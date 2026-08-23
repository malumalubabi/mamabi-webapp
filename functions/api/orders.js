import { getSupabase, getBrandId, jsonResponse, errorResponse } from "./_lib/supabase.js";
import { nextCode } from "./_lib/codes.js";
import { buildCostResolver } from "./_lib/costing.js";

// Ported from the old app's isOrderDone_() (OrdersService.gs): an order is
// "done" (History) once it's Cancelled, or once it's Paid AND fulfillment
// is no longer Pending (Delivered/Picked Up) - regardless of whatever
// order_status happens to say. Everything else is "Ongoing". See also the
// PATCH handler, which flips order_status to Completed when this condition
// first becomes true, so stock_ledger (which keys off order_status =
// 'Completed' for Sale moves) stays in sync with this rule.
export function isOrderDone(o) {
  return o.orderStatus === "Cancelled" || (o.paymentStatus === "Paid" && o.fulfillmentStatus !== "Pending");
}

const ORDER_SELECT =
  "order_code, order_date, delivery_date, order_type, order_status, fulfillment_status, " +
  "payment_status, payment_method, delivery_fee, driver_staff_id, driver_name_raw, driver_payout, " +
  "driver_payout_status, driver_payout_method, driver_payout_opex_code, notes, " +
  "customers(name, contact), staff(name), " +
  "order_items(qty, unit_price, line_total, food_cost_snapshot, packaging_cost_snapshot, sku_items(sku, name))";

export async function onRequestGet({ request, env }) {
  try {
    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    const url = new URL(request.url);
    const scope = url.searchParams.get("scope") || "ongoing";

    const { data, error } = await supabase
      .from("orders")
      .select(ORDER_SELECT)
      .eq("brand_id", brandId)
      .order("order_code", { ascending: false });
    if (error) throw error;

    const shaped = data.map(shapeOrder);
    const filtered = scope === "history" ? shaped.filter(isOrderDone) : shaped.filter((o) => !isOrderDone(o));

    return jsonResponse(filtered);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    if (!body.customerId) return jsonResponse({ error: "Customer is required" }, 400);
    if (!Array.isArray(body.items) || !body.items.length) {
      return jsonResponse({ error: "At least one item is required" }, 400);
    }

    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);
    const orderCode = await nextCode(supabase, "orders", "order_code", brandId, "ORD", 4);

    const deliveryFee = body.deliveryFee || 0;

    // GrabExpress is paid cash to the driver on pickup, real-time per
    // delivery - unlike internal drivers (Rian/Aaron/Chris) who get paid
    // lumpsum later, it never needs to sit in Unpaid Payout waiting for a
    // manual Mark Paid. Case-insensitive so "grabexpress"/"GrabExpress "
    // etc. still match; only driver_name_raw (external), never a
    // driver_staff_id (internal), per the user's explicit instruction.
    const isGrabExpress = typeof body.driverNameRaw === "string" && body.driverNameRaw.trim().toLowerCase() === "grabexpress";

    const insertRow = {
      brand_id: brandId,
      order_code: orderCode,
      order_date: body.orderDate,
      delivery_date: body.deliveryDate || null,
      customer_id: body.customerId,
      order_type: body.orderType,
      order_status: body.orderStatus || "Ongoing",
      fulfillment_status: body.fulfillmentStatus || "Pending",
      payment_status: body.paymentStatus || "Unpaid",
      payment_method: body.paymentMethod || null,
      delivery_fee: deliveryFee,
      driver_staff_id: body.driverStaffId || null,
      driver_name_raw: body.driverNameRaw || null,
      notes: body.notes || null
    };
    if (isGrabExpress) {
      insertRow.driver_payout_status = "Paid";
      insertRow.driver_payout = deliveryFee;
      insertRow.driver_payout_method = "Cash";
    }

    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .insert(insertRow)
      .select("id, order_code")
      .single();
    if (orderErr) throw orderErr;

    // Food/Packaging Cost snapshotted from live Costing AT THIS MOMENT, per
    // the same rule as the old app (OrdersService.gs saveOrder): stored once
    // here, read back forever after (Sales Log, margin reporting) instead of
    // recomputed live - so a Product's recipe/cost changing later never
    // silently rewrites this order's historical margin.
    const resolver = await buildCostResolver(supabase, brandId);
    const itemRows = body.items.map((it) => {
      const qty = Number(it.qty);
      const { items: recipeItems } = resolver.getBreakdown(it.skuId);
      const foodCostPerUnit = recipeItems.filter((x) => x.itemType !== "Packaging").reduce((sum, x) => sum + x.lineCost, 0);
      const packagingCostPerUnit = recipeItems.filter((x) => x.itemType === "Packaging").reduce((sum, x) => sum + x.lineCost, 0);

      return {
        order_id: order.id,
        sku_id: it.skuId,
        qty: qty,
        unit_price: it.unitPrice,
        food_cost_snapshot: foodCostPerUnit * qty,
        packaging_cost_snapshot: packagingCostPerUnit * qty
      };
    });

    const { error: itemsErr } = await supabase.from("order_items").insert(itemRows);
    if (itemsErr) {
      // Best-effort rollback - the order row is useless without its items.
      await supabase.from("orders").delete().eq("id", order.id);
      throw itemsErr;
    }

    // Same OpEx-per-order rule as Driver Payout's Mark Paid (see
    // pages/orders.js confirmMarkGroupPaid) - one "Logistic" entry, skipped
    // for a zero fee (free delivery), since GrabExpress's fee is still a
    // real MaMaBi expense, not a pass-through.
    if (isGrabExpress && deliveryFee > 0) {
      const opexCode = await nextCode(supabase, "opex_entries", "opex_code", brandId, "OPX", 4);
      const { error: opexErr } = await supabase.from("opex_entries").insert({
        brand_id: brandId,
        opex_code: opexCode,
        entry_date: body.orderDate,
        category: "Logistic",
        description: "Driver Fee GrabExpress, " + order.order_code,
        gross_amount: deliveryFee,
        amort: "No",
        period: 1
      });
      if (opexErr) throw opexErr;

      const { error: linkErr } = await supabase
        .from("orders")
        .update({ driver_payout_opex_code: opexCode })
        .eq("id", order.id);
      if (linkErr) throw linkErr;
    }

    return jsonResponse({ orderCode: order.order_code }, 201);
  } catch (err) {
    return errorResponse(err);
  }
}

function shapeOrder(o) {
  return {
    orderCode: o.order_code,
    orderDate: o.order_date,
    deliveryDate: o.delivery_date,
    orderType: o.order_type,
    orderStatus: o.order_status,
    fulfillmentStatus: o.fulfillment_status,
    paymentStatus: o.payment_status,
    paymentMethod: o.payment_method,
    deliveryFee: Number(o.delivery_fee) || 0,
    driverStaffId: o.driver_staff_id,
    driverNameRaw: o.driver_name_raw,
    driverName: o.staff ? o.staff.name : (o.driver_name_raw || ""),
    driverPayout: o.driver_payout === null ? null : Number(o.driver_payout),
    driverPayoutStatus: o.driver_payout_status,
    driverPayoutMethod: o.driver_payout_method,
    driverPayoutOpexCode: o.driver_payout_opex_code,
    notes: o.notes,
    customerName: o.customers ? o.customers.name : "",
    customerContact: o.customers ? o.customers.contact : "",
    items: (o.order_items || []).map((it) => ({
      sku: it.sku_items ? it.sku_items.sku : "",
      name: it.sku_items ? it.sku_items.name : "",
      qty: Number(it.qty),
      unitPrice: Number(it.unit_price),
      lineTotal: Number(it.line_total),
      foodCostSnapshot: it.food_cost_snapshot === null ? null : Number(it.food_cost_snapshot),
      packagingCostSnapshot: it.packaging_cost_snapshot === null ? null : Number(it.packaging_cost_snapshot)
    }))
  };
}
