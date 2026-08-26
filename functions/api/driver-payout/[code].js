// Replaces the ad-hoc opex PATCH/DELETE + order PATCH sequence that used to
// live in pages/orders.js's savePayoutEdit() (Payout History's inline Fee/
// Driver/Method/Status edit) - now that a Driver Payout OpEx entry can be
// shared by several orders (grouped per driver+month), editing one order's
// fee/driver/status can no longer just PATCH "its" opex entry directly (that
// would clobber every other order sharing it). Instead: update the order,
// then fully resync both the group it's leaving (old driver+month, if it was
// Paid before) and the group it's joining (new driver+month, if it's Paid
// now) - same resync helper Mark Paid uses, see functions/api/_lib/opex.js.
import { getSupabase, getBrandId, jsonResponse, errorResponse } from "../_lib/supabase.js";
import { resyncDriverPayoutOpexGroup } from "../_lib/opex.js";

export async function onRequestPatch({ request, env, params }) {
  try {
    const body = await request.json();
    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    const { data: current, error: curErr } = await supabase
      .from("orders")
      .select("order_code, order_date, driver_staff_id, driver_name_raw")
      .eq("brand_id", brandId)
      .eq("order_code", params.code)
      .maybeSingle();
    if (curErr) throw curErr;
    if (!current) return jsonResponse({ error: "Order not found: " + params.code }, 404);

    const oldDriverIsStaff = !!current.driver_staff_id;
    const oldDriverKey = oldDriverIsStaff ? current.driver_staff_id : current.driver_name_raw;
    const monthKey = String(current.order_date).slice(0, 7); // order_date isn't editable here, month never changes

    const update = {};
    if ("deliveryFee" in body) update.delivery_fee = body.deliveryFee;
    if ("driverStaffId" in body) update.driver_staff_id = body.driverStaffId;
    if ("driverNameRaw" in body) update.driver_name_raw = body.driverNameRaw;
    if ("driverPayoutMethod" in body) update.driver_payout_method = body.driverPayoutMethod;
    if ("driverPayoutStatus" in body) update.driver_payout_status = body.driverPayoutStatus;

    const { error: updErr } = await supabase
      .from("orders")
      .update(update)
      .eq("brand_id", brandId)
      .eq("order_code", params.code);
    if (updErr) throw updErr;

    const newDriverIsStaff = "driverStaffId" in body || "driverNameRaw" in body ? !!body.driverStaffId : oldDriverIsStaff;
    const newDriverKey = newDriverIsStaff
      ? ("driverStaffId" in body ? body.driverStaffId : current.driver_staff_id)
      : ("driverNameRaw" in body ? body.driverNameRaw : current.driver_name_raw);

    await resyncDriverPayoutOpexGroup(supabase, brandId, oldDriverKey, oldDriverIsStaff, monthKey);
    if (newDriverKey !== oldDriverKey || newDriverIsStaff !== oldDriverIsStaff) {
      await resyncDriverPayoutOpexGroup(supabase, brandId, newDriverKey, newDriverIsStaff, monthKey);
    }

    return jsonResponse({ orderCode: params.code });
  } catch (err) {
    return errorResponse(err);
  }
}
