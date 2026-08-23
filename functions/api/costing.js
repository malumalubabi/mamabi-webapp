// Read-only recipe breakdown for one Component/Semi-Finished/Product SKU -
// ported display structure from the old app's ComponentCogsTable.html
// (items table + summary line), but computed live via buildCostResolver
// instead of reading a saved COGS - Component/COGS - Product snapshot.
import { getSupabase, getBrandId, jsonResponse, errorResponse } from "./_lib/supabase.js";
import { buildCostResolver } from "./_lib/costing.js";

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const sku = url.searchParams.get("sku");
    if (!sku) return jsonResponse({ error: "sku query param is required" }, 400);

    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);
    const resolver = await buildCostResolver(supabase, brandId);

    const parent = Object.values(resolver.skuById).find((s) => s.sku === sku);
    if (!parent) return jsonResponse({ error: "SKU not found: " + sku }, 404);

    const { items } = resolver.getBreakdown(parent.id);

    const totalQty = items.reduce((sum, it) => sum + it.qty, 0);
    const totalCost = items.reduce((sum, it) => sum + it.lineCost, 0);
    const foodCost = items.filter((it) => it.itemType !== "Packaging").reduce((sum, it) => sum + it.lineCost, 0);
    const packagingCost = items.filter((it) => it.itemType === "Packaging").reduce((sum, it) => sum + it.lineCost, 0);
    const yieldQty = Number(parent.base_yield_qty) || 0;
    const costPerGram = yieldQty ? totalCost / yieldQty : 0;

    return jsonResponse({
      sku: parent.sku,
      name: parent.name,
      itemType: parent.item_type,
      unit: parent.unit,
      baseYieldQty: parent.base_yield_qty === null ? null : Number(parent.base_yield_qty),
      items: items,
      totals: {
        totalQty: totalQty,
        totalCost: totalCost,
        costPerGram: costPerGram,
        foodCost: foodCost,
        packagingCost: packagingCost,
        totalCogs: foodCost + packagingCost
      }
    });
  } catch (err) {
    return errorResponse(err);
  }
}
