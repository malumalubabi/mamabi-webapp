// Inventory > Cost > Current Cost - one row per SKU with its most recent
// purchase-driven cost (sku_cost_history, latest per sku_id - same rule as
// the current_unit_cost view, but that view doesn't expose purchase_price,
// so this reads the table directly instead). Ported from the old app's
// getItemPriceList()/CurrentCostTable.html - only SKUs that have actually
// been purchased at least once show up here (never-purchased SKUs have no
// cost history row to read).
import { getSupabase, getBrandId, jsonResponse, errorResponse } from "./_lib/supabase.js";

export async function onRequestGet({ env }) {
  try {
    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    const { data, error } = await supabase
      .from("sku_cost_history")
      .select("sku_id, effective_date, purchase_qty, unit, purchase_price, updated_unit_cost, created_at, suppliers(name), sku_items!inner(brand_id, sku, category, name)")
      .eq("sku_items.brand_id", brandId)
      .order("effective_date", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throw error;

    const latestBySku = {};
    data.forEach((r) => {
      if (!latestBySku[r.sku_id]) latestBySku[r.sku_id] = r;
    });

    const rows = Object.values(latestBySku)
      .map((r) => ({
        sku: r.sku_items.sku,
        category: r.sku_items.category,
        name: r.sku_items.name,
        unit: r.unit,
        purchaseQty: Number(r.purchase_qty) || 0,
        purchasePrice: Number(r.purchase_price) || 0,
        unitCost: Number(r.updated_unit_cost) || 0,
        lastUpdated: r.effective_date,
        supplier: r.suppliers ? r.suppliers.name : ""
      }))
      .sort((a, b) => a.sku.localeCompare(b.sku));

    return jsonResponse(rows);
  } catch (err) {
    return errorResponse(err);
  }
}
