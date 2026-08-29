// One-off setup call (like sync-menu.js) - hit once to register our
// production webhook URL with GoBiz so gofood.order.created/cancelled
// events actually get delivered to functions/api/webhooks/gofood.js.
// Confirmed via docs: this endpoint takes exactly one event per call (no
// array support), so this loops one POST per event we handle. Only the 2
// events our receiver acts on are registered - subscribing to events we'd
// just 200-and-ignore (merchant_accepted, driver_otw_pickup, etc.) would
// only add noise, not capability.
import { gobizFetch } from "../_lib/gobiz.js";
import { jsonResponse, errorResponse } from "../_lib/supabase.js";

const WEBHOOK_URL = "https://malumalubabi.pages.dev/api/webhooks/gofood";
const EVENTS = ["gofood.order.created", "gofood.order.cancelled"];

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
    const results = [];
    for (const event of EVENTS) {
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
