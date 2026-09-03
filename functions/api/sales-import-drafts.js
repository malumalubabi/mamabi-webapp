// Sales > Draft - daily platform sales reports (GoFood/GrabFood Merchant)
// staged here before becoming a real sales_batches entry. Kept separate
// from sales_batches on purpose: if a parser ever misreads a report, only
// this staging table is wrong, not the real ledger - a human has to Review
// (pages/sales.js's openSalesDraftReviewModal, same layout as Input Sales,
// fees pre-filled) and Save before anything lands in Sales/OpEx.
//
// GoFood drafts are created by the Gmail cron (sales-import/run.js);
// GrabFood drafts are created by uploading its 2 report files
// (sales-import/create-grabfood-draft.js, since GrabFood emails nothing).
// This POST is also directly callable (manual/testing). Dedupes on
// source_message_id - a Gmail message ID for GoFood, a synthesized
// "platform:date" key for GrabFood file uploads - so re-processing the
// same report is a no-op instead of a duplicate draft.
import { getSupabase, getBrandId, jsonResponse, errorResponse } from "./_lib/supabase.js";
import { upsertSalesImportDraft } from "./_lib/sales-import-drafts.js";

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const status = url.searchParams.get("status") || "Pending";

    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    const { data, error } = await supabase
      .from("sales_import_drafts")
      .select("id, report_date, platform, report_gross, platform_fee, marketing_fee, source_link, source_files, items, status, confirmed_batch_code, created_at")
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
      sourceFiles: r.source_files || [],
      items: r.items || null,
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

    const result = await upsertSalesImportDraft(supabase, brandId, {
      date: body.date,
      platform: body.platform,
      reportGross: body.reportGross,
      platformFee: body.platformFee,
      marketingFee: body.marketingFee,
      sourceMessageId: body.sourceMessageId,
      sourceLink: body.sourceLink
    });

    return jsonResponse(result, result.deduped ? 200 : 201);
  } catch (err) {
    return errorResponse(err);
  }
}
