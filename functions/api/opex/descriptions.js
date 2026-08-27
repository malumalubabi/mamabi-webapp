// Distinct Description values ever used in OpEx, for the Add/Edit Expense
// form's Description field (a free-text combobox - pick an existing one for
// consistency, or type a brand-new one) - same pattern as
// functions/api/cashflow/descriptions.js.
import { getSupabase, getBrandId, jsonResponse, errorResponse } from "../_lib/supabase.js";

export async function onRequestGet({ env }) {
  try {
    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    const { data, error } = await supabase
      .from("opex_entries")
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
