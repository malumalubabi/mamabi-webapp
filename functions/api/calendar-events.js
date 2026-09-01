// HR > Attendance's Calendar reads this to show a description under a
// date's number and drive its "tanggal merah" red-number styling -
// informational only, doesn't affect Outlet Hours/Outlet Closures at all.
// Populated by Settings > Calendar's import (see national-holidays.js);
// no manual add here yet - not asked for, and re-running the import is
// how it'd get corrected today.
import { getSupabase, getBrandId, jsonResponse, errorResponse } from "./_lib/supabase.js";

export async function onRequestGet({ env }) {
  try {
    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    const { data, error } = await supabase
      .from("calendar_events")
      .select("event_date, name")
      .eq("brand_id", brandId)
      .order("event_date");
    if (error) throw error;

    return jsonResponse(data.map((r) => ({ date: r.event_date, name: r.name })));
  } catch (err) {
    return errorResponse(err);
  }
}
