// GoFood order webhook receiver (Direct Integration, Auto Accept) - GoBiz
// calls this whenever a subscribed event fires (see notification-subscriptions
// registration, not yet wired up - this endpoint just needs to exist and be
// reachable first). Only 2 event types are acted on:
//   - gofood.order.created: the order already has full item/price/customer
//     data, and Auto Accept means GoBiz has already accepted it on our
//     behalf (see _lib/gobiz.js's outlet-link comment) - so this is the
//     right moment to create our own orders/order_items rows, no separate
//     "accept" API call needed.
//   - gofood.order.cancelled: keeps our copy in sync if the CONSUMER cancels
//     (rare, but possible in the window right after auto-accept).
// Every other subscribed event (merchant_accepted, driver_otw_pickup, etc.)
// just gets a 200 OK with no action - they're either redundant with what we
// already know, or not something our schema tracks.
//
// Every incoming order line's external_id is one of OUR sku_items.sku codes
// - set via gobiz/sync-menu.js's catalog push, which is what makes this
// mapping possible at all (see that file's comment).
import { getSupabase, getBrandId, jsonResponse, errorResponse } from "../_lib/supabase.js";
import { nextCode } from "../_lib/codes.js";
import { buildCostResolver } from "../_lib/costing.js";

async function verifySignature(env, rawBody, signatureHeader) {
  if (!env.GOBIZ_WEBHOOK_SECRET) throw new Error("Missing GOBIZ_WEBHOOK_SECRET env var");
  if (!signatureHeader) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.GOBIZ_WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const expected = Array.from(new Uint8Array(sigBuf)).map((b) => b.toString(16).padStart(2, "0")).join("");

  // Same length + byte-by-byte compare - a plain === would short-circuit on
  // the first mismatching char, which is the timing side-channel HMAC
  // comparison is supposed to avoid.
  if (expected.length !== signatureHeader.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signatureHeader.charCodeAt(i);
  return diff === 0;
}

export async function onRequestPost({ request, env }) {
  try {
    const rawBody = await request.text();
    const signature = request.headers.get("X-Go-Signature") || request.headers.get("x-go-signature");

    // TEMPORARY diagnostic - logs every incoming call (valid or not) since
    // we have no other way to see Cloudflare Pages Function logs right now.
    // Remove once a real GoFood order has been confirmed to land correctly.
    try {
      const supabase = getSupabase(env);
      const headersObj = {};
      request.headers.forEach((v, k) => { headersObj[k] = v; });
      await supabase.from("webhook_logs").insert({ source: "gofood", headers: headersObj, body: rawBody });
    } catch (logErr) {
      console.error("webhook_logs insert failed", logErr);
    }

    const validSignature = await verifySignature(env, rawBody, signature);
    if (!validSignature) return new Response("Invalid signature", { status: 401 });

    const payload = JSON.parse(rawBody);
    const eventType = payload.header && payload.header.event_type;
    const body = payload.body || {};

    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    if (eventType === "gofood.order.cancelled") {
      await handleCancelled(supabase, brandId, body);
    } else if (eventType === "gofood.order.created") {
      await handleCreated(supabase, brandId, body);
    }
    // Any other event: acknowledged, no action.

    return new Response("OK", { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}

async function handleCancelled(supabase, brandId, body) {
  const orderNumber = body.order && body.order.number;
  if (!orderNumber) return;

  const { error } = await supabase
    .from("orders")
    .update({ order_status: "Cancelled" })
    .eq("brand_id", brandId)
    .eq("platform_order_id", orderNumber);
  if (error) throw error;
}

async function handleCreated(supabase, brandId, body) {
  const orderNumber = body.order && body.order.number;
  if (!orderNumber) throw new Error("gofood.order.created payload missing body.order.number");

  // Idempotency - GoBiz retries on any non-2xx (and possibly redelivers even
  // after a 200, per most webhook systems), so re-processing an
  // already-created order must be a safe no-op rather than a duplicate row.
  const { data: existing, error: existingErr } = await supabase
    .from("orders")
    .select("id")
    .eq("brand_id", brandId)
    .eq("platform_order_id", orderNumber)
    .maybeSingle();
  if (existingErr) throw existingErr;
  if (existing) return;

  const rawItems = Array.isArray(body.order_items) ? body.order_items : [];
  const externalIds = rawItems.map((it) => it.external_id).filter(Boolean);

  const { data: skus, error: skuErr } = await supabase
    .from("sku_items")
    .select("id, sku")
    .eq("brand_id", brandId)
    .in("sku", externalIds.length ? externalIds : ["__none__"]);
  if (skuErr) throw skuErr;
  const skuIdByCode = {};
  skus.forEach((s) => { skuIdByCode[s.sku] = s.id; });

  const orderCode = await nextCode(supabase, "orders", "order_code", brandId, "ORD", 4);

  // No driver/delivery fee tracking on our side - Gojek's own courier
  // network handles the actual delivery leg and is paid by GoFood directly,
  // not through our Driver Payout module. order_type "Takeaway" (rather than
  // "Delivery") reflects this accurately from our bookkeeping's perspective
  // - the Gojek driver picks food up FROM us, same shape as a Takeaway
  // customer, and keeps these orders out of Driver Payout's Delivery-only
  // grouping (see pages/orders.js's renderDriverPayoutSections). fulfillment_status
  // starts Pending like any other order - staff click the same existing
  // "Mark Picked Up" action once the Gojek driver actually collects it,
  // which is also what triggers stock consumption (see
  // functions/api/orders/[code].js's PATCH, unchanged for this case).
  //
  // payment_status is Paid immediately - GoFood collects payment from the
  // consumer through their own app at order time, never cash/QRIS collected
  // by us, confirmed by the existence of a separate payment.transaction.settlement
  // webhook event for GoBiz's own settlement to us.
  const insertRow = {
    brand_id: brandId,
    order_code: orderCode,
    order_date: new Date().toISOString().slice(0, 10),
    customer_id: null,
    order_type: "Takeaway",
    order_status: "Ongoing",
    fulfillment_status: "Pending",
    payment_status: "Paid",
    payment_method: "GoFood",
    delivery_fee: 0,
    platform: "GoFood",
    platform_order_id: orderNumber,
    notes: "GoFood #" + orderNumber + (body.customer && body.customer.name ? " - " + body.customer.name : "")
  };

  const { data: order, error: orderErr } = await supabase
    .from("orders")
    .insert(insertRow)
    .select("id, order_code")
    .single();
  if (orderErr) throw orderErr;

  const resolver = await buildCostResolver(supabase, brandId);
  const itemRows = [];
  const unmapped = [];

  rawItems.forEach((it) => {
    const skuId = skuIdByCode[it.external_id];
    if (!skuId) { unmapped.push(it.external_id || "(no external_id)"); return; }

    const qty = Number(it.quantity) || 0;
    const unitPrice = Number(it.price) || 0;
    const { items: recipeItems } = resolver.getBreakdown(skuId);
    const foodCostPerUnit = recipeItems.filter((x) => x.itemType !== "Packaging").reduce((sum, x) => sum + x.lineCost, 0);
    const packagingCostPerUnit = recipeItems.filter((x) => x.itemType === "Packaging").reduce((sum, x) => sum + x.lineCost, 0);

    itemRows.push({
      order_id: order.id,
      sku_id: skuId,
      qty: qty,
      unit_price: unitPrice,
      food_cost_snapshot: foodCostPerUnit * qty,
      packaging_cost_snapshot: packagingCostPerUnit * qty
    });
  });

  if (itemRows.length) {
    const { error: itemsErr } = await supabase.from("order_items").insert(itemRows);
    if (itemsErr) {
      await supabase.from("orders").delete().eq("id", order.id);
      throw itemsErr;
    }
  }

  // An item GoFood sent that doesn't match any of our SKU codes means the
  // catalog push (gobiz/sync-menu.js) is stale or was never run for it - log
  // loudly rather than silently dropping it with no trace, since it's real
  // lost revenue/reporting otherwise.
  if (unmapped.length) {
    console.error("GoFood order " + orderNumber + " had unmapped item(s): " + unmapped.join(", "));
  }
}
