// Ported from CashflowService.gs. Category -> Type/Flow reference is a
// small, stable business rule (17 categories across Operating/Investing/
// Financing) - cross-checked directly against the "Category | Type | Flow"
// table in the original Google Sheets migration source ("01. Cashflow"),
// not just derived from what's already been used in migrated data (which
// would have missed never-yet-used categories like Payroll/Rent/Utilities/
// Loan Proceeds/Loan Repayment). Lives in settings_lists now (list_name
// "Cashflow Category", meta = "Type - Flow", e.g. "Operating - OUT") instead
// of a hardcoded array, same as every other managed option list (Payment
// Method, Sales Platform, PnL Categories) - manageable/renameable (with
// cascade, see settings-lists.js's CASCADE_RENAME_TARGETS) from the Settings
// page instead of needing a code change, and no longer duplicated in
// pages/cashflow.js (that read it live off /api/settings instead).
import { getSupabase, getBrandId, jsonResponse, errorResponse } from "./_lib/supabase.js";
import { nextCode } from "./_lib/codes.js";

async function loadCategoryDefs(supabase, brandId) {
  const { data, error } = await supabase
    .from("settings_lists")
    .select("value, meta")
    .eq("brand_id", brandId)
    .eq("list_name", "Cashflow Category");
  if (error) throw error;

  const defs = {};
  data.forEach((r) => {
    const [type, flow] = String(r.meta || "").split(" - ");
    defs[r.value] = { name: r.value, type: type || null, flow: flow || null };
  });
  return defs;
}

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const account = url.searchParams.get("account") || "Bank";

    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    const { data, error } = await supabase
      .from("cashflow_transactions")
      .select("txn_code, txn_date, flow_group, category, description, cash_in, cash_out, running_balance, notes")
      .eq("brand_id", brandId)
      .eq("account", account)
      .order("txn_code", { ascending: false }); // latest first for display, like the old app's getCashflowList().reverse()
    if (error) throw error;

    return jsonResponse(
      data.map((r) => ({
        txnCode: r.txn_code,
        date: r.txn_date,
        type: r.flow_group,
        category: r.category,
        description: r.description,
        cashIn: Number(r.cash_in) || 0,
        cashOut: Number(r.cash_out) || 0,
        balance: Number(r.running_balance),
        notes: r.notes
      }))
    );
  } catch (err) {
    return errorResponse(err);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    if (!body.date) return jsonResponse({ error: "Date is required" }, 400);
    if (body.account !== "Bank" && body.account !== "Cash") return jsonResponse({ error: "Invalid account" }, 400);
    if (!Array.isArray(body.items) || !body.items.length) {
      return jsonResponse({ error: "At least one entry is required" }, 400);
    }

    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);
    const categoryDefs = await loadCategoryDefs(supabase, brandId);

    // txn_code is one shared sequence across both accounts (matches the old
    // app's single Settings!B2 counter) - scoped by brand only, not account.
    const startCode = await nextCode(supabase, "cashflow_transactions", "txn_code", brandId, "CF", 6);
    const startNum = parseInt(startCode.match(/-(\d+)$/)[1], 10);

    // Running balance is a pure append, continuing from whatever this
    // account's last balance currently is - ported as-is from the old
    // app's targetRow = lastRow+1 model. A backdated entry does NOT get
    // re-slotted into historical position by date; it's just appended.
    const { data: lastRows, error: lastErr } = await supabase
      .from("cashflow_transactions")
      .select("running_balance")
      .eq("brand_id", brandId)
      .eq("account", body.account)
      .order("txn_code", { ascending: false })
      .limit(1);
    if (lastErr) throw lastErr;
    let balance = lastRows.length ? Number(lastRows[0].running_balance) : 0;

    const rows = [];
    for (let i = 0; i < body.items.length; i++) {
      const item = body.items[i];
      const def = categoryDefs[item.category];
      if (!def) throw new Error("Category has no flow defined: " + item.category);

      const amount = Number(item.amount);
      const cashIn = def.flow === "IN" ? amount : 0;
      const cashOut = def.flow === "OUT" ? amount : 0;
      balance = balance + cashIn - cashOut;

      rows.push({
        brand_id: brandId,
        txn_code: "CF-" + String(startNum + i).padStart(6, "0"),
        txn_date: body.date,
        account: body.account,
        flow_group: def.type,
        category: item.category,
        description: item.desc || null,
        cash_in: cashIn,
        cash_out: cashOut,
        running_balance: balance,
        notes: item.notes || null
      });
    }

    const { error: insErr } = await supabase.from("cashflow_transactions").insert(rows);
    if (insErr) throw insErr;

    return jsonResponse({ count: rows.length, firstCode: rows[0].txn_code, lastCode: rows[rows.length - 1].txn_code }, 201);
  } catch (err) {
    return errorResponse(err);
  }
}
