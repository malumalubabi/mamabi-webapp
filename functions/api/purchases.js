// Ported from InventoryService.gs savePurchase() + renderPurchaseTable() /
// StockInTable.html's grouped-by-Purchase-ID layout. unit_cost is a
// generated column (total_cost/qty) - never set it directly. Inserting
// purchase_lines fires the fn_log_cost_update trigger automatically
// (sku_cost_history), same effect as the old app's "auto SKU/cost update"
// but handled in the DB instead of app code - no separate warnings needed.
//
// Editing/deleting a purchase (see purchases/[code].js's PATCH) is safe -
// as of the 20260820195501_cost_history_delete_update_sync migration,
// purchase_lines also has an AFTER UPDATE trigger
// (fn_sync_cost_history_on_line_update) that keeps its sku_cost_history row
// in sync, sku_cost_history.purchase_line_id ON DELETE CASCADEs, and
// fn_cost_history_self_correct/fn_cost_history_resync_next keep the whole
// previous_unit_cost/variance_pct chain internally consistent afterward.
// current_unit_cost/stock_ledger are plain views (not snapshots), so both
// reflect an edit immediately with no manual recompute needed. (This
// comment used to say Purchase Log was deliberately create-only - that was
// true when written, but the DB grew edit/delete support later and this
// went stale; don't trust an old file comment over the actual schema.)
import { getSupabase, getBrandId, jsonResponse, errorResponse } from "./_lib/supabase.js";
import { nextCode } from "./_lib/codes.js";

export async function onRequestGet({ env }) {
  try {
    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    const { data, error } = await supabase
      .from("purchases")
      .select(
        "purchase_code, purchase_date, status, method, notes, supplier_id, suppliers(name), " +
        "purchase_lines(id, sku_id, category, qty, unit, total_cost, unit_cost, notes, sku_items(sku, name))"
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
          supplierId: p.supplier_id,
          supplier: p.suppliers ? p.suppliers.name : "",
          lineId: line.id,
          skuId: line.sku_id,
          category: line.category,
          itemName: line.sku_items ? line.sku_items.name : "",
          qty: Number(line.qty),
          unit: line.unit,
          totalCost: Number(line.total_cost),
          unitCost: Number(line.unit_cost),
          lineNotes: line.notes,
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
      total_cost: it.totalCost,
      notes: it.notes || null
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
