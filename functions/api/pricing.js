// Menu Engineering - Pricing: Selling Price (editable, see [sku].js) plus
// Food Cost/Packaging Cost/Total COGS/%s/Gross Profit/Gross Margin - all
// computed live from recipe_lines via buildCostResolver, ported from the
// old app's getMenuPricing() (which read a saved "Pricing" sheet instead).
import { getSupabase, getBrandId, jsonResponse, errorResponse } from "./_lib/supabase.js";
import { buildCostResolver } from "./_lib/costing.js";

export async function onRequestGet({ env }) {
  try {
    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);
    const resolver = await buildCostResolver(supabase, brandId);

    const products = Object.values(resolver.skuById).filter((s) => s.item_type === "Product");

    const rows = products
      .map((p) => {
        const { items } = resolver.getBreakdown(p.id);
        const foodCost = items.filter((it) => it.itemType !== "Packaging").reduce((sum, it) => sum + it.lineCost, 0);
        const packagingCost = items.filter((it) => it.itemType === "Packaging").reduce((sum, it) => sum + it.lineCost, 0);
        const totalCogs = foodCost + packagingCost;
        const sellingPrice = Number(p.selling_price) || 0;
        const grossProfit = sellingPrice - totalCogs;

        return {
          sku: p.sku,
          name: p.name,
          displayOrder: p.display_order === null ? null : Number(p.display_order),
          sellingPrice: sellingPrice,
          foodCost: foodCost,
          packagingCost: packagingCost,
          totalCogs: totalCogs,
          foodCostPct: sellingPrice ? foodCost / sellingPrice : 0,
          cogsPct: sellingPrice ? totalCogs / sellingPrice : 0,
          grossProfit: grossProfit,
          grossMarginPct: sellingPrice ? grossProfit / sellingPrice : 0
        };
      })
      // Manual order (Menu Engineering > Pricing > Arrange) - nulls (never
      // arranged yet) fall back to alphabetical, sorted after every arranged row.
      .sort((a, b) => {
        if (a.displayOrder !== null && b.displayOrder !== null) return a.displayOrder - b.displayOrder;
        if (a.displayOrder !== null) return -1;
        if (b.displayOrder !== null) return 1;
        return a.sku.localeCompare(b.sku);
      });

    return jsonResponse(rows);
  } catch (err) {
    return errorResponse(err);
  }
}
