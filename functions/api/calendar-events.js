// HR > Attendance's Calendar reads this to show a description under a
// date's number and drive its "tanggal merah" red-number styling -
// informational only, doesn't affect Outlet Hours/Outlet Closures at all.
// Populated by Settings > Calendar's import (see national-holidays.js) and
// manageable (deletable) from that same modal - see [code].js.
import { getSupabase, getBrandId, jsonResponse, errorResponse } from "./_lib/supabase.js";

export async function onRequestGet({ env }) {
  try {
    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    const { data, error } = await supabase
      .from("calendar_events")
      .select("event_code, event_date, name")
      .eq("brand_id", brandId)
      .order("event_date");
    if (error) throw error;

    return jsonResponse(data.map((r) => ({ eventCode: r.event_code, date: r.event_date, name: r.name })));
  } catch (err) {
    return errorResponse(err);
  }
}
