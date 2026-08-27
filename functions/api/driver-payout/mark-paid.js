// Marks every given order's driver_payout_status Paid. Used to just also
// re-derive the Driver Payout OpEx entry (resyncDriverPayoutOpexGroup) here,
// but that's now accrual-based - the OpEx entry is created/updated the
// moment an order becomes Completed (functions/api/orders.js POST,
// functions/api/orders/[code].js PATCH), not when the driver is actually
// paid. Mark Paid is now purely a cash-tracking action: it doesn't touch
// opex_entries at all, so the P&L/OpEx side stays on accrual timing
// regardless of when this gets clicked.
//
// No payment date input - the OpEx entry's date (set at the accrual point
// above) is the group's latest order_date, not when Mark Paid was clicked,
// so there's nothing left for a payment date field to drive here either.
import { getSupabase, getBrandId, jsonResponse, errorResponse } from "../_lib/supabase.js";

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
      .select("order_code, delivery_fee")
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

    return jsonResponse({ count: orders.length });
  } catch (err) {
    return errorResponse(err);
  }
}
