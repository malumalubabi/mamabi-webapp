// HR > Attendance - dates the outlet itself is closed (holidays, planned
// off-days). Doesn't count against any staff's attendance, and blocks
// creating a staff_shifts row on that date (see staff-shifts.js's POST).
import { getSupabase, getBrandId, jsonResponse, errorResponse } from "./_lib/supabase.js";
import { nextCode } from "./_lib/codes.js";

export async function onRequestGet({ env }) {
  try {
    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    const { data, error } = await supabase
      .from("outlet_closures")
      .select("closure_code, closure_date, reason")
      .eq("brand_id", brandId)
      .order("closure_date", { ascending: false });
    if (error) throw error;

    return jsonResponse(data.map((r) => ({ closureCode: r.closure_code, date: r.closure_date, reason: r.reason })));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    if (!body.date) return jsonResponse({ error: "Date is required" }, 400);

    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    const { data: existing, error: existingErr } = await supabase
      .from("outlet_closures")
      .select("closure_code")
      .eq("brand_id", brandId)
      .eq("closure_date", body.date)
      .maybeSingle();
    if (existingErr) throw existingErr;
    if (existing) return jsonResponse({ error: "This date is already marked as a closure (" + existing.closure_code + ")." }, 400);

    const closureCode = await nextCode(supabase, "outlet_closures", "closure_code", brandId, "CLS", 4);

    const { data, error } = await supabase
      .from("outlet_closures")
      .insert({
        brand_id: brandId,
        closure_code: closureCode,
        closure_date: body.date,
        reason: (body.reason || "").trim() || null
      })
      .select("closure_code")
      .single();
    if (error) throw error;

    return jsonResponse({ closureCode: data.closure_code }, 201);
  } catch (err) {
    return errorResponse(err);
  }
}
