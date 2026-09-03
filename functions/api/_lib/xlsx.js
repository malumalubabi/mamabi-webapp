// Minimal, dependency-free .xlsx (Office Open XML spreadsheet) reader -
// enough to pull specific named sheets out of a small report file, nothing
// more (no styles/formulas/number-formatting, no writing). Built by hand
// instead of adding a library (SheetJS etc. are large, and this only ever
// needs to read a handful of labeled cells out of one small report) - same
// reasoning as national-holidays.js's custom ad-hoc parseIcsHolidays().
//
// .xlsx is just a ZIP (entries stored with compression method 0=stored or
// 8=deflate) of XML files - readZipEntries below is a minimal central-
// directory reader, using the Workers-native DecompressionStream
// ("deflate-raw") for the actual inflate (no zlib/nodejs_compat needed).
// Verified end-to-end against a real GrabMerchant report file before
// shipping (see chat history) - Cloudflare Functions can't be exercised
// live from here, but every piece here is plain Web-standard API usage,
// testable the same way in plain Node.
function readUint32LE(buf, off) { return (buf[off] | (buf[off + 1] << 8) | (buf[off + 2] << 16) | (buf[off + 3] << 24)) >>> 0; }
function readUint16LE(buf, off) { return buf[off] | (buf[off + 1] << 8); }

async function readZipEntries(bytes, wantedNames) {
  const wanted = new Set(wantedNames);
  let eocdOffset = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65536); i--) {
    if (readUint32LE(bytes, i) === 0x06054b50) { eocdOffset = i; break; }
  }
  if (eocdOffset === -1) throw new Error("Not a valid .xlsx file (ZIP end-of-central-directory not found)");

  const cdOffset = readUint32LE(bytes, eocdOffset + 16);
  const cdEntryCount = readUint16LE(bytes, eocdOffset + 10);

  const results = new Map();
  let offset = cdOffset;
  for (let i = 0; i < cdEntryCount; i++) {
    if (readUint32LE(bytes, offset) !== 0x02014b50) throw new Error("Corrupt .xlsx file (bad ZIP central directory entry)");
    const compMethod = readUint16LE(bytes, offset + 10);
    const compSize = readUint32LE(bytes, offset + 20);
    const nameLen = readUint16LE(bytes, offset + 28);
    const extraLen = readUint16LE(bytes, offset + 30);
    const commentLen = readUint16LE(bytes, offset + 32);
    const localHeaderOffset = readUint32LE(bytes, offset + 42);
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLen));

    if (wanted.has(name)) {
      // Local file header's own filename/extra lengths can differ from the
      // central directory's - has to be read locally to find where the
      // actual entry data starts.
      const lfNameLen = readUint16LE(bytes, localHeaderOffset + 26);
      const lfExtraLen = readUint16LE(bytes, localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + lfNameLen + lfExtraLen;
      const compressedData = bytes.subarray(dataStart, dataStart + compSize);

      let data;
      if (compMethod === 0) data = compressedData;
      else if (compMethod === 8) {
        const stream = new Blob([compressedData]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
        data = new Uint8Array(await new Response(stream).arrayBuffer());
      } else throw new Error("Unsupported ZIP compression method in .xlsx: " + compMethod);

      results.set(name, data);
    }

    offset += 46 + nameLen + extraLen + commentLen;
  }
  return results;
}

function parseSharedStrings(xml) {
  const strings = [];
  // Must match self-closing <si/> (empty string) too, or every index after
  // one shifts down by one.
  const siRe = /<si\/>|<si>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = siRe.exec(xml))) {
    if (m[1] === undefined) { strings.push(""); continue; }
    const texts = [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]);
    strings.push(texts.join("").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'"));
  }
  return strings;
}

// Rows keyed by their 1-based row number (sparse array - gaps for blank
// rows), each a { [columnLetter]: cellText } map. Cell values only (no
// formulas/number-format handling beyond resolving shared-string refs) -
// exactly what a report parser needs to read labeled cells by column.
function parseSheet(xml, sharedStrings) {
  const rows = [];
  const rowRe = /<row[^>]*\br="(\d+)"[^>]*>([\s\S]*?)<\/row>/g;
  let rm;
  while ((rm = rowRe.exec(xml))) {
    const rowNum = Number(rm[1]);
    const rowXml = rm[2];
    const cellRe = /<c\b([^>]*)\/>|<c\b([^>]*)>([\s\S]*?)<\/c>/g;
    const cells = {};
    let cm;
    while ((cm = cellRe.exec(rowXml))) {
      const attrs = cm[1] !== undefined ? cm[1] : cm[2];
      const inner = cm[3] || "";
      const refMatch = attrs.match(/\br="([A-Z]+)\d+"/);
      if (!refMatch) continue;
      const col = refMatch[1];
      const typeMatch = attrs.match(/\bt="([^"]+)"/);
      const type = typeMatch ? typeMatch[1] : null;

      let val = null;
      const vMatch = inner.match(/<v>([\s\S]*?)<\/v>/);
      const isMatch = inner.match(/<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>[\s\S]*?<\/is>/);
      if (isMatch) val = isMatch[1];
      else if (vMatch) val = type === "s" ? sharedStrings[Number(vMatch[1])] : vMatch[1];
      cells[col] = val;
    }
    rows[rowNum] = cells;
  }
  return rows;
}

// High-level entry point: raw .xlsx bytes in, { [sheetName]: rows } out,
// for exactly the sheet names asked for - sheetN.xml's own numbering
// doesn't necessarily match display order or name (workbook.xml + its
// .rels is the indirection that resolves "Ringkasan" -> sheet2.xml, the
// same lookup Excel itself does), so a caller asks by the name it sees on
// the tab, not a file number that could silently point somewhere else on a
// differently-generated report.
export async function readXlsxSheets(bytes, wantedSheetNames) {
  const entries = await readZipEntries(bytes, ["xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/sharedStrings.xml"]);
  const dec = new TextDecoder("utf-8");

  const workbookXml = dec.decode(entries.get("xl/workbook.xml"));
  const relsXml = dec.decode(entries.get("xl/_rels/workbook.xml.rels"));
  const sharedStrings = entries.has("xl/sharedStrings.xml") ? parseSharedStrings(dec.decode(entries.get("xl/sharedStrings.xml"))) : [];

  const relTargetById = {};
  for (const m of relsXml.matchAll(/<Relationship\b([^>]*)>/g)) {
    const idMatch = m[1].match(/\bId="([^"]+)"/);
    const targetMatch = m[1].match(/\bTarget="([^"]+)"/);
    if (!idMatch || !targetMatch) continue;
    const target = targetMatch[1];
    relTargetById[idMatch[1]] = target.startsWith("/") ? target.slice(1) : "xl/" + target;
  }

  const wantedSheetPaths = {};
  for (const m of workbookXml.matchAll(/<sheet\b([^>]*)>/g)) {
    const nameMatch = m[1].match(/\bname="([^"]+)"/);
    const ridMatch = m[1].match(/\br:id="([^"]+)"/);
    if (!nameMatch || !ridMatch) continue;
    if (wantedSheetNames.includes(nameMatch[1]) && relTargetById[ridMatch[1]]) wantedSheetPaths[nameMatch[1]] = relTargetById[ridMatch[1]];
  }

  const missing = wantedSheetNames.filter((n) => !wantedSheetPaths[n]);
  if (missing.length) throw new Error("Sheet(s) not found in .xlsx: " + missing.join(", "));

  const sheetEntries = await readZipEntries(bytes, Object.values(wantedSheetPaths));
  const result = {};
  for (const name of wantedSheetNames) {
    result[name] = parseSheet(dec.decode(sheetEntries.get(wantedSheetPaths[name])), sharedStrings);
  }
  return result;
}
