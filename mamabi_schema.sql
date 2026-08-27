-- ============================================================================
-- ⚠ STALE - this file is the INITIAL migration only (2026-08-20), applied to
-- Supabase as "mamabi_full_schema". 25 further migrations have been applied
-- directly against the live project since (never written back here) - as of
-- 2026-08-27 the live schema includes things this file knows nothing about:
-- opex_entries, the whole Sales module (sales_batches/sales_entries), the
-- Cashflow Category settings list, pnl_lines.closed_at, driver_payout_method,
-- selling_price/base_yield_qty columns, sku display_order/registry_order,
-- recipe_lines.line_order, RLS on opex_entries, orders.channel and
-- order_items.cost_snapshot_source (added then later dropped again unused),
-- and more - see the full list via the Supabase MCP tool's list_migrations,
-- or query information_schema.columns/pg_constraint/pg_views directly.
-- Do NOT treat this file as the current schema - it's a historical record of
-- day one only. No attempt was made to regenerate it in full here: a
-- manually-reconstructed dump risks being subtly wrong in a way that reads
-- as authoritative, which is worse than this file just being visibly old.
-- ============================================================================

-- ============================================================================
-- MaMaBi (MaluMaluBabi) — Full Schema Migration
-- From: Google Sheets (Apps Script) -> Postgres (Supabase)
-- ============================================================================
-- Mapping notes (sheet -> table):
--   01. SKU Registry          -> sku_items
--   02. Staff                 -> staff
--   03. Supplier               -> suppliers
--   04. Customer + Customer Summary -> customers (+ view customer_summary)
--   03. Orders (Online) Order Log -> orders, order_items
--   01. Inventory / Purchase Log      -> purchases, purchase_lines
--   01. Inventory / Batch Production  -> production_batches
--   01. Inventory / Prep+Consumption logs -> production_consumption
--   01. Inventory / Stock Opname      -> stock_opname
--   01. Inventory / Cost Update Log   -> auto-generated via trigger on purchase_lines
--         (Master Ingredient Pricing becomes a VIEW: current_unit_cost)
--   01. Inventory / Stock Ledger      -> VIEW stock_ledger (computed, no more #REF! errors)
--   01. Cashflow (Bank/Cash In-Out)   -> cashflow_transactions
--   02. Profit & Loss                 -> left as manual entry for now (accrual logic
--         is business-specific — recommend keeping as a monthly journal table,
--         see pnl_lines below, and revisit automation in phase 2)
--   Settings and Configuration        -> settings, settings_lists
-- ============================================================================

-- ---------- Extensions ----------
create extension if not exists "uuid-ossp";
create extension if not exists pgcrypto;

-- ---------- Brands (Fresca / Nagare later — inactive until launch) ----------
create table brands (
  id            uuid primary key default gen_random_uuid(),
  code          text unique not null,        -- e.g. 'MMB', 'FRESCA', 'NAGARE'
  name          text not null,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

insert into brands (code, name, is_active) values ('MMB', 'MaluMaluBabi', true);

-- ---------- Settings (Settings and Configuration sheet) ----------
create table settings (
  brand_id      uuid not null references brands(id),
  key           text not null,
  value         text not null,
  primary key (brand_id, key)
);

create table settings_lists (
  id            uuid primary key default gen_random_uuid(),
  brand_id      uuid not null references brands(id),
  list_name     text not null,   -- 'Payment Method', 'PnL Fixed Categories', 'Stockable Types', 'Staff Roles', etc.
  value         text not null
);

-- ---------- Staff (02. Staff) ----------
create table staff (
  id            uuid primary key default gen_random_uuid(),
  brand_id      uuid not null references brands(id),
  staff_code    text not null,     -- STF-0001
  name          text not null,
  roles         text[] not null default '{}',   -- Owner, Kitchen, Driver, Finance, Marketing
  contact       text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (brand_id, staff_code)
);

-- ---------- Suppliers (03. Supplier) ----------
create table suppliers (
  id            uuid primary key default gen_random_uuid(),
  brand_id      uuid not null references brands(id),
  supplier_code text not null,     -- SUP-0001
  name          text not null,
  contact       text,
  area          text,
  address       text,
  notes         text,
  created_at    timestamptz not null default now(),
  unique (brand_id, supplier_code)
);

-- ---------- Customers (04. Customer) ----------
create table customers (
  id            uuid primary key default gen_random_uuid(),
  brand_id      uuid not null references brands(id),
  customer_code text not null,     -- CUST-0001
  name          text not null,
  contact       text,
  area          text,
  address       text,
  notes         text,
  created_at    timestamptz not null default now(),
  unique (brand_id, customer_code)
);

-- ---------- SKU Registry (01. SKU Registry) ----------
create type item_type as enum (
  'Product', 'Component', 'Semi-Finished', 'Packaging', 'Operating', 'Ingredient', 'Other'
);

create table sku_items (
  id            uuid primary key default gen_random_uuid(),
  brand_id      uuid not null references brands(id),
  sku           text not null,          -- PR-NBMM-RICA, IN-FRSH-0001, etc.
  item_type     item_type not null,
  category      text,                    -- Nasi Babi Mamak, Protein, Fresh, Dry, ...
  name          text not null,
  unit          text not null,           -- g, pc, port., sheet, lot
  status        text not null default 'Active',   -- Active / Available / Inactive
  min_stock     numeric,
  created_at    timestamptz not null default now(),
  unique (brand_id, sku)
);

-- ---------- Recipes / BOM (implied by Prep/Batch logs — now explicit) ----------
-- Template: how much of each component/ingredient goes into one batch unit of a parent SKU.
-- This did not exist as a standalone sheet before; production logs recorded actuals only.
-- Having this as a real table lets you plan batches instead of reconstructing them by hand.
create table recipe_lines (
  id                uuid primary key default gen_random_uuid(),
  brand_id          uuid not null references brands(id),
  parent_sku_id     uuid not null references sku_items(id),   -- e.g. CM-PROT-RICA
  component_sku_id  uuid not null references sku_items(id),   -- e.g. IN-PROT-0004
  qty_per_batch_unit numeric not null,   -- quantity of component per 1 unit yield of parent
  unit              text not null,
  notes             text
);

-- ---------- Purchases (Purchase Log) ----------
create table purchases (
  id            uuid primary key default gen_random_uuid(),
  brand_id      uuid not null references brands(id),
  purchase_code text not null,        -- PO-0001
  purchase_date date not null,
  supplier_id   uuid references suppliers(id),
  method        text,                 -- QRIS, Cash, TF
  status        text not null default 'Paid',
  notes         text,
  created_at    timestamptz not null default now(),
  unique (brand_id, purchase_code)
);

create table purchase_lines (
  id            uuid primary key default gen_random_uuid(),
  purchase_id   uuid not null references purchases(id) on delete cascade,
  sku_id        uuid not null references sku_items(id),
  category      text,
  qty           numeric not null,
  unit          text not null,
  total_cost    numeric not null,
  unit_cost     numeric generated always as (case when qty <> 0 then round(total_cost / qty, 4) else 0 end) stored,
  notes         text
);

-- Auto-maintained current cost per SKU (replaces "Master Ingredient Pricing" manual tab)
create table sku_cost_history (
  id                uuid primary key default gen_random_uuid(),
  sku_id            uuid not null references sku_items(id),
  effective_date    date not null,
  supplier_id       uuid references suppliers(id),
  purchase_qty      numeric,
  unit              text,
  purchase_price    numeric,
  previous_unit_cost numeric,
  updated_unit_cost numeric not null,
  variance          numeric generated always as (updated_unit_cost - coalesce(previous_unit_cost, 0)) stored,
  variance_pct      numeric,
  remarks           text,
  created_at        timestamptz not null default now()
);

-- Trigger: every purchase_line insert logs a cost update automatically
create or replace function fn_log_cost_update() returns trigger as $$
declare
  v_prev numeric;
begin
  select updated_unit_cost into v_prev
  from sku_cost_history
  where sku_id = new.sku_id
  order by effective_date desc, created_at desc
  limit 1;

  insert into sku_cost_history (sku_id, effective_date, purchase_qty, unit, purchase_price, previous_unit_cost, updated_unit_cost, variance_pct, remarks)
  values (
    new.sku_id,
    (select purchase_date from purchases where id = new.purchase_id),
    new.qty, new.unit, new.total_cost, v_prev, new.unit_cost,
    case when v_prev is not null and v_prev <> 0 then round(((new.unit_cost - v_prev) / v_prev) * 100, 2) else null end,
    case when v_prev is null then 'Initial Cost' when new.unit_cost > v_prev then 'Increase' else 'Decrease' end
  );
  return new;
end;
$$ language plpgsql;

create trigger trg_log_cost_update
  after insert on purchase_lines
  for each row execute function fn_log_cost_update();

-- View: current unit cost per SKU (replaces Master Ingredient Pricing tab)
create view current_unit_cost as
select distinct on (sku_id)
  sku_id, effective_date, updated_unit_cost as unit_cost, purchase_qty, unit, supplier_id
from sku_cost_history
order by sku_id, effective_date desc, created_at desc;

-- ---------- Batch Production (Batch Production log) ----------
create table production_batches (
  id            uuid primary key default gen_random_uuid(),
  brand_id      uuid not null references brands(id),
  batch_code    text not null,         -- #0001
  batch_date    timestamptz not null,
  output_sku_id uuid not null references sku_items(id),
  category      text,
  batch_size    numeric,               -- e.g. 12 (portions)
  yield_qty     numeric,               -- e.g. 1200 (g)
  status        text not null default 'Ongoing',  -- Ongoing / Done
  notes         text,
  unique (brand_id, batch_code)
);

-- ---------- Production Consumption (Prep Log + ingredient consumption tables) ----------
create table production_consumption (
  id            uuid primary key default gen_random_uuid(),
  batch_id      uuid not null references production_batches(id) on delete cascade,
  sku_id        uuid not null references sku_items(id),
  qty           numeric not null,
  source        text default 'Batch Production',
  notes         text
);

-- ---------- Stock Opname (Stock Opname tab) ----------
create table stock_opname (
  id            uuid primary key default gen_random_uuid(),
  brand_id      uuid not null references brands(id),
  opname_code   text not null,       -- SO-0001
  opname_date   date not null,
  sku_id        uuid not null references sku_items(id),
  book_balance  numeric not null,
  physical_count numeric not null,
  variance      numeric generated always as (physical_count - book_balance) stored,
  variance_value numeric,
  notes         text,
  unique (brand_id, opname_code)
);

-- ---------- Orders (03. Orders Online / Order Log) ----------
create type order_status as enum ('Ongoing', 'Confirmed', 'Completed', 'Cancelled');
create type fulfillment_status as enum ('Pending', 'Delivered', 'Picked Up');
create type order_type as enum ('Delivery', 'Takeaway');
create type payment_status as enum ('Paid', 'Unpaid');

create table orders (
  id                uuid primary key default gen_random_uuid(),
  brand_id          uuid not null references brands(id),
  order_code        text not null,          -- ORD-0001
  order_date        date not null,
  delivery_date     date,
  customer_id       uuid references customers(id),
  order_type        order_type not null,
  order_status      order_status not null default 'Ongoing',
  fulfillment_status fulfillment_status not null default 'Pending',
  payment_status    payment_status not null default 'Unpaid',
  payment_method    text,
  delivery_fee      numeric default 0,
  driver_staff_id   uuid references staff(id),
  driver_name_raw   text,          -- covers external drivers e.g. GrabExpress not in staff table
  driver_payout     numeric,
  driver_payout_status text,
  channel           text,          -- GrabFood / GoFood / WhatsApp / DANA (from Settings > Manual Sales Platform)
  notes             text,
  created_at        timestamptz not null default now(),
  unique (brand_id, order_code)
);

create table order_items (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references orders(id) on delete cascade,
  sku_id        uuid not null references sku_items(id),
  qty           numeric not null,
  unit_price    numeric not null,
  line_total    numeric generated always as (qty * unit_price) stored
);

-- View: replaces the manual "Customer Summary" tab
create view customer_summary as
select
  c.id as customer_id,
  c.name,
  mode() within group (order by o.order_type) as preferred_order_type,
  count(distinct o.id) as total_orders,
  sum(oi.line_total) as lifetime_value,
  round(avg(order_totals.total), 2) as average_order_value,
  min(o.order_date) as first_order_date,
  max(o.order_date) as last_order_date,
  (current_date - max(o.order_date)) as days_since_last_order,
  case when (current_date - max(o.order_date)) <= (select value::int from settings s where s.key = 'Customer Active Days Threshold' and s.brand_id = c.brand_id)
       then 'Active' else 'Inactive' end as status
from customers c
join orders o on o.customer_id = c.id
join order_items oi on oi.order_id = o.id
join lateral (select sum(oi2.line_total) as total from order_items oi2 where oi2.order_id = o.id) order_totals on true
group by c.id, c.name;

-- ---------- Stock Ledger — fully computed, no manual entry, no #REF! ----------
-- Combines: purchases (in), production consumption (out), production yield (in),
-- confirmed sales via orders (out), and opname adjustments.
create view stock_ledger as
with movements as (
  select sku_id, purchase_date as move_date, qty as qty_in, 0 as qty_out, 'Purchase' as move_type
  from purchase_lines pl join purchases p on p.id = pl.purchase_id
  union all
  select sku_id, batch_date::date, 0, qty, 'Production Consumption'
  from production_consumption pc join production_batches pb on pb.id = pc.batch_id
  union all
  select output_sku_id, batch_date::date, coalesce(yield_qty,0), 0, 'Production Yield'
  from production_batches
  where status = 'Done'
  union all
  select oi.sku_id, o.order_date, 0, oi.qty, 'Sale'
  from order_items oi join orders o on o.id = oi.order_id
  where o.order_status = 'Completed'
)
select
  sku_id,
  move_date,
  move_type,
  qty_in,
  qty_out,
  sum(qty_in - qty_out) over (partition by sku_id order by move_date, move_type
      rows between unbounded preceding and current row) as running_balance
from movements
order by sku_id, move_date;

-- ---------- Cashflow (01. Cashflow: Bank / Cash in-out) ----------
create type cf_account as enum ('Bank', 'Cash');
create type cf_flow_group as enum ('Operating', 'Investing', 'Financing');

create table cashflow_transactions (
  id            uuid primary key default gen_random_uuid(),
  brand_id      uuid not null references brands(id),
  txn_code      text not null,          -- CF-000001
  txn_date      date not null,
  account       cf_account not null,
  flow_group    cf_flow_group not null,
  category      text not null,          -- Food Cost, Packaging, Sales Revenue, Capital Contribution, ...
  description   text,
  cash_in       numeric default 0,
  cash_out      numeric default 0,
  running_balance numeric,
  notes         text,
  unique (brand_id, txn_code)
);

-- ---------- P&L (kept as manual monthly journal — accrual allocation is judgment-based) ----------
-- Recommendation: keep manual for now (lump-sum allocation like gas across months needs a human call).
-- Revisit automation once cashflow_transactions + purchases history is deep enough to allocate reliably.
create table pnl_lines (
  id            uuid primary key default gen_random_uuid(),
  brand_id      uuid not null references brands(id),
  period_month  date not null,          -- first of month, e.g. 2026-07-01
  section       text not null,          -- Revenue / COGS / Fixed Cost / Variable Cost
  category      text not null,          -- Online, GrabFood, Food Cost, Packaging, Payroll, Rent, ...
  amount        numeric not null default 0,
  notes         text
);

-- ============================================================================
-- Indexes
-- ============================================================================
create index idx_purchase_lines_sku on purchase_lines(sku_id);
create index idx_order_items_sku on order_items(sku_id);
create index idx_orders_date on orders(order_date);
create index idx_cashflow_date on cashflow_transactions(txn_date);
create index idx_production_consumption_sku on production_consumption(sku_id);
create index idx_sku_cost_history_sku on sku_cost_history(sku_id, effective_date desc);

-- ============================================================================
-- Row Level Security — enabled on every table.
-- No policies are defined yet, which means NO ACCESS via anon/authenticated
-- keys until policies are added (default-deny). This is intentional: the web
-- app has no staff login yet, so for now use the `service_role` key
-- server-side (Apps Script / your backend) — it bypasses RLS by design.
-- Once staff auth exists (Chris/Rian/Aaron), add policies here, e.g.:
--   create policy "staff can read own brand orders" on orders
--     for select using (brand_id = (select brand_id from staff where auth_uid = auth.uid()));
-- ============================================================================
alter table brands enable row level security;
alter table settings enable row level security;
alter table settings_lists enable row level security;
alter table staff enable row level security;
alter table suppliers enable row level security;
alter table customers enable row level security;
alter table sku_items enable row level security;
alter table recipe_lines enable row level security;
alter table purchases enable row level security;
alter table purchase_lines enable row level security;
alter table sku_cost_history enable row level security;
alter table production_batches enable row level security;
alter table production_consumption enable row level security;
alter table stock_opname enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;
alter table cashflow_transactions enable row level security;
alter table pnl_lines enable row level security;
