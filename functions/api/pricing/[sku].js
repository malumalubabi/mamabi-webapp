import { getSupabase, getBrandId, jsonResponse, errorResponse } from "../_lib/supabase.js";

export async function onRequestPatch({ request, env, params }) {
  try {
    const body = await request.json();
    if (body.sellingPrice === undefined) return jsonResponse({ error: "sellingPrice is required" }, 400);

    const sku = decodeURIComponent(params.sku);
    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    const { data, error } = await supabase
      .from("sku_items")
      .update({ selling_price: Number(body.sellingPrice) })
      .eq("brand_id", brandId)
      .eq("sku", sku)
      .eq("item_type", "Product")
      .select("sku")
      .maybeSingle();
    if (error) throw error;
    if (!data) return jsonResponse({ error: "Product SKU not found: " + sku }, 404);

    return jsonResponse({ sku: data.sku });
  } catch (err) {
    return errorResponse(err);
  }
}
