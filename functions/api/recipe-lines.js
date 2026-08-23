// Menu Engineering - Costing's "Manage Costing" modal writes here to add a
// new ingredient/component/packaging line to a recipe. Editing an existing
// line's qty or deleting one goes through recipe-lines/[id].js instead.
import { getSupabase, getBrandId, jsonResponse, errorResponse } from "./_lib/supabase.js";

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    if (!body.parentSku) return jsonResponse({ error: "parentSku is required" }, 400);
    if (!body.componentSku) return jsonResponse({ error: "componentSku is required" }, 400);
    if (!body.qty || Number(body.qty) <= 0) return jsonResponse({ error: "qty must be greater than 0" }, 400);
    if (body.parentSku === body.componentSku) return jsonResponse({ error: "A recipe can't reference itself as an ingredient." }, 400);

    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    const { data: skus, error: skuErr } = await supabase
      .from("sku_items")
      .select("id, sku, unit")
      .eq("brand_id", brandId)
      .in("sku", [body.parentSku, body.componentSku]);
    if (skuErr) throw skuErr;

    const parent = skus.find((s) => s.sku === body.parentSku);
    const component = skus.find((s) => s.sku === body.componentSku);
    if (!parent) return jsonResponse({ error: "Parent SKU not found: " + body.parentSku }, 404);
    if (!component) return jsonResponse({ error: "Component SKU not found: " + body.componentSku }, 404);

    const { data, error } = await supabase
      .from("recipe_lines")
      .insert({
        brand_id: brandId,
        parent_sku_id: parent.id,
        component_sku_id: component.id,
        qty_per_batch_unit: Number(body.qty),
        unit: body.unit || component.unit
      })
      .select("id")
      .single();
    if (error) throw error;

    return jsonResponse({ id: data.id }, 201);
  } catch (err) {
    return errorResponse(err);
  }
}
