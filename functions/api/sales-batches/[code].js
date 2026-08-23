// Edit/Delete for a whole Sales batch (batch_code, e.g. SLB-0001) -
// the Date/Platform/Platform Fee/Marketing Fee shared by one Input Sales
// submission. PATCH syncs the linked OpEx entries (same pattern as Driver
// Payout's driver_payout_opex_code) and cascades Date/Platform/Notes onto
// every product line in the batch (sales_entries.batch_id = this batch) -
// those are denormalized copies for the flat Sales Log view, kept in sync
// here rather than joined every read. DELETE removes the whole batch: every
// product line (FK cascade), each line's own stock consumption, and both
// fee OpEx entries.
import { getSupabase, getBrandId, jsonResponse, errorResponse } from "../_lib/supabase.js";
import { syncFeeOpex } from "../_lib/sales.js";

export async function onRequestPatch({ request, env, params }) {
  try {
    const body = await request.json();
    if (!body.date) return jsonResponse({ error: "Date is required" }, 400);
    if (!body.platform) return jsonResponse({ error: "Platform is required" }, 400);

    const batchCode = decodeURIComponent(params.code);
    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    const { data: existing, error: findErr } = await supabase
      .from("sales_batches")
      .select("id, platform_fee_opex_code, marketing_fee_opex_code")
      .eq("brand_id", brandId)
      .eq("batch_code", batchCode)
      .maybeSingle();
    if (findErr) throw findErr;
    if (!existing) return jsonResponse({ error: "Sales batch not found: " + batchCode }, 404);

    const platformFee = Number(body.platformFee) || 0;
    const marketingFee = Number(body.marketingFee) || 0;
    const description = body.platform + ", " + batchCode;

    const platformFeeOpexCode = await syncFeeOpex(supabase, brandId, existing.platform_fee_opex_code, platformFee, body.date, "Platform Fee", description);
    const marketingFeeOpexCode = await syncFeeOpex(supabase, brandId, existing.marketing_fee_opex_code, marketingFee, body.date, "Marketing", description);

    const { error: updateErr } = await supabase
      .from("sales_batches")
      .update({
        sale_date: body.date,
        platform: body.platform,
        platform_fee: platformFee || null,
        marketing_fee: marketingFee || null,
        notes: body.notes || null,
        platform_fee_opex_code: platformFeeOpexCode,
        marketing_fee_opex_code: marketingFeeOpexCode
      })
      .eq("id", existing.id);
    if (updateErr) throw updateErr;

    // Denormalized copies on every product line, kept consistent with the batch.
    const { error: cascadeErr } = await supabase
      .from("sales_entries")
      .update({ sale_date: body.date, platform: body.platform, notes: body.notes || null })
      .eq("batch_id", existing.id);
    if (cascadeErr) throw cascadeErr;

    return jsonResponse({ batchCode: batchCode });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function onRequestDelete({ env, params }) {
  try {
    const batchCode = decodeURIComponent(params.code);
    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    const { data: existing, error: findErr } = await supabase
      .from("sales_batches")
      .select("id, platform_fee_opex_code, marketing_fee_opex_code, sales_entries(sales_code)")
      .eq("brand_id", brandId)
      .eq("batch_code", batchCode)
      .maybeSingle();
    if (findErr) throw findErr;
    if (!existing) return jsonResponse({ error: "Sales batch not found: " + batchCode }, 404);

    const salesCodes = (existing.sales_entries || []).map((r) => r.sales_code);
    if (salesCodes.length) {
      const { error: delConsErr } = await supabase
        .from("production_consumption")
        .delete()
        .in("ref_code", salesCodes)
        .eq("source", "Sales");
      if (delConsErr) throw delConsErr;
    }

    if (existing.platform_fee_opex_code) {
      const { error } = await supabase.from("opex_entries").delete().eq("brand_id", brandId).eq("opex_code", existing.platform_fee_opex_code);
      if (error) throw error;
    }
    if (existing.marketing_fee_opex_code) {
      const { error } = await supabase.from("opex_entries").delete().eq("brand_id", brandId).eq("opex_code", existing.marketing_fee_opex_code);
      if (error) throw error;
    }

    // Cascades to every sales_entries row in this batch (batch_id FK on
    // delete cascade).
    const { error: delErr } = await supabase.from("sales_batches").delete().eq("id", existing.id);
    if (delErr) throw delErr;

    return jsonResponse({ batchCode: batchCode });
  } catch (err) {
    return errorResponse(err);
  }
}
