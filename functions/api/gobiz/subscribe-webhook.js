// One-off setup call (like sync-menu.js) - hit once to register our
// production webhook URL with GoBiz so these events actually get delivered
// to functions/api/webhooks/gofood.js. Confirmed via docs: this endpoint
// takes exactly one event per call (no array support), so this loops one
// POST per event. created/cancelled drive real order creation/cancellation;
// the rest are purely logged to order_status_events for Platform Orders'
// Status column timeline (see gofood.js's LIFECYCLE_EVENTS).
import { gobizFetch } from "../_lib/gobiz.js";
import { jsonResponse, errorResponse } from "../_lib/supabase.js";

const WEBHOOK_URL = "https://malumalubabi.pages.dev/api/webhooks/gofood";
const EVENTS = [
  "gofood.order.created",
  "gofood.order.cancelled",
  "gofood.order.merchant_accepted",
  "gofood.order.driver_otw_pickup",
  "gofood.order.driver_arrived",
  "gofood.order.placed",
  "gofood.order.completed"
];

// Debugging helper - lists whatever subscriptions currently exist on this
// credential, to confirm a POST above actually registered (and check its
// exact shape - e.g. General vs Outlet-specific).
export async function onRequestGet({ env }) {
  try {
    const result = await gobizFetch(env, "/integrations/partner/v1/notification-subscriptions", { method: "GET" });
    return jsonResponse(result);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function onRequestPost({ env }) {
  try {
    // GoBiz rejects re-registering the same (event, url) pair ("url has
    // already been taken") - fetch what's already subscribed first so
    // re-running this (e.g. after adding new events to EVENTS) only POSTs
    // the ones actually missing, instead of aborting on the first duplicate.
    const existing = await gobizFetch(env, "/integrations/partner/v1/notification-subscriptions", { method: "GET" });
    const existingEvents = new Set((existing.data && existing.data.subscriptions || []).map((s) => s.event));

    const results = [];
    for (const event of EVENTS) {
      if (existingEvents.has(event)) { results.push({ event: event, result: "already subscribed" }); continue; }
      const result = await gobizFetch(env, "/integrations/partner/v1/notification-subscriptions", {
        method: "POST",
        body: { event: event, url: WEBHOOK_URL, active: true }
      });
      results.push({ event: event, result: result });
    }
    return jsonResponse({ webhookUrl: WEBHOOK_URL, subscriptions: results });
  } catch (err) {
    return errorResponse(err);
  }
}
