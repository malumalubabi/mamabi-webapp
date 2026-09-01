// Settings > National Holidays - bulk-imports Indonesia's public holidays
// for one year straight into outlet_closures (a national holiday IS just an
// outlet closure, bulk-sourced instead of entered one at a time - no new
// table). Source is Nager.Date's free public holiday API (no key needed) -
// it only covers FIXED-date holidays (New Year, Labour Day, Independence
// Day, Christmas, etc.), not Indonesia's moveable religious ones (Idul
// Fitri, Nyepi, Waisak, Isra Miraj, Maulid Nabi, Imlek) - those still need
// adding by hand via HR > Attendance's own "+ Add Closure". Dates that
// already have a closure row (same date, from an earlier import or a
// manual add) are skipped, not duplicated.
import { getSupabase, getBrandId, jsonResponse, errorResponse } from "./_lib/supabase.js";
import { nextCode } from "./_lib/codes.js";

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const year = Number(body.year);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) return jsonResponse({ error: "Invalid year" }, 400);

    const res = await fetch("https://date.nager.at/api/v3/publicholidays/" + year + "/ID");
    if (!res.ok) throw new Error("Couldn't fetch holidays for " + year + " (status " + res.status + ")");
    const holidays = await res.json(); // [{date, localName, name, ...}]

    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    const { data: existing, error: existErr } = await supabase
      .from("outlet_closures")
      .select("closure_date")
      .eq("brand_id", brandId);
    if (existErr) throw existErr;
    const existingDates = new Set(existing.map((r) => r.closure_date));

    const toInsert = holidays.filter((h) => !existingDates.has(h.date));
    let imported = 0;
    for (const h of toInsert) {
      const closureCode = await nextCode(supabase, "outlet_closures", "closure_code", brandId, "CLS", 4);
      const { error } = await supabase.from("outlet_closures").insert({
        brand_id: brandId,
        closure_code: closureCode,
        closure_date: h.date,
        reason: h.localName || h.name
      });
      if (error) throw error;
      imported++;
    }

    return jsonResponse({ imported: imported, skipped: holidays.length - imported, total: holidays.length });
  } catch (err) {
    return errorResponse(err);
  }
}
