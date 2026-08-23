// Database > Supplier - full CRUD (purchases.js also has its own inline
// quick-add for "New Supplier" on the Purchase form, left as-is; this is
// the standalone management page).
import { getSupabase, getBrandId, jsonResponse, errorResponse } from "./_lib/supabase.js";
import { nextCode } from "./_lib/codes.js";

export async function onRequestGet({ env }) {
  try {
    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    const { data, error } = await supabase
      .from("suppliers")
      .select("id, supplier_code, name, contact, area, address, notes, is_active")
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
    if (!name) return jsonResponse({ error: "Supplier name is required" }, 400);

    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);
    const supplierCode = await nextCode(supabase, "suppliers", "supplier_code", brandId, "SUP", 4);

    const { data, error } = await supabase
      .from("suppliers")
      .insert({
        brand_id: brandId,
        supplier_code: supplierCode,
        name,
        contact: body.contact || null,
        area: body.area || null,
        address: body.address || null,
        notes: body.notes || null
      })
      .select("id, supplier_code, name, contact, area, address, notes, is_active")
      .single();
    if (error) throw error;

    return jsonResponse(data, 201);
  } catch (err) {
    return errorResponse(err);
  }
}
