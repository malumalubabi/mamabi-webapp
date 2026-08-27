// OpEx Log, ported from the old app's OpexService.gs (DB.OPEX / "OpEx Log"
// sheet) - a separate expense ledger from Cashflow. Rows come from two
// sources: auto-booked (Driver Payout's Mark Paid, Sales's Platform/
// Marketing Fee - see functions/api/_lib/opex.js's getOpexLinkMap) and
// manual (this file's POST, for categories with no automation yet -
// Payroll/Rent/Utilities/etc., see pages/opex.js's Input Expense modal).
import { getSupabase, getBrandId, jsonResponse, errorResponse } from "./_lib/supabase.js";
import { nextCode } from "./_lib/codes.js";
import { getOpexLinkMap, isValidOpexCategory } from "./_lib/opex.js";

export async function onRequestGet({ env }) {
  try {
    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    const [entriesRes, linkMap] = await Promise.all([
      supabase
        .from("opex_entries")
        .select("opex_code, entry_date, category, description, gross_amount, amort, period, accrued_expense")
        .eq("brand_id", brandId)
        .order("opex_code", { ascending: false }),
      getOpexLinkMap(supabase, brandId)
    ]);
    if (entriesRes.error) throw entriesRes.error;

    return jsonResponse(
      entriesRes.data.map((r) => {
        const link = linkMap[r.opex_code] || null;
        return {
          opexCode: r.opex_code,
          date: r.entry_date,
          category: r.category,
          desc: r.description,
          grossAmount: Number(r.gross_amount),
          amort: r.amort,
          period: r.period,
          accruedExpense: Number(r.accrued_expense),
          linkedFrom: link ? link.source : null,
          linkedRef: link ? link.refCode : null,
          paymentMethod: link ? link.paymentMethod : null
        };
      })
    );
  } catch (err) {
    return errorResponse(err);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    if (!body.date) return jsonResponse({ error: "Date is required" }, 400);
    if (!body.category) return jsonResponse({ error: "Category is required" }, 400);
    if (!String(body.desc || "").trim()) return jsonResponse({ error: "Description is required" }, 400);
    if (!body.grossAmount || Number(body.grossAmount) <= 0) return jsonResponse({ error: "Gross amount must be greater than 0" }, 400);

    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    if (!(await isValidOpexCategory(supabase, brandId, body.category))) {
      return jsonResponse({ error: "Unknown category: " + body.category + " - add it in Settings (PnL Categories) first." }, 400);
    }

    const opexCode = await nextCode(supabase, "opex_entries", "opex_code", brandId, "OPX", 4);

    // Same guard as the old app's saveOpexEntry_(): amort defaults to "No",
    // and period is only ever anything but 1 when amort is actually "Yes".
    const amort = body.amort === "Yes" ? "Yes" : "No";
    const period = amort === "Yes" ? (Number(body.period) || 1) : 1;

    const { data, error } = await supabase
      .from("opex_entries")
      .insert({
        brand_id: brandId,
        opex_code: opexCode,
        entry_date: body.date,
        category: body.category,
        description: body.desc.trim(),
        gross_amount: Number(body.grossAmount),
        amort: amort,
        period: period
      })
      .select("opex_code")
      .single();
    if (error) throw error;

    return jsonResponse({ opexCode: data.opex_code }, 201);
  } catch (err) {
    return errorResponse(err);
  }
}
