// PATCH: decide a Pending draft - "confirm" (Review modal saved a real
// sales_batches entry off it, see pages/sales.js's saveSalesDraftReview) or
// "reject" (discarded without ever becoming a Sales entry, e.g. a duplicate
// or a report that turned out already covered manually). Both keep the row
// (status flips, nothing is deleted) - same "never delete, just close it
// out" precedent as payroll_runs, useful for audit later ("this Sales batch
// came from draft X").
import { getSupabase, getBrandId, jsonResponse, errorResponse } from "../_lib/supabase.js";

export async function onRequestPatch({ request, env, params }) {
  try {
    const id = params.id;
    const body = await request.json();

    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    const { data: draft, error: findErr } = await supabase
      .from("sales_import_drafts")
      .select("id, status")
      .eq("brand_id", brandId)
      .eq("id", id)
      .maybeSingle();
    if (findErr) throw findErr;
    if (!draft) return jsonResponse({ error: "Draft not found" }, 404);
    if (draft.status !== "Pending") return jsonResponse({ error: "This draft was already " + draft.status.toLowerCase() + "." }, 400);

    if (body.action === "confirm") {
      if (!body.batchCode) return jsonResponse({ error: "batchCode is required" }, 400);
      const { error } = await supabase
        .from("sales_import_drafts")
        .update({ status: "Confirmed", confirmed_batch_code: body.batchCode })
        .eq("id", id);
      if (error) throw error;
      return jsonResponse({ ok: true });
    }

    if (body.action === "reject") {
      const { error } = await supabase
        .from("sales_import_drafts")
        .update({ status: "Rejected" })
        .eq("id", id);
      if (error) throw error;
      return jsonResponse({ ok: true });
    }

    return jsonResponse({ error: "Unknown action" }, 400);
  } catch (err) {
    return errorResponse(err);
  }
}
