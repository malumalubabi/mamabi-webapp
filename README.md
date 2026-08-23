# MaMaBi WebApp

Internal ops app for MaMaBi (MaluMaluBabi) — Dashboard, Orders, Inventory,
Cashflow. Replaces the old Apps Script app; same data (Google Sheets) now
lives in Supabase (see `mamabi_schema.sql`).

## Stack

Plain HTML/CSS/JS (no build step, no framework) + [Cloudflare Pages
Functions](https://developers.cloudflare.com/pages/functions/) as a thin API
layer that talks to Supabase with the `service_role` key. The browser never
sees that key — it only ever calls our own `/api/*` endpoints.

```
/                     <- static site, deployed as-is
  index.html          <- page shell (nav + #content)
  shared.css
  shared.js           <- combobox, pagination, save-status, format helpers
  pages/
    dashboard.js       (orders.js / inventory.js / cashflow.js still stubs)
/functions/api/       <- Cloudflare Pages Functions (service_role lives here)
  _lib/supabase.js    <- shared client + response helpers (the "_" prefix
                          means Cloudflare does NOT treat it as a route)
  dashboard.js
```

## One-time setup

1. **Supabase service_role key**: Supabase dashboard → this project → Project
   Settings → API → copy the `service_role` secret key. **Never** put it in
   a file that gets committed — it goes straight into Cloudflare's dashboard
   (production) or a local-only `.dev.vars` file (already gitignored).

2. **Local dev** (optional — needs Node.js; skip this if you're only ever
   editing on the tablet and testing on the live preview URL instead):
   ```
   npm install
   copy .dev.vars.example .dev.vars     (Windows)
   cp .dev.vars.example .dev.vars       (mac/Linux)
   ```
   Edit `.dev.vars`, paste the real `service_role` key in. Then:
   ```
   npm run dev
   ```
   Opens on `http://127.0.0.1:8788`.

3. **Deploy (Cloudflare Pages)**:
   - Push this folder to a GitHub repo.
   - Cloudflare dashboard → Workers & Pages → Create → Pages → Connect to
     GitHub → pick the repo.
   - Build settings: **Framework preset: None**, **Build command: (leave
     empty)**, **Build output directory: `/`**. There's nothing to build —
     Cloudflare just serves the static files and wires up `/functions/api/*`
     automatically.
   - Settings → Environment variables → add `SUPABASE_URL` and
     `SUPABASE_SERVICE_ROLE_KEY` for both Production and Preview.
   - Deploy. Every `git push` after this auto-deploys — no local build ever
     required, which is the point given you're often on a tablet.

## Manual backup

```
npm run backup
```

Dumps every table (customers, orders, sales, opex, everything) to
`backups/<timestamp>/*.json`, one file per table plus a `_manifest.json`
summary of row counts. Read-only - safe to run anytime, doesn't touch live
data. Needs the same `.dev.vars` as local dev (see setup above), so it only
works from a machine that has that file - not from Acode/tablet-only editing.

`backups/` is gitignored on purpose - a backup is a full data dump
(customer names/phone numbers included), so it stays local, never pushed to
GitHub. Copy the timestamped folder somewhere safe (cloud drive, external
disk) after running if you want it to survive this machine dying.

## Editing from Acode (Android)

Edit files directly, commit + push (Acode's git integration or Termux).
Cloudflare picks up the push and rebuilds — nothing to run on-device.

## Status

- [x] Dashboard — cash/bank balance, income/expense this month, low-stock
      alerts (`current_stock` view vs `sku_items.min_stock`), 5 most recent
      orders.
- [ ] Orders — new order form + ongoing/history list.
- [ ] Inventory — stock overview, purchase log, batch production, stock
      opname.
- [ ] Cashflow — transaction entry + ledger + Operating/Investing/Financing
      summary.

## Notes / known simplifications

- "This month" on the Dashboard uses the server's calendar month (UTC date),
  not `Asia/Makassar` — off by at most a few hours right at a month
  boundary. Not worth the complexity to fix unless it actually bites.
- Low-stock check only sees SKUs that have at least one stock movement
  (`current_stock` is built from `stock_ledger`, which is movement-based). A
  SKU with `min_stock` set but zero purchases/production ever recorded won't
  show up as "low" — there's no movement to compute a balance from yet.
