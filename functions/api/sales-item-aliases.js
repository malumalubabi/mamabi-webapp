// Saves/updates one learned name mapping (see sales_item_aliases' own
// comment) - called from pages/sales.js's Draft Review modal the moment a
// user manually resolves a not-matched item row that came from an
// imported file, so the same platform-reported text auto-matches on every
// later import instead of asking again.
import { getSupabase, getBrandId, jsonResponse, errorResponse } from "./_lib/supabase.js";
import { saveItemAlias } from "./_lib/item-matching.js";

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    if (!body.platform) return jsonResponse({ error: "platform is required" }, 400);
    if (!body.rawLabel) return jsonResponse({ error: "rawLabel is required" }, 400);
    if (!body.skuId) return jsonResponse({ error: "skuId is required" }, 400);

    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    await saveItemAlias(supabase, brandId, body.platform, body.rawLabel, body.skuId);

    return jsonResponse({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
