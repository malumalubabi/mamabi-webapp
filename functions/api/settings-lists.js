// Generic add/rename/remove for one item in a settings_lists list (Payment
// Method, Sales Platform, PnL Categories, Staff Roles). Rows optionally
// carry a `meta` tag - Sales Platform uses it for "Base Pricing"/"Platform
// Pricing" (folded in from the old separate "Platforms Using Platform
// Price" list - see the settings_lists_meta_merge migration), PnL
// Categories uses it for "Fixed"/"Variable". Payment Method/Staff Roles
// leave it null.
//
// Renaming a value's text also cascades to every historical record already
// carrying the old text (per explicit request - that's the whole point of
// managing these as lists rather than free text everywhere), via
// CASCADE_RENAME_TARGETS below. "text" targets are a plain text column;
// "array" targets are a text[] column (Staff.roles) where only the matching
// element is swapped. PnL Categories now drives opex_entries.category (see
// pages/opex.js's Input Expense) and P&L's Fixed/Variable split (see
// functions/api/pnl.js), so it cascades there too. Changing only `meta`
// (not the value text) never needs to cascade - it's not copied into any
// other table, just read live off this row when needed (e.g. sales.js's
// pricing lookup, or pnl.js's Fixed/Variable bucketing for an still-open
// month - a CLOSED month's bucketing is frozen in pnl_lines instead, see
// pnl.js's own comment).
import { getSupabase, getBrandId, jsonResponse, errorResponse } from "./_lib/supabase.js";

const CASCADE_RENAME_TARGETS = {
  "Payment Method": [
    { kind: "text", table: "orders", column: "payment_method" },
    { kind: "text", table: "orders", column: "driver_payout_method" },
    { kind: "text", table: "purchases", column: "method" }
  ],
  "Sales Platform": [
    { kind: "text", table: "sales_batches", column: "platform" },
    { kind: "text", table: "sales_entries", column: "platform" }
  ],
  "Staff Roles": [
    { kind: "array", table: "staff", column: "roles" }
  ],
  "PnL Categories": [
    { kind: "text", table: "opex_entries", column: "category" }
  ]
};

async function runCascadeRename(supabase, brandId, listName, oldValue, newValue) {
  const targets = CASCADE_RENAME_TARGETS[listName] || [];
  if (!targets.length || newValue === oldValue) return;

  for (const t of targets) {
    if (t.kind === "text") {
      const { error } = await supabase.from(t.table).update({ [t.column]: newValue }).eq("brand_id", brandId).eq(t.column, oldValue);
      if (error) throw error;
    } else if (t.kind === "array") {
      const { data: rows, error: selErr } = await supabase
        .from(t.table)
        .select("id, " + t.column)
        .eq("brand_id", brandId)
        .contains(t.column, [oldValue]);
      if (selErr) throw selErr;

      const updates = rows.map((r) =>
        supabase.from(t.table).update({ [t.column]: r[t.column].map((v) => (v === oldValue ? newValue : v)) }).eq("id", r.id)
      );
      const results = await Promise.all(updates);
      const failed = results.find((r) => r.error);
      if (failed) throw failed.error;
    }
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const listName = (body.listName || "").trim();
    const value = (body.value || "").trim();
    const meta = body.meta ? String(body.meta).trim() : null;
    if (!listName) return jsonResponse({ error: "listName is required" }, 400);
    if (!value) return jsonResponse({ error: "Value is required" }, 400);

    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    const { data: existing, error: findErr } = await supabase
      .from("settings_lists")
      .select("value, sort_order")
      .eq("brand_id", brandId)
      .eq("list_name", listName);
    if (findErr) throw findErr;
    if (existing.some((r) => r.value.toLowerCase() === value.toLowerCase())) {
      return jsonResponse({ error: listName + " already has: " + value }, 400);
    }

    const nextOrder = existing.reduce((max, r) => Math.max(max, r.sort_order), 0) + 1;
    const { error: insErr } = await supabase.from("settings_lists").insert({ brand_id: brandId, list_name: listName, value: value, meta: meta, sort_order: nextOrder });
    if (insErr) throw insErr;

    return jsonResponse({ listName: listName, value: value, meta: meta }, 201);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function onRequestPatch({ request, env }) {
  try {
    const body = await request.json();
    const listName = (body.listName || "").trim();
    const oldValue = (body.oldValue || "").trim();
    const newValue = (body.newValue || "").trim();
    const metaProvided = body.meta !== undefined;
    const meta = metaProvided ? (body.meta ? String(body.meta).trim() : null) : undefined;
    if (!listName || !oldValue) return jsonResponse({ error: "listName and oldValue are required" }, 400);
    if (!newValue) return jsonResponse({ error: "Value is required" }, 400);

    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    if (newValue.toLowerCase() !== oldValue.toLowerCase()) {
      const { data: existing, error: findErr } = await supabase
        .from("settings_lists")
        .select("value")
        .eq("brand_id", brandId)
        .eq("list_name", listName);
      if (findErr) throw findErr;
      if (existing.some((r) => r.value.toLowerCase() === newValue.toLowerCase())) {
        return jsonResponse({ error: listName + " already has: " + newValue }, 400);
      }
    }

    const updatePayload = { value: newValue };
    if (metaProvided) updatePayload.meta = meta;

    const { data, error } = await supabase
      .from("settings_lists")
      .update(updatePayload)
      .eq("brand_id", brandId)
      .eq("list_name", listName)
      .eq("value", oldValue)
      .select("value, meta")
      .maybeSingle();
    if (error) throw error;
    if (!data) return jsonResponse({ error: listName + " not found: " + oldValue }, 404);

    await runCascadeRename(supabase, brandId, listName, oldValue, newValue);

    return jsonResponse({ listName: listName, value: data.value, meta: data.meta });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function onRequestDelete({ request, env }) {
  try {
    const body = await request.json();
    const listName = (body.listName || "").trim();
    const value = (body.value || "").trim();
    if (!listName || !value) return jsonResponse({ error: "listName and value are required" }, 400);

    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    const { error, count } = await supabase
      .from("settings_lists")
      .delete({ count: "exact" })
      .eq("brand_id", brandId)
      .eq("list_name", listName)
      .eq("value", value);
    if (error) throw error;
    if (!count) return jsonResponse({ error: listName + " not found: " + value }, 404);

    return jsonResponse({ listName: listName, value: value });
  } catch (err) {
    return errorResponse(err);
  }
}
