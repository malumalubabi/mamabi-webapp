import { getSupabase, getBrandId, jsonResponse, errorResponse } from "../_lib/supabase.js";

export async function onRequestPatch({ request, env, params }) {
  try {
    const weekday = Number(params.weekday);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return jsonResponse({ error: "Invalid weekday" }, 400);

    const body = await request.json();
    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    const update = {};
    if (body.isOpen !== undefined) update.is_open = !!body.isOpen;
    if (body.openTime !== undefined) update.open_time = body.openTime || null;
    if (body.closeTime !== undefined) update.close_time = body.closeTime || null;
    if (!Object.keys(update).length) return jsonResponse({ error: "No updatable fields provided" }, 400);

    const { data, error } = await supabase
      .from("outlet_hours")
      .update(update)
      .eq("brand_id", brandId)
      .eq("weekday", weekday)
      .select("weekday, is_open, open_time, close_time")
      .maybeSingle();
    if (error) throw error;
    if (!data) return jsonResponse({ error: "Weekday not found: " + weekday }, 404);

    return jsonResponse({ weekday: data.weekday, isOpen: data.is_open, openTime: data.open_time, closeTime: data.close_time });
  } catch (err) {
    return errorResponse(err);
  }
}
