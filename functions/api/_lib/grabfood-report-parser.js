import { readXlsxSheets } from "./xlsx.js";

// GrabMerchant's "Reports" export (the GrabMerchant Financial Report /
// GMFR), Ringkasan (Summary) sheet - confirmed against a real sample (see
// chat history). Single-day files only for now, same reasoning as the
// Menu Sales CSV parser: a genuine multi-day sample hasn't been seen to
// verify how the Ringkasan sheet would represent more than one day (it may
// well just be one lump total for the whole range, not a per-day
// breakdown - guessing that structure risks silently wrong numbers, so
// this is left unsupported until there's a real sample to check against).
//
// Column meaning (read generically by header text, not by fixed column
// letter, in case Grab ever reorders columns):
//   Nilai pesanan      -> Report Gross (pre-discount order value)
//   Atribusi Layanan   -> Platform Fee (Grab's own split of "Biaya jasa"
//                         attributable to service)
//   Atribusi Promosi + Diskon (Dibiayai Merchant) +
//   Diskon Ongkos Kirim (Dibiayai Merchant) + Biaya sukses pemasaran
//                      -> Marketing Fee (everything promo/discount/ad-like)
// Every other GrabFood column (tax, packaging fee, shipping cost borne by
// merchant, adjustments, GrabExpress delivery fee, step-up commission,
// withholding tax) was 0 in the only real sample seen and isn't folded
// into either bucket - if one of them is ever non-zero, Platform/Marketing
// Fee here will legitimately fall short of "Jumlah bersih" (net) by that
// amount, which is visible (not silently wrong), not blocking.
const GROSS_HEADER = "Nilai pesanan";
const PLATFORM_FEE_HEADERS = ["Atribusi Layanan"];
const MARKETING_FEE_HEADERS = ["Atribusi Promosi", "Diskon (Dibiayai Merchant)", "Diskon Ongkos Kirim (Dibiayai Merchant)", "Biaya sukses pemasaran"];

function parseRupiahCell(v) {
  return Math.abs(Number(v) || 0);
}

function parseDateRange(text) {
  const m = (text || "").match(/(\d{2})\/(\d{2})\/(\d{4})\s*-\s*(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) throw new Error("Could not read the date range from the Reports file (\"Rentang Tanggal\")");
  const start = m[3] + "-" + m[2] + "-" + m[1];
  const end = m[6] + "-" + m[5] + "-" + m[4];
  return { start, end };
}

export async function parseGrabFoodReportXlsx(bytes) {
  const { Ringkasan: rows } = await readXlsxSheets(bytes, ["Ringkasan"]);

  const dateRangeRow = rows.find((r) => r && r.B === "Rentang Tanggal");
  if (!dateRangeRow) throw new Error("Could not find \"Rentang Tanggal\" in the Reports file - is this a GrabMerchant Reports export?");
  const { start, end } = parseDateRange(dateRangeRow.C);
  if (start !== end) throw new Error("This Reports file covers " + start + " to " + end + " - only a single day is supported per draft right now.");

  const sectionRowIndex = rows.findIndex((r) => r && r.B === "GrabFood");
  if (sectionRowIndex === -1) throw new Error("Could not find a \"GrabFood\" section in the Reports file");
  const headerRow = rows[sectionRowIndex + 1];
  const dataRow = rows[sectionRowIndex + 2];
  if (!headerRow || !dataRow) throw new Error("GrabFood section in the Reports file is missing its header/data rows");

  const colByHeader = {};
  Object.keys(headerRow).forEach((col) => { colByHeader[headerRow[col]] = col; });

  function sumHeaders(headers) {
    return headers.reduce((sum, h) => {
      const col = colByHeader[h];
      return sum + (col ? parseRupiahCell(dataRow[col]) : 0);
    }, 0);
  }

  const grossCol = colByHeader[GROSS_HEADER];
  if (!grossCol) throw new Error("Could not find the \"" + GROSS_HEADER + "\" column in the Reports file");

  return {
    date: start,
    platform: "GrabFood",
    reportGross: parseRupiahCell(dataRow[grossCol]),
    platformFee: sumHeaders(PLATFORM_FEE_HEADERS),
    marketingFee: sumHeaders(MARKETING_FEE_HEADERS)
  };
}
