// Standard base64 (not base64url - this is what a browser's
// FileReader-then-btoa client side produces) decoded to raw bytes - what a
// binary upload (.xlsx) needs; decodeBase64Text below is the same decode
// plus a UTF-8 text interpretation, for a text upload (.csv).
export function decodeBase64Bytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function decodeBase64Text(b64) {
  return new TextDecoder("utf-8").decode(decodeBase64Bytes(b64));
}

// Minimal CSV parser - handles quoted fields (with embedded commas/escaped
// quotes) since a product name could plausibly contain a comma, but no
// exotic dialect support (always comma-delimited, no custom quote chars) -
// every report this app reads is a plain comma-separated export.
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  // Normalize line endings up front so \r\n / \r / \n all behave the same
  // inside the state machine below.
  const s = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }

  // Drop trailing fully-empty rows (a common trailing-blank-line artifact
  // in exported CSVs, e.g. the sample GoFood Items export ends with one).
  while (rows.length && rows[rows.length - 1].every((f) => f.trim() === "")) rows.pop();

  return rows;
}

// Rows as objects keyed by the first row's header text - what every
// platform-specific parser in this app actually wants (never raw arrays).
export function parseCsvRecords(text) {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((row) => {
    const rec = {};
    headers.forEach((h, i) => { rec[h] = row[i] !== undefined ? row[i].trim() : ""; });
    return rec;
  });
}
