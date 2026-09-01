// Settings > Calendar - bulk-imports Indonesia's holiday calendar for one
// year straight into outlet_closures (a holiday IS just an outlet closure,
// bulk-sourced instead of entered one at a time - no new table). Source is
// Google's public "Hari libur di Indonesia" calendar (iCal feed, no key
// needed) - unlike the Nager.Date API tried first, this one also covers the
// moveable religious holidays (Idul Fitri, Nyepi, Waisak, Isra Miraj,
// Maulid Nabi, Imlek) and Cuti Bersama days, not just fixed-date ones.
// Dates that already have a closure row (same date, from an earlier import
// or a manual add) are skipped, not duplicated.
import { getSupabase, getBrandId, jsonResponse, errorResponse } from "./_lib/supabase.js";
import { nextCode } from "./_lib/codes.js";

const ID_HOLIDAY_ICS_URL = "https://calendar.google.com/calendar/ical/id.indonesian%23holiday%40group.v.calendar.google.com/public/basic.ics";

// Minimal ad-hoc parser for what this one feed actually contains (single-
// line DTSTART;VALUE=DATE:YYYYMMDD + SUMMARY per VEVENT) - not a general
// RFC5545 parser (no line-unfolding, no recurrence rules), which this feed
// never uses since every entry is already a plain one-off all-day event.
function parseIcsHolidays(icsText, year) {
  const text = icsText.replace(/\r\n/g, "\n");
  const blocks = text.split("BEGIN:VEVENT").slice(1);
  const yearStr = String(year);
  const byDate = {};

  for (const block of blocks) {
    const end = block.indexOf("END:VEVENT");
    const body = end === -1 ? block : block.slice(0, end);
    const dateMatch = body.match(/DTSTART[^:\n]*:(\d{8})/);
    const summaryMatch = body.match(/SUMMARY:(.+)/);
    if (!dateMatch || !summaryMatch) continue;

    const raw = dateMatch[1];
    if (raw.slice(0, 4) !== yearStr) continue;
    const date = raw.slice(0, 4) + "-" + raw.slice(4, 6) + "-" + raw.slice(6, 8);
    const name = summaryMatch[1].trim();

    // Two events can legitimately land on the same date (e.g. a religious
    // holiday + its own Cuti Bersama) - merge into one closure reason
    // rather than letting the second insert fail against the first.
    if (byDate[date]) byDate[date].name += " / " + name;
    else byDate[date] = { date: date, name: name };
  }

  return Object.values(byDate);
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const year = Number(body.year);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) return jsonResponse({ error: "Invalid year" }, 400);

    const res = await fetch(ID_HOLIDAY_ICS_URL);
    if (!res.ok) throw new Error("Couldn't fetch the calendar (status " + res.status + ")");
    const holidays = parseIcsHolidays(await res.text(), year);
    if (!holidays.length) return jsonResponse({ imported: 0, skipped: 0, total: 0 });

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
        reason: h.name
      });
      if (error) throw error;
      imported++;
    }

    return jsonResponse({ imported: imported, skipped: holidays.length - imported, total: holidays.length });
  } catch (err) {
    return errorResponse(err);
  }
}
