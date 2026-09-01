// HR > Attendance's Calendar reads this to show a description under a
// date's number and drive its "tanggal merah" red-number styling -
// informational only, doesn't affect Outlet Hours/Outlet Closures at all.
// Populated by Settings > Calendar's import (see national-holidays.js).
// Settings > Manage Calendar manages these per import BATCH (source+year),
// not per individual day - DELETE here removes a whole batch at once.
import { getSupabase, getBrandId, jsonResponse, errorResponse } from "./_lib/supabase.js";

export async function onRequestGet({ env }) {
  try {
    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    const { data, error } = await supabase
      .from("calendar_events")
      .select("event_code, event_date, name, source, year")
      .eq("brand_id", brandId)
      .order("event_date");
    if (error) throw error;

    return jsonResponse(data.map((r) => ({ eventCode: r.event_code, date: r.event_date, name: r.name, source: r.source, year: r.year })));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function onRequestDelete({ request, env }) {
  try {
    const url = new URL(request.url);
    const source = url.searchParams.get("source");
    const year = Number(url.searchParams.get("year"));
    if (!source || !year) return jsonResponse({ error: "source and year are required" }, 400);

    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    const { error, count } = await supabase
      .from("calendar_events")
      .delete({ count: "exact" })
      .eq("brand_id", brandId)
      .eq("source", source)
      .eq("year", year);
    if (error) throw error;

    return jsonResponse({ deleted: count || 0 });
  } catch (err) {
    return errorResponse(err);
  }
}
