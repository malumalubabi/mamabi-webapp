// Edit/Delete for ONE product line within a Sales batch (sales_code, e.g.
// SAL-0001) - never touches the batch's Platform Fee/Marketing Fee/OpEx
// (see sales-batches/[code].js for that). Never reachable for "Online" rows
// (those have no sales_code - edit the source Order instead, same
// restriction as the old app). Both handlers keep this line's own stock
// consumption (production_consumption, ref_code = this sales_code) in sync;
// other lines in the same batch are untouched.
import { getSupabase, getBrandId, jsonResponse, errorResponse } from "../_lib/supabase.js";
import { buildCostResolver } from "../_lib/costing.js";
import { saleConsumptionItems, productCostPerUnit } from "../_lib/sales.js";

export async function onRequestPatch({ request, env, params }) {
  try {
    const body = await request.json();
    if (!body.skuId) return jsonResponse({ error: "Product is required" }, 400);

    const qty = Number(body.qty);
    if (!qty || qty <= 0) return jsonResponse({ error: "Qty must be greater than 0" }, 400);
    const sellingPrice = Number(body.sellingPrice);
    if (!sellingPrice || sellingPrice <= 0) return jsonResponse({ error: "Selling price must be greater than 0" }, 400);

    const salesCode = decodeURIComponent(params.code);
    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    const { data: existing, error: findErr } = await supabase
      .from("sales_entries")
      .select("id, sale_date, sales_batches!inner(brand_id)")
      .eq("sales_batches.brand_id", brandId)
      .eq("sales_code", salesCode)
      .maybeSingle();
    if (findErr) throw findErr;
    if (!existing) return jsonResponse({ error: "Sales entry not found: " + salesCode }, 404);

    // Cost re-snapshotted from CURRENT Costing, same as the old app's
    // updateSalesEntry() (which re-pulls live pricing at edit time) -
    // unlike creation, an edit is allowed to refresh the numbers.
    const resolver = await buildCostResolver(supabase, brandId);
    const { foodCostPerUnit, packagingCostPerUnit } = productCostPerUnit(resolver, body.skuId);

    const { error: updateErr } = await supabase
      .from("sales_entries")
      .update({
        sku_id: body.skuId,
        qty: qty,
        selling_price: sellingPrice,
        food_cost_snapshot: foodCostPerUnit * qty,
        packaging_cost_snapshot: packagingCostPerUnit * qty
      })
      .eq("id", existing.id);
    if (updateErr) throw updateErr;

    // This line's consumption is wiped and rewritten fresh - simpler and
    // safer than diffing old vs new SKU/qty. Other lines in the same batch
    // (different ref_code) are untouched.
    const { error: delConsErr } = await supabase
      .from("production_consumption")
      .delete()
      .eq("ref_code", salesCode)
      .eq("source", "Sales");
    if (delConsErr) throw delConsErr;

    const consumptionItems = saleConsumptionItems(resolver, body.skuId, qty);
    if (consumptionItems.length) {
      const rows = consumptionItems.map((it) => ({
        sku_id: it.skuId,
        qty: it.qty,
        source: "Sales",
        ref_code: salesCode,
        consumption_date: existing.sale_date
      }));
      const { error: insConsErr } = await supabase.from("production_consumption").insert(rows);
      if (insConsErr) throw insConsErr;
    }

    return jsonResponse({ salesCode: salesCode });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function onRequestDelete({ env, params }) {
  try {
    const salesCode = decodeURIComponent(params.code);
    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    const { data: existing, error: findErr } = await supabase
      .from("sales_entries")
      .select("id, sales_batches!inner(brand_id)")
      .eq("sales_batches.brand_id", brandId)
      .eq("sales_code", salesCode)
      .maybeSingle();
    if (findErr) throw findErr;
    if (!existing) return jsonResponse({ error: "Sales entry not found: " + salesCode }, 404);

    const { error: delConsErr } = await supabase
      .from("production_consumption")
      .delete()
      .eq("ref_code", salesCode)
      .eq("source", "Sales");
    if (delConsErr) throw delConsErr;

    const { error: delErr } = await supabase.from("sales_entries").delete().eq("id", existing.id);
    if (delErr) throw delErr;

    return jsonResponse({ salesCode: salesCode });
  } catch (err) {
    return errorResponse(err);
  }
}
