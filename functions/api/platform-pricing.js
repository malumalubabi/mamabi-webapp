// Menu Engineering - Platform Pricing: Platform Selling Price (editable, see
// [sku].js) plus Markup Price/Base+Platform Gross Margin, ported from the
// old app's getPlatformPricing(). Platform Fee is read live from settings
// ("Platform Fee %", a plain percent number e.g. "20") instead of a
// dedicated PlatformPricing sheet cell - Markup Price is always derived from
// Selling Price + fee; Platform Selling Price stays purely manual, no
// default/formula, same as the old app.
import { getSupabase, getBrandId, jsonResponse, errorResponse } from "./_lib/supabase.js";
import { buildCostResolver } from "./_lib/costing.js";

export async function onRequestGet({ env }) {
  try {
    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    const [resolver, settingsRes] = await Promise.all([
      buildCostResolver(supabase, brandId),
      supabase.from("settings").select("value").eq("brand_id", brandId).eq("key", "Platform Fee %").maybeSingle()
    ]);
    if (settingsRes.error) throw settingsRes.error;

    const fee = (Number(settingsRes.data ? settingsRes.data.value : 0) || 0) / 100;

    const products = Object.values(resolver.skuById).filter((s) => s.item_type === "Product");

    const rows = products
      .map((p) => {
        const { items } = resolver.getBreakdown(p.id);
        const totalCogs = items.reduce((sum, it) => sum + it.lineCost, 0);
        const sellingPrice = Number(p.selling_price) || 0;
        const platformSellingPrice = Number(p.platform_selling_price) || 0;

        const markupPrice = fee < 1 ? sellingPrice / (1 - fee) : 0;
        const grossProfit = sellingPrice - totalCogs;
        const baseGrossMarginPct = sellingPrice ? grossProfit / sellingPrice : 0;

        const platformNetRevenue = platformSellingPrice * (1 - fee);
        const platformGrossProfit = platformNetRevenue - totalCogs;
        const platformGrossMarginPct = platformNetRevenue ? platformGrossProfit / platformNetRevenue : 0;

        const marginDiff = platformGrossMarginPct - baseGrossMarginPct;
        let marginTrend = "same";
        if (platformSellingPrice) {
          if (marginDiff > 0.0001) marginTrend = "up";
          else if (marginDiff < -0.0001) marginTrend = "down";
        }

        return {
          sku: p.sku,
          name: p.name,
          displayOrder: p.display_order === null ? null : Number(p.display_order),
          sellingPrice: sellingPrice,
          markupPrice: markupPrice,
          platformSellingPrice: platformSellingPrice,
          baseGrossMarginPct: baseGrossMarginPct,
          platformGrossMarginPct: platformGrossMarginPct,
          marginTrend: marginTrend
        };
      })
      // Mirrors Pricing's order (Menu Engineering > Pricing > Arrange) - no
      // separate ordering feature here, same display_order column.
      .sort((a, b) => {
        if (a.displayOrder !== null && b.displayOrder !== null) return a.displayOrder - b.displayOrder;
        if (a.displayOrder !== null) return -1;
        if (b.displayOrder !== null) return 1;
        return a.sku.localeCompare(b.sku);
      });

    return jsonResponse({ fee: fee, rows: rows });
  } catch (err) {
    return errorResponse(err);
  }
}
