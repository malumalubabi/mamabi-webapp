// Minimal Gmail API client for the sales-report import pipeline
// (functions/api/sales-import/run.js) - reads malumalubabi@gmail.com via a
// standalone OAuth2 refresh token (NOT the same thing as the Claude Code
// session's own Gmail access, which only exists inside a chat and can't be
// used by a deployed Cloudflare Function). GMAIL_CLIENT_ID/GMAIL_CLIENT_SECRET/
// GMAIL_REFRESH_TOKEN come from a one-time manual OAuth consent - see the
// setup instructions handed over alongside this file, since obtaining them
// is a step only the account owner can do.
//
// In-module token cache mirrors _lib/gobiz.js's getGobizToken - best-effort
// only (Cloudflare Workers isolates are ephemeral/parallel), just avoids a
// pointless re-refresh within one isolate's short lifetime.
let _tokenCache = null; // { token, expiry }

export async function getGmailAccessToken(env) {
  if (!env.GMAIL_CLIENT_ID || !env.GMAIL_CLIENT_SECRET || !env.GMAIL_REFRESH_TOKEN) {
    throw new Error("Missing GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET / GMAIL_REFRESH_TOKEN env vars");
  }

  const now = Date.now();
  if (_tokenCache && now < _tokenCache.expiry) return _tokenCache.token;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GMAIL_CLIENT_ID,
      client_secret: env.GMAIL_CLIENT_SECRET,
      refresh_token: env.GMAIL_REFRESH_TOKEN,
      grant_type: "refresh_token"
    }).toString()
  });
  if (!res.ok) throw new Error("Gmail token refresh failed (" + res.status + "): " + await res.text());
  const data = await res.json();

  // Refresh 60s before actual expiry, same margin as _lib/gobiz.js.
  _tokenCache = { token: data.access_token, expiry: now + (Number(data.expires_in) - 60) * 1000 };
  return _tokenCache.token;
}

// q uses normal Gmail search syntax (from:/subject:/newer_than:...) - same
// operators as the Gmail search box. Returns [{id, threadId}, ...] or [] -
// message STUBS only, getGmailMessage below fetches each one's actual
// content.
export async function searchGmailMessages(accessToken, query) {
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages?q=" + encodeURIComponent(query), {
    headers: { Authorization: "Bearer " + accessToken }
  });
  if (!res.ok) throw new Error("Gmail search failed (" + res.status + "): " + await res.text());
  const data = await res.json();
  return data.messages || [];
}

// base64url (Gmail's body encoding - "-"/"_" instead of "+"/"/", no
// padding) decoded to actual UTF-8 text, not just the raw Latin-1 atob()
// bytes - matters here since Indonesian report bodies carry non-ASCII
// characters.
function base64UrlDecode(data) {
  const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder("utf-8").decode(bytes);
}

// Depth-first search through a message's MIME tree for the first part of
// the given type - text/plain preferred by the caller below since it needs
// no tag-stripping and can't be thrown off by markup changes; text/html is
// the fallback for a report that only ever sends HTML.
function findBodyPart(payload, mimeType) {
  if (payload.mimeType === mimeType && payload.body && payload.body.data) return payload.body.data;
  if (payload.parts) {
    for (const part of payload.parts) {
      const found = findBodyPart(part, mimeType);
      if (found) return found;
    }
  }
  return null;
}

function stripHtml(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&mdash;/gi, "-")
    .replace(/&rsquo;/gi, "'")
    .replace(/&ndash;/gi, "-");
}

// Collapsed to single spaces - report_parser.js's regexes match on
// "<Label>\s+<value>" adjacency, which this preserves regardless of how
// many newlines/nested tags sat between them in the source.
function normalizeWhitespace(text) {
  return text.replace(/\s+/g, " ").trim();
}

export async function getGmailMessage(accessToken, messageId) {
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/" + messageId + "?format=full", {
    headers: { Authorization: "Bearer " + accessToken }
  });
  if (!res.ok) throw new Error("Gmail get message failed (" + res.status + "): " + await res.text());
  const data = await res.json();

  const headers = {};
  (data.payload.headers || []).forEach((h) => { headers[h.name.toLowerCase()] = h.value; });

  let raw = findBodyPart(data.payload, "text/plain");
  let isHtml = false;
  if (!raw) { raw = findBodyPart(data.payload, "text/html"); isHtml = true; }
  if (!raw && data.payload.body && data.payload.body.data) { raw = data.payload.body.data; isHtml = data.payload.mimeType === "text/html"; }

  const text = raw ? base64UrlDecode(raw) : "";
  const bodyText = normalizeWhitespace(isHtml ? stripHtml(text) : text);

  return {
    id: data.id,
    subject: headers["subject"] || "",
    bodyText: bodyText
  };
}

// Stable link back to the source email - works regardless of which label
// the message currently sits under. Used for Sales Draft's "Open reference
// email" (pages/sales.js's openSalesDraftReviewModal).
export function buildGmailPermalink(messageId) {
  return "https://mail.google.com/mail/u/0/#all/" + messageId;
}
