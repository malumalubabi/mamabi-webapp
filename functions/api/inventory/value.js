// Inventory Stock > Inventory Value tab - one row per stocked SKU (same
// scope as Stock Overview: everything except Product and Unavailable) with
// its live unit cost and current-stock x unit-cost valuation. Unit cost
// comes from buildCostResolver (../_lib/costing.js, same live resolver
// Menu Engineering uses) rather than sku_cost_history/current-cost.js
// directly, so Semi-Finished/Component items (never purchased, so they
// have no cost history row) still get a resolved cost instead of showing
// as worthless.
import { getSupabase, getBrandId, jsonResponse, errorResponse } from "../_lib/supabase.js";
import { buildCostResolver } from "../_lib/costing.js";

export async function onRequestGet({ env }) {
  try {
    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    const [itemsRes, resolver] = await Promise.all([
      supabase
        .from("sku_items")
        .select("id, sku, name, category, unit, item_type")
        .eq("brand_id", brandId)
        .neq("item_type", "Product")
        .neq("status", "Unavailable")
        .order("registry_order"),
      buildCostResolver(supabase, brandId)
    ]);
    if (itemsRes.error) throw itemsRes.error;
    const items = itemsRes.data;

    const ids = items.map((i) => i.id);
    const { data: stockRows, error: stockErr } = await supabase
      .from("current_stock")
      .select("sku_id, qty_on_hand")
      .in("sku_id", ids);
    if (stockErr) throw stockErr;
    const stockBySku = new Map(stockRows.map((s) => [s.sku_id, Number(s.qty_on_hand)]));

    const rows = items.map((it) => {
      const currentStock = stockBySku.has(it.id) ? stockBySku.get(it.id) : 0;
      const unitCost = resolver.getUnitCost(it.id);
      return {
        sku: it.sku,
        name: it.name,
        category: it.category,
        itemType: it.item_type,
        unit: it.unit,
        currentStock: currentStock,
        unitCost: unitCost,
        value: currentStock * unitCost
      };
    });

    return jsonResponse(rows);
  } catch (err) {
    return errorResponse(err);
  }
}
