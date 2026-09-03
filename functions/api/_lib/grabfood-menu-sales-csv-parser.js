import { parseCsvRecords } from "./csv.js";

// GrabMerchant's "Menu Sales" export - per-item totals for a date range,
// one row per (date, item). Single-day files only for now (see chat
// history - a genuine multi-day sample hasn't been seen yet to verify how
// a real multi-day export groups, so this only trusts what's proven:
// every row sharing one date). Confirmed against a real sample: "Date,
// Country, City, Merchant, Grab Service, Item, Units Sold, Item Gross
// Sales (Rp)", DD/MM/YYYY.
function ddmmyyyyToIso(s) {
  const [d, m, y] = s.split("/");
  return y + "-" + m.padStart(2, "0") + "-" + d.padStart(2, "0");
}

export function parseGrabFoodMenuSalesCsv(csvText) {
  const records = parseCsvRecords(csvText).filter((r) => r["Item"]);
  if (!records.length) throw new Error("No item rows found in Menu Sales file");

  const dates = new Set(records.map((r) => ddmmyyyyToIso(r["Date"])));
  if (dates.size > 1) throw new Error("This file covers more than one date (" + Array.from(dates).sort().join(", ") + ") - only a single day is supported per draft right now.");
  const date = Array.from(dates)[0];

  const items = records.map((r) => {
    const qty = Number(r["Units Sold"]) || 0;
    const grossSales = Number(r["Item Gross Sales (Rp)"]) || 0;
    return { label: r["Item"], qty: qty, sellingPrice: qty > 0 ? Math.round((grossSales / qty) * 100) / 100 : 0 };
  }).filter((it) => it.label && it.qty > 0);

  return { date: date, items: items };
}
