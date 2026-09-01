// HR > Attendance > Payroll - one run per month. POST generates (or, while
// still Draft, recalculates - same "always live recompute from scratch"
// pattern as P&L's computeLiveMonthlyData) a run's lines from
// computePayrollLines(). A Closed run is frozen - re-POSTing that month is
// rejected, matching P&L's own closed-month guard; see [code].js's PATCH
// for actually closing one (syncs to opex_entries).
import { getSupabase, getBrandId, jsonResponse, errorResponse } from "./_lib/supabase.js";
import { nextCode } from "./_lib/codes.js";
import { computePayrollLines } from "./_lib/payroll.js";

export async function onRequestGet({ env }) {
  try {
    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    const { data, error } = await supabase
      .from("payroll_runs")
      .select("run_code, period_month, status, generated_at, closed_at")
      .eq("brand_id", brandId)
      .order("period_month", { ascending: false });
    if (error) throw error;

    return jsonResponse(data.map((r) => ({
      runCode: r.run_code,
      month: r.period_month.slice(0, 7),
      status: r.status,
      generatedAt: r.generated_at,
      closedAt: r.closed_at
    })));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const month = body.month; // "YYYY-MM"
    if (!month || !/^\d{4}-\d{2}$/.test(month)) return jsonResponse({ error: "Invalid month" }, 400);

    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);
    const periodMonth = month + "-01";

    const { data: existing, error: existErr } = await supabase
      .from("payroll_runs")
      .select("id, run_code, status")
      .eq("brand_id", brandId)
      .eq("period_month", periodMonth)
      .maybeSingle();
    if (existErr) throw existErr;
    if (existing && existing.status === "Closed") {
      return jsonResponse({ error: "This month's payroll is already closed (" + existing.run_code + ") - can't regenerate a closed run." }, 400);
    }

    const lines = await computePayrollLines(supabase, brandId, month);

    let runId, runCode;
    if (existing) {
      runId = existing.id;
      runCode = existing.run_code;
      const { error: delErr } = await supabase.from("payroll_lines").delete().eq("payroll_run_id", runId);
      if (delErr) throw delErr;
    } else {
      runCode = await nextCode(supabase, "payroll_runs", "run_code", brandId, "PAY", 4);
      const { data: inserted, error: insErr } = await supabase
        .from("payroll_runs")
        .insert({ brand_id: brandId, run_code: runCode, period_month: periodMonth })
        .select("id")
        .single();
      if (insErr) throw insErr;
      runId = inserted.id;
    }

    if (lines.length) {
      const { error: linesErr } = await supabase.from("payroll_lines").insert(lines.map((l) => ({
        brand_id: brandId,
        payroll_run_id: runId,
        staff_id: l.staffId,
        employment_type: l.employmentType,
        base_pay: l.basePay,
        worked_days: l.workedDays,
        absent_days: l.absentDays,
        deduction: l.deduction,
        bonus: 0,
        gross_pay: l.basePay
      })));
      if (linesErr) throw linesErr;
    }

    return jsonResponse({ runCode: runCode }, existing ? 200 : 201);
  } catch (err) {
    return errorResponse(err);
  }
}
