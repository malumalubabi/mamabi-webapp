// HR > Attendance - explicit per-date roster, replaces the old weekly
// scheduled_days pattern + attendance_exceptions log (schedules here change
// ad-hoc too often for a repeating pattern to stay accurate). One row =
// "this staff is assigned this role on this date." status defaults to
// "Scheduled" (counts as worked for Payroll); flip it to Absent/Leave/Sick/
// Cancelled if it didn't actually happen. Also the single source both the
// Calendar view ("who's needed today") and Payroll (Phase 2, rate looked up
// per role from Settings > Staff Roles) read from.
import { getSupabase, getBrandId, jsonResponse, errorResponse } from "./_lib/supabase.js";
import { nextCode } from "./_lib/codes.js";

export async function onRequestGet({ env }) {
  try {
    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    const { data, error } = await supabase
      .from("staff_shifts")
      .select("shift_code, shift_date, role, status, notes, staff_id, staff(name)")
      .eq("brand_id", brandId)
      .order("shift_date", { ascending: false });
    if (error) throw error;

    return jsonResponse(data.map((r) => ({
      shiftCode: r.shift_code,
      date: r.shift_date,
      role: r.role,
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
    if (!body.role) return jsonResponse({ error: "Role is required" }, 400);
    const status = body.status || "Scheduled";
    if (["Scheduled", "Absent", "Leave", "Sick", "Cancelled"].indexOf(status) === -1) return jsonResponse({ error: "Invalid status" }, 400);

    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    const { data: staffRow, error: staffErr } = await supabase
      .from("staff")
      .select("roles")
      .eq("brand_id", brandId)
      .eq("id", body.staffId)
      .maybeSingle();
    if (staffErr) throw staffErr;
    if (!staffRow) return jsonResponse({ error: "Staff not found" }, 404);
    if (!Array.isArray(staffRow.roles) || staffRow.roles.indexOf(body.role) === -1) {
      return jsonResponse({ error: "This staff doesn't have the \"" + body.role + "\" role - add it in Database > Staff first." }, 400);
    }

    const { data: closure, error: closureErr } = await supabase
      .from("outlet_closures")
      .select("closure_code, reason")
      .eq("brand_id", brandId)
      .eq("closure_date", body.date)
      .maybeSingle();
    if (closureErr) throw closureErr;
    if (closure) {
      return jsonResponse({ error: "Outlet is closed on this date (" + closure.closure_code + (closure.reason ? " - " + closure.reason : "") + ") - remove the closure first if this shift is intentional." }, 400);
    }

    const { data: existing, error: existingErr } = await supabase
      .from("staff_shifts")
      .select("shift_code")
      .eq("brand_id", brandId)
      .eq("staff_id", body.staffId)
      .eq("shift_date", body.date)
      .maybeSingle();
    if (existingErr) throw existingErr;
    if (existing) return jsonResponse({ error: "This staff already has a shift on this date (" + existing.shift_code + ") - edit it instead." }, 400);

    const shiftCode = await nextCode(supabase, "staff_shifts", "shift_code", brandId, "SFT", 4);

    const { data, error } = await supabase
      .from("staff_shifts")
      .insert({
        brand_id: brandId,
        shift_code: shiftCode,
        staff_id: body.staffId,
        shift_date: body.date,
        role: body.role,
        status: status,
        notes: (body.notes || "").trim() || null
      })
      .select("shift_code")
      .single();
    if (error) throw error;

    return jsonResponse({ shiftCode: data.shift_code }, 201);
  } catch (err) {
    return errorResponse(err);
  }
}
