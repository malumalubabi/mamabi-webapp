import { parseCsvRecords } from "./csv.js";

// GoFood Merchant Dashboard's "Items" export - optional, attached later to
// an already-existing GoFood draft (see sales-import-drafts/[id]/attach-items.js).
// Unlike the daily report email, this file carries NO date column of its
// own - the covered range only lives in the filename itself
// ("Items_<Merchant>_<startYYYYMMDD>_<HH_MM_SS>__<endYYYYMMDD>_<HH_MM_SS>.csv"),
// confirmed against a real sample (see chat history). Single-day files
// only - a range spanning more than one day can't be attached to one
// draft (there'd be no way to know which items belong to which day).
const FILENAME_RE = /_(\d{8})_\d{2}_\d{2}_\d{2}__(\d{8})_\d{2}_\d{2}_\d{2}\.csv$/i;

function yyyymmddToIso(s) {
  return s.slice(0, 4) + "-" + s.slice(4, 6) + "-" + s.slice(6, 8);
}

export function parseGoFoodItemsFilename(filename) {
  const m = filename.match(FILENAME_RE);
  if (!m) throw new Error("Filename doesn't look like a GoFood Items export (expected Items_..._YYYYMMDD_HH_MM_SS__YYYYMMDD_HH_MM_SS.csv): " + filename);
  const start = yyyymmddToIso(m[1]);
  const end = yyyymmddToIso(m[2]);
  if (start !== end) throw new Error("This file covers " + start + " to " + end + " - only a single day can be attached to one draft.");
  return start;
}

export function parseGoFoodItemsCsv(csvText) {
  return parseCsvRecords(csvText).map((r) => ({
    label: r["Nama menu"] || "",
    qty: Number(r["Jumlah"]) || 0,
    sellingPrice: Number(r["Harga per item (IDR)"]) || 0
  })).filter((it) => it.label && it.qty > 0);
}
