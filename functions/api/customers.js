// GET/POST for Database > Customer (full list + create). POST also still
// serves the Orders form's inline "New Customer" quick-add (only sends
// name/contact/area - address/notes just come back null for that path).
import { getSupabase, getBrandId, jsonResponse, errorResponse } from "./_lib/supabase.js";
import { nextCode } from "./_lib/codes.js";

export async function onRequestGet({ env }) {
  try {
    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    const { data, error } = await supabase
      .from("customers")
      .select("id, customer_code, name, contact, area, address, notes, is_active")
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
    if (!name) return jsonResponse({ error: "Customer name is required" }, 400);

    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);
    const customerCode = await nextCode(supabase, "customers", "customer_code", brandId, "CUST", 4);

    const { data, error } = await supabase
      .from("customers")
      .insert({
        brand_id: brandId,
        customer_code: customerCode,
        name,
        contact: body.contact || null,
        area: body.area || null,
        address: body.address || null,
        notes: body.notes || null
      })
      .select("id, customer_code, name, contact, area, address, notes, is_active")
      .single();
    if (error) throw error;

    return jsonResponse(data, 201);
  } catch (err) {
    return errorResponse(err);
  }
}
