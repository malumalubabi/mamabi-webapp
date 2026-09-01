import { getSupabase, getBrandId, jsonResponse, errorResponse } from "../_lib/supabase.js";

export async function onRequestDelete({ env, params }) {
  try {
    const code = decodeURIComponent(params.code);
    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    const { data, error } = await supabase
      .from("calendar_events")
      .delete()
      .eq("brand_id", brandId)
      .eq("event_code", code)
      .select("event_code")
      .maybeSingle();
    if (error) throw error;
    if (!data) return jsonResponse({ error: "Event not found: " + code }, 404);

    return jsonResponse({ eventCode: data.event_code });
  } catch (err) {
    return errorResponse(err);
  }
}
