// GoFood order webhook receiver (Direct Integration, Auto Accept) - GoBiz
// calls this whenever a subscribed event fires (see gobiz/subscribe-webhook.js
// for the exact list registered). Two event types get real handling:
//   - gofood.order.created: the order already has full item/price/customer
//     data, and Auto Accept means GoBiz has already accepted it on our
//     behalf (see _lib/gobiz.js's outlet-link comment) - so this is the
//     right moment to create our own orders/order_items rows, no separate
//     "accept" API call needed.
//   - gofood.order.cancelled: keeps our copy in sync if the CONSUMER cancels
//     (rare, but possible in the window right after auto-accept).
// Every other subscribed lifecycle event (merchant_accepted,
// driver_otw_pickup, driver_arrived, placed, completed) doesn't change
// anything on the order row itself - it's just appended to
// order_status_events (order_id, event_name, occurred_at) as a display-only
// timeline, per explicit request (Platform Orders' Status column shows when
// the order came in and any subsequent status notifications with their
// time).
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
    // Confirmed live against a real sandbox order (see webhook_logs) - the
    // docs say "event_type" but the actual field GoBiz sends is
    // "event_name".
    const eventType = payload.header && payload.header.event_name;
    const eventTimestamp = (payload.header && payload.header.timestamp) || new Date().toISOString();
    const body = payload.body || {};

    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    if (eventType === "gofood.order.cancelled") {
      await handleCancelled(supabase, brandId, body);
      await logStatusEvent(supabase, brandId, body, eventType, eventTimestamp);
    } else if (eventType === "gofood.order.created") {
      await handleCreated(supabase, brandId, body, eventTimestamp);
    } else if (LIFECYCLE_EVENTS.has(eventType)) {
      await logStatusEvent(supabase, brandId, body, eventType, eventTimestamp);
    }
    // Any other, unrecognized event: acknowledged, no action.

    return new Response("OK", { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}

// Purely informational lifecycle events - logged to order_status_events for
// the Platform Orders Status column timeline, no effect on the order row
// itself (fulfillment/order_status only ever change via handleCreated,
// handleCancelled, or our own Mark Picked Up action).
const LIFECYCLE_EVENTS = new Set([
  "gofood.order.merchant_accepted",
  "gofood.order.driver_otw_pickup",
  "gofood.order.driver_arrived",
  "gofood.order.placed",
  "gofood.order.completed"
]);

async function logStatusEvent(supabase, brandId, body, eventType, eventTimestamp) {
  const orderNumber = body.order && body.order.order_number;
  if (!orderNumber) return;

  const { data: order, error: orderErr } = await supabase
    .from("orders")
    .select("id")
    .eq("brand_id", brandId)
    .eq("platform_order_id", orderNumber)
    .maybeSingle();
  if (orderErr) throw orderErr;
  if (!order) return; // event arrived before/without a matching order - nothing to attach it to

  const { error } = await supabase.from("order_status_events").insert({
    order_id: order.id,
    event_name: eventType,
    occurred_at: eventTimestamp
  });
  if (error) throw error;
}

async function handleCancelled(supabase, brandId, body) {
  const orderNumber = body.order && body.order.order_number;
  if (!orderNumber) return;

  const { error } = await supabase
    .from("orders")
    .update({ order_status: "Cancelled" })
    .eq("brand_id", brandId)
    .eq("platform_order_id", orderNumber);
  if (error) throw error;
}

async function handleCreated(supabase, brandId, body, eventTimestamp) {
  // Confirmed live against a real sandbox order (see webhook_logs) - both
  // order_number and order_items live under body.order, not top-level body
  // as the docs' abbreviated example implied.
  const orderNumber = body.order && body.order.order_number;
  if (!orderNumber) throw new Error("gofood.order.created payload missing body.order.order_number");

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

  const rawItems = Array.isArray(body.order.order_items) ? body.order.order_items : [];
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

  // service_type is "gofood" (Gojek's own driver delivers) or
  // "gofood_pickup" (consumer collects themselves) - confirmed live in
  // webhook_logs at body.service_type, not body.order.service_type.
  const fulfillmentType = body.service_type === "gofood_pickup" ? "Pickup" : "Delivery";

  // No driver/delivery fee tracking on our side either way - even for
  // "Delivery" here, it's Gojek's own courier network doing the actual leg
  // and being paid by GoFood directly, not through our Driver Payout module.
  // order_type "Takeaway" (rather than "Delivery") reflects this accurately
  // from our bookkeeping's perspective - whoever physically collects the
  // food does so FROM us, same shape as a Takeaway customer, and keeps
  // these orders out of Driver Payout's Delivery-only grouping (see
  // pages/orders.js's renderDriverPayoutSections). fulfillment_status
  // starts Pending like any other order - staff click the same existing
  // "Mark Picked Up" action once collected, which is also what triggers
  // stock consumption (see functions/api/orders/[code].js's PATCH,
  // unchanged for this case).
  //
  // payment_status is Paid immediately - GoFood collects payment from the
  // consumer through their own app at order time, never cash/QRIS collected
  // by us, confirmed by the existence of a separate payment.transaction.settlement
  // webhook event for GoBiz's own settlement to us. That settlement is a
  // lump-sum payout the next day though, not per-order, so this deliberately
  // does NOT get treated as recognized Sales revenue yet (see
  // _lib/sales.js's getOnlineSalesRows(), which now excludes platform !=
  // "Online" orders for exactly this reason) - a platform settlement
  // reconciliation flow would need to exist first.
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
    platform_pin: (body.order && body.order.pin) || null,
    platform_fulfillment_type: fulfillmentType,
    platform_service_fee: (body.order && Number(body.order.takeaway_charges)) || 0,
    platform_customer_name: (body.customer && body.customer.name) || null,
    // Raw capture, defensive - every real sandbox order so far has sent an
    // empty array (no promo has actually been triggered yet to see its
    // populated shape), but the field exists in the payload
    // (body.order.applied_promotions) and per-item body.order.order_items[].sku_promo_id
    // - stored as-is rather than parsed into a specific structure we'd be
    // guessing at, so nothing is lost once a real promo'd order arrives.
    platform_promotions: (body.order && Array.isArray(body.order.applied_promotions) && body.order.applied_promotions.length)
      ? body.order.applied_promotions
      : null,
    notes: null
  };

  const { data: order, error: orderErr } = await supabase
    .from("orders")
    .insert(insertRow)
    .select("id, order_code")
    .single();
  if (orderErr) throw orderErr;

  await supabase.from("order_status_events").insert({
    order_id: order.id,
    event_name: "gofood.order.created",
    occurred_at: eventTimestamp
  });

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
      packaging_cost_snapshot: packagingCostPerUnit * qty,
      notes: it.notes || null
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
