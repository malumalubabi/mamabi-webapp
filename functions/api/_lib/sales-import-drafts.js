// Shared insert-or-dedupe logic for sales_import_drafts - used by both the
// public POST /api/sales-import-drafts endpoint (manual creation, used for
// testing since there's no other way to get a draft in yet) and the Gmail
// cron endpoint (sales-import/run.js). One place owns "what does creating a
// draft mean" so the two callers can't drift apart.
//
// Dedupes on source_message_id (a Gmail message ID is globally unique) - a
// re-fetch of an already-imported email (cron re-checking a wider date
// window, or a retry) returns the existing draft as-is instead of erroring
// or creating a sibling row.
export async function upsertSalesImportDraft(supabase, brandId, draft) {
  const { data: existing, error: existingErr } = await supabase
    .from("sales_import_drafts")
    .select("id, status")
    .eq("source_message_id", draft.sourceMessageId)
    .maybeSingle();
  if (existingErr) throw existingErr;
  if (existing) return { id: existing.id, status: existing.status, deduped: true };

  const { data, error } = await supabase
    .from("sales_import_drafts")
    .insert({
      brand_id: brandId,
      report_date: draft.date,
      platform: draft.platform,
      report_gross: Number(draft.reportGross) || 0,
      platform_fee: Number(draft.platformFee) || 0,
      marketing_fee: Number(draft.marketingFee) || 0,
      source_message_id: draft.sourceMessageId,
      source_link: draft.sourceLink || null
    })
    .select("id")
    .single();
  if (error) throw error;

  return { id: data.id, status: "Pending", deduped: false };
}
