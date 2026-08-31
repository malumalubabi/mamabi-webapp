import { getSupabase, getBrandId, jsonResponse, errorResponse } from "../_lib/supabase.js";

export async function onRequestDelete({ env, params }) {
  try {
    const code = decodeURIComponent(params.code);
    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    const { data, error } = await supabase
      .from("outlet_closures")
      .delete()
      .eq("brand_id", brandId)
      .eq("closure_code", code)
      .select("closure_code")
      .maybeSingle();
    if (error) throw error;
    if (!data) return jsonResponse({ error: "Closure not found: " + code }, 404);

    return jsonResponse({ closureCode: data.closure_code });
  } catch (err) {
    return errorResponse(err);
  }
}
