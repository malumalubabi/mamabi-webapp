// Ported from InventoryService.gs savePurchase() + renderPurchaseTable() /
// StockInTable.html's grouped-by-Purchase-ID layout. unit_cost is a
// generated column (total_cost/qty) - never set it directly. Inserting
// purchase_lines fires the fn_log_cost_update trigger automatically
// (sku_cost_history), same effect as the old app's "auto SKU/cost update"
// but handled in the DB instead of app code - no separate warnings needed.
import { getSupabase, getBrandId, jsonResponse, errorResponse } from "./_lib/supabase.js";
import { nextCode } from "./_lib/codes.js";

export async function onRequestGet({ env }) {
  try {
    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    const { data, error } = await supabase
      .from("purchases")
      .select(
        "purchase_code, purchase_date, status, method, notes, suppliers(name), " +
        "purchase_lines(category, qty, unit, total_cost, unit_cost, sku_items(sku, name))"
      )
      .eq("brand_id", brandId)
      .order("purchase_code", { ascending: false });
    if (error) throw error;

    // Flattened, one row per line item, tagged with groupStart/groupSize so
    // the client can render it with rowspan exactly like the old
    // StockInTable.html (Purchase ID/Date/Supplier/Status/Method/Notes
    // merged across all lines of the same purchase).
    const rows = [];
    for (const p of data) {
      const lines = p.purchase_lines || [];
      lines.forEach((line, i) => {
        rows.push({
          groupStart: i === 0,
          groupSize: lines.length,
          purchaseCode: p.purchase_code,
          date: p.purchase_date,
          supplier: p.suppliers ? p.suppliers.name : "",
          category: line.category,
          itemName: line.sku_items ? line.sku_items.name : "",
          qty: Number(line.qty),
          unit: line.unit,
          totalCost: Number(line.total_cost),
          unitCost: Number(line.unit_cost),
          status: p.status,
          method: p.method,
          notes: p.notes
        });
      });
    }

    return jsonResponse(rows);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    if (!body.date) return jsonResponse({ error: "Date is required" }, 400);
    if (!Array.isArray(body.items) || !body.items.length) {
      return jsonResponse({ error: "At least one item is required" }, 400);
    }

    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

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

    const purchaseCode = await nextCode(supabase, "purchases", "purchase_code", brandId, "PO", 4);

    const { data: purchase, error: purErr } = await supabase
      .from("purchases")
      .insert({
        brand_id: brandId,
        purchase_code: purchaseCode,
        purchase_date: body.date,
        supplier_id: supplierId,
        method: body.method || null,
        status: body.status || "Paid",
        notes: body.notes || null
      })
      .select("id, purchase_code")
      .single();
    if (purErr) throw purErr;

    const lineRows = body.items.map((it) => ({
      purchase_id: purchase.id,
      sku_id: it.skuId,
      category: it.category || null,
      qty: it.qty,
      unit: it.unit,
      total_cost: it.totalCost
    }));

    const { error: linesErr } = await supabase.from("purchase_lines").insert(lineRows);
    if (linesErr) {
      await supabase.from("purchases").delete().eq("id", purchase.id);
      throw linesErr;
    }

    return jsonResponse({ purchaseCode: purchase.purchase_code }, 201);
  } catch (err) {
    return errorResponse(err);
  }
}
