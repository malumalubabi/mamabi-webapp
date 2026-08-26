// Distinct Description values ever used in Cashflow, for the Input
// Transaction form's Description field (a free-text combobox - pick an
// existing one for consistency, or type a brand-new one, per explicit
// request). Deduped/sorted in JS rather than a SQL DISTINCT, same "small
// dataset, compute in JS" approach used elsewhere in this app (e.g. P&L).
import { getSupabase, getBrandId, jsonResponse, errorResponse } from "../_lib/supabase.js";

export async function onRequestGet({ env }) {
  try {
    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    const { data, error } = await supabase
      .from("cashflow_transactions")
      .select("description")
      .eq("brand_id", brandId)
      .not("description", "is", null);
    if (error) throw error;

    const unique = [...new Set(data.map((r) => r.description.trim()).filter(Boolean))].sort();
    return jsonResponse(unique);
  } catch (err) {
    return errorResponse(err);
  }
}
