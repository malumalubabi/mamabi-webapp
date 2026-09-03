// Parses GoFood Merchant's "Laporan Penjualan DD-MM-YYYY" daily email
// (sender merchant.no-reply@gojek.com) into what sales_import_drafts needs.
// Confirmed against a real sample sent for MaluMaluBabi (see chat history,
// 01-09-2026 report) - NOT verified against a live Gmail API fetch yet
// (this repo has no way to obtain that from here), so treat the first few
// real cron runs as needing a spot-check against the actual email.
//
// Body layout (after tag-stripping/whitespace-collapsing, see
// _lib/gmail.js's getGmailMessage): "Penjualan Rp159.000 ... Biaya
// transaksi -Rp46.735 Biaya layanan GoFood Delivery -Rp30.005 Promo yang
// ditanggung mitra usaha -Rp16.730 Pendapatan bersih Rp112.265". The
// "Biaya transaksi" sub-items are read generically (whatever labels are
// present, not hardcoded to just those two) - the email's own glossary
// warns other deductions (GoModal, GoFood Merchant Plus, biaya iklan) can
// appear on other days. Bucketed per an explicit rule: a label mentioning
// "layanan" (GoFood's own per-transaction service fee) is Platform Fee,
// everything else (promo/diskon/iklan/voucher/program) is Marketing Fee -
// confirmed this doesn't misfile GoModal/Merchant Plus since MaluMaluBabi
// doesn't use either.
export function parseGoFoodReport({ subject, bodyText }) {
  const dateMatch = subject.match(/Laporan Penjualan\s+(\d{2})-(\d{2})-(\d{4})/i);
  if (!dateMatch) throw new Error("Could not find a date in subject: " + subject);
  const date = dateMatch[3] + "-" + dateMatch[2] + "-" + dateMatch[1];

  const grossMatch = bodyText.match(/\bPenjualan\s+Rp\s?([\d.,]+)/);
  if (!grossMatch) throw new Error("Could not find \"Penjualan\" (Gross) in report body");
  const reportGross = parseIndoRupiah(grossMatch[1]);

  const txStart = bodyText.search(/Biaya transaksi\s+-?Rp\s?[\d.,]+/);
  if (txStart === -1) throw new Error("Could not find \"Biaya transaksi\" section in report body");
  const headerMatch = bodyText.slice(txStart).match(/^Biaya transaksi\s+-?Rp\s?[\d.,]+\s*/);
  const afterHeader = txStart + headerMatch[0].length;
  const txEndIdx = bodyText.indexOf("Pendapatan bersih", afterHeader);
  const subItemsText = bodyText.slice(afterHeader, txEndIdx === -1 ? bodyText.length : txEndIdx);

  let platformFee = 0;
  let marketingFee = 0;
  const lineItemRe = /([A-Za-zÀ-ɏ][A-Za-zÀ-ɏ0-9 .]*?)\s+-Rp\s?([\d.,]+)/g;
  let m;
  while ((m = lineItemRe.exec(subItemsText))) {
    const label = m[1].trim();
    const amount = parseIndoRupiah(m[2]);
    if (/layanan/i.test(label)) platformFee += amount;
    else marketingFee += amount;
  }

  return { date: date, platform: "GoFood", reportGross: reportGross, platformFee: platformFee, marketingFee: marketingFee };
}

// "." is the thousands separator in these reports (id-ID convention), no
// decimals ever appear on a whole-rupiah GoFood report - strip both "." and
// any stray "," defensively.
function parseIndoRupiah(str) {
  return Number(str.replace(/[.,]/g, "")) || 0;
}
