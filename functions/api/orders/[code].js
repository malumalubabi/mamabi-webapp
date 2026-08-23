// Inline status-update endpoint for one order row in the ongoing/history
// table - PATCH /api/orders/ORD-0079. Only touches the fields the client
// actually sends (status dropdowns, driver, payment), never the items.
import { getSupabase, getBrandId, jsonResponse, errorResponse } from "../_lib/supabase.js";

const PATCHABLE_FIELDS = {
  orderStatus: "order_status",
  fulfillmentStatus: "fulfillment_status",
  paymentStatus: "payment_status",
  paymentMethod: "payment_method",
  deliveryFee: "delivery_fee",
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
    if (!Object.keys(update).length) {
      return jsonResponse({ error: "No updatable fields provided" }, 400);
    }

    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    const { data: current, error: curErr } = await supabase
      .from("orders")
      .select("order_status, payment_status, fulfillment_status")
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
    if (isDone && effective.orderStatus !== "Cancelled" && effective.orderStatus !== "Completed") {
      update.order_status = "Completed";
    }

    const { data, error } = await supabase
      .from("orders")
      .update(update)
      .eq("brand_id", brandId)
      .eq("order_code", params.code)
      .select("order_code")
      .maybeSingle();
    if (error) throw error;
    if (!data) return jsonResponse({ error: "Order not found: " + params.code }, 404);

    return jsonResponse({ orderCode: data.order_code });
  } catch (err) {
    return errorResponse(err);
  }
}
