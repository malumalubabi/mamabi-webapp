import { getSupabase, getBrandId, jsonResponse, errorResponse } from "../_lib/supabase.js";

export async function onRequestPatch({ request, env, params }) {
  try {
    const body = await request.json();
    if (!body.qty || Number(body.qty) <= 0) return jsonResponse({ error: "qty must be greater than 0" }, 400);

    const id = decodeURIComponent(params.id);
    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    const { data, error } = await supabase
      .from("recipe_lines")
      .update({ qty_per_batch_unit: Number(body.qty) })
      .eq("brand_id", brandId)
      .eq("id", id)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) return jsonResponse({ error: "Recipe line not found: " + id }, 404);

    return jsonResponse({ id: data.id });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function onRequestDelete({ env, params }) {
  try {
    const id = decodeURIComponent(params.id);
    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    const { data, error } = await supabase
      .from("recipe_lines")
      .delete()
      .eq("brand_id", brandId)
      .eq("id", id)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) return jsonResponse({ error: "Recipe line not found: " + id }, 404);

    return jsonResponse({ id: data.id });
  } catch (err) {
    return errorResponse(err);
  }
}
