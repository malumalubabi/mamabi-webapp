// Menu Engineering - Pricing tab's Arrange mode: the client stages moves
// locally (no API calls while dragging/clicking) and only calls this once,
// on "Save Order", with the full final SKU sequence - so this just writes
// display_order = 1..N in that order, no swap logic needed server-side.
import { getSupabase, getBrandId, jsonResponse, errorResponse } from "./_lib/supabase.js";

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    if (!Array.isArray(body.skus) || !body.skus.length) return jsonResponse({ error: "skus array is required" }, 400);

    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    const updates = body.skus.map((sku, i) =>
      supabase
        .from("sku_items")
        .update({ display_order: i + 1 })
        .eq("brand_id", brandId)
        .eq("sku", sku)
        .eq("item_type", "Product")
    );
    const results = await Promise.all(updates);
    const failed = results.find((r) => r.error);
    if (failed) throw failed.error;

    return jsonResponse({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
