// Simplified version of the old app's getCashflowSummaryMonthly() -
// Operating/Investing/Financing totals (in/out/net) per month, combined
// across both accounts, for the last 3 months. The old app also broke this
// down per-category and per-account; that level of detail wasn't asked for
// here (the ledger's Bank/Cash tabs already cover the per-account view).
import { getSupabase, getBrandId, jsonResponse, errorResponse } from "../_lib/supabase.js";

const FLOW_TYPES = ["Operating", "Investing", "Financing"];

function monthKey(dateStr) {
  return dateStr.slice(0, 7); // "YYYY-MM" - txn_date has no time component, so this is timezone-safe
}

function monthLabel(key) {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString("en-US", { month: "short", year: "numeric" });
}

function recentMonthKeys(count) {
  const now = new Date();
  const start = -Math.floor((count - 1) / 2);
  const keys = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + start + i, 1);
    keys.push(d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"));
  }
  return keys;
}

export async function onRequestGet({ env }) {
  try {
    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    const { data, error } = await supabase
      .from("cashflow_transactions")
      .select("txn_date, flow_group, cash_in, cash_out")
      .eq("brand_id", brandId);
    if (error) throw error;

    const months = recentMonthKeys(3);
    const buckets = {};
    FLOW_TYPES.forEach((t) => {
      buckets[t] = {};
      months.forEach((m) => { buckets[t][m] = { in: 0, out: 0 }; });
    });

    for (const tx of data) {
      const mk = monthKey(tx.txn_date);
      const bucket = buckets[tx.flow_group] && buckets[tx.flow_group][mk];
      if (!bucket) continue;
      bucket.in += Number(tx.cash_in) || 0;
      bucket.out += Number(tx.cash_out) || 0;
    }

    const groups = FLOW_TYPES.map((type) => ({
      type,
      months: months.map((mk) => ({
        month: mk,
        in: buckets[type][mk].in,
        out: buckets[type][mk].out,
        net: buckets[type][mk].in - buckets[type][mk].out
      }))
    }));

    return jsonResponse({
      months: months.map((mk) => ({ month: mk, label: monthLabel(mk) })),
      groups
    });
  } catch (err) {
    return errorResponse(err);
  }
}
