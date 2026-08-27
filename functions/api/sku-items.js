// Database > SKU - full list (optionally filtered by ?type=) + create.
// lookups.js has its own select of every SKU (all types) for other modules'
// comboboxes - this is the standalone management page's data source.
import { getSupabase, getBrandId, jsonResponse, errorResponse } from "./_lib/supabase.js";

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
    const sku = (body.sku || "").trim().toUpperCase();
    const name = (body.name || "").trim();
    const unit = (body.unit || "").trim();
    const itemType = (body.itemType || "").trim();

    if (!sku) return jsonResponse({ error: "SKU code is required" }, 400);
    if (!itemType) return jsonResponse({ error: "Item Type is required" }, 400);
    if (!name) return jsonResponse({ error: "Item Name is required" }, 400);
    if (!unit) return jsonResponse({ error: "Unit is required" }, 400);

    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    const { data, error } = await supabase
      .from("sku_items")
      .insert({
        brand_id: brandId,
        sku,
        item_type: itemType,
        category: body.category || null,
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
