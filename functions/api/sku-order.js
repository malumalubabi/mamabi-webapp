// Database > SKU's Arrange mode - same "stage moves locally, send the final
// full sequence once" pattern as pricing-order.js (which this reuses
// directly for Product, so Database and Menu Engineering > Pricing stay in
// sync on one ordering, not two independent ones).
//
// The other 5 types share ONE flat registry_order sequence across ALL
// types (see the sku_items_registry_order migration - Product 1-19,
// Component 20-28, etc., one contiguous block per type). Renumbering a
// type's rows 1..N here would collide with every other type's block, so
// instead this keeps the type's own existing set of registry_order values
// ("slots") and just reassigns which item sits in which slot, in the new
// order - the value SET a type owns never changes, only the assignment
// within it.
import { getSupabase, getBrandId, jsonResponse, errorResponse } from "./_lib/supabase.js";

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const skus = body.skus;
    const itemType = (body.itemType || "").trim();
    if (!Array.isArray(skus) || !skus.length) return jsonResponse({ error: "skus array is required" }, 400);
    if (!itemType) return jsonResponse({ error: "itemType is required" }, 400);

    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    if (itemType === "Product") {
      const updates = skus.map((sku, i) =>
        supabase.from("sku_items").update({ display_order: i + 1 }).eq("brand_id", brandId).eq("sku", sku).eq("item_type", "Product")
      );
      const results = await Promise.all(updates);
      const failed = results.find((r) => r.error);
      if (failed) throw failed.error;
      return jsonResponse({ ok: true });
    }

    const { data: current, error: fetchErr } = await supabase
      .from("sku_items")
      .select("registry_order")
      .eq("brand_id", brandId)
      .eq("item_type", itemType)
      .order("registry_order");
    if (fetchErr) throw fetchErr;
    if (current.length !== skus.length) return jsonResponse({ error: "Row count mismatch - reload and try again." }, 400);

    const slots = current.map((r) => r.registry_order);
    const updates = skus.map((sku, i) =>
      supabase.from("sku_items").update({ registry_order: slots[i] }).eq("brand_id", brandId).eq("sku", sku).eq("item_type", itemType)
    );
    const results = await Promise.all(updates);
    const failed = results.find((r) => r.error);
    if (failed) throw failed.error;

    return jsonResponse({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
