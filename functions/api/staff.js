// Database > Staff - full list (including inactive - lookups.js has its own
// active-only select for other modules' dropdowns) + create.
import { getSupabase, getBrandId, jsonResponse, errorResponse } from "./_lib/supabase.js";
import { nextCode } from "./_lib/codes.js";

export async function onRequestGet({ env }) {
  try {
    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    const { data, error } = await supabase
      .from("staff")
      .select("id, staff_code, name, roles, contact, is_active, employment_type, base_rate, join_date, scheduled_days")
      .eq("brand_id", brandId)
      .order("name");
    if (error) throw error;

    return jsonResponse(data);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const name = (body.name || "").trim();
    if (!name) return jsonResponse({ error: "Staff name is required" }, 400);

    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);
    const staffCode = await nextCode(supabase, "staff", "staff_code", brandId, "STF", 4);

    const { data, error } = await supabase
      .from("staff")
      .insert({
        brand_id: brandId,
        staff_code: staffCode,
        name,
        roles: Array.isArray(body.roles) ? body.roles : [],
        contact: body.contact || null,
        employment_type: body.employmentType === "Daily" ? "Daily" : "Monthly",
        base_rate: Number(body.baseRate) || 0,
        join_date: body.joinDate || null,
        scheduled_days: Array.isArray(body.scheduledDays) && body.scheduledDays.length ? body.scheduledDays : [0, 1, 2, 3, 4, 5, 6]
      })
      .select("id, staff_code, name, roles, contact, is_active, employment_type, base_rate, join_date, scheduled_days")
      .single();
    if (error) throw error;

    return jsonResponse(data, 201);
  } catch (err) {
    return errorResponse(err);
  }
}
