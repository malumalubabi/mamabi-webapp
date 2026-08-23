import { createClient } from "@supabase/supabase-js";

// service_role client - server-side only. Bypasses RLS by design, which is
// why this file lives under functions/ (Cloudflare Pages Functions), never
// shipped to the browser. env comes from context.env in each function -
// Cloudflare Pages secrets in production, .dev.vars locally.
export function getSupabase(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env vars");
  }
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  });
}

export function jsonResponse(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "Content-Type": "application/json" }
  });
}

export function errorResponse(err, status) {
  console.error(err);
  const message = (err && err.message) || String(err);
  return jsonResponse({ error: message }, status || 500);
}

// MMB is currently the only brand live in the app; centralizing the lookup
// here means the rest of the codebase never hardcodes the code string.
export async function getBrandId(supabase) {
  const { data, error } = await supabase
    .from("brands")
    .select("id")
    .eq("code", "MMB")
    .single();
  if (error) throw error;
  return data.id;
}
