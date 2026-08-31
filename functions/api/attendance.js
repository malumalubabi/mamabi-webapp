// HR > Attendance - exception-based log. Only deviations from a normal
// working day get a row here (Absent/Leave/Sick/Holiday) - no row for a
// given staff+date means that staff was present, per staff.scheduled_days.
// Payroll's present-days calc (Phase 2) derives from this plus
// outlet_closures and staff.scheduled_days, never a full daily punch log.
import { getSupabase, getBrandId, jsonResponse, errorResponse } from "./_lib/supabase.js";
import { nextCode } from "./_lib/codes.js";

export async function onRequestGet({ env }) {
  try {
    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    const { data, error } = await supabase
      .from("attendance_exceptions")
      .select("exception_code, exception_date, status, notes, staff_id, staff(name)")
      .eq("brand_id", brandId)
      .order("exception_date", { ascending: false });
    if (error) throw error;

    return jsonResponse(data.map((r) => ({
      exceptionCode: r.exception_code,
      date: r.exception_date,
      status: r.status,
      notes: r.notes,
      staffId: r.staff_id,
      staffName: r.staff ? r.staff.name : null
    })));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    if (!body.staffId) return jsonResponse({ error: "Staff is required" }, 400);
    if (!body.date) return jsonResponse({ error: "Date is required" }, 400);
    if (["Absent", "Leave", "Sick", "Holiday"].indexOf(body.status) === -1) return jsonResponse({ error: "Invalid status" }, 400);

    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    const { data: existing, error: existingErr } = await supabase
      .from("attendance_exceptions")
      .select("exception_code")
      .eq("brand_id", brandId)
      .eq("staff_id", body.staffId)
      .eq("exception_date", body.date)
      .maybeSingle();
    if (existingErr) throw existingErr;
    if (existing) return jsonResponse({ error: "This staff already has an exception on this date (" + existing.exception_code + ") - edit it instead." }, 400);

    const exceptionCode = await nextCode(supabase, "attendance_exceptions", "exception_code", brandId, "ATN", 4);

    const { data, error } = await supabase
      .from("attendance_exceptions")
      .insert({
        brand_id: brandId,
        exception_code: exceptionCode,
        staff_id: body.staffId,
        exception_date: body.date,
        status: body.status,
        notes: (body.notes || "").trim() || null
      })
      .select("exception_code")
      .single();
    if (error) throw error;

    return jsonResponse({ exceptionCode: data.exception_code }, 201);
  } catch (err) {
    return errorResponse(err);
  }
}
