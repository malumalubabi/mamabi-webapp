// Simplified stand-in for the old app's recipe/BOM-driven Batch Production
// (MenuService.gs startBatch/markBatchDone, scaled off recipe_lines). Our
// recipe_lines is deliberately empty for now, so there's no BOM to scale -
// this is direct manual entry instead: pick the output SKU, batch size,
// yield, and manually list what was consumed, matching how the historical
// data was migrated. Auto-consume-from-recipe can replace this once
// recipe_lines is populated.
import { getSupabase, getBrandId, jsonResponse, errorResponse } from "./_lib/supabase.js";

async function nextBatchCode(supabase, brandId) {
  const { data, error } = await supabase
    .from("production_batches")
    .select("batch_code")
    .eq("brand_id", brandId)
    .like("batch_code", "#%")
    .order("batch_code", { ascending: false })
    .limit(1);
  if (error) throw error;

  let n = 0;
  if (data.length) {
    const m = data[0].batch_code.match(/^#(\d+)$/);
    if (m) n = parseInt(m[1], 10);
  }
  return "#" + String(n + 1).padStart(4, "0");
}

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const scope = url.searchParams.get("scope"); // "ongoing" | "history" | null (everything)

    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    let query = supabase
      .from("production_batches")
      .select(
        "batch_code, batch_date, category, batch_size, yield_qty, status, notes, sku_items(sku, name), " +
        "production_consumption(qty, sku_items(sku, name))"
      )
      .eq("brand_id", brandId);

    // "Ongoing Batches" and "Batch History" are a clean split on status -
    // every batch is Ongoing, Done, or Cancelled (Cancel Batch), so scoping
    // here (rather than filtering client-side, which previously let History
    // show everything including still-Ongoing batches) guarantees no overlap.
    if (scope === "ongoing") query = query.eq("status", "Ongoing");
    else if (scope === "history") query = query.in("status", ["Done", "Cancelled"]);

    const { data, error } = await query.order("batch_code", { ascending: false });
    if (error) throw error;

    return jsonResponse(
      data.map((b) => ({
        batchCode: b.batch_code,
        // batch_date is timestamptz (unlike every other module's plain
        // `date` columns), so PostgREST returns a full ISO instant here -
        // trim to YYYY-MM-DD so it displays the same as everywhere else.
        date: b.batch_date.slice(0, 10),
        sku: b.sku_items ? b.sku_items.sku : "",
        itemName: b.sku_items ? b.sku_items.name : "",
        category: b.category,
        batchSize: b.batch_size === null ? null : Number(b.batch_size),
        yieldQty: b.yield_qty === null ? null : Number(b.yield_qty),
        status: b.status,
        notes: b.notes,
        consumption: (b.production_consumption || []).map((c) => ({
          sku: c.sku_items ? c.sku_items.sku : "",
          name: c.sku_items ? c.sku_items.name : "",
          qty: Number(c.qty)
        }))
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
    if (!body.outputSkuId) return jsonResponse({ error: "Output SKU is required" }, 400);

    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);
    const batchCode = await nextBatchCode(supabase, brandId);

    const { data: batch, error: batchErr } = await supabase
      .from("production_batches")
      .insert({
        brand_id: brandId,
        batch_code: batchCode,
        batch_date: body.date,
        output_sku_id: body.outputSkuId,
        category: body.category || null,
        batch_size: body.batchSize || null,
        yield_qty: body.yieldQty || null,
        status: body.status || "Ongoing",
        notes: body.notes || null
      })
      .select("id, batch_code")
      .single();
    if (batchErr) throw batchErr;

    const items = Array.isArray(body.consumption) ? body.consumption.filter((c) => c.skuId && c.qty) : [];
    if (items.length) {
      const rows = items.map((c) => ({
        batch_id: batch.id,
        ref_code: batch.batch_code,
        consumption_date: body.date,
        sku_id: c.skuId,
        qty: c.qty,
        source: "Batch Production"
      }));
      const { error: consErr } = await supabase.from("production_consumption").insert(rows);
      if (consErr) {
        await supabase.from("production_batches").delete().eq("id", batch.id);
        throw consErr;
      }
    }

    return jsonResponse({ batchCode: batch.batch_code }, 201);
  } catch (err) {
    return errorResponse(err);
  }
}
