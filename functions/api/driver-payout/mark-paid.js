// Replaces the old per-order sequence in pages/orders.js's
// confirmMarkGroupPaid() (one POST /api/opex per order). Marks every given
// order Paid, then re-derives the Driver Payout OpEx entry for every
// driver+month touched from scratch (resyncDriverPayoutOpexGroup) instead of
// creating one opex entry per order - see functions/api/_lib/opex.js for why
// this has to be a full resync rather than an incremental append.
//
// No payment date input anymore - the OpEx entry's date is now the group's
// latest order_date (per explicit request), not when Mark Paid was clicked,
// so there's nothing left for a payment date field to drive. The Mark Paid
// modal dropped that field accordingly (see pages/orders.js).
import { getSupabase, getBrandId, jsonResponse, errorResponse } from "../_lib/supabase.js";
import { resyncDriverPayoutOpexGroup } from "../_lib/opex.js";

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    if (!Array.isArray(body.orderCodes) || !body.orderCodes.length) {
      return jsonResponse({ error: "orderCodes is required" }, 400);
    }

    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    const { data: orders, error: selErr } = await supabase
      .from("orders")
      .select("order_code, order_date, delivery_fee, driver_staff_id, driver_name_raw")
      .eq("brand_id", brandId)
      .in("order_code", body.orderCodes);
    if (selErr) throw selErr;
    if (!orders.length) return jsonResponse({ error: "No matching orders" }, 404);

    await Promise.all(orders.map((o) =>
      supabase
        .from("orders")
        .update({
          driver_payout_status: "Paid",
          driver_payout_method: body.method || null,
          driver_payout: o.delivery_fee
        })
        .eq("brand_id", brandId)
        .eq("order_code", o.order_code)
    ));

    // Distinct (driver, month) pairs touched by this batch - a driver paid
    // for orders spanning several months gets one resync call per month.
    const groups = new Map();
    orders.forEach((o) => {
      const driverIsStaff = !!o.driver_staff_id;
      const driverKey = driverIsStaff ? o.driver_staff_id : o.driver_name_raw;
      if (!driverKey) return; // Unassigned - shouldn't happen (Mark Paid is disabled for it client-side), but skip defensively
      const monthKey = String(o.order_date).slice(0, 7);
      groups.set(driverKey + "|" + driverIsStaff + "|" + monthKey, { driverKey, driverIsStaff, monthKey });
    });

    for (const g of groups.values()) {
      await resyncDriverPayoutOpexGroup(supabase, brandId, g.driverKey, g.driverIsStaff, g.monthKey);
    }

    return jsonResponse({ count: orders.length });
  } catch (err) {
    return errorResponse(err);
  }
}
