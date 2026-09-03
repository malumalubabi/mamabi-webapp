// PATCH: acts on a Pending draft.
//   "confirm"     - Review modal saved a real sales_batches entry off it
//                   (see pages/sales.js's saveDraftReview) - flips to
//                   Confirmed, keeps a link to the resulting batch code.
//   "reject"      - discarded without ever becoming a Sales entry (e.g. a
//                   duplicate, or a day already covered manually).
//   "attachItems" - GoFood only: attach an optional Items .csv (see
//                   _lib/gofood-items-csv-parser.js) to a draft that was
//                   auto-created from the daily email with no item detail.
//                   The file's own covered date (read from its filename,
//                   not content - see that parser) must match this
//                   draft's report_date, or it's rejected outright.
//   "removeItems" - clears whatever "attachItems" set, back to no items.
// confirm/reject keep the row forever (status flips, nothing deleted) -
// same "never delete, just close it out" precedent as payroll_runs, useful
// for audit later ("this Sales batch came from draft X").
import { getSupabase, getBrandId, jsonResponse, errorResponse } from "../_lib/supabase.js";
import { decodeBase64Text } from "../_lib/csv.js";
import { parseGoFoodItemsFilename, parseGoFoodItemsCsv } from "../_lib/gofood-items-csv-parser.js";
import { matchItemsToSkus } from "../_lib/item-matching.js";

export async function onRequestPatch({ request, env, params }) {
  try {
    const id = params.id;
    const body = await request.json();

    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    const { data: draft, error: findErr } = await supabase
      .from("sales_import_drafts")
      .select("id, status, platform, report_date")
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

    if (body.action === "attachItems") {
      if (draft.platform !== "GoFood") return jsonResponse({ error: "Only GoFood drafts accept a standalone Items file - GrabFood's items come from Reports/Menu Sales at creation." }, 400);
      if (!body.fileName || !body.fileContentBase64) return jsonResponse({ error: "fileName and fileContentBase64 are required" }, 400);
      if (!/\.csv$/i.test(body.fileName)) return jsonResponse({ error: "Only a .csv file is accepted here." }, 400);

      let fileDate;
      try {
        fileDate = parseGoFoodItemsFilename(body.fileName);
      } catch (err) {
        return jsonResponse({ error: err.message }, 400);
      }
      if (fileDate !== draft.report_date) {
        return jsonResponse({ error: body.fileName + " is dated " + fileDate + ", but this draft is for " + draft.report_date + " - not attached." }, 400);
      }

      const csvText = decodeBase64Text(body.fileContentBase64);
      const rawItems = parseGoFoodItemsCsv(csvText);
      if (!rawItems.length) return jsonResponse({ error: "No item rows found in " + body.fileName }, 400);
      const items = await matchItemsToSkus(supabase, brandId, "GoFood", rawItems);

      const { error } = await supabase
        .from("sales_import_drafts")
        .update({ items: items, source_files: [body.fileName] })
        .eq("id", id);
      if (error) throw error;
      return jsonResponse({ ok: true, items: items });
    }

    if (body.action === "removeItems") {
      const { error } = await supabase
        .from("sales_import_drafts")
        .update({ items: null, source_files: null })
        .eq("id", id);
      if (error) throw error;
      return jsonResponse({ ok: true });
    }

    return jsonResponse({ error: "Unknown action" }, 400);
  } catch (err) {
    return errorResponse(err);
  }
}
