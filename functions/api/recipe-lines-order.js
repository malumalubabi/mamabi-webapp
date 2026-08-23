// Manage Costing modal's Arrange mode: same staged-locally-then-save-once
// pattern as Pricing tab's Arrange (functions/api/pricing-order.js) - client
// sends the final ordered list of recipe_lines ids for one parent SKU,
// this just writes line_order = 1..N in that order.
import { getSupabase, getBrandId, jsonResponse, errorResponse } from "./_lib/supabase.js";

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    if (!Array.isArray(body.lineIds) || !body.lineIds.length) return jsonResponse({ error: "lineIds array is required" }, 400);

    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    const updates = body.lineIds.map((id, i) =>
      supabase.from("recipe_lines").update({ line_order: i + 1 }).eq("brand_id", brandId).eq("id", id)
    );
    const results = await Promise.all(updates);
    const failed = results.find((r) => r.error);
    if (failed) throw failed.error;

    return jsonResponse({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
