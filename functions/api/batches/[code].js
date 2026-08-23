// Two things patch a batch here: marking it Done from the Ongoing Batches
// list (ported concept from MenuBatchProduction_JS.html's markBatchDone() -
// matters beyond just the label, since stock_ledger's "Production Yield"
// movement only counts a batch's yield once status = 'Done'), and editing
// its batch size from the Open Recipe modal (ported concept from
// MenuBatchProduction_JS.html's updateBatchScaledQty(), simplified to just
// the size itself since we don't scale a recipe off it).
import { getSupabase, getBrandId, jsonResponse, errorResponse } from "../_lib/supabase.js";

const PATCHABLE_FIELDS = {
  status: "status",
  batchSize: "batch_size"
};

export async function onRequestPatch({ request, env, params }) {
  try {
    const body = await request.json();

    const update = {};
    for (const key of Object.keys(PATCHABLE_FIELDS)) {
      if (body[key] !== undefined) update[PATCHABLE_FIELDS[key]] = body[key];
    }
    if (!Object.keys(update).length) return jsonResponse({ error: "No updatable fields provided" }, 400);

    // Batch codes are "#0001"-style - the # doesn't survive as a literal
    // path segment, so the client percent-encodes it; Pages Functions
    // does not auto-decode params, so it has to happen here.
    const code = decodeURIComponent(params.code);

    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    const { data, error } = await supabase
      .from("production_batches")
      .update(update)
      .eq("brand_id", brandId)
      .eq("batch_code", code)
      .select("batch_code")
      .maybeSingle();
    if (error) throw error;
    if (!data) return jsonResponse({ error: "Batch not found: " + code }, 404);

    return jsonResponse({ batchCode: data.batch_code });
  } catch (err) {
    return errorResponse(err);
  }
}
