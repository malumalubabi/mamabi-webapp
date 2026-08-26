// Ported from InventoryService.gs getStockOverview()/renderStockOverviewTable().
// Status thresholds (Habis/Mepet/Aman) match the old app exactly. Unlike the
// old app, currentStock here comes from the stock_ledger view (which now
// folds in Stock Opname corrections - see the stock_ledger_include_opname
// migration) instead of a "baseline since last opname + net moves" JS
// recomputation; same end result, computed differently.
//
// Excludes Product - Products are never purchased or produced as a stocked
// unit (always assembled from Components/Packaging at order/sale time via
// production_consumption), so tracking "stock" for them is structurally
// meaningless; stock_ledger's Sale movement no longer touches them either
// (see the sku_items_registry_order migration's sibling stock_ledger fix).
// Also excludes any SKU marked Unavailable - it's the source both Stock
// Overview and Stock Opname's checklist read from (pages/inventory.js's
// loadOpnameChecklist calls this same endpoint), per explicit request that
// an Unavailable SKU disappear from Inventory Stock entirely, not just get
// greyed out.
// Ordered by registry_order (the "01. SKU Registry" sheet's row order -
// Item Type, then Category - not alphabetical by SKU) so this table reads
// the same way the business's own master list does.
import { getSupabase, getBrandId, jsonResponse, errorResponse } from "../_lib/supabase.js";

export async function onRequestGet({ env }) {
  try {
    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    const { data: items, error: itemsErr } = await supabase
      .from("sku_items")
      .select("id, sku, name, category, unit, min_stock, item_type")
      .eq("brand_id", brandId)
      .neq("item_type", "Product")
      .neq("status", "Unavailable")
      .order("registry_order");
    if (itemsErr) throw itemsErr;

    const ids = items.map((i) => i.id);
    const [stockRes, opnameRes] = await Promise.all([
      supabase.from("current_stock").select("sku_id, qty_on_hand").in("sku_id", ids),
      supabase.from("stock_opname").select("sku_id, opname_date").in("sku_id", ids).order("opname_date", { ascending: false })
    ]);
    if (stockRes.error) throw stockRes.error;
    if (opnameRes.error) throw opnameRes.error;

    const stockBySku = new Map(stockRes.data.map((s) => [s.sku_id, Number(s.qty_on_hand)]));
    const lastOpnameBySku = new Map();
    for (const o of opnameRes.data) {
      if (!lastOpnameBySku.has(o.sku_id)) lastOpnameBySku.set(o.sku_id, o.opname_date);
    }

    const rows = items.map((it) => {
      const currentStock = stockBySku.has(it.id) ? stockBySku.get(it.id) : 0;
      const minStock = it.min_stock === null ? null : Number(it.min_stock);
      let status;
      if (currentStock <= 0) status = "Habis";
      else if (minStock !== null && currentStock <= minStock) status = "Mepet";
      else status = "Aman";

      return {
        id: it.id,
        sku: it.sku,
        name: it.name,
        category: it.category,
        unit: it.unit,
        itemType: it.item_type,
        minStock: minStock,
        currentStock: currentStock,
        lastOpnameDate: lastOpnameBySku.get(it.id) || "",
        status: status
      };
    });

    return jsonResponse(rows);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function onRequestPatch({ request, env }) {
  try {
    const body = await request.json();
    if (!body.sku) return jsonResponse({ error: "sku is required" }, 400);
    if (body.minStock === undefined || body.minStock === null || Number(body.minStock) < 0) {
      return jsonResponse({ error: "Please provide a valid min stock" }, 400);
    }

    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    const { data, error } = await supabase
      .from("sku_items")
      .update({ min_stock: body.minStock })
      .eq("brand_id", brandId)
      .eq("sku", body.sku)
      .select("sku")
      .maybeSingle();
    if (error) throw error;
    if (!data) return jsonResponse({ error: "SKU not found: " + body.sku }, 404);

    return jsonResponse({ sku: data.sku });
  } catch (err) {
    return errorResponse(err);
  }
}
