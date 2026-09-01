// One-off script (run manually via `node scripts/generate-icons.js`, not
// part of the build) that derives every PWA/favicon icon size from the
// source logo(s) under assets/. Not an ongoing pipeline dependency - just
// how the PNGs under assets/icons/ were produced, kept around for whenever
// the logo changes again.
//
// Three source variants, each gets its own full icon set:
// - "Logo B.png"      -> assets/icons/        (primary - wired into
//                         manifest.json/index.html right now)
// - "Logo B nobg.png"  -> assets/icons/nobg/    (transparent background)
// - "Logo C.png"       -> assets/icons/text/    (MAMASI wordmark)
// nobg/text sets are generated for the user to compare/choose from, not
// auto-wired anywhere - manifest.json still points at the primary set.
const sharp = require("sharp");
const path = require("path");
const fs = require("fs");

const ASSETS = path.join(__dirname, "..", "assets");
const SOURCES = [
  { file: "Logo B.png", outDir: path.join(ASSETS, "icons") },
  { file: "Logo B nobg.png", outDir: path.join(ASSETS, "icons", "nobg") },
  { file: "Logo C.png", outDir: path.join(ASSETS, "icons", "text") }
];

// Non-square sources (Logo B nobg is 367x301) get letterboxed onto a
// transparent square canvas first, sized to the larger dimension, so every
// output size is a true square icon instead of a stretched/cropped one.
async function squareBuffer(srcPath) {
  const meta = await sharp(srcPath).metadata();
  if (meta.width === meta.height) return sharp(srcPath).toBuffer();
  const side = Math.max(meta.width, meta.height);
  return sharp(srcPath)
    .resize(side, side, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer();
}

// Rounded-rect corner radius as a fraction of icon size - ~20% lands close
// to the common "app icon" rounded-square look (iOS's own squircle mask is
// closer to 22%, Android's default rounded-icon shape closer to 16-20%).
const ROUNDED_CORNER_FRACTION = 0.2;

// Only for icon-*/apple-touch-icon/favicon-* - NOT maskable-* (a maskable
// icon exists so the OS can apply its OWN shape mask over the full safe
// zone; pre-rounding it here would double-clip and fight that, not help
// it), and NOT skipped just because iOS re-masks apple-touch-icon anyway -
// desktop PWA install prompts and some Android launchers use icon-192/512
// as-is with no automatic rounding, so the shape has to be baked in here.
async function icon(squared, size, outPath, rounded) {
  let img = sharp(squared).resize(size, size);
  if (rounded) {
    const r = Math.round(size * ROUNDED_CORNER_FRACTION);
    const mask = Buffer.from('<svg width="' + size + '" height="' + size + '"><rect width="' + size + '" height="' + size + '" rx="' + r + '" ry="' + r + '"/></svg>');
    img = img.composite([{ input: mask, blend: "dest-in" }]);
  }
  await img.png().toFile(outPath);
}

async function generateSet(srcFile, outDir) {
  const srcPath = path.join(ASSETS, srcFile);
  if (!fs.existsSync(srcPath)) { console.log("Skipping (not found):", srcFile); return; }
  fs.mkdirSync(outDir, { recursive: true });

  const squared = await squareBuffer(srcPath);
  await icon(squared, 192, path.join(outDir, "icon-192.png"), true);
  await icon(squared, 512, path.join(outDir, "icon-512.png"), true);
  await icon(squared, 180, path.join(outDir, "apple-touch-icon.png"), true);
  await icon(squared, 32, path.join(outDir, "favicon-32.png"), true);
  await icon(squared, 16, path.join(outDir, "favicon-16.png"), true);
  await icon(squared, 192, path.join(outDir, "maskable-192.png"), false);
  await icon(squared, 512, path.join(outDir, "maskable-512.png"), false);
  console.log("Wrote icon set:", outDir);
}

async function main() {
  for (const { file, outDir } of SOURCES) {
    await generateSet(file, outDir);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
