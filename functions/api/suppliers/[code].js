// Edit/Delete one Supplier. Delete is guarded (blocked with a friendly
// message) if any Purchase or Cost History row still references it - real
// FK (purchases.supplier_id / sku_cost_history.supplier_id both ON DELETE
// NO ACTION), unlike the old app where Supplier was just a denormalized
// text label on transactions. Deactivate (is_active) is the way out when
// blocked, same idea as sku_items.status.
import { getSupabase, getBrandId, jsonResponse, errorResponse } from "../_lib/supabase.js";

async function findSupplierUsage(supabase, supplierId) {
  const [purchases, costHistory] = await Promise.all([
    supabase.from("purchases").select("id", { count: "exact", head: true }).eq("supplier_id", supplierId),
    supabase.from("sku_cost_history").select("id", { count: "exact", head: true }).eq("supplier_id", supplierId)
  ]);
  if (purchases.error) throw purchases.error;
  if (costHistory.error) throw costHistory.error;

  const usage = [];
  if (purchases.count) usage.push("Purchases (" + purchases.count + ")");
  if (costHistory.count) usage.push("Cost Update Log (" + costHistory.count + ")");
  return usage;
}

export async function onRequestPatch({ request, env, params }) {
  try {
    const body = await request.json();
    const supplierCode = decodeURIComponent(params.code);
    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    const update = {};
    if (body.name !== undefined) {
      const name = (body.name || "").trim();
      if (!name) return jsonResponse({ error: "Supplier name is required" }, 400);
      update.name = name;
    }
    if (body.contact !== undefined) update.contact = body.contact || null;
    if (body.area !== undefined) update.area = body.area || null;
    if (body.address !== undefined) update.address = body.address || null;
    if (body.notes !== undefined) update.notes = body.notes || null;
    if (body.isActive !== undefined) update.is_active = !!body.isActive;

    const { data, error } = await supabase
      .from("suppliers")
      .update(update)
      .eq("brand_id", brandId)
      .eq("supplier_code", supplierCode)
      .select("id, supplier_code, name, contact, area, address, notes, is_active")
      .maybeSingle();
    if (error) throw error;
    if (!data) return jsonResponse({ error: "Supplier not found: " + supplierCode }, 404);

    return jsonResponse(data);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function onRequestDelete({ env, params }) {
  try {
    const supplierCode = decodeURIComponent(params.code);
    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    const { data: existing, error: findErr } = await supabase
      .from("suppliers")
      .select("id")
      .eq("brand_id", brandId)
      .eq("supplier_code", supplierCode)
      .maybeSingle();
    if (findErr) throw findErr;
    if (!existing) return jsonResponse({ error: "Supplier not found: " + supplierCode }, 404);

    const usage = await findSupplierUsage(supabase, existing.id);
    if (usage.length) {
      return jsonResponse({ error: "Can't delete - still referenced in: " + usage.join(", ") + ". Deactivate it instead." }, 400);
    }

    const { error: delErr } = await supabase.from("suppliers").delete().eq("id", existing.id);
    if (delErr) throw delErr;

    return jsonResponse({ supplierCode: supplierCode });
  } catch (err) {
    return errorResponse(err);
  }
}
