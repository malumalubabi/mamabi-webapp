// Edit/Delete one Customer. Delete is guarded - orders.customer_id is a real
// FK (ON DELETE NO ACTION), unlike the old app where Customer was just a
// denormalized text label on Order Log. Deactivate (is_active) is the way
// out when blocked.
import { getSupabase, getBrandId, jsonResponse, errorResponse } from "../_lib/supabase.js";

export async function onRequestPatch({ request, env, params }) {
  try {
    const body = await request.json();
    const customerCode = decodeURIComponent(params.code);
    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    const update = {};
    if (body.name !== undefined) {
      const name = (body.name || "").trim();
      if (!name) return jsonResponse({ error: "Customer name is required" }, 400);
      update.name = name;
    }
    if (body.contact !== undefined) update.contact = body.contact || null;
    if (body.area !== undefined) update.area = body.area || null;
    if (body.address !== undefined) update.address = body.address || null;
    if (body.notes !== undefined) update.notes = body.notes || null;
    if (body.isActive !== undefined) update.is_active = !!body.isActive;

    const { data, error } = await supabase
      .from("customers")
      .update(update)
      .eq("brand_id", brandId)
      .eq("customer_code", customerCode)
      .select("id, customer_code, name, contact, area, address, notes, is_active")
      .maybeSingle();
    if (error) throw error;
    if (!data) return jsonResponse({ error: "Customer not found: " + customerCode }, 404);

    return jsonResponse(data);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function onRequestDelete({ env, params }) {
  try {
    const customerCode = decodeURIComponent(params.code);
    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    const { data: existing, error: findErr } = await supabase
      .from("customers")
      .select("id")
      .eq("brand_id", brandId)
      .eq("customer_code", customerCode)
      .maybeSingle();
    if (findErr) throw findErr;
    if (!existing) return jsonResponse({ error: "Customer not found: " + customerCode }, 404);

    const { count, error: usageErr } = await supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("customer_id", existing.id);
    if (usageErr) throw usageErr;
    if (count) {
      return jsonResponse({ error: "Can't delete - still referenced in: Orders (" + count + "). Deactivate it instead." }, 400);
    }

    const { error: delErr } = await supabase.from("customers").delete().eq("id", existing.id);
    if (delErr) throw delErr;

    return jsonResponse({ customerCode: customerCode });
  } catch (err) {
    return errorResponse(err);
  }
}
