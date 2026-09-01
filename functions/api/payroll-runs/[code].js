// GET: one run + its lines (joined with staff name). PATCH: either adjust
// one line's bonus (still Draft) or close the whole run - closing syncs
// one opex_entries row per staff with gross_pay > 0 (category "Payroll",
// same "one row per group" pattern as _lib/opex.js's
// resyncDriverPayoutOpexGroup, just a one-shot at close time instead of an
// ongoing resync) and freezes the run (no more edits/regeneration after).
import { getSupabase, getBrandId, jsonResponse, errorResponse } from "../_lib/supabase.js";
import { nextCode } from "../_lib/codes.js";

async function getRun(supabase, brandId, code) {
  const { data, error } = await supabase
    .from("payroll_runs")
    .select("id, run_code, period_month, status")
    .eq("brand_id", brandId)
    .eq("run_code", code)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function onRequestGet({ env, params }) {
  try {
    const code = decodeURIComponent(params.code);
    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    const run = await getRun(supabase, brandId, code);
    if (!run) return jsonResponse({ error: "Payroll run not found: " + code }, 404);

    const { data: lines, error: linesErr } = await supabase
      .from("payroll_lines")
      .select("staff_id, employment_type, base_pay, worked_days, absent_days, deduction, bonus, gross_pay, payout_opex_code, staff(name)")
      .eq("payroll_run_id", run.id)
      .order("staff(name)");
    if (linesErr) throw linesErr;

    return jsonResponse({
      runCode: run.run_code,
      month: run.period_month.slice(0, 7),
      status: run.status,
      lines: lines.map((l) => ({
        staffId: l.staff_id,
        staffName: l.staff ? l.staff.name : null,
        employmentType: l.employment_type,
        basePay: Number(l.base_pay),
        workedDays: l.worked_days,
        absentDays: l.absent_days,
        deduction: Number(l.deduction),
        bonus: Number(l.bonus),
        grossPay: Number(l.gross_pay),
        payoutOpexCode: l.payout_opex_code
      }))
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function onRequestPatch({ request, env, params }) {
  try {
    const code = decodeURIComponent(params.code);
    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);
    const body = await request.json();

    const run = await getRun(supabase, brandId, code);
    if (!run) return jsonResponse({ error: "Payroll run not found: " + code }, 404);
    if (run.status === "Closed") return jsonResponse({ error: "This payroll run is already closed." }, 400);

    if (body.action === "updateBonus") {
      const bonus = Number(body.bonus) || 0;
      if (!body.staffId) return jsonResponse({ error: "staffId is required" }, 400);

      const { data: line, error: lineErr } = await supabase
        .from("payroll_lines")
        .select("base_pay")
        .eq("payroll_run_id", run.id)
        .eq("staff_id", body.staffId)
        .maybeSingle();
      if (lineErr) throw lineErr;
      if (!line) return jsonResponse({ error: "Staff not found on this run" }, 404);

      const { error: updErr } = await supabase
        .from("payroll_lines")
        .update({ bonus: bonus, gross_pay: Number(line.base_pay) + bonus })
        .eq("payroll_run_id", run.id)
        .eq("staff_id", body.staffId);
      if (updErr) throw updErr;

      return jsonResponse({ ok: true });
    }

    if (body.action === "close") {
      const { data: lines, error: linesErr } = await supabase
        .from("payroll_lines")
        .select("id, staff_id, gross_pay, staff(name)")
        .eq("payroll_run_id", run.id);
      if (linesErr) throw linesErr;

      const monthLabel = run.period_month.slice(0, 7);
      for (const line of lines) {
        if (Number(line.gross_pay) <= 0) continue;
        const staffName = line.staff ? line.staff.name : "Unknown";
        const opexCode = await nextCode(supabase, "opex_entries", "opex_code", brandId, "OPX", 4);
        const { error: insErr } = await supabase.from("opex_entries").insert({
          brand_id: brandId,
          opex_code: opexCode,
          entry_date: run.period_month,
          category: "Payroll",
          description: "Payroll - " + staffName + ", " + monthLabel,
          gross_amount: Number(line.gross_pay),
          amort: "No",
          period: 1
        });
        if (insErr) throw insErr;

        const { error: linkErr } = await supabase
          .from("payroll_lines")
          .update({ payout_opex_code: opexCode })
          .eq("id", line.id);
        if (linkErr) throw linkErr;
      }

      const { error: closeErr } = await supabase
        .from("payroll_runs")
        .update({ status: "Closed", closed_at: new Date().toISOString() })
        .eq("id", run.id);
      if (closeErr) throw closeErr;

      return jsonResponse({ ok: true });
    }

    return jsonResponse({ error: "Unknown action" }, 400);
  } catch (err) {
    return errorResponse(err);
  }
}
