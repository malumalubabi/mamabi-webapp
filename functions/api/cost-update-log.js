// Inventory > Cost > Cost Update Log - full audit trail of every cost
// change (sku_cost_history), newest first. Ported from the old app's
// CostUpdateLogTable.html - rows are auto-created by the
// trg_log_cost_update trigger on purchase_lines insert, never written
// directly by this endpoint (GET only, no POST/PATCH here).
import { getSupabase, getBrandId, jsonResponse, errorResponse } from "./_lib/supabase.js";

export async function onRequestGet({ env }) {
  try {
    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    const { data, error } = await supabase
      .from("sku_cost_history")
      .select(
        "id, effective_date, purchase_qty, unit, purchase_price, previous_unit_cost, updated_unit_cost, variance, variance_pct, remarks, created_at, " +
        "suppliers(name), sku_items!inner(brand_id, sku, name)"
      )
      .eq("sku_items.brand_id", brandId)
      .order("effective_date", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throw error;

    return jsonResponse(
      data.map((r) => ({
        id: r.id,
        date: r.effective_date,
        sku: r.sku_items.sku,
        itemName: r.sku_items.name,
        supplier: r.suppliers ? r.suppliers.name : "",
        qty: r.purchase_qty === null ? null : Number(r.purchase_qty),
        unit: r.unit,
        purchasePrice: Number(r.purchase_price) || 0,
        previousUnitCost: r.previous_unit_cost === null ? null : Number(r.previous_unit_cost),
        updatedUnitCost: Number(r.updated_unit_cost) || 0,
        variance: r.variance === null ? null : Number(r.variance),
        variancePct: r.variance_pct === null ? null : Number(r.variance_pct),
        remarks: r.remarks
      }))
    );
  } catch (err) {
    return errorResponse(err);
  }
}
