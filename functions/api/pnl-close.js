// Close (or recalculate/re-close) one past month's P&L into pnl_lines - see
// pnl.js's file comment for why. Always snapshots a FRESH live computation
// (never re-reads a previous snapshot), so "Recalculate" on an already-
// closed month genuinely re-derives from current Sales/Opex + current PnL
// Categories Fixed/Variable meta, then overwrites. The current (still-open)
// month can never be closed - enforced here, not just hidden in the UI.
import { getSupabase, getBrandId, jsonResponse, errorResponse } from "./_lib/supabase.js";
import { computeLiveMonthlyData } from "./pnl.js";

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const monthKey = (body.monthKey || "").trim();
    if (!/^\d{4}-\d{2}$/.test(monthKey)) return jsonResponse({ error: "monthKey must be in YYYY-MM format" }, 400);

    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    const { monthKeys, nowKey, buckets, categoryMetaMap } = await computeLiveMonthlyData(supabase, brandId);
    if (monthKey >= nowKey) return jsonResponse({ error: "Only a month before the current one can be closed." }, 400);
    if (!monthKeys.includes(monthKey)) return jsonResponse({ error: "Month is outside the P&L reporting range." }, 400);

    const bucket = buckets[monthKey];
    const periodMonth = monthKey + "-01";
    const closedAt = new Date().toISOString();

    const rows = [];
    Object.entries(bucket.revenueByPlatform).forEach(([platform, amount]) => {
      rows.push({ brand_id: brandId, period_month: periodMonth, section: "Revenue", category: platform, amount: amount, closed_at: closedAt });
    });
    rows.push({ brand_id: brandId, period_month: periodMonth, section: "COGS", category: "Food Cost", amount: bucket.foodCost, closed_at: closedAt });
    rows.push({ brand_id: brandId, period_month: periodMonth, section: "COGS", category: "Packaging Cost", amount: bucket.packagingCost, closed_at: closedAt });
    Object.entries(bucket.opexByCategory).forEach(([category, amount]) => {
      const section = categoryMetaMap[category] === "Fixed" ? "OPEX Fixed" : "OPEX Variable";
      rows.push({ brand_id: brandId, period_month: periodMonth, section: section, category: category, amount: amount, closed_at: closedAt });
    });
    Object.entries(bucket.otherIncomeByCategory).forEach(([category, amount]) => {
      rows.push({ brand_id: brandId, period_month: periodMonth, section: "Other Income", category: category, amount: amount, closed_at: closedAt });
    });

    const { error: delErr } = await supabase.from("pnl_lines").delete().eq("brand_id", brandId).eq("period_month", periodMonth);
    if (delErr) throw delErr;

    if (rows.length) {
      const { error: insErr } = await supabase.from("pnl_lines").insert(rows);
      if (insErr) throw insErr;
    }

    return jsonResponse({ monthKey: monthKey, closedAt: closedAt, lines: rows.length });
  } catch (err) {
    return errorResponse(err);
  }
}
