// Daily Gmail pull for GoFood/GrabFood Merchant sales reports - called by
// .github/workflows/sales-import-cron.yml on a schedule. Cloudflare Pages
// has no native Cron Trigger (that's a plain-Workers feature), so an
// outside scheduler has to call in - see that workflow file for why GitHub
// Actions was picked over standing up a separate Worker just for this.
//
// This is the one endpoint in the app a system caller hits instead of a
// logged-in browser, so unlike everywhere else it needs its own auth (the
// rest of this app has no login at all - a request just has to know the
// URL, which is fine for a human on the app's own pages but not for an
// endpoint reachable by anyone who finds it).
//
// GoFood only for now - GrabFood Merchant's daily report has a different
// sender/format we don't have a sample of yet (see chat history for the
// design discussion). Add its own entry to REPORT_SOURCES + a parser
// module once a sample email is available.
import { getSupabase, getBrandId, jsonResponse, errorResponse } from "../_lib/supabase.js";
import { getGmailAccessToken, searchGmailMessages, getGmailMessage, getGmailAttachmentText, buildGmailPermalink } from "../_lib/gmail.js";
import { parseGoFoodReport, parseGoFoodPotonganPendapatanCsv } from "../_lib/gofood-report-parser.js";
import { upsertSalesImportDraft } from "../_lib/sales-import-drafts.js";

// Same-day ad spend for a GoFood report - a separate CSV attachment on the
// same email as the daily report itself (see parseGoFoodPotonganPendapatanCsv's
// own comment for why this, not the report body's "Potongan layanan" figure
// or the separate "Pembayaran Berhasil" payout email, is the source used
// here). A day with no ad spend has no such attachment at all - 0, not an
// error.
async function getGoFoodAdFee(accessToken, message) {
  const attachment = message.attachments.find((a) => /^Laporan Potongan Pendapatan.*\.csv$/i.test(a.filename));
  if (!attachment) return 0;
  const csvText = await getGmailAttachmentText(accessToken, message.id, attachment.attachmentId);
  return parseGoFoodPotonganPendapatanCsv(csvText);
}

const REPORT_SOURCES = [
  {
    platform: "GoFood",
    // newer_than:2d, not 1d - the report for day D lands mid-afternoon on
    // D+1 (confirmed against a real sample: the 01-09-2026 report arrived
    // Sep 2, 3:26 PM), so a once-a-day cron needs a window wide enough to
    // never miss one to a late send/run. Re-seeing an already-imported
    // email on a later run is a harmless no-op either way -
    // upsertSalesImportDraft dedupes on the Gmail message ID.
    query: 'from:merchant.no-reply@gojek.com subject:"Laporan Penjualan" newer_than:2d',
    parse: parseGoFoodReport
  }
];

export async function onRequestPost({ request, env }) {
  try {
    const secret = request.headers.get("X-Cron-Secret");
    if (!env.SALES_IMPORT_CRON_SECRET || secret !== env.SALES_IMPORT_CRON_SECRET) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);
    const accessToken = await getGmailAccessToken(env);

    const results = [];
    for (const source of REPORT_SOURCES) {
      const messages = await searchGmailMessages(accessToken, source.query);
      for (const stub of messages) {
        try {
          const message = await getGmailMessage(accessToken, stub.id);
          const parsed = source.parse({ subject: message.subject, bodyText: message.bodyText });
          const adFee = source.platform === "GoFood" ? await getGoFoodAdFee(accessToken, message) : 0;
          const draft = await upsertSalesImportDraft(supabase, brandId, {
            date: parsed.date,
            platform: parsed.platform,
            reportGross: parsed.reportGross,
            platformFee: parsed.platformFee,
            promoFee: parsed.promoFee,
            adFee: adFee,
            sourceMessageId: message.id,
            sourceLink: buildGmailPermalink(message.id)
          });
          results.push({ platform: source.platform, messageId: message.id, date: parsed.date, ok: true, deduped: draft.deduped });
        } catch (err) {
          // One bad email (parse failure, unexpected format) must not sink
          // every other message in the run - logged per-message instead.
          results.push({ platform: source.platform, messageId: stub.id, ok: false, error: (err && err.message) || String(err) });
        }
      }
    }

    return jsonResponse({ processed: results.length, results: results });
  } catch (err) {
    return errorResponse(err);
  }
}
