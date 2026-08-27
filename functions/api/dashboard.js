import { getSupabase, getBrandId, jsonResponse, errorResponse } from "./_lib/supabase.js";

// "This month" in the configured Timezone setting (Settings > General),
// not the Worker's own UTC clock - same source pages/opex.js's Summary now
// reads client-side via todayISO() (shared.js), so Dashboard and OpEx
// Summary agree on which month "this month" is instead of two different
// ambient clocks disagreeing right around a month boundary.
async function currentMonthStart(supabase, brandId) {
  const { data, error } = await supabase.from("settings").select("value").eq("brand_id", brandId).eq("key", "Timezone").maybeSingle();
  if (error) throw error;
  const timezone = (data && data.value) || "Asia/Makassar";

  try {
    const todayInZone = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date()); // "YYYY-MM-DD"
    return todayInZone.slice(0, 7) + "-01";
  } catch (err) {
    return new Date().toISOString().slice(0, 7) + "-01";
  }
}

export async function onRequestGet({ env }) {
  try {
    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    const monthStart = await currentMonthStart(supabase, brandId);

    const [cashRow, bankRow, monthTxns, lowStock, recentOrders] = await Promise.all([
      latestBalance(supabase, brandId, "Cash"),
      latestBalance(supabase, brandId, "Bank"),
      monthTotals(supabase, brandId, monthStart),
      lowStockItems(supabase, brandId),
      recentOrdersList(supabase, brandId)
    ]);

    return jsonResponse({
      cashBalance: cashRow,
      bankBalance: bankRow,
      income: monthTxns.income,
      expense: monthTxns.expense,
      lowStock,
      recentOrders
    });
  } catch (err) {
    return errorResponse(err);
  }
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

async function recentOrdersList(supabase, brandId) {
  const { data, error } = await supabase
    .from("orders")
    .select("order_code, order_date, order_type, order_status, delivery_fee, customers(name, contact), order_items(line_total)")
    .eq("brand_id", brandId)
    .order("order_code", { ascending: false })
    .limit(5);
  if (error) throw error;

  return data.map((o) => ({
    orderCode: o.order_code,
    orderDate: o.order_date,
    customerName: o.customers ? o.customers.name : "",
    customerContact: o.customers ? o.customers.contact : "",
    orderType: o.order_type,
    orderStatus: o.order_status,
    totalPrice: (o.order_items || []).reduce((sum, it) => sum + Number(it.line_total), 0) + (Number(o.delivery_fee) || 0)
  }));
}
