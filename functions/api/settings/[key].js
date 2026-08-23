// Generic single-key update for the settings table (brand_id, key, value) -
// key is a human-readable string (e.g. "Platform Fee %"), not a code, so it
// travels URL-encoded (spaces/% included) and gets decoded back here, same
// pattern as orders/[code].js etc.
import { getSupabase, getBrandId, jsonResponse, errorResponse } from "../_lib/supabase.js";

export async function onRequestPatch({ request, env, params }) {
  try {
    const body = await request.json();
    if (body.value === undefined || body.value === null || body.value === "") {
      return jsonResponse({ error: "value is required" }, 400);
    }

    const key = decodeURIComponent(params.key);
    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    const { data, error } = await supabase
      .from("settings")
      .update({ value: String(body.value) })
      .eq("brand_id", brandId)
      .eq("key", key)
      .select("key, value")
      .maybeSingle();
    if (error) throw error;
    if (!data) return jsonResponse({ error: "Setting not found: " + key }, 404);

    return jsonResponse(data);
  } catch (err) {
    return errorResponse(err);
  }
}
