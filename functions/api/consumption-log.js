// Inventory > Stock > Consumption Log - every stock-out recorded in
// production_consumption, newest first. Ported from the old app's
// ConsumptionLogTable.html - Ref ID covers whatever source wrote the row
// (Batch Production's batch code so far; Sales' Sales ID once that module
// writes here too). Brand-scoped via sku_items (not production_batches -
// batch_id is now optional, so a non-batch row wouldn't have one to join).
import { getSupabase, getBrandId, jsonResponse, errorResponse } from "./_lib/supabase.js";

export async function onRequestGet({ env }) {
  try {
    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    const { data, error } = await supabase
      .from("production_consumption")
      .select("qty, source, notes, ref_code, consumption_date, sku_items!inner(brand_id, sku, name)")
      .eq("sku_items.brand_id", brandId)
      .order("consumption_date", { ascending: false });
    if (error) throw error;

    return jsonResponse(
      data.map((r) => ({
        refId: r.ref_code || "",
        date: r.consumption_date,
        sku: r.sku_items ? r.sku_items.sku : "",
        itemName: r.sku_items ? r.sku_items.name : "",
        qty: Number(r.qty) || 0,
        source: r.source,
        notes: r.notes
      }))
    );
  } catch (err) {
    return errorResponse(err);
  }
}
