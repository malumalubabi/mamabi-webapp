// Sales - manual entries (GrabFood/GoFood/ShopeeFood/Walk-in/Dine In) plus
// "Online" rows derived live from Orders, merged into one log/summary
// source. Ported from the old app's SalesService.gs (getSalesLog/saveSales):
// one Input Sales submission (Date+Platform+Platform Fee+Marketing Fee,
// shared) becomes one sales_batches row, with N sales_entries rows (one per
// product, each with its own sales_code) underneath. Platform Fee/Marketing
// Fee link 1:1 to the BATCH's own OpEx entry (see [code].js under
// sales-batches/ for editing/deleting a whole batch; sales/[code].js edits
// or deletes one product line within a batch). POST also doubles as "add
// product(s) to an existing batch" when body.batchCode is set - used by the
// Edit Batch modal's "+ Add Product", which saves batch-level fields via
// sales-batches/[code].js PATCH first.
import { getSupabase, getBrandId, jsonResponse, errorResponse } from "./_lib/supabase.js";
import { nextCode } from "./_lib/codes.js";
import { buildCostResolver } from "./_lib/costing.js";
import { getOnlineSalesRows, getManualSalesRows, saleConsumptionItems, productCostPerUnit, syncFeeOpex } from "./_lib/sales.js";

export async function onRequestGet({ env }) {
  try {
    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    const [manualRows, onlineRows] = await Promise.all([
      getManualSalesRows(supabase, brandId),
      getOnlineSalesRows(supabase, brandId)
    ]);

    const rows = manualRows.concat(onlineRows).sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return b.refId.localeCompare(a.refId);
    });

    return jsonResponse(rows);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    if (!body.date) return jsonResponse({ error: "Date is required" }, 400);
    if (!body.platform) return jsonResponse({ error: "Platform is required" }, 400);
    if (!Array.isArray(body.items) || !body.items.length) return jsonResponse({ error: "At least one product is required" }, 400);

    for (let i = 0; i < body.items.length; i++) {
      const it = body.items[i];
      if (!it.skuId) return jsonResponse({ error: "Missing product for row " + (i + 1) }, 400);
      if (!it.qty || Number(it.qty) <= 0) return jsonResponse({ error: "Qty must be greater than 0 for row " + (i + 1) }, 400);
      if (!it.sellingPrice || Number(it.sellingPrice) <= 0) return jsonResponse({ error: "Selling price must be greater than 0 for row " + (i + 1) }, 400);
    }

    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);
    const resolver = await buildCostResolver(supabase, brandId);

    let batch;
    let batchCode;

    if (body.batchCode) {
      // Appending product(s) to a batch that already exists (the Edit Batch
      // modal's "+ Add Product") - date/platform/fees were already saved via
      // sales-batches/[code].js PATCH before this call, so skip re-creating
      // the batch row and re-syncing OpEx here.
      const { data: existing, error: findErr } = await supabase
        .from("sales_batches")
        .select("id")
        .eq("brand_id", brandId)
        .eq("batch_code", body.batchCode)
        .maybeSingle();
      if (findErr) throw findErr;
      if (!existing) return jsonResponse({ error: "Sales batch not found: " + body.batchCode }, 404);
      batch = existing;
      batchCode = body.batchCode;
    } else {
      batchCode = await nextCode(supabase, "sales_batches", "batch_code", brandId, "SLB", 4);
      const platformFee = Number(body.platformFee) || 0;
      const marketingFee = Number(body.marketingFee) || 0;

      const { data: inserted, error: batchErr } = await supabase
        .from("sales_batches")
        .insert({
          brand_id: brandId,
          batch_code: batchCode,
          sale_date: body.date,
          platform: body.platform,
          platform_fee: platformFee || null,
          marketing_fee: marketingFee || null,
          notes: body.notes || null
        })
        .select("id")
        .single();
      if (batchErr) throw batchErr;
      batch = inserted;

      const description = body.platform + ", " + batchCode;
      const opexUpdates = {
        platform_fee_opex_code: await syncFeeOpex(supabase, brandId, null, platformFee, body.date, "Platform Fee", description),
        marketing_fee_opex_code: await syncFeeOpex(supabase, brandId, null, marketingFee, body.date, "Marketing", description)
      };
      if (opexUpdates.platform_fee_opex_code || opexUpdates.marketing_fee_opex_code) {
        const { error } = await supabase.from("sales_batches").update(opexUpdates).eq("id", batch.id);
        if (error) throw error;
      }
    }

    // sales_code assigned per product line (matching the old app's
    // saveSales(), which increments one Sales ID per item even within a
    // single multi-product submission) - computed locally from one nextCode
    // call instead of N round-trips (nextCode only reads the current max,
    // calling it repeatedly without inserting in between would return the
    // same code every time).
    const firstCode = await nextCode(supabase, "sales_entries", "sales_code", brandId, "SAL", 4);
    const startN = parseInt(firstCode.split("-")[1], 10);

    const entryRows = [];
    const consumptionRows = [];
    body.items.forEach((it, i) => {
      const qty = Number(it.qty);
      const sellingPrice = Number(it.sellingPrice);
      const salesCode = "SAL-" + String(startN + i).padStart(4, "0");
      const { foodCostPerUnit, packagingCostPerUnit } = productCostPerUnit(resolver, it.skuId);

      entryRows.push({
        brand_id: brandId,
        sales_code: salesCode,
        batch_id: batch.id,
        sale_date: body.date,
        platform: body.platform,
        sku_id: it.skuId,
        qty: qty,
        selling_price: sellingPrice,
        food_cost_snapshot: foodCostPerUnit * qty,
        packaging_cost_snapshot: packagingCostPerUnit * qty,
        notes: body.notes || null
      });

      saleConsumptionItems(resolver, it.skuId, qty).forEach((c) => {
        consumptionRows.push({ sku_id: c.skuId, qty: c.qty, source: "Sales", ref_code: salesCode, consumption_date: body.date });
      });
    });

    const { error: entriesErr } = await supabase.from("sales_entries").insert(entryRows);
    if (entriesErr) throw entriesErr;

    if (consumptionRows.length) {
      const { error: consErr } = await supabase.from("production_consumption").insert(consumptionRows);
      if (consErr) throw consErr;
    }

    return jsonResponse({ batchCode: batchCode }, 201);
  } catch (err) {
    return errorResponse(err);
  }
}
