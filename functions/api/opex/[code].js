// Ported from the old app's updateOpexAmount_()/updateOpexDesc_() (Driver
// Payout syncing an already-Paid entry's linked OpEx row) and
// deleteOpexEntry_()/deleteOpexEntryDirect() - both collapsed into one
// generic PATCH + DELETE pair here, matching how orders/[code].js works.
//
// Unlike the old app (which let the Ledger UI edit/delete ANY row,
// auto-linked or not, with nothing stopping it from desyncing against
// Driver Payout/Sales), this blocks both here server-side for a row that's
// auto-linked - the source module (Driver Payout, or the Sales batch's own
// edit) is the only place that's allowed to touch it. Driver Payout/Sales
// themselves call the /api/orders and /api/sales-batches endpoints, which
// go straight to opex_entries directly (not through here), so this guard
// doesn't block their own legitimate syncing.
import { getSupabase, getBrandId, jsonResponse, errorResponse } from "../_lib/supabase.js";
import { getOpexLinkMap, isValidOpexCategory } from "../_lib/opex.js";

const PATCHABLE_FIELDS = {
  grossAmount: "gross_amount",
  desc: "description",
  category: "category",
  date: "entry_date"
};

async function blockedByLink(supabase, brandId, code) {
  const linkMap = await getOpexLinkMap(supabase, brandId);
  const link = linkMap[code];
  if (!link) return null;
  return jsonResponse({ error: "This expense is auto-linked from " + link.source + " (" + link.refCode + ") - edit or delete it from there instead." }, 400);
}

export async function onRequestPatch({ request, env, params }) {
  try {
    const code = decodeURIComponent(params.code);
    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    const blocked = await blockedByLink(supabase, brandId, code);
    if (blocked) return blocked;

    const body = await request.json();
    if ("category" in body && !(await isValidOpexCategory(supabase, brandId, body.category))) {
      return jsonResponse({ error: "Unknown category: " + body.category + " - add it in Settings (PnL Categories) first." }, 400);
    }

    const update = {};
    for (const [clientKey, column] of Object.entries(PATCHABLE_FIELDS)) {
      if (clientKey in body) update[column] = body[clientKey];
    }
    if (!Object.keys(update).length) return jsonResponse({ error: "No updatable fields provided" }, 400);

    const { data, error } = await supabase
      .from("opex_entries")
      .update(update)
      .eq("brand_id", brandId)
      .eq("opex_code", code)
      .select("opex_code")
      .maybeSingle();
    if (error) throw error;
    if (!data) return jsonResponse({ error: "Expense not found: " + code }, 404);

    return jsonResponse({ opexCode: data.opex_code });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function onRequestDelete({ env, params }) {
  try {
    const code = decodeURIComponent(params.code);
    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    const blocked = await blockedByLink(supabase, brandId, code);
    if (blocked) return blocked;

    const { data, error } = await supabase
      .from("opex_entries")
      .delete()
      .eq("brand_id", brandId)
      .eq("opex_code", code)
      .select("opex_code")
      .maybeSingle();
    if (error) throw error;
    if (!data) return jsonResponse({ error: "Expense not found: " + code }, 404);

    return jsonResponse({ opexCode: data.opex_code });
  } catch (err) {
    return errorResponse(err);
  }
}
