// Arrange mode for a settings_lists list - same "stage moves locally, send
// the final full sequence once" pattern as pricing-order.js. Currently only
// wired up in the UI for Staff Roles (Database > Staff sorts by role
// priority using this order), but works for any list_name.
import { getSupabase, getBrandId, jsonResponse, errorResponse } from "./_lib/supabase.js";

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const listName = (body.listName || "").trim();
    const values = body.values;
    if (!listName) return jsonResponse({ error: "listName is required" }, 400);
    if (!Array.isArray(values) || !values.length) return jsonResponse({ error: "values array is required" }, 400);

    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    const updates = values.map((value, i) =>
      supabase
        .from("settings_lists")
        .update({ sort_order: i + 1 })
        .eq("brand_id", brandId)
        .eq("list_name", listName)
        .eq("value", value)
    );
    const results = await Promise.all(updates);
    const failed = results.find((r) => r.error);
    if (failed) throw failed.error;

    return jsonResponse({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
