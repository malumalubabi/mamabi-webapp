// Database > SKU - full list (optionally filtered by ?type=) + create.
// lookups.js has its own select of every SKU (all types) for other modules'
// comboboxes - this is the standalone management page's data source.
import { getSupabase, getBrandId, jsonResponse, errorResponse } from "./_lib/supabase.js";
import { nextCode } from "./_lib/codes.js";

export async function onRequestGet({ request, env }) {
  try {
    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);
    const type = new URL(request.url).searchParams.get("type");

    let query = supabase
      .from("sku_items")
      .select("id, sku, item_type, category, name, unit, status")
      .eq("brand_id", brandId);
    if (type) query = query.eq("item_type", type);

    // Product uses display_order (Menu Engineering > Pricing's own Arrange
    // column, kept in sync via sku-order.js) so this page's Product order
    // always matches Pricing's; every other type uses registry_order (also
    // what Stock Overview sorts by).
    query = type === "Product" ? query.order("display_order") : query.order("registry_order");

    const { data, error } = await query;
    if (error) throw error;

    return jsonResponse(data);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const name = (body.name || "").trim();
    const unit = (body.unit || "").trim();
    const itemType = (body.itemType || "").trim();
    const category = (body.category || "").trim();

    if (!itemType) return jsonResponse({ error: "Item Type is required" }, 400);
    if (!category) return jsonResponse({ error: "Category is required" }, 400);
    if (!name) return jsonResponse({ error: "Item Name is required" }, 400);
    if (!unit) return jsonResponse({ error: "Unit is required" }, 400);

    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    // SKU codes follow TYPE-CATEGORY-NNNN (e.g. "SF-AROM-0001") - the TYPE
    // and CATEGORY segments come from Settings > SKU Configuration
    // (settings_lists "SKU Type Code" / "SKU Category Code - {itemType}"),
    // not derived from any existing sku_items row - see pages/settings.js's
    // Manage SKU Config modal and pages/database.js's Add SKU form, whose
    // Category dropdown only ever offers categories configured there.
    const [typeRes, categoryRes] = await Promise.all([
      supabase.from("settings_lists").select("meta").eq("brand_id", brandId).eq("list_name", "SKU Type Code").eq("value", itemType).maybeSingle(),
      supabase.from("settings_lists").select("meta").eq("brand_id", brandId).eq("list_name", "SKU Category Code - " + itemType).eq("value", category).maybeSingle()
    ]);
    if (typeRes.error) throw typeRes.error;
    if (categoryRes.error) throw categoryRes.error;
    if (!typeRes.data || !typeRes.data.meta) return jsonResponse({ error: "No SKU code configured for Type \"" + itemType + "\" - add it in Settings > Manage SKU Config first." }, 400);
    if (!categoryRes.data || !categoryRes.data.meta) return jsonResponse({ error: "No SKU code configured for Category \"" + category + "\" - add it in Settings > Manage SKU Config first." }, 400);

    const prefix = typeRes.data.meta + "-" + categoryRes.data.meta;
    const sku = await nextCode(supabase, "sku_items", "sku", brandId, prefix, 4);

    const { data, error } = await supabase
      .from("sku_items")
      .insert({
        brand_id: brandId,
        sku,
        item_type: itemType,
        category,
        name,
        unit,
        // Product's "on" state is "Active", everything else is "Available" -
        // see pages/database.js's skuStatusOptionsHtml. The form always
        // sends a real value; this default only matters for a direct API
        // call that omits status.
        status: body.status || (itemType === "Product" ? "Active" : "Available")
      })
      .select("id, sku, item_type, category, name, unit, status")
      .single();
    if (error) {
      if (error.code === "23505") return jsonResponse({ error: "SKU code already exists: " + sku }, 400);
      throw error;
    }

    return jsonResponse(data, 201);
  } catch (err) {
    return errorResponse(err);
  }
}
