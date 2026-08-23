// Manual backup - dumps every table below to timestamped JSON files under
// backups/<timestamp>/, one file per table plus a _manifest.json summary.
// Run with `npm run backup`. Read-only (SELECT * per table), safe to run
// anytime, doesn't touch the live data. Uses the same service_role key as
// local dev (.dev.vars) - never commit that file OR the backups/ folder
// itself (both gitignored - a backup is a full data dump, including
// customer names/phone numbers, so it stays local-only by design).
//
// .mjs (not .js) so this runs as an ES module via plain `node` regardless of
// the root package.json's module type - keeps this independent from
// whatever Wrangler/Cloudflare Functions needs there.
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");

// Every table in the schema. Order here is just the order they're dumped/
// logged in - no FK-ordering concerns since this is read-only.
const TABLES = [
  "brands", "staff", "suppliers", "customers", "sku_items",
  "purchases", "purchase_lines", "sku_cost_history",
  "production_batches", "production_consumption", "stock_opname",
  "orders", "order_items", "sales_batches", "sales_entries",
  "cashflow_transactions", "opex_entries", "pnl_lines",
  "settings", "settings_lists"
];

const PAGE_SIZE = 1000; // Supabase's default row cap per request - paginate past it so this stays correct as tables grow.

function loadDevVars() {
  const path = join(rootDir, ".dev.vars");
  if (!existsSync(path)) return {};
  const vars = {};
  readFileSync(path, "utf8").split("\n").forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const eq = trimmed.indexOf("=");
    if (eq === -1) return;
    vars[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  });
  return vars;
}

async function fetchAllRows(supabase, table) {
  let rows = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase.from(table).select("*").range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(table + ": " + error.message);
    rows = rows.concat(data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
}

async function main() {
  const devVars = loadDevVars();
  const supabaseUrl = process.env.SUPABASE_URL || devVars.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || devVars.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY - checked .dev.vars and the environment. Copy .dev.vars.example to .dev.vars and fill in your Supabase keys first.");
  }

  const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

  const now = new Date();
  const stamp = now.toISOString().replace(/:/g, "-").split(".")[0].replace("T", "_");
  const outDir = join(rootDir, "backups", stamp);
  mkdirSync(outDir, { recursive: true });

  console.log("Backing up to backups/" + stamp + "/ ...\n");

  const manifestTables = [];
  for (const table of TABLES) {
    const rows = await fetchAllRows(supabase, table);
    writeFileSync(join(outDir, table + ".json"), JSON.stringify(rows, null, 2));
    manifestTables.push({ table: table, rows: rows.length });
    console.log("  " + table.padEnd(24) + rows.length + " rows");
  }

  writeFileSync(
    join(outDir, "_manifest.json"),
    JSON.stringify({ backedUpAt: now.toISOString(), tables: manifestTables }, null, 2)
  );

  console.log("\nDone: backups/" + stamp + "/ (" + manifestTables.length + " tables)");
}

main().catch((err) => {
  console.error("Backup failed:", err.message);
  process.exit(1);
});
