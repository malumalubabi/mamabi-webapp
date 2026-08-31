import { getSupabase, getBrandId, jsonResponse, errorResponse } from "../_lib/supabase.js";

export async function onRequestPatch({ request, env, params }) {
  try {
    const code = decodeURIComponent(params.code);
    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    const body = await request.json();

    // Role isn't just any string - it has to stay one the staff on this
    // shift actually has, same guard as the create path.
    let staffId = body.staffId;
    if (body.role !== undefined) {
      if (!staffId) {
        const { data: shiftRow, error: shiftErr } = await supabase
          .from("staff_shifts")
          .select("staff_id")
          .eq("brand_id", brandId)
          .eq("shift_code", code)
          .maybeSingle();
        if (shiftErr) throw shiftErr;
        if (!shiftRow) return jsonResponse({ error: "Shift not found: " + code }, 404);
        staffId = shiftRow.staff_id;
      }
      const { data: staffRow, error: staffErr } = await supabase.from("staff").select("roles").eq("id", staffId).maybeSingle();
      if (staffErr) throw staffErr;
      if (!staffRow || !Array.isArray(staffRow.roles) || staffRow.roles.indexOf(body.role) === -1) {
        return jsonResponse({ error: "This staff doesn't have the \"" + body.role + "\" role - add it in Database > Staff first." }, 400);
      }
    }

    const update = {};
    if (body.date !== undefined) update.shift_date = body.date;
    if (body.role !== undefined) update.role = body.role;
    if (body.status !== undefined) {
      if (["Scheduled", "Absent", "Leave", "Sick", "Cancelled"].indexOf(body.status) === -1) return jsonResponse({ error: "Invalid status" }, 400);
      update.status = body.status;
    }
    if (body.notes !== undefined) update.notes = (body.notes || "").trim() || null;
    if (!Object.keys(update).length) return jsonResponse({ error: "No updatable fields provided" }, 400);

    const { data, error } = await supabase
      .from("staff_shifts")
      .update(update)
      .eq("brand_id", brandId)
      .eq("shift_code", code)
      .select("shift_code")
      .maybeSingle();
    if (error) throw error;
    if (!data) return jsonResponse({ error: "Shift not found: " + code }, 404);

    return jsonResponse({ shiftCode: data.shift_code });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function onRequestDelete({ env, params }) {
  try {
    const code = decodeURIComponent(params.code);
    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    const { data, error } = await supabase
      .from("staff_shifts")
      .delete()
      .eq("brand_id", brandId)
      .eq("shift_code", code)
      .select("shift_code")
      .maybeSingle();
    if (error) throw error;
    if (!data) return jsonResponse({ error: "Shift not found: " + code }, 404);

    return jsonResponse({ shiftCode: data.shift_code });
  } catch (err) {
    return errorResponse(err);
  }
}
