// Deducts stock for an Order's direct-recipe Ingredient/Packaging/Operating
// lines exactly once, at the moment the order first becomes Completed - the
// same "Production Consumption" channel Sales already uses (see
// _lib/sales.js's saleConsumptionItems, reused here as-is), not the
// structurally-dead "Sale" branch in the stock_ledger view (order_items.
// sku_id is always a Product, and that branch only ever matches non-Product
// rows - see functions/api/inventory/overview.js's comment). Component/
// Semi-Finished lines are already skipped by saleConsumptionItems (their
// raw ingredients were deducted when THAT batch was produced), so this
// can't double-count against Batch Production.
//
// Called from two places, both exactly at the order_status -> "Completed"
// transition: functions/api/orders.js's POST (an order created already Paid
// + fulfilled in one shot) and functions/api/orders/[code].js's PATCH (the
// more common case - paid/delivered sometime after creation). Order items
// are immutable after creation (no endpoint edits them), so there's no
// drift risk between when this runs and what was actually ordered.
import { saleConsumptionItems } from "./sales.js";

// A driver's identity is either a real staff_id, or (external drivers -
// GrabExpress today, possibly others later) free text matched by EXACT
// string equality everywhere driver rows get grouped (resyncDriverPayoutOpexGroup,
// GrabExpress's own instant-pay detection). The New Order form only ever
// sends the exact canonical string now (dropdown-only, no free typing), but
// normalize at every write site anyway - a direct API call, or a future
// external driver added with free text, could otherwise create "GrabExpress"/
// "Grabexpress"/" grabexpress " as silently different groups.
export function normalizeDriverNameRaw(raw) {
  if (raw === null || raw === undefined) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  return trimmed.toLowerCase() === "grabexpress" ? "GrabExpress" : trimmed;
}

export async function recordOrderConsumption(supabase, resolver, orderCode, orderDate, items) {
  // Idempotency guard - the order_status derivation logic already only
  // flips to "Completed" once (never re-fires once it's already
  // Completed), but this is cheap insurance against ever double-deducting
  // stock for the same order.
  const { count, error: checkErr } = await supabase
    .from("production_consumption")
    .select("id", { count: "exact", head: true })
    .eq("ref_code", orderCode)
    .eq("source", "Orders");
  if (checkErr) throw checkErr;
  if (count) return;

  const rows = [];
  items.forEach((it) => {
    saleConsumptionItems(resolver, it.skuId, Number(it.qty)).forEach((c) => {
      rows.push({ sku_id: c.skuId, qty: c.qty, source: "Orders", ref_code: orderCode, consumption_date: orderDate });
    });
  });
  if (!rows.length) return;

  const { error: insErr } = await supabase.from("production_consumption").insert(rows);
  if (insErr) throw insErr;
}
