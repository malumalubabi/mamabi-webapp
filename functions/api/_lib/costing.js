// Shared live-cost resolver for Menu Engineering (Costing/Pricing/Platform
// Pricing) - walks recipe_lines recursively so a Product's cost correctly
// includes its Components' AND those Components' own Semi-Finished
// ingredient costs, not just one level deep. Unlike the old app's
// Recipe/COGS-* sheets (which snapshot Unit Cost at save time and need a
// manual "Refresh Product Costing" pass), this always reads
// current_unit_cost live, so it's never stale.
export async function buildCostResolver(supabase, brandId) {
  const [skusRes, linesRes, costRes] = await Promise.all([
    supabase.from("sku_items").select("id, sku, name, category, item_type, unit, base_yield_qty, selling_price, platform_selling_price, display_order").eq("brand_id", brandId),
    supabase.from("recipe_lines").select("id, parent_sku_id, component_sku_id, qty_per_batch_unit, unit, line_order").eq("brand_id", brandId),
    supabase.from("current_unit_cost").select("sku_id, unit_cost")
  ]);
  if (skusRes.error) throw skusRes.error;
  if (linesRes.error) throw linesRes.error;
  if (costRes.error) throw costRes.error;

  const skuById = {};
  skusRes.data.forEach((s) => { skuById[s.id] = s; });

  const linesByParent = {};
  linesRes.data.forEach((l) => {
    if (!linesByParent[l.parent_sku_id]) linesByParent[l.parent_sku_id] = [];
    linesByParent[l.parent_sku_id].push(l);
  });
  // Recipe/workflow order (prep sequence), not insertion order - nulls
  // (never arranged) fall back after every arranged line.
  Object.values(linesByParent).forEach((lines) => {
    lines.sort((a, b) => {
      if (a.line_order !== null && b.line_order !== null) return a.line_order - b.line_order;
      if (a.line_order !== null) return -1;
      if (b.line_order !== null) return 1;
      return 0;
    });
  });

  const rawCostById = {};
  costRes.data.forEach((c) => { rawCostById[c.sku_id] = Number(c.unit_cost) || 0; });

  const unitCostCache = {};

  // Ported from the old app's getProductCostingItemOptions(): a produced
  // item's usable "unit cost" depends on its own transaction unit - 'g'
  // means per-gram (costPerGram), 'pc' means the WHOLE batch's cost (one
  // full recipe run = 1 pc consumed elsewhere, e.g. Base Rica inside Comp.
  // Babi Rica). Raw items (Ingredient/Packaging/Operating) just read
  // current_unit_cost directly - no recipe of their own.
  function getUnitCost(skuId, visiting) {
    if (unitCostCache[skuId] !== undefined) return unitCostCache[skuId];
    const sku = skuById[skuId];
    if (!sku) return 0;

    if (sku.item_type !== "Component" && sku.item_type !== "Semi-Finished") {
      const cost = rawCostById[skuId] || 0;
      unitCostCache[skuId] = cost;
      return cost;
    }

    visiting = visiting || new Set();
    if (visiting.has(skuId)) return 0; // cycle guard - a component can't validly point back to itself
    visiting.add(skuId);

    const lines = linesByParent[skuId] || [];
    const totalCost = lines.reduce((sum, l) => sum + Number(l.qty_per_batch_unit) * getUnitCost(l.component_sku_id, visiting), 0);
    const yieldQty = Number(sku.base_yield_qty) || 0;
    const costPerYieldUnit = yieldQty ? totalCost / yieldQty : 0;
    const result = sku.unit === "pc" ? totalCost : costPerYieldUnit;

    unitCostCache[skuId] = result;
    return result;
  }

  // One level of recipe_lines for parentSkuId, each line's cost resolved
  // live (recursively, when that line's own item is itself produced).
  function getBreakdown(parentSkuId) {
    const parent = skuById[parentSkuId];
    const lines = linesByParent[parentSkuId] || [];

    const items = lines.map((l) => {
      const item = skuById[l.component_sku_id];
      const unitCost = getUnitCost(l.component_sku_id);
      const qty = Number(l.qty_per_batch_unit);
      return {
        lineId: l.id,
        lineOrder: l.line_order === null ? null : Number(l.line_order),
        componentSkuId: l.component_sku_id,
        sku: item ? item.sku : l.component_sku_id,
        name: item ? item.name : "",
        category: item ? item.category : "",
        itemType: item ? item.item_type : "",
        qty: qty,
        unit: l.unit,
        unitCost: unitCost,
        lineCost: qty * unitCost
      };
    });

    return { parent: parent, items: items };
  }

  return { skuById, getUnitCost, getBreakdown };
}
