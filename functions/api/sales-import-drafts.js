// Sales > Draft - daily platform sales reports (GoFood/GrabFood Merchant)
// imported from Gmail, staged here before becoming a real sales_batches
// entry. Kept separate from sales_batches on purpose: if the Gmail parser
// ever misreads a report, only this staging table is wrong, not the real
// ledger - a human has to Review (pages/sales.js's openSalesDraftReviewModal,
// same layout as Input Sales, fees pre-filled) and Save before anything
// lands in Sales/OpEx.
//
// POST is also the seam the not-yet-built Gmail import pipeline will call
// into (one row per report per day/platform) - for now it's how a draft
// gets created at all (manually, for testing the Draft tab end to end).
// Dedupes on source_message_id (a Gmail message ID is globally unique) so a
// re-run/re-fetch of the same email is a no-op instead of a duplicate draft.
import { getSupabase, getBrandId, jsonResponse, errorResponse } from "./_lib/supabase.js";

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const status = url.searchParams.get("status") || "Pending";

    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    const { data, error } = await supabase
      .from("sales_import_drafts")
      .select("id, report_date, platform, report_gross, platform_fee, marketing_fee, source_link, status, confirmed_batch_code, created_at")
      .eq("brand_id", brandId)
      .eq("status", status)
      .order("report_date", { ascending: false });
    if (error) throw error;

    return jsonResponse(data.map((r) => ({
      id: r.id,
      date: r.report_date,
      platform: r.platform,
      reportGross: Number(r.report_gross),
      platformFee: Number(r.platform_fee),
      marketingFee: Number(r.marketing_fee),
      sourceLink: r.source_link,
      status: r.status,
      confirmedBatchCode: r.confirmed_batch_code
    })));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    if (!body.date) return jsonResponse({ error: "Date is required" }, 400);
    if (!body.platform) return jsonResponse({ error: "Platform is required" }, 400);
    if (body.reportGross === undefined) return jsonResponse({ error: "reportGross is required" }, 400);
    if (!body.sourceMessageId) return jsonResponse({ error: "sourceMessageId is required" }, 400);

    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    // Dedupe: a re-fetch of an already-imported email returns the existing
    // draft as-is instead of erroring or creating a sibling row.
    const { data: existing, error: existingErr } = await supabase
      .from("sales_import_drafts")
      .select("id, status")
      .eq("source_message_id", body.sourceMessageId)
      .maybeSingle();
    if (existingErr) throw existingErr;
    if (existing) return jsonResponse({ id: existing.id, status: existing.status, deduped: true });

    const { data, error } = await supabase
      .from("sales_import_drafts")
      .insert({
        brand_id: brandId,
        report_date: body.date,
        platform: body.platform,
        report_gross: Number(body.reportGross) || 0,
        platform_fee: Number(body.platformFee) || 0,
        marketing_fee: Number(body.marketingFee) || 0,
        source_message_id: body.sourceMessageId,
        source_link: body.sourceLink || null
      })
      .select("id")
      .single();
    if (error) throw error;

    return jsonResponse({ id: data.id }, 201);
  } catch (err) {
    return errorResponse(err);
  }
}
