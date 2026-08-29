// GoBiz (GoFood) Direct Integration - OAuth2 client-credentials token fetch
// (cached in-module, best-effort only: Cloudflare Workers isolates are
// ephemeral/parallel, so this just avoids refetching within one isolate's
// short lifetime, not a real shared cache) plus a small authenticated-fetch
// helper reused by every GoBiz API call site (outlet-link, webhook
// subscription, order status updates).
//
// Credentials come from GOBIZ_CLIENT_ID/GOBIZ_CLIENT_SECRET (.dev.vars
// locally, Cloudflare Pages secrets in production) - see .dev.vars for the
// sandbox values already generated at developer.gobiz.com.
//
// Endpoint/scope/flow details confirmed via developer.gobiz.com docs
// (Direct Integration auth + API reference), not guessed:
// https://developer.gobiz.com/docs/api/auth/direct-integration/
//
// Sandbox and Production are NOT the same host with different credentials -
// the OAuth token endpoint itself moves too (confirmed via docs' Getting
// Started page). Controlled by GOBIZ_ENV ("production" or unset/anything
// else = sandbox) so local dev (.dev.vars, no GOBIZ_ENV set) always stays
// sandbox, and flipping Cloudflare Pages production over later is just
// setting GOBIZ_ENV=production + swapping the 3 credential env vars for
// their production values - no code change needed at cutover time.
const ENVIRONMENTS = {
  sandbox: {
    tokenUrl: "https://integration-goauth.gojekapi.com/oauth2/token",
    apiBase: "https://api.partner-sandbox.gobiz.co.id"
  },
  // Full path confirmed (not guessed) via developer.gobiz.com/docs/docs/authentication's
  // own example curl command, which literally uses this exact URL.
  production: {
    tokenUrl: "https://accounts.go-jek.com/oauth2/token",
    apiBase: "https://api.gobiz.co.id"
  }
};

function getEnvConfig(env) {
  return env.GOBIZ_ENV === "production" ? ENVIRONMENTS.production : ENVIRONMENTS.sandbox;
}

// Exact scope list confirmed live in the developer.gobiz.com integration
// page (Sandbox "All Active Scopes") - not every scope may end up used, but
// requesting a scope not already granted to the credential would fail the
// token request, so this must match that page exactly.
const SCOPES = [
  "offline",
  "gofood:catalog:write",
  "gofood:catalog:read",
  "gofood:order:write",
  "gofood:order:read",
  "promo:food_promo:write",
  "promo:food_promo:read",
  "gofood:outlet:write",
  "partner:outlet:write",
  "partner:outlet:read"
].join(" ");

// Note: there is no outlet-link API call for the Direct Integration model -
// PUT /integrations/partner/v1/outlet-link (and the whole "Steps on Linking
// Outlets" doc) is explicitly Facilitator-model only ("If you are using
// direct integration, you may proceed without going through this section" -
// confirmed both by that doc text and live: calling it with our
// client_credentials token 404s "Invalid URL"). For Direct Integration the
// outlet is already linked once the sandbox/production credential is issued
// via the developer portal - our sandbox outlet's GoBiz id is the UUID from
// the outlet URL the portal already gave us
// (.../restaurant/84f2b00c-6a73-47c4-aaf6-7b8bba9b2d94), which is what the
// {outlet_id} path segment on order-status endpoints (e.g. Mark Food Ready)
// expects - not something we call an API to obtain or set ourselves.

// Keyed by environment name (not just one shared variable) so a sandbox
// token and a production token could never collide if a single isolate
// somehow handled both in practice - cheap insurance, not expected to
// actually happen (local dev only ever runs sandbox, deployed prod only
// ever runs whatever GOBIZ_ENV is set to there).
const _tokenCache = {}; // { [envName]: { token, expiry } }

export async function getGobizToken(env) {
  if (!env.GOBIZ_CLIENT_ID || !env.GOBIZ_CLIENT_SECRET) {
    throw new Error("Missing GOBIZ_CLIENT_ID / GOBIZ_CLIENT_SECRET env vars");
  }

  const envName = env.GOBIZ_ENV === "production" ? "production" : "sandbox";
  const config = getEnvConfig(env);
  const now = Date.now();
  const cached = _tokenCache[envName];
  if (cached && now < cached.expiry) return cached.token;

  const basicAuth = btoa(env.GOBIZ_CLIENT_ID + ":" + env.GOBIZ_CLIENT_SECRET);
  const res = await fetch(config.tokenUrl, {
    method: "POST",
    headers: {
      "Authorization": "Basic " + basicAuth,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials&scope=" + encodeURIComponent(SCOPES)
  });
  if (!res.ok) throw new Error("GoBiz token request failed (" + res.status + "): " + await res.text());
  const data = await res.json();

  // Refresh 60s before actual expiry so a request never races an
  // about-to-expire token.
  _tokenCache[envName] = { token: data.access_token, expiry: now + (Number(data.expires_in) - 60) * 1000 };
  return data.access_token;
}

// Generic authenticated call against the GoBiz Partner/GoFood API - path is
// relative to the current environment's apiBase (e.g.
// "/integrations/partner/v1/outlet-link").
export async function gobizFetch(env, path, options) {
  options = options || {};
  const token = await getGobizToken(env);
  const config = getEnvConfig(env);

  const res = await fetch(config.apiBase + path, {
    method: options.method || "GET",
    headers: Object.assign(
      { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
      options.headers || {}
    ),
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const text = await res.text();
  if (!res.ok) throw new Error("GoBiz API " + path + " failed (" + res.status + "): " + text);
  return text ? JSON.parse(text) : null;
}
