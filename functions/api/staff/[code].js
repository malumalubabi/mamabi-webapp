// Edit/Delete one Staff. Delete is guarded - orders.driver_staff_id is a
// real FK (ON DELETE NO ACTION), unlike the old app where Driver Payout
// history just kept the staff name as denormalized text. Deactivate
// (is_active) is the way out when blocked - already wired into lookups.js's
// active-only staff select for other modules' dropdowns.
import { getSupabase, getBrandId, jsonResponse, errorResponse } from "../_lib/supabase.js";

export async function onRequestPatch({ request, env, params }) {
  try {
    const body = await request.json();
    const staffCode = decodeURIComponent(params.code);
    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    const update = {};
    if (body.name !== undefined) {
      const name = (body.name || "").trim();
      if (!name) return jsonResponse({ error: "Staff name is required" }, 400);
      update.name = name;
    }
    if (body.roles !== undefined) update.roles = Array.isArray(body.roles) ? body.roles : [];
    if (body.contact !== undefined) update.contact = body.contact || null;
    if (body.isActive !== undefined) update.is_active = !!body.isActive;
    if (body.employmentType !== undefined) update.employment_type = body.employmentType === "Daily" ? "Daily" : "Monthly";
    if (body.baseRate !== undefined) update.base_rate = Number(body.baseRate) || 0;
    if (body.joinDate !== undefined) update.join_date = body.joinDate || null;

    const { data, error } = await supabase
      .from("staff")
      .update(update)
      .eq("brand_id", brandId)
      .eq("staff_code", staffCode)
      .select("id, staff_code, name, roles, contact, is_active, employment_type, base_rate, join_date")
      .maybeSingle();
    if (error) throw error;
    if (!data) return jsonResponse({ error: "Staff not found: " + staffCode }, 404);

    return jsonResponse(data);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function onRequestDelete({ env, params }) {
  try {
    const staffCode = decodeURIComponent(params.code);
    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    const { data: existing, error: findErr } = await supabase
      .from("staff")
      .select("id")
      .eq("brand_id", brandId)
      .eq("staff_code", staffCode)
      .maybeSingle();
    if (findErr) throw findErr;
    if (!existing) return jsonResponse({ error: "Staff not found: " + staffCode }, 404);

    const { count, error: usageErr } = await supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("driver_staff_id", existing.id);
    if (usageErr) throw usageErr;
    if (count) {
      return jsonResponse({ error: "Can't delete - still referenced in: Driver Payout / Orders (" + count + "). Deactivate it instead." }, 400);
    }

    const { error: delErr } = await supabase.from("staff").delete().eq("id", existing.id);
    if (delErr) throw delErr;

    return jsonResponse({ staffCode: staffCode });
  } catch (err) {
    return errorResponse(err);
  }
}
