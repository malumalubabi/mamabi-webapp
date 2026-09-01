// HR > Attendance - the outlet's regular weekly operating hours (Gmaps-
// style: which weekdays it's open, what hours), one fixed row per weekday
// (0=Sunday..6=Saturday) - always exactly 7 rows, seeded once per brand by
// the outlet_hours migration, never added/removed, only edited. This is the
// DEFAULT pattern; outlet_closures layers ad-hoc one-off exceptions on top
// (a holiday that falls on a normally-open day) - see staff-shifts.js's
// POST, which checks both before allowing a shift.
import { getSupabase, getBrandId, jsonResponse, errorResponse } from "./_lib/supabase.js";

export async function onRequestGet({ env }) {
  try {
    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    const { data, error } = await supabase
      .from("outlet_hours")
      .select("weekday, is_open, open_time, close_time")
      .eq("brand_id", brandId)
      .order("weekday");
    if (error) throw error;

    return jsonResponse(data.map((r) => ({
      weekday: r.weekday,
      isOpen: r.is_open,
      openTime: r.open_time,
      closeTime: r.close_time
    })));
  } catch (err) {
    return errorResponse(err);
  }
}
