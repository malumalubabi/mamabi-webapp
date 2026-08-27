// Ported from InventoryService.gs saveStockOpname() / StockOpnameEntry_JS's
// checklist pattern. book_balance is looked up server-side from
// current_stock (not trusted from the client) so it reflects the true
// system balance at save time, not whatever was on screen when the page
// loaded. variance is a generated column in stock_opname; variance_value
// (cost impact) is best-effort from current_unit_cost - null if the SKU
// has no purchase history yet to price it from.
import { getSupabase, getBrandId, jsonResponse, errorResponse } from "./_lib/supabase.js";
import { nextCode } from "./_lib/codes.js";

export async function onRequestGet({ env }) {
  try {
    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    const { data, error } = await supabase
      .from("stock_opname")
      .select("opname_code, opname_date, book_balance, physical_count, variance, variance_value, notes, sku_items(sku, name)")
      .eq("brand_id", brandId)
      .order("opname_code", { ascending: false });
    if (error) throw error;

    return jsonResponse(
      data.map((o) => ({
        opnameCode: o.opname_code,
        date: o.opname_date,
        sku: o.sku_items ? o.sku_items.sku : "",
        itemName: o.sku_items ? o.sku_items.name : "",
        bookBalance: Number(o.book_balance),
        physicalCount: Number(o.physical_count),
        variance: Number(o.variance),
        varianceValue: o.variance_value === null ? null : Number(o.variance_value),
        notes: o.notes
      }))
    );
  } catch (err) {
    return errorResponse(err);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    if (!body.date) return jsonResponse({ error: "Date is required" }, 400);
    if (!Array.isArray(body.items) || !body.items.length) {
      return jsonResponse({ error: "Check at least one item that's been counted" }, 400);
    }

    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    const skuIds = body.items.map((it) => it.skuId);
    const [stockRes, costRes] = await Promise.all([
      supabase.from("current_stock").select("sku_id, qty_on_hand").in("sku_id", skuIds),
      supabase.from("current_unit_cost").select("sku_id, unit_cost").in("sku_id", skuIds)
    ]);
    if (stockRes.error) throw stockRes.error;
    if (costRes.error) throw costRes.error;

    const stockBySku = new Map(stockRes.data.map((s) => [s.sku_id, Number(s.qty_on_hand)]));
    const costBySku = new Map(costRes.data.map((c) => [c.sku_id, Number(c.unit_cost)]));

    // Each SKU counted in one submission gets its OWN sequential opname_code
    // (SO-0001, SO-0002, ... - one row = one code, matching the old app's
    // saveStockOpname() and stock_opname's UNIQUE(brand_id, opname_code)).
    // nextCode() must be called ONCE up front, not per item inside the loop
    // - it looks up the current max code in the DB, and nothing here gets
    // inserted until the bulk insert below, so calling it per item would
    // hand out the exact same code to every row and blow up that unique
    // constraint on insert. Same starting-number-then-increment pattern as
    // functions/api/cashflow.js's multi-entry POST.
    const startCode = await nextCode(supabase, "stock_opname", "opname_code", brandId, "SO", 4);
    const startNum = parseInt(startCode.match(/-(\d+)$/)[1], 10);

    const rows = body.items.map((it, i) => {
      const bookBalance = stockBySku.has(it.skuId) ? stockBySku.get(it.skuId) : 0;
      const physicalCount = Number(it.physicalCount);
      const variance = physicalCount - bookBalance;
      const unitCost = costBySku.get(it.skuId);

      return {
        brand_id: brandId,
        opname_code: "SO-" + String(startNum + i).padStart(4, "0"),
        opname_date: body.date,
        sku_id: it.skuId,
        book_balance: bookBalance,
        physical_count: physicalCount,
        variance_value: unitCost === undefined ? null : Math.round(variance * unitCost * 100) / 100,
        notes: it.notes || null
      };
    });

    const { error: insErr } = await supabase.from("stock_opname").insert(rows);
    if (insErr) throw insErr;

    return jsonResponse({ count: rows.length }, 201);
  } catch (err) {
    return errorResponse(err);
  }
}
