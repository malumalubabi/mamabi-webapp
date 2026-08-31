import { getSupabase, getBrandId, jsonResponse, errorResponse } from "../_lib/supabase.js";

export async function onRequestPatch({ request, env, params }) {
  try {
    const code = decodeURIComponent(params.code);
    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    const body = await request.json();
    const update = {};
    if (body.date !== undefined) update.exception_date = body.date;
    if (body.status !== undefined) {
      if (["Absent", "Leave", "Sick", "Holiday"].indexOf(body.status) === -1) return jsonResponse({ error: "Invalid status" }, 400);
      update.status = body.status;
    }
    if (body.notes !== undefined) update.notes = (body.notes || "").trim() || null;
    if (!Object.keys(update).length) return jsonResponse({ error: "No updatable fields provided" }, 400);

    const { data, error } = await supabase
      .from("attendance_exceptions")
      .update(update)
      .eq("brand_id", brandId)
      .eq("exception_code", code)
      .select("exception_code")
      .maybeSingle();
    if (error) throw error;
    if (!data) return jsonResponse({ error: "Exception not found: " + code }, 404);

    return jsonResponse({ exceptionCode: data.exception_code });
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
      .from("attendance_exceptions")
      .delete()
      .eq("brand_id", brandId)
      .eq("exception_code", code)
      .select("exception_code")
      .maybeSingle();
    if (error) throw error;
    if (!data) return jsonResponse({ error: "Exception not found: " + code }, 404);

    return jsonResponse({ exceptionCode: data.exception_code });
  } catch (err) {
    return errorResponse(err);
  }
}
