// GrabFood has no email/API channel at all (confirmed - see chat history),
// so this is the ONLY way a GrabFood draft ever comes into being: both
// files from GrabMerchant > Finance > Reports (the Reports .xlsx for
// fees, the Menu Sales .csv for items) uploaded together. Both files'
// covered date must match each other exactly - checked BEFORE anything is
// created, so a GrabFood draft's attachments are always guaranteed correct
// (pages/sales.js's Review modal treats them as read-only for exactly this
// reason - there's no broken state to fix in place, only Reject + re-
// upload).
//
// Single-day files only for now (both parsers already enforce this - see
// their own comments for why a genuine multi-day sample is needed before
// that's safe to support).
import { getSupabase, getBrandId, jsonResponse, errorResponse } from "../_lib/supabase.js";
import { decodeBase64Bytes, decodeBase64Text } from "../_lib/csv.js";
import { parseGrabFoodReportXlsx } from "../_lib/grabfood-report-parser.js";
import { parseGrabFoodMenuSalesCsv } from "../_lib/grabfood-menu-sales-csv-parser.js";
import { matchItemsToSkus } from "../_lib/item-matching.js";
import { upsertSalesImportDraft } from "../_lib/sales-import-drafts.js";

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const required = ["reportsFileName", "reportsFileContentBase64", "menuSalesFileName", "menuSalesFileContentBase64"];
    for (const key of required) {
      if (!body[key]) return jsonResponse({ error: key + " is required" }, 400);
    }
    if (!/\.xlsx$/i.test(body.reportsFileName)) return jsonResponse({ error: "Reports file must be .xlsx" }, 400);
    if (!/\.csv$/i.test(body.menuSalesFileName)) return jsonResponse({ error: "Menu Sales file must be .csv" }, 400);

    let report;
    try {
      report = await parseGrabFoodReportXlsx(decodeBase64Bytes(body.reportsFileContentBase64));
    } catch (err) {
      return jsonResponse({ error: "Reports file: " + err.message }, 400);
    }

    let menuSales;
    try {
      menuSales = parseGrabFoodMenuSalesCsv(decodeBase64Text(body.menuSalesFileContentBase64));
    } catch (err) {
      return jsonResponse({ error: "Menu Sales file: " + err.message }, 400);
    }

    if (report.date !== menuSales.date) {
      return jsonResponse({ error: "Date ranges don't match: " + body.reportsFileName + " is for " + report.date + ", but " + body.menuSalesFileName + " is for " + menuSales.date + ". Re-upload two files covering the same date." }, 400);
    }

    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    const items = await matchItemsToSkus(supabase, brandId, "GrabFood", menuSales.items);

    const result = await upsertSalesImportDraft(supabase, brandId, {
      date: report.date,
      platform: "GrabFood",
      reportGross: report.reportGross,
      platformFee: report.platformFee,
      marketingFee: report.marketingFee,
      sourceMessageId: "grabfood-file:" + report.date,
      sourceLink: null,
      items: items,
      sourceFiles: [body.reportsFileName, body.menuSalesFileName]
    });

    return jsonResponse(result, result.deduped ? 200 : 201);
  } catch (err) {
    return errorResponse(err);
  }
}
