// P&L report - ported from the old app's PnLService.gs getPnLReport(), which
// was 100% computed live from Sales + Opex (no manual entry table existed
// there at all). Same here, EXCEPT: per explicit request, a past month can
// be "closed" (see pnl-close.js) once it's over, freezing its numbers into
// pnl_lines so they don't quietly drift if Sales/Opex data changes later or
// a PnL Category gets reclassified Fixed<->Variable - real P&L is supposed
// to stay put once the books are closed. The current (still-open) month,
// and any past month never explicitly closed, is always computed live.
//
// All dates involved (sale_date/order_date/entry_date/period_month) are
// plain DATE columns already in the brand's local calendar day - no
// timezone math needed, just slice(0, 7) for the "YYYY-MM" bucket key.
import { getSupabase, getBrandId, jsonResponse, errorResponse } from "./_lib/supabase.js";
import { getManualSalesRows, getOnlineSalesRows } from "./_lib/sales.js";

const BENCHMARKS = { grossMargin: 0.65, netMargin: 0.15, primeCostPct: 0.60 };

function currentMonthKey() {
  const now = new Date();
  return now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
}

export function monthKeysFrom(startYear, startMonth) {
  const keys = [];
  const nowKey = currentMonthKey();
  let y = startYear, m = startMonth;
  while (true) {
    const key = y + "-" + String(m).padStart(2, "0");
    keys.push(key);
    if (key === nowKey) break;
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return keys;
}

function monthLabel(monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString("en-US", { month: "short", year: "numeric" });
}

// Same seen-then-config-order rule as the old app's orderByConfigList_() -
// values from the managed list come first in that list's order, anything
// seen in the data but not (or no longer) in the list is appended
// alphabetically so nothing silently disappears.
function orderByConfigList(seen, configOrder) {
  const known = configOrder.filter((v) => seen.has(v));
  const extra = [...seen].filter((v) => !configOrder.includes(v)).sort();
  return known.concat(extra);
}

function emptyBucket() {
  return { revenueByPlatform: {}, foodCost: 0, packagingCost: 0, opexByCategory: {}, sectionByCategory: {}, otherIncomeByCategory: {} };
}

// Rolled-up Revenue/COGS/OPEX totals, cheap to compare instead of diffing
// every platform/category line - proportionate for a "something changed"
// flag (a per-line diff would catch a same-total offsetting change, but
// that's a much rarer case than the actual drift this guards against: a
// backdated order/opex landing in an already-closed month).
function bucketTotals(b) {
  return {
    revenue: Object.values(b.revenueByPlatform).reduce((s, v) => s + v, 0),
    cogs: b.foodCost + b.packagingCost,
    opex: Object.values(b.opexByCategory).reduce((s, v) => s + v, 0),
    otherIncome: Object.values(b.otherIncomeByCategory).reduce((s, v) => s + v, 0)
  };
}

function bucketTotalsDiffer(liveBucket, frozenBucket) {
  const live = bucketTotals(liveBucket);
  const frozen = bucketTotals(frozenBucket);
  const EPS = 0.5; // rupiah - tolerate float rounding noise, not real drift
  return Math.abs(live.revenue - frozen.revenue) > EPS || Math.abs(live.cogs - frozen.cogs) > EPS ||
    Math.abs(live.opex - frozen.opex) > EPS || Math.abs(live.otherIncome - frozen.otherIncome) > EPS;
}

// Amortized entries (amort=Yes, period=N) spread their accrued_expense
// (already gross_amount/period, via the generated column) across N
// consecutive months starting at entry_date's month, instead of landing
// entirely in the entry's own month. The old app's OpexService/PnLService
// never actually did this (accruedExpense was booked once, same as a
// period=1 entry) despite having the Amort/Period fields - this is a real
// fix, not a port.
function addMonths(monthKey, n) {
  const [y, m] = monthKey.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}

// Live buckets for every month in range, before any closed-month snapshot
// override - shared by the GET report below and pnl-close.js (closing/
// recalculating a month always snapshots freshly-computed live numbers,
// never the previous snapshot).
export async function computeLiveMonthlyData(supabase, brandId) {
  const [settingsRes, listsRes, opexRes, manualSales, onlineSales, deliveryFeeRes] = await Promise.all([
    supabase.from("settings").select("key, value").eq("brand_id", brandId).in("key", ["PnL Start Year", "PnL Start Month"]),
    supabase.from("settings_lists").select("list_name, value, meta").eq("brand_id", brandId).in("list_name", ["Sales Platform", "PnL Categories"]).order("sort_order"),
    supabase.from("opex_entries").select("entry_date, category, accrued_expense, period").eq("brand_id", brandId),
    getManualSalesRows(supabase, brandId),
    getOnlineSalesRows(supabase, brandId),
    // Delivery fee collected from the customer on completed Online Delivery
    // orders - previously had no offsetting income anywhere in P&L at all,
    // even though the matching driver payout IS booked as a real Logistic
    // OPEX expense (see functions/api/_lib/opex.js's resyncDriverPayoutOpexGroup),
    // which understated Net Profit by the full pass-through amount. Kept OUT
    // of Revenue (would inflate Gross Margin % with non-sales cash) - a
    // separate Other Income section instead, per explicit request. Online
    // only - Platform Orders (GrabFood/GoFood) never carry a delivery_fee,
    // their courier logistics aren't ours to account for either side.
    supabase.from("orders").select("order_date, delivery_fee").eq("brand_id", brandId).eq("order_status", "Completed").eq("order_type", "Delivery").eq("platform", "Online")
  ]);
  if (settingsRes.error) throw settingsRes.error;
  if (listsRes.error) throw listsRes.error;
  if (opexRes.error) throw opexRes.error;
  if (deliveryFeeRes.error) throw deliveryFeeRes.error;

  const settingsByKey = {};
  settingsRes.data.forEach((r) => { settingsByKey[r.key] = r.value; });
  const startYear = Number(settingsByKey["PnL Start Year"]) || new Date().getFullYear();
  const startMonth = Number(settingsByKey["PnL Start Month"]) || 1;

  const salesPlatformOrder = listsRes.data.filter((r) => r.list_name === "Sales Platform").map((r) => r.value);
  const categoryOrder = [];
  const categoryMetaMap = {};
  listsRes.data.filter((r) => r.list_name === "PnL Categories").forEach((r) => {
    categoryOrder.push(r.value);
    categoryMetaMap[r.value] = r.meta;
  });

  const monthKeys = monthKeysFrom(startYear, startMonth);
  const nowKey = currentMonthKey();

  const buckets = {};
  monthKeys.forEach((mk) => { buckets[mk] = emptyBucket(); });

  const unpricedNames = {};
  manualSales.concat(onlineSales).forEach((r) => {
    const mk = String(r.date).slice(0, 7);
    const b = buckets[mk];
    if (!b) return;
    const platform = r.platform || "(Unspecified)";
    b.revenueByPlatform[platform] = (b.revenueByPlatform[platform] || 0) + r.revenue;
    if (r.foodCost > 0 || r.packagingCost > 0) {
      b.foodCost += r.foodCost;
      b.packagingCost += r.packagingCost;
    } else if (r.sku) {
      unpricedNames[r.sku] = r.productName || r.sku;
    }
  });

  deliveryFeeRes.data.forEach((r) => {
    const fee = Number(r.delivery_fee) || 0;
    if (fee <= 0) return;
    const mk = String(r.order_date).slice(0, 7);
    const b = buckets[mk];
    if (!b) return;
    b.otherIncomeByCategory["Delivery Fee Income"] = (b.otherIncomeByCategory["Delivery Fee Income"] || 0) + fee;
  });

  opexRes.data.forEach((r) => {
    const entryMonth = String(r.entry_date).slice(0, 7);
    const period = Number(r.period) || 1;
    const perMonthAmount = Number(r.accrued_expense);
    for (let i = 0; i < period; i++) {
      const mk = addMonths(entryMonth, i);
      const b = buckets[mk];
      if (!b) continue;
      b.opexByCategory[r.category] = (b.opexByCategory[r.category] || 0) + perMonthAmount;
      b.sectionByCategory[r.category] = categoryMetaMap[r.category] === "Fixed" ? "Fixed" : "Variable";
    }
  });

  return { monthKeys, nowKey, buckets, salesPlatformOrder, categoryOrder, categoryMetaMap, unpricedNames };
}

export async function onRequestGet({ env }) {
  try {
    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    const [live, pnlLinesRes] = await Promise.all([
      computeLiveMonthlyData(supabase, brandId),
      supabase.from("pnl_lines").select("period_month, section, category, amount, closed_at").eq("brand_id", brandId)
    ]);
    if (pnlLinesRes.error) throw pnlLinesRes.error;

    const { monthKeys, nowKey, buckets, salesPlatformOrder, categoryOrder, categoryMetaMap, unpricedNames } = live;

    // Closed months: overwrite that month's bucket entirely with the frozen
    // snapshot instead of the live one just built above - but first compare
    // the live numbers against the snapshot being frozen-over, so a month
    // that's drifted since it was closed (a backdated order/opex landing in
    // it later) can be flagged instead of silently showing stale numbers
    // with no hint that Recalculate is needed.
    const closedInfo = {};
    const closedBuckets = {};
    const driftedInfo = {};
    pnlLinesRes.data.forEach((r) => {
      const mk = String(r.period_month).slice(0, 7);
      if (!closedBuckets[mk]) closedBuckets[mk] = emptyBucket();
      if (!closedInfo[mk]) closedInfo[mk] = r.closed_at;
      const b = closedBuckets[mk];
      const amount = Number(r.amount);
      if (r.section === "Revenue") b.revenueByPlatform[r.category] = amount;
      else if (r.section === "COGS" && r.category === "Food Cost") b.foodCost = amount;
      else if (r.section === "COGS" && r.category === "Packaging Cost") b.packagingCost = amount;
      else if (r.section === "OPEX Fixed") { b.opexByCategory[r.category] = amount; b.sectionByCategory[r.category] = "Fixed"; }
      else if (r.section === "OPEX Variable") { b.opexByCategory[r.category] = amount; b.sectionByCategory[r.category] = "Variable"; }
      else if (r.section === "Other Income") b.otherIncomeByCategory[r.category] = amount;
    });
    Object.keys(closedBuckets).forEach((mk) => {
      if (!buckets[mk]) return;
      driftedInfo[mk] = bucketTotalsDiffer(buckets[mk], closedBuckets[mk]);
      buckets[mk] = closedBuckets[mk];
    });

    const months = monthKeys.map((mk) => ({
      key: mk,
      label: monthLabel(mk),
      closed: !!closedInfo[mk],
      closedAt: closedInfo[mk] || null,
      closeable: mk < nowKey,
      drifted: !!driftedInfo[mk]
    }));

    const seenPlatforms = new Set();
    const seenCategories = new Set();
    monthKeys.forEach((mk) => {
      Object.keys(buckets[mk].revenueByPlatform).forEach((p) => seenPlatforms.add(p));
      Object.keys(buckets[mk].opexByCategory).forEach((c) => seenCategories.add(c));
    });

    const platforms = orderByConfigList(seenPlatforms, salesPlatformOrder);
    const fixedCategories = orderByConfigList(new Set([...seenCategories].filter((c) => categoryMetaMap[c] === "Fixed")), categoryOrder);
    const variableCategories = orderByConfigList(new Set([...seenCategories].filter((c) => categoryMetaMap[c] !== "Fixed")), categoryOrder);

    const rows = [];
    const header = (label) => rows.push({ label: label, values: null });
    const line = (label, values, bold) => rows.push({ label: label, values: values, bold: !!bold });

    const revenueByMonth = monthKeys.map((mk) => platforms.reduce((sum, p) => sum + (buckets[mk].revenueByPlatform[p] || 0), 0));
    header("Revenue");
    platforms.forEach((p) => line(p, monthKeys.map((mk) => buckets[mk].revenueByPlatform[p] || 0)));
    line("Total Revenue", revenueByMonth, true);

    header("COGS");
    const foodCostByMonth = monthKeys.map((mk) => buckets[mk].foodCost);
    const packagingCostByMonth = monthKeys.map((mk) => buckets[mk].packagingCost);
    const totalCogsByMonth = monthKeys.map((mk, i) => foodCostByMonth[i] + packagingCostByMonth[i]);
    line("Food Cost", foodCostByMonth);
    line("Packaging Cost", packagingCostByMonth);
    line("Total COGS", totalCogsByMonth, true);

    header("Gross Profit");
    const grossProfitByMonth = monthKeys.map((mk, i) => revenueByMonth[i] - totalCogsByMonth[i]);
    const grossMarginByMonth = monthKeys.map((mk, i) => (revenueByMonth[i] ? grossProfitByMonth[i] / revenueByMonth[i] : 0));
    line("Gross Profit", grossProfitByMonth, true);
    line("Gross Margin %", grossMarginByMonth);

    // Subtotals sum from each month's OWN frozen/live sectionByCategory
    // (not from which header the row below happens to render under) - the
    // one thing that must stay correct even if a category's Fixed/Variable
    // meta gets reclassified after some months were already closed. See the
    // file-level comment.
    header("OPEX");
    header("Fixed Cost");
    fixedCategories.forEach((c) => line(c, monthKeys.map((mk) => buckets[mk].opexByCategory[c] || 0)));
    const fixedCostByMonth = monthKeys.map((mk) =>
      Object.keys(buckets[mk].opexByCategory).reduce((sum, c) => sum + (buckets[mk].sectionByCategory[c] === "Fixed" ? buckets[mk].opexByCategory[c] : 0), 0)
    );
    line("Subtotal", fixedCostByMonth, true);

    header("Variable Cost");
    variableCategories.forEach((c) => line(c, monthKeys.map((mk) => buckets[mk].opexByCategory[c] || 0)));
    const variableCostByMonth = monthKeys.map((mk) =>
      Object.keys(buckets[mk].opexByCategory).reduce((sum, c) => sum + (buckets[mk].sectionByCategory[c] !== "Fixed" ? buckets[mk].opexByCategory[c] : 0), 0)
    );
    line("Subtotal", variableCostByMonth, true);

    const totalOpexByMonth = monthKeys.map((mk, i) => fixedCostByMonth[i] + variableCostByMonth[i]);
    line("Total OPEX", totalOpexByMonth, true);

    // Pass-through cash (currently just delivery fee collected from the
    // customer) that has a real offsetting expense elsewhere (Logistic
    // OPEX's driver payout) but isn't sales revenue - kept out of the
    // Revenue section entirely so Gross Margin % stays a pure sales figure,
    // per explicit request. Only affects Net Profit, added back in below.
    const seenOtherIncomeCategories = new Set();
    monthKeys.forEach((mk) => Object.keys(buckets[mk].otherIncomeByCategory).forEach((c) => seenOtherIncomeCategories.add(c)));
    const otherIncomeCategories = [...seenOtherIncomeCategories].sort();
    header("Other Income");
    otherIncomeCategories.forEach((c) => line(c, monthKeys.map((mk) => buckets[mk].otherIncomeByCategory[c] || 0)));
    const otherIncomeByMonth = monthKeys.map((mk) => Object.values(buckets[mk].otherIncomeByCategory).reduce((s, v) => s + v, 0));
    line("Total Other Income", otherIncomeByMonth, true);

    header("Profitability");
    const netProfitByMonth = monthKeys.map((mk, i) => grossProfitByMonth[i] - totalOpexByMonth[i] + otherIncomeByMonth[i]);
    const netMarginByMonth = monthKeys.map((mk, i) => (revenueByMonth[i] ? netProfitByMonth[i] / revenueByMonth[i] : 0));
    const payrollByMonth = monthKeys.map((mk) => buckets[mk].opexByCategory["Payroll"] || 0);
    const primeCostByMonth = monthKeys.map((mk, i) => totalCogsByMonth[i] + payrollByMonth[i]);
    const primeCostPctByMonth = monthKeys.map((mk, i) => (revenueByMonth[i] ? primeCostByMonth[i] / revenueByMonth[i] : 0));

    line("Operating/Net Profit", netProfitByMonth, true);
    line("Net Margin %", netMarginByMonth);
    line("Prime Cost (COGS+Payroll)", primeCostByMonth);
    line("Prime Cost %", primeCostPctByMonth);

    header("Benchmark Check");
    line("Gross Margin % (>" + (BENCHMARKS.grossMargin * 100) + "%)", grossMarginByMonth.map((v) => (v >= BENCHMARKS.grossMargin ? "OK" : "Below Target")));
    line("Net Margin % (>" + (BENCHMARKS.netMargin * 100) + "%)", netMarginByMonth.map((v) => (v >= BENCHMARKS.netMargin ? "OK" : "Below Target")));
    line("Prime Cost % (<" + (BENCHMARKS.primeCostPct * 100) + "%)", primeCostPctByMonth.map((v) => (v <= BENCHMARKS.primeCostPct ? "OK" : "Above Target")));

    return jsonResponse({
      months: months,
      rows: rows,
      unpricedProductNames: Object.keys(unpricedNames).map((sku) => unpricedNames[sku])
    });
  } catch (err) {
    return errorResponse(err);
  }
}
