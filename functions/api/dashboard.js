import { getSupabase, getBrandId, jsonResponse, errorResponse } from "./_lib/supabase.js";
import { computeLiveMonthlyData } from "./pnl.js";
import { getManualSalesRows, getOnlineSalesRows } from "./_lib/sales.js";

// "Today"/"this month" in the configured Timezone setting (Settings >
// General), not the Worker's own UTC clock - same source pages/opex.js's
// Summary now reads client-side via todayISO() (shared.js), so Dashboard
// and OpEx Summary agree on which day/month it is instead of two different
// ambient clocks disagreeing right around a boundary.
async function todayInBrandTimezone(supabase, brandId) {
  const { data, error } = await supabase.from("settings").select("value").eq("brand_id", brandId).eq("key", "Timezone").maybeSingle();
  if (error) throw error;
  const timezone = (data && data.value) || "Asia/Makassar";

  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date()); // "YYYY-MM-DD"
  } catch (err) {
    return new Date().toISOString().slice(0, 10);
  }
}

function addMonthsToDateStr(dateStr, n) {
  const [y, m] = dateStr.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-01";
}

export async function onRequestGet({ env }) {
  try {
    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    const today = await todayInBrandTimezone(supabase, brandId);
    const monthStart = today.slice(0, 7) + "-01";
    const nextMonthStart = addMonthsToDateStr(monthStart, 1);

    const [cashRow, bankRow, monthTxns, lowStock, lowStockTotalTracked, actionNeededOrders, unpaidDriverPayout, driverPayoutMonth, live, revenueTrendDaily] = await Promise.all([
      latestBalance(supabase, brandId, "Cash"),
      latestBalance(supabase, brandId, "Bank"),
      monthTotals(supabase, brandId, monthStart),
      lowStockItems(supabase, brandId),
      totalTrackedSkuCount(supabase, brandId),
      actionNeededOrdersList(supabase, brandId),
      unpaidDriverPayoutTotal(supabase, brandId),
      driverPayoutThisMonth(supabase, brandId, monthStart, nextMonthStart),
      computeLiveMonthlyData(supabase, brandId),
      revenueTrendDailyList(supabase, brandId, today, 90)
    ]);

    // This month is always the live (never-closeable) bucket - see pnl.js's
    // file comment - so no need to check pnl_lines/closed status here.
    const thisMonthBucket = live.buckets[live.nowKey] || { revenueByPlatform: {}, foodCost: 0, packagingCost: 0, opexByCategory: {} };
    const revenue = Object.values(thisMonthBucket.revenueByPlatform).reduce((s, v) => s + v, 0);
    const cogs = thisMonthBucket.foodCost + thisMonthBucket.packagingCost;
    const opex = Object.values(thisMonthBucket.opexByCategory).reduce((s, v) => s + v, 0);
    const netProfit = revenue - cogs - opex;
    const salesByChannel = Object.entries(thisMonthBucket.revenueByPlatform)
      .map(([platform, platformRevenue]) => ({ platform, revenue: platformRevenue }))
      .sort((a, b) => b.revenue - a.revenue);
    const opexByCategoryThisMonth = Object.entries(thisMonthBucket.opexByCategory)
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount);

    return jsonResponse({
      cashBalance: cashRow,
      bankBalance: bankRow,
      income: monthTxns.income,
      expense: monthTxns.expense,
      netProfit,
      salesByChannel,
      unpaidDriverPayout,
      lowStock,
      actionNeededOrders,
      // Added for Dashboard v2 - the original Dashboard page (pages/
      // dashboard.js) doesn't read any of these, only the fields above.
      lowStockTotalTracked,
      driverPayoutThisMonth: driverPayoutMonth,
      opexByCategoryThisMonth,
      revenueTrendDaily
    });
  } catch (err) {
    return errorResponse(err);
  }
}

// Same Sales revenue source as P&L/salesByChannel above (getManualSalesRows/
// getOnlineSalesRows), just bucketed per calendar day instead of per month -
// for Dashboard v2's Revenue Flow chart. Fixed `days`-long window ending
// today, zero-filled so a day with no sales is a real 0 point, not a gap.
// byPlatform is included per day (not just the summed total) so the chart
// can toggle between a single Total line and one line per channel without
// a second fetch/query.
async function revenueTrendDailyList(supabase, brandId, todayStr, days) {
  const [manual, online] = await Promise.all([getManualSalesRows(supabase, brandId), getOnlineSalesRows(supabase, brandId)]);
  const byDate = new Map();
  manual.concat(online).forEach((r) => {
    const d = String(r.date).slice(0, 10);
    const platform = r.platform || "(Unspecified)";
    if (!byDate.has(d)) byDate.set(d, {});
    const byPlatform = byDate.get(d);
    byPlatform[platform] = (byPlatform[platform] || 0) + r.revenue;
  });

  const [y, m, d] = todayStr.split("-").map(Number);
  const end = new Date(Date.UTC(y, m - 1, d));
  const points = [];
  for (let i = days - 1; i >= 0; i--) {
    const dt = new Date(end);
    dt.setUTCDate(dt.getUTCDate() - i);
    const dateStr = dt.toISOString().slice(0, 10);
    const byPlatform = byDate.get(dateStr) || {};
    const revenue = Object.values(byPlatform).reduce((s, v) => s + v, 0);
    points.push({ date: dateStr, revenue, byPlatform });
  }
  return points;
}

// Paid vs unpaid driver payout for Delivery orders dated THIS month
// specifically (unlike unpaidDriverPayoutTotal below, which is the
// all-time actionable total) - for Dashboard v2's progress-bar card, "how
// caught up are we on this month's driver payouts".
async function driverPayoutThisMonth(supabase, brandId, monthStart, nextMonthStart) {
  const { data, error } = await supabase
    .from("orders")
    .select("delivery_fee, driver_payout_status")
    .eq("brand_id", brandId)
    .eq("order_type", "Delivery")
    .gte("order_date", monthStart)
    .lt("order_date", nextMonthStart);
  if (error) throw error;

  return data.reduce(
    (acc, o) => {
      const fee = Number(o.delivery_fee) || 0;
      if (o.driver_payout_status === "Paid") acc.paid += fee;
      else acc.unpaid += fee;
      return acc;
    },
    { paid: 0, unpaid: 0 }
  );
}

// Denominator for Dashboard v2's Stock Alert progress bar - same filter as
// lowStockItems below, minus the "currently below min" condition, via a
// count-only query (cheaper than re-fetching every row twice).
async function totalTrackedSkuCount(supabase, brandId) {
  const { count, error } = await supabase
    .from("sku_items")
    .select("id", { count: "exact", head: true })
    .eq("brand_id", brandId)
    .neq("item_type", "Product")
    .neq("status", "Unavailable")
    .not("min_stock", "is", null);
  if (error) throw error;
  return count || 0;
}

// Every order still un-Paid or un-fulfilled (delivery_fee's driver payout
// is a separate concern - see unpaidDriverPayoutTotal) - same "not done yet"
// predicate as functions/api/orders.js's isOrderDone, just inverted and
// applied here directly (that function isn't exported for reuse). Oldest
// first - the longest-waiting order is the most overdue for action, not
// the newest.
async function actionNeededOrdersList(supabase, brandId) {
  const { data, error } = await supabase
    .from("orders")
    .select("order_code, order_date, order_type, payment_status, fulfillment_status, delivery_fee, customers(name, contact), order_items(line_total)")
    .eq("brand_id", brandId)
    .neq("order_status", "Cancelled")
    .neq("order_status", "Completed")
    .order("order_date", { ascending: true })
    .limit(8);
  if (error) throw error;

  return data.map((o) => ({
    orderCode: o.order_code,
    orderDate: o.order_date,
    customerName: o.customers ? o.customers.name : "",
    customerContact: o.customers ? o.customers.contact : "",
    orderType: o.order_type,
    paymentStatus: o.payment_status,
    fulfillmentStatus: o.fulfillment_status,
    totalPrice: (o.order_items || []).reduce((sum, it) => sum + Number(it.line_total), 0) + (Number(o.delivery_fee) || 0)
  }));
}

// Fetches every Delivery order and filters client-side rather than
// `.neq("driver_payout_status", "Paid")` in the query - driver_payout_status
// is null for "not yet paid" (see pages/orders.js's Payout History), and SQL
// NULL != 'Paid' evaluates to NULL (excluded), not true, so that filter
// would silently drop every genuinely-unpaid row instead of counting them.
async function unpaidDriverPayoutTotal(supabase, brandId) {
  const { data, error } = await supabase
    .from("orders")
    .select("delivery_fee, driver_payout_status")
    .eq("brand_id", brandId)
    .eq("order_type", "Delivery");
  if (error) throw error;

  return data
    .filter((o) => o.driver_payout_status !== "Paid")
    .reduce((sum, o) => sum + (Number(o.delivery_fee) || 0), 0);
}

async function latestBalance(supabase, brandId, account) {
  const { data, error } = await supabase
    .from("cashflow_transactions")
    .select("running_balance")
    .eq("brand_id", brandId)
    .eq("account", account)
    .order("txn_code", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? Number(data.running_balance) : 0;
}

async function monthTotals(supabase, brandId, monthStart) {
  const { data, error } = await supabase
    .from("cashflow_transactions")
    .select("cash_in, cash_out")
    .eq("brand_id", brandId)
    .gte("txn_date", monthStart);
  if (error) throw error;

  return data.reduce(
    (acc, row) => {
      acc.income += Number(row.cash_in) || 0;
      acc.expense += Number(row.cash_out) || 0;
      return acc;
    },
    { income: 0, expense: 0 }
  );
}

// current_stock has no qty for SKUs with zero movement yet, so those never
// show up as "low" here even if min_stock is set - there's simply nothing
// to compare against. Acceptable for now: a SKU with truly zero stock and
// zero purchases is a data-entry gap, not a runtime alert.
async function lowStockItems(supabase, brandId) {
  // Same exclusions as functions/api/inventory/overview.js: Product isn't a
  // stocked item (min_stock on one is meaningless), and an Unavailable SKU
  // should stay out of every Inventory Stock view, alerts included.
  const { data: skus, error: skuErr } = await supabase
    .from("sku_items")
    .select("id, sku, name, unit, min_stock")
    .eq("brand_id", brandId)
    .neq("item_type", "Product")
    .neq("status", "Unavailable")
    .not("min_stock", "is", null);
  if (skuErr) throw skuErr;
  if (!skus.length) return [];

  const ids = skus.map((s) => s.id);
  const { data: stock, error: stockErr } = await supabase
    .from("current_stock")
    .select("sku_id, qty_on_hand")
    .in("sku_id", ids);
  if (stockErr) throw stockErr;

  const stockBySku = new Map(stock.map((s) => [s.sku_id, Number(s.qty_on_hand)]));

  return skus
    .map((s) => ({
      sku: s.sku,
      name: s.name,
      unit: s.unit,
      minStock: Number(s.min_stock),
      qtyOnHand: stockBySku.has(s.id) ? stockBySku.get(s.id) : 0
    }))
    .filter((s) => s.qtyOnHand < s.minStock)
    .sort((a, b) => a.qtyOnHand - a.minStock - (b.qtyOnHand - b.minStock));
}

