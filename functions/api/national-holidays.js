// Settings > Calendar - bulk-imports Indonesia's holiday calendar for one
// year into calendar_events - informational only (a description shown on
// HR > Attendance's Calendar + the "tanggal merah" red date-number), NOT
// an outlet_closures row - a public holiday existing doesn't mean THIS
// business is actually closed that day (plenty of F&B stays open, some
// busier, on a holiday). Outlet Closures stays reserved for genuine ad-hoc
// closure decisions (see outlet-closures.js), entered by hand, which do
// still block scheduling/show the gray "closed" background.
// Source is Google's public "Hari libur di Indonesia" calendar (iCal feed,
// no key needed) - covers the moveable religious holidays (Idul Fitri,
// Nyepi, Waisak, Isra Miraj, Maulid Nabi, Imlek) and Cuti Bersama days too,
// not just fixed-date ones (unlike the Nager.Date API tried first).
// Dates that already have an event (same date, from an earlier import) are
// skipped, not duplicated.
import { getSupabase, getBrandId, jsonResponse, errorResponse } from "./_lib/supabase.js";

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
    // holiday + its own Cuti Bersama) - merge into one event name rather
    // than letting the second insert fail against the first.
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
      .from("calendar_events")
      .select("event_date")
      .eq("brand_id", brandId);
    if (existErr) throw existErr;
    const existingDates = new Set(existing.map((r) => r.event_date));

    const toInsert = holidays
      .filter((h) => !existingDates.has(h.date))
      .map((h) => ({ brand_id: brandId, event_date: h.date, name: h.name }));

    if (toInsert.length) {
      const { error } = await supabase.from("calendar_events").insert(toInsert);
      if (error) throw error;
    }

    return jsonResponse({ imported: toInsert.length, skipped: holidays.length - toInsert.length, total: holidays.length });
  } catch (err) {
    return errorResponse(err);
  }
}
