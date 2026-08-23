// Edit/Delete one SKU item. SKU code/Item Type/Category are locked after
// creation (same as the old app's updateSkuItem - editing them safely would
// mean regenerating relationships across every table below, out of scope
// for a simple edit) - only Name/Unit/Status. Delete is guarded across
// every table that can hold a real FK to sku_items.id.
import { getSupabase, getBrandId, jsonResponse, errorResponse } from "../_lib/supabase.js";

async function findSkuUsage(supabase, skuId) {
  const checks = [
    { label: "Purchases", table: "purchase_lines", column: "sku_id" },
    { label: "Recipe (as parent)", table: "recipe_lines", column: "parent_sku_id" },
    { label: "Recipe (as component)", table: "recipe_lines", column: "component_sku_id" },
    { label: "Batch Production (output)", table: "production_batches", column: "output_sku_id" },
    { label: "Consumption Log", table: "production_consumption", column: "sku_id" },
    { label: "Cost Update Log", table: "sku_cost_history", column: "sku_id" },
    { label: "Stock Opname", table: "stock_opname", column: "sku_id" },
    { label: "Orders", table: "order_items", column: "sku_id" },
    { label: "Sales", table: "sales_entries", column: "sku_id" }
  ];

  const results = await Promise.all(
    checks.map((c) => supabase.from(c.table).select("id", { count: "exact", head: true }).eq(c.column, skuId))
  );

  const usage = [];
  results.forEach((r, i) => {
    if (r.error) throw r.error;
    if (r.count) usage.push(checks[i].label + " (" + r.count + ")");
  });
  return usage;
}

export async function onRequestPatch({ request, env, params }) {
  try {
    const body = await request.json();
    const sku = decodeURIComponent(params.code);
    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    const update = {};
    if (body.name !== undefined) {
      const name = (body.name || "").trim();
      if (!name) return jsonResponse({ error: "Item Name is required" }, 400);
      update.name = name;
    }
    if (body.unit !== undefined) {
      const unit = (body.unit || "").trim();
      if (!unit) return jsonResponse({ error: "Unit is required" }, 400);
      update.unit = unit;
    }
    if (body.status !== undefined) update.status = body.status || "Available";

    const { data, error } = await supabase
      .from("sku_items")
      .update(update)
      .eq("brand_id", brandId)
      .eq("sku", sku)
      .select("id, sku, item_type, category, name, unit, status")
      .maybeSingle();
    if (error) throw error;
    if (!data) return jsonResponse({ error: "SKU not found: " + sku }, 404);

    return jsonResponse(data);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function onRequestDelete({ env, params }) {
  try {
    const sku = decodeURIComponent(params.code);
    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    const { data: existing, error: findErr } = await supabase
      .from("sku_items")
      .select("id")
      .eq("brand_id", brandId)
      .eq("sku", sku)
      .maybeSingle();
    if (findErr) throw findErr;
    if (!existing) return jsonResponse({ error: "SKU not found: " + sku }, 404);

    const usage = await findSkuUsage(supabase, existing.id);
    if (usage.length) {
      return jsonResponse({ error: "Can't delete " + sku + " - still referenced in: " + usage.join(", ") + ". Set Status to \"Unavailable\" instead." }, 400);
    }

    const { error: delErr } = await supabase.from("sku_items").delete().eq("id", existing.id);
    if (delErr) throw delErr;

    return jsonResponse({ sku: sku });
  } catch (err) {
    return errorResponse(err);
  }
}
