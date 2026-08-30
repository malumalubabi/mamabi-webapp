// Three things patch a batch here: marking it Done from the Ongoing Batches
// list (ported concept from MenuBatchProduction_JS.html's markBatchDone() -
// matters beyond just the label, since stock_ledger's "Production Yield"
// movement only counts a batch's yield once status = 'Done'), editing its
// batch size from the Open Recipe modal (ported concept from
// MenuBatchProduction_JS.html's updateBatchScaledQty()) - which also scales
// every already-saved Consumption row by the same ratio the size just
// changed by, so editing 2x -> 3x actually multiplies what's on hand to be
// deducted instead of leaving Consumption stuck at the old size - and
// Change Component (ported concept from updateBatchComponent()), which
// re-points the batch at a different SKU - any Component or Semi-Finished
// item, not restricted to the batch's current item_type, per explicit
// request that this be free to swap across both kinds - and fully
// regenerates Consumption from THAT SKU's own recipe (not a rescale - the
// old Consumption belonged to an entirely different recipe, keeping it
// would be nonsensical).
import { getSupabase, getBrandId, jsonResponse, errorResponse } from "../_lib/supabase.js";
import { buildCostResolver } from "../_lib/costing.js";

const PATCHABLE_FIELDS = {
  status: "status",
  batchSize: "batch_size",
  outputSkuId: "output_sku_id"
};

// Same pair as pages/menu.js's BATCH_OUTPUT_TYPES (Start New Batch's own
// output picker) - a batch only ever produces one of these two kinds, so
// Change Component can't be pointed at a raw/purchased item_type.
const BATCH_COMPONENT_OUTPUT_TYPES = ["Semi-Finished", "Component"];

export async function onRequestPatch({ request, env, params }) {
  try {
    const body = await request.json();

    const update = {};
    for (const key of Object.keys(PATCHABLE_FIELDS)) {
      if (body[key] !== undefined) update[PATCHABLE_FIELDS[key]] = body[key];
    }
    if (!Object.keys(update).length) return jsonResponse({ error: "No updatable fields provided" }, 400);

    // Batch codes are "#0001"-style - the # doesn't survive as a literal
    // path segment, so the client percent-encodes it; Pages Functions
    // does not auto-decode params, so it has to happen here.
    const code = decodeURIComponent(params.code);

    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    // Need the pre-update batch_size before applying the update, to compute
    // the rescale ratio below.
    const { data: current, error: curErr } = await supabase
      .from("production_batches")
      .select("id, batch_size, batch_date, output_sku_id")
      .eq("brand_id", brandId)
      .eq("batch_code", code)
      .maybeSingle();
    if (curErr) throw curErr;
    if (!current) return jsonResponse({ error: "Batch not found: " + code }, 404);

    let newSku = null;
    if (body.outputSkuId !== undefined) {
      const { data: skuRow, error: skuErr } = await supabase
        .from("sku_items")
        .select("id, sku, name, category, item_type")
        .eq("brand_id", brandId)
        .eq("id", body.outputSkuId)
        .maybeSingle();
      if (skuErr) throw skuErr;
      if (!skuRow) return jsonResponse({ error: "SKU not found: " + body.outputSkuId }, 404);

      // No longer restricted to the batch's current item_type - Change
      // Component can freely swap between Component and Semi-Finished (the
      // same pair Start New Batch's own output picker allows), per explicit
      // request that this not be locked to "same category". Still can't be
      // pointed at a raw/purchased type (Ingredient/Packaging/...) though -
      // a batch always produces one of these two kinds, nothing else has a
      // recipe to regenerate Consumption from below.
      if (BATCH_COMPONENT_OUTPUT_TYPES.indexOf(skuRow.item_type) === -1) {
        return jsonResponse({ error: "Change Component must pick a Component or Semi-Finished item - " + skuRow.name + " is a " + skuRow.item_type + "." }, 400);
      }
      newSku = skuRow;
      update.category = newSku.category; // denormalized on production_batches, keep it in sync with the new output SKU
    }

    const { data, error } = await supabase
      .from("production_batches")
      .update(update)
      .eq("brand_id", brandId)
      .eq("batch_code", code)
      .select("batch_code")
      .maybeSingle();
    if (error) throw error;
    if (!data) return jsonResponse({ error: "Batch not found: " + code }, 404);

    // Scale every already-saved Consumption row by the same ratio Batch
    // Size just changed by - preserves any manual per-line tweak (rather
    // than regenerating from the recipe from scratch, which would silently
    // discard it) while keeping Consumption proportionally in sync with
    // the new size. Skipped if there's no old size to compute a ratio from
    // (never set) or the size didn't actually change. Skipped entirely if
    // Change Component also ran below (that fully regenerates Consumption
    // instead, off the new recipe - rescaling first would be wasted work).
    if (body.batchSize !== undefined && !newSku) {
      const oldSize = Number(current.batch_size);
      const newSize = Number(body.batchSize);
      if (oldSize > 0 && newSize > 0 && oldSize !== newSize) {
        const ratio = newSize / oldSize;
        const { data: rows, error: rowsErr } = await supabase
          .from("production_consumption")
          .select("id, qty")
          .eq("batch_id", current.id);
        if (rowsErr) throw rowsErr;

        const results = await Promise.all(rows.map((r) =>
          supabase.from("production_consumption").update({ qty: Math.round(Number(r.qty) * ratio * 100) / 100 }).eq("id", r.id)
        ));
        const failed = results.find((r) => r.error);
        if (failed) throw failed.error;
      }
    }

    // Change Component: fully regenerate Consumption from the NEW SKU's own
    // recipe (every recipe_lines entry, whatever its own item_type - this
    // IS Batch Production, the one place a produced item's own raw-
    // ingredient consumption belongs; Sales/Orders' saleConsumptionItems
    // deducts a completely different, one-level-up set of lines, so there's
    // no overlap to double-count here either way). Scaled by whatever Batch
    // Size ends up in effect
    // (the new one if also being changed in this same request, otherwise
    // the batch's existing size).
    if (newSku) {
      const effectiveBatchSize = body.batchSize !== undefined ? Number(body.batchSize) : Number(current.batch_size) || 1;

      const { error: delErr } = await supabase.from("production_consumption").delete().eq("batch_id", current.id);
      if (delErr) throw delErr;

      const resolver = await buildCostResolver(supabase, brandId);
      const { items: recipeItems } = resolver.getBreakdown(newSku.id);
      if (recipeItems.length) {
        const rows = recipeItems.map((it) => ({
          batch_id: current.id,
          ref_code: data.batch_code,
          consumption_date: String(current.batch_date).slice(0, 10),
          sku_id: it.componentSkuId,
          qty: Math.round(it.qty * effectiveBatchSize * 100) / 100,
          source: "Batch Production"
        }));
        const { error: insErr } = await supabase.from("production_consumption").insert(rows);
        if (insErr) throw insErr;
      }
    }

    return jsonResponse({ batchCode: data.batch_code });
  } catch (err) {
    return errorResponse(err);
  }
}
