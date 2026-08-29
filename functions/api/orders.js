import { getSupabase, getBrandId, jsonResponse, errorResponse } from "./_lib/supabase.js";
import { nextCode } from "./_lib/codes.js";
import { buildCostResolver } from "./_lib/costing.js";
import { resyncDriverPayoutOpexGroup } from "./_lib/opex.js";
import { recordOrderConsumption, normalizeDriverNameRaw } from "./_lib/orders.js";

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
  "driver_payout_status, driver_payout_method, driver_payout_opex_code, notes, platform, created_at, " +
  "platform_order_id, platform_pin, platform_fulfillment_type, platform_service_fee, platform_customer_name, platform_promotions, " +
  "customers(name, contact, address), staff(name), " +
  "order_items(qty, unit_price, line_total, food_cost_snapshot, packaging_cost_snapshot, notes, sku_items(sku, name)), " +
  "order_status_events(event_name, occurred_at)";

export async function onRequestGet({ request, env }) {
  try {
    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    const url = new URL(request.url);
    const scope = url.searchParams.get("scope") || "ongoing";
    // Online Orders page passes "Online"; Platform Orders page passes
    // "GrabFood,GoFood" - comma-separated so a future Dine-In page can
    // reuse this same param instead of a new one-off filter.
    const platformParam = url.searchParams.get("platform");
    const platforms = platformParam ? platformParam.split(",") : null;

    let query = supabase
      .from("orders")
      .select(ORDER_SELECT)
      .eq("brand_id", brandId);
    if (platforms) query = query.in("platform", platforms);
    query = query.order("order_code", { ascending: false });

    const { data, error } = await query;
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

    // Normalized once so every downstream use (isGrabExpress check, the
    // stored column, and the OpEx grouping call below) agrees on the exact
    // same string - see _lib/orders.js's normalizeDriverNameRaw.
    const driverNameRaw = normalizeDriverNameRaw(body.driverNameRaw);

    // GrabExpress is paid cash to the driver on pickup, real-time per
    // delivery - unlike internal drivers (Rian/Aaron/Chris) who get paid
    // lumpsum later, it never needs to sit in Unpaid Payout waiting for a
    // manual Mark Paid. Only driver_name_raw (external), never a
    // driver_staff_id (internal), per the user's explicit instruction.
    const isGrabExpress = driverNameRaw === "GrabExpress";

    // order_status is derived, never a manual field (see isOrderDone above
    // and functions/api/orders/[code].js's PATCH, which re-derives the same
    // way on every update) - Cancelled is the only value ever set directly,
    // and only later via the Cancel Order action, never at creation.
    const paymentStatus = body.paymentStatus || "Unpaid";
    const fulfillmentStatus = body.fulfillmentStatus || "Pending";
    const orderStatus = paymentStatus === "Paid" && fulfillmentStatus !== "Pending" ? "Completed" : "Ongoing";

    const insertRow = {
      brand_id: brandId,
      order_code: orderCode,
      order_date: body.orderDate,
      delivery_date: body.deliveryDate || null,
      customer_id: body.customerId,
      order_type: body.orderType,
      order_status: orderStatus,
      fulfillment_status: fulfillmentStatus,
      payment_status: paymentStatus,
      payment_method: body.paymentMethod || null,
      delivery_fee: deliveryFee,
      driver_staff_id: body.driverStaffId || null,
      driver_name_raw: driverNameRaw,
      notes: body.notes || null,
      platform: body.platform || "Online"
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

    // Deduct stock for direct-recipe Ingredient/Packaging/Operating lines,
    // and (below) resync the Driver Payout OpEx group - both when an order
    // arrives already Completed (Paid + fulfilled in one shot). Reuses the
    // same resolver as the cost snapshots above.
    if (orderStatus === "Completed") {
      await recordOrderConsumption(supabase, resolver, order.order_code, body.orderDate, body.items);

      // Driver Payout OpEx is accrual-based (functions/api/_lib/opex.js's
      // resyncDriverPayoutOpexGroup) - the fee is a real expense the moment
      // the order is Completed, regardless of whether the driver has
      // actually been paid yet (that's driver_payout_status, tracked
      // separately). Every driver type, not just GrabExpress - any order
      // that arrives already-Completed with a fee accrues it immediately.
      // Skipped when there's no driver or a zero fee (free delivery/Takeaway).
      const driverIsStaff = !!body.driverStaffId;
      const driverKey = driverIsStaff ? body.driverStaffId : driverNameRaw;
      if (driverKey && deliveryFee > 0) {
        await resyncDriverPayoutOpexGroup(supabase, brandId, driverKey, driverIsStaff, body.orderDate.slice(0, 7));
      }
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
    platform: o.platform,
    createdAt: o.created_at,
    platformOrderId: o.platform_order_id,
    platformPin: o.platform_pin,
    platformFulfillmentType: o.platform_fulfillment_type,
    platformServiceFee: Number(o.platform_service_fee) || 0,
    platformPromotions: o.platform_promotions,
    // Sorted chronologically here (not left to the client) - the "created"
    // event isn't always guaranteed to be first if events ever arrive
    // out of order (webhook delivery isn't ordered), and the Status column
    // timeline needs to read top-to-bottom correctly regardless.
    statusEvents: (o.order_status_events || [])
      .map((e) => ({ event: e.event_name, occurredAt: e.occurred_at }))
      .sort((a, b) => new Date(a.occurredAt) - new Date(b.occurredAt)),
    customerName: o.customers ? o.customers.name : (o.platform_customer_name || ""),
    customerContact: o.customers ? o.customers.contact : "",
    customerAddress: o.customers ? o.customers.address : "",
    items: (o.order_items || []).map((it) => ({
      sku: it.sku_items ? it.sku_items.sku : "",
      name: it.sku_items ? it.sku_items.name : "",
      qty: Number(it.qty),
      unitPrice: Number(it.unit_price),
      lineTotal: Number(it.line_total),
      notes: it.notes,
      foodCostSnapshot: it.food_cost_snapshot === null ? null : Number(it.food_cost_snapshot),
      packagingCostSnapshot: it.packaging_cost_snapshot === null ? null : Number(it.packaging_cost_snapshot)
    }))
  };
}
