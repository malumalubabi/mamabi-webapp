// Edit an existing purchase (Purchase Log's Edit button) - see purchases.js's
// file comment for why this is safe: purchase_lines' AFTER UPDATE trigger
// keeps sku_cost_history in sync, ON DELETE CASCADE handles removed lines,
// and the self-correcting/resync-next triggers keep the whole
// previous_unit_cost/variance_pct chain consistent afterward. Same body
// shape as purchases.js's POST, plus each item may carry a lineId: present
// -> update that existing line, absent -> insert it as a new line. Any
// existing line not present in body.items (by id) gets deleted.
import { getSupabase, getBrandId, jsonResponse, errorResponse } from "../_lib/supabase.js";
import { nextCode } from "../_lib/codes.js";

export async function onRequestPatch({ request, env, params }) {
  try {
    const body = await request.json();
    const purchaseCode = decodeURIComponent(params.code);
    if (!body.date) return jsonResponse({ error: "Date is required" }, 400);
    if (!Array.isArray(body.items) || !body.items.length) {
      return jsonResponse({ error: "At least one item is required" }, 400);
    }

    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    const { data: purchase, error: findErr } = await supabase
      .from("purchases")
      .select("id")
      .eq("brand_id", brandId)
      .eq("purchase_code", purchaseCode)
      .maybeSingle();
    if (findErr) throw findErr;
    if (!purchase) return jsonResponse({ error: "Purchase not found: " + purchaseCode }, 404);

    let supplierId = null;
    if (body.isNewSupplier && body.supplierName) {
      const supplierCode = await nextCode(supabase, "suppliers", "supplier_code", brandId, "SUP", 4);
      const { data: sup, error: supErr } = await supabase
        .from("suppliers")
        .insert({ brand_id: brandId, supplier_code: supplierCode, name: body.supplierName.trim() })
        .select("id")
        .single();
      if (supErr) throw supErr;
      supplierId = sup.id;
    } else if (body.supplierId) {
      supplierId = body.supplierId;
    }

    const { error: updErr } = await supabase
      .from("purchases")
      .update({
        purchase_date: body.date,
        supplier_id: supplierId,
        method: body.method || null,
        status: body.status || "Paid",
        notes: body.notes || null
      })
      .eq("id", purchase.id);
    if (updErr) throw updErr;

    const { data: existingLines, error: existErr } = await supabase
      .from("purchase_lines")
      .select("id")
      .eq("purchase_id", purchase.id);
    if (existErr) throw existErr;

    const keptIds = body.items.filter((it) => it.lineId).map((it) => it.lineId);
    const toDelete = existingLines.map((l) => l.id).filter((id) => keptIds.indexOf(id) === -1);

    if (toDelete.length) {
      const { error: delErr } = await supabase.from("purchase_lines").delete().in("id", toDelete);
      if (delErr) throw delErr;
    }

    // Sequential (not Promise.all) - two lines referencing the same SKU
    // firing the resync-next chain concurrently could race each other.
    for (const it of body.items) {
      if (it.lineId) {
        const { error: lineErr } = await supabase
          .from("purchase_lines")
          .update({
            sku_id: it.skuId,
            category: it.category || null,
            qty: it.qty,
            unit: it.unit,
            total_cost: it.totalCost,
            notes: it.notes || null
          })
          .eq("id", it.lineId);
        if (lineErr) throw lineErr;
      } else {
        const { error: lineErr } = await supabase.from("purchase_lines").insert({
          purchase_id: purchase.id,
          sku_id: it.skuId,
          category: it.category || null,
          qty: it.qty,
          unit: it.unit,
          total_cost: it.totalCost,
          notes: it.notes || null
        });
        if (lineErr) throw lineErr;
      }
    }

    return jsonResponse({ purchaseCode: purchaseCode });
  } catch (err) {
    return errorResponse(err);
  }
}
