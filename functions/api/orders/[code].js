// Inline status-update endpoint for one order row in the ongoing/history
// table - PATCH /api/orders/ORD-0079. Also handles Edit Order (Ongoing
// Orders' own Edit button, see pages/orders.js's openEditOrderModal) - a
// separate concern (editing static order details/items, not a status
// transition) that shares this endpoint rather than a new route, since this
// is already the one mutation point for an order. items, when present,
// fully replace order_items (reconciled by lineId - update/delete-not-
// present/insert-new, same pattern as purchases/[code].js), with cost
// snapshots recomputed fresh from current costing - safe because Edit Order
// is only ever reachable from the Ongoing list, and an order there has
// never reached Completed yet (recordOrderConsumption hasn't fired for it),
// so there's no stale consumption/stock record an item edit could desync.
import { getSupabase, getBrandId, jsonResponse, errorResponse } from "../_lib/supabase.js";
import { buildCostResolver } from "../_lib/costing.js";
import { recordOrderConsumption, normalizeDriverNameRaw } from "../_lib/orders.js";
import { resyncDriverPayoutOpexGroup } from "../_lib/opex.js";

const PATCHABLE_FIELDS = {
  orderStatus: "order_status",
  fulfillmentStatus: "fulfillment_status",
  paymentStatus: "payment_status",
  paymentMethod: "payment_method",
  deliveryDate: "delivery_date",
  orderType: "order_type",
  deliveryFee: "delivery_fee",
  notes: "notes",
  driverStaffId: "driver_staff_id",
  driverNameRaw: "driver_name_raw",
  driverPayout: "driver_payout",
  driverPayoutStatus: "driver_payout_status",
  driverPayoutMethod: "driver_payout_method",
  driverPayoutOpexCode: "driver_payout_opex_code"
};

export async function onRequestPatch({ request, env, params }) {
  try {
    const body = await request.json();
    const update = {};
    for (const [clientKey, column] of Object.entries(PATCHABLE_FIELDS)) {
      if (clientKey in body) update[column] = body[clientKey];
    }
    if ("driverNameRaw" in body) update.driver_name_raw = normalizeDriverNameRaw(body.driverNameRaw);

    const hasItemsUpdate = Array.isArray(body.items);
    if (!Object.keys(update).length && !hasItemsUpdate) {
      return jsonResponse({ error: "No updatable fields provided" }, 400);
    }

    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    const { data: current, error: curErr } = await supabase
      .from("orders")
      .select("id, order_status, payment_status, fulfillment_status, delivery_fee, driver_staff_id, driver_name_raw, order_date")
      .eq("brand_id", brandId)
      .eq("order_code", params.code)
      .maybeSingle();
    if (curErr) throw curErr;
    if (!current) return jsonResponse({ error: "Order not found: " + params.code }, 404);

    // Ported from the old app's isOrderDone_(): once an order is Paid AND
    // fulfillment is no longer Pending, it's done. The old sheet never
    // stored that as an explicit status (it was a derived display label) -
    // our schema's order_status is a real column other things key off
    // (stock_ledger's Sale moves only count 'Completed' orders), so we
    // persist the transition here instead of re-deriving it everywhere.
    const effective = {
      orderStatus: update.order_status ?? current.order_status,
      paymentStatus: update.payment_status ?? current.payment_status,
      fulfillmentStatus: update.fulfillment_status ?? current.fulfillment_status
    };
    const isDone = effective.orderStatus === "Cancelled" || (effective.paymentStatus === "Paid" && effective.fulfillmentStatus !== "Pending");
    const becomingCompleted = isDone && effective.orderStatus !== "Cancelled" && effective.orderStatus !== "Completed";
    if (becomingCompleted) {
      update.order_status = "Completed";
    }

    // An items-only edit (no scalar fields changed) has nothing for this
    // UPDATE to set - skip it rather than sending an empty SET clause, and
    // fall back to `current`'s own id/order_code/order_date for the items
    // reconciliation and response below.
    let data = { id: current.id, order_code: params.code, order_date: current.order_date };
    if (Object.keys(update).length) {
      const { data: updated, error } = await supabase
        .from("orders")
        .update(update)
        .eq("brand_id", brandId)
        .eq("order_code", params.code)
        .select("id, order_code, order_date")
        .maybeSingle();
      if (error) throw error;
      if (!updated) return jsonResponse({ error: "Order not found: " + params.code }, 404);
      data = updated;
    }

    if (hasItemsUpdate) {
      const resolver = await buildCostResolver(supabase, brandId);
      const { data: existingItems, error: existErr } = await supabase.from("order_items").select("id").eq("order_id", current.id);
      if (existErr) throw existErr;
      const existingIds = new Set(existingItems.map((it) => it.id));
      const sentIds = new Set(body.items.filter((it) => it.lineId).map((it) => it.lineId));

      const toDelete = [...existingIds].filter((id) => !sentIds.has(id));
      if (toDelete.length) {
        const { error: delErr } = await supabase.from("order_items").delete().in("id", toDelete);
        if (delErr) throw delErr;
      }

      // Sequential (not Promise.all) - avoids racing whatever DB triggers
      // key off order_items writes, same reasoning as
      // purchases/[code].js's line reconciliation.
      for (const it of body.items) {
        const qty = Number(it.qty);
        const { items: recipeItems } = resolver.getBreakdown(it.skuId);
        const foodCostPerUnit = recipeItems.filter((x) => x.itemType !== "Packaging").reduce((sum, x) => sum + x.lineCost, 0);
        const packagingCostPerUnit = recipeItems.filter((x) => x.itemType === "Packaging").reduce((sum, x) => sum + x.lineCost, 0);
        const row = {
          order_id: current.id,
          sku_id: it.skuId,
          qty: qty,
          unit_price: it.unitPrice,
          food_cost_snapshot: foodCostPerUnit * qty,
          packaging_cost_snapshot: packagingCostPerUnit * qty
        };
        if (it.lineId && existingIds.has(it.lineId)) {
          const { error: updErr } = await supabase.from("order_items").update(row).eq("id", it.lineId);
          if (updErr) throw updErr;
        } else {
          const { error: insErr } = await supabase.from("order_items").insert(row);
          if (insErr) throw insErr;
        }
      }
    }

    // Deduct stock for direct-recipe Ingredient/Packaging/Operating lines,
    // and resync the Driver Payout OpEx group, both at the exact moment
    // this order becomes Completed (see _lib/orders.js and _lib/opex.js) -
    // the far more common path than POST's already-Completed case, since
    // most orders are created Ongoing and reach Completed later via Mark
    // Paid/Mark Delivered.
    if (becomingCompleted) {
      const { data: items, error: itemsErr } = await supabase
        .from("order_items")
        .select("sku_id, qty")
        .eq("order_id", data.id);
      if (itemsErr) throw itemsErr;

      const resolver = await buildCostResolver(supabase, brandId);
      await recordOrderConsumption(supabase, resolver, data.order_code, data.order_date, items.map((it) => ({ skuId: it.sku_id, qty: it.qty })));

      // Effective driver/fee AFTER this PATCH - from the body if this same
      // call changed them, else whatever was already stored. Accrual-based
      // (functions/api/_lib/opex.js's resyncDriverPayoutOpexGroup): the fee
      // becomes a real expense right here, regardless of driver_payout_status.
      const effectiveDeliveryFee = "deliveryFee" in body ? body.deliveryFee : current.delivery_fee;
      const effectiveDriverIsStaff = "driverStaffId" in body || "driverNameRaw" in body ? !!body.driverStaffId : !!current.driver_staff_id;
      const effectiveDriverKey = effectiveDriverIsStaff
        ? ("driverStaffId" in body ? body.driverStaffId : current.driver_staff_id)
        : ("driverNameRaw" in body ? normalizeDriverNameRaw(body.driverNameRaw) : current.driver_name_raw);

      if (effectiveDriverKey && Number(effectiveDeliveryFee) > 0) {
        await resyncDriverPayoutOpexGroup(supabase, brandId, effectiveDriverKey, effectiveDriverIsStaff, String(data.order_date).slice(0, 7));
      }
    }

    return jsonResponse({ orderCode: data.order_code });
  } catch (err) {
    return errorResponse(err);
  }
}
