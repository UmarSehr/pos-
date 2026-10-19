-- =====================================================================
--  AI POS  -  Supabase / PostgreSQL schema
--  Run this whole file once in:  Supabase Dashboard -> SQL Editor -> New query
--  It is safe to re-run (uses IF NOT EXISTS / CREATE OR REPLACE).
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1. STORE SETTINGS  (single row, id = 1)
-- ---------------------------------------------------------------------
create table if not exists public.settings (
  id             integer primary key default 1 check (id = 1),
  store_name     text not null default 'My Store',
  store_address  text default '',
  store_phone    text default '',
  tax_rate       numeric(5,2) not null default 18 check (tax_rate >= 0 and tax_rate <= 100),
  currency       text not null default 'PKR',
  receipt_footer text default 'Thank you for shopping with us!'
);
insert into public.settings (id) values (1) on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- 2. PRODUCTS (inventory)
-- ---------------------------------------------------------------------
create table if not exists public.products (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  category       text not null default 'General',
  sku            text not null unique,
  barcode        text unique,                      -- optional; NULL allowed many times
  purchase_price numeric(12,2) not null default 0 check (purchase_price >= 0),
  selling_price  numeric(12,2) not null default 0 check (selling_price  >= 0),
  quantity       integer       not null default 0 check (quantity >= 0),
  supplier       text default '',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists products_name_idx     on public.products (lower(name));
create index if not exists products_category_idx on public.products (category);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists products_touch on public.products;
create trigger products_touch before update on public.products
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- 3. CUSTOMERS
-- ---------------------------------------------------------------------
create table if not exists public.customers (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  phone      text unique,                          -- optional; NULL allowed many times
  created_at timestamptz not null default now()
);
create index if not exists customers_name_idx on public.customers (lower(name));

-- ---------------------------------------------------------------------
-- 4. SALES + SALE ITEMS
-- ---------------------------------------------------------------------
create sequence if not exists public.invoice_seq start 1001;

create table if not exists public.sales (
  id             uuid primary key default gen_random_uuid(),
  invoice_no     bigint not null unique default nextval('public.invoice_seq'),
  customer_id    uuid references public.customers(id) on delete set null,
  customer_name  text not null default 'Walk-in',
  customer_phone text,
  subtotal       numeric(14,2) not null default 0,   -- before discounts, before tax
  discount_total numeric(14,2) not null default 0,
  tax_rate       numeric(5,2)  not null default 0,   -- rate applied at time of sale
  tax_amount     numeric(14,2) not null default 0,
  total          numeric(14,2) not null default 0,   -- subtotal - discount + tax
  payment_method text not null default 'cash',
  created_by     uuid default auth.uid(),
  created_at     timestamptz not null default now()
);
create index if not exists sales_created_idx  on public.sales (created_at);
create index if not exists sales_customer_idx on public.sales (customer_id);

create table if not exists public.sale_items (
  id               uuid primary key default gen_random_uuid(),
  sale_id          uuid not null references public.sales(id) on delete cascade,
  product_id       uuid references public.products(id) on delete set null,
  product_name     text not null,                    -- snapshot, survives product deletion
  category         text not null default 'General',  -- snapshot
  quantity         integer not null check (quantity > 0),
  unit_price       numeric(12,2) not null,
  discount_percent numeric(5,2)  not null default 0,
  line_total       numeric(14,2) not null,           -- after discount, before tax
  unit_cost        numeric(12,2) not null default 0, -- purchase price snapshot (for profit)
  created_at       timestamptz not null default now()
);
create index if not exists sale_items_sale_idx    on public.sale_items (sale_id);
create index if not exists sale_items_product_idx on public.sale_items (product_id);
create index if not exists sale_items_created_idx on public.sale_items (created_at);

-- ---------------------------------------------------------------------
-- 5. ATOMIC CHECKOUT:  complete_sale()
--    * locks the product rows, checks stock, deducts stock
--    * upserts the customer (by phone, or by name when no phone)
--    * inserts the sale + items with server-calculated totals
--    * everything happens in ONE transaction - it either fully succeeds or rolls back
--    Runs as the calling user, so Row Level Security still applies.
-- ---------------------------------------------------------------------
create or replace function public.complete_sale(
  p_customer_name  text,
  p_customer_phone text,
  p_payment_method text,
  p_items          jsonb      -- [{product_id, quantity, unit_price, discount_percent}]
) returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_rate        numeric(5,2);
  v_name        text := nullif(trim(coalesce(p_customer_name,  '')), '');
  v_phone       text := nullif(trim(coalesce(p_customer_phone, '')), '');
  v_customer_id uuid;
  v_sale_id     uuid;
  v_item        jsonb;
  v_product     public.products%rowtype;
  v_qty         integer;
  v_price       numeric;
  v_disc        numeric;
  v_gross       numeric;
  v_line        numeric;
  v_subtotal    numeric := 0;
  v_discount    numeric := 0;
  v_tax         numeric;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Cart is empty';
  end if;

  select tax_rate into v_rate from public.settings where id = 1;
  v_rate := coalesce(v_rate, 0);

  -- ---- customer ----
  if v_phone is not null then
    insert into public.customers (name, phone)
    values (coalesce(v_name, 'Customer'), v_phone)
    on conflict (phone) do update set name = coalesce(v_name, public.customers.name)
    returning id into v_customer_id;
  elsif v_name is not null then
    select id into v_customer_id from public.customers
     where phone is null and lower(name) = lower(v_name) limit 1;
    if v_customer_id is null then
      insert into public.customers (name) values (v_name) returning id into v_customer_id;
    end if;
  end if;

  if v_customer_id is not null then
    select name into v_name from public.customers where id = v_customer_id;
  end if;

  -- ---- sale header (totals filled in after the items are processed) ----
  insert into public.sales (customer_id, customer_name, customer_phone, payment_method, tax_rate)
  values (v_customer_id, coalesce(v_name, 'Walk-in'), v_phone,
          coalesce(nullif(trim(p_payment_method), ''), 'cash'), v_rate)
  returning id into v_sale_id;

  -- ---- items ----
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_qty   := (v_item->>'quantity')::integer;
    v_price := (v_item->>'unit_price')::numeric;
    v_disc  := coalesce((v_item->>'discount_percent')::numeric, 0);

    if v_qty   is null or v_qty   <= 0 then raise exception 'Invalid quantity'; end if;
    if v_price is null or v_price <  0 then raise exception 'Invalid price';    end if;
    if v_disc < 0 or v_disc > 100      then raise exception 'Invalid discount'; end if;

    select * into v_product from public.products
     where id = (v_item->>'product_id')::uuid
     for update;                                   -- row lock: prevents overselling
    if not found then raise exception 'Product not found'; end if;

    if v_product.quantity < v_qty then
      raise exception 'Insufficient stock for "%": % left, % requested',
        v_product.name, v_product.quantity, v_qty;
    end if;

    update public.products set quantity = quantity - v_qty where id = v_product.id;

    v_gross    := round(v_qty * v_price, 2);
    v_line     := round(v_gross * (1 - v_disc / 100), 2);
    v_subtotal := v_subtotal + v_gross;
    v_discount := v_discount + (v_gross - v_line);

    insert into public.sale_items
      (sale_id, product_id, product_name, category, quantity,
       unit_price, discount_percent, line_total, unit_cost)
    values
      (v_sale_id, v_product.id, v_product.name, v_product.category, v_qty,
       v_price, v_disc, v_line, v_product.purchase_price);
  end loop;

  v_tax := round((v_subtotal - v_discount) * v_rate / 100, 2);

  update public.sales
     set subtotal       = v_subtotal,
         discount_total = v_discount,
         tax_amount     = v_tax,
         total          = v_subtotal - v_discount + v_tax
   where id = v_sale_id;

  return v_sale_id;
end $$;

-- ---------------------------------------------------------------------
-- 6. VIEWS used by the dashboards (security_invoker => RLS still applies)
-- ---------------------------------------------------------------------
create or replace view public.product_stock
with (security_invoker = true) as
select p.*, coalesce(s.sold, 0)::integer as sold_qty
from public.products p
left join (
  select product_id, sum(quantity) as sold
  from public.sale_items
  where product_id is not null
  group by product_id
) s on s.product_id = p.id;

create or replace view public.customer_stats
with (security_invoker = true) as
select c.id, c.name, c.phone, c.created_at,
       count(s.id)::integer                    as orders,
       coalesce(sum(s.total), 0)::numeric(14,2) as total_spent,
       max(s.created_at)                       as last_purchase
from public.customers c
left join public.sales s on s.customer_id = c.id
group by c.id;

-- ---------------------------------------------------------------------
-- 7. ROW LEVEL SECURITY
--    Single-store setup: any signed-in (authenticated) user can use the
--    app; anonymous visitors get nothing.
--    For multi-store / multi-tenant, add a store_id column and scope the
--    policies on it.
-- ---------------------------------------------------------------------
alter table public.settings   enable row level security;
alter table public.products   enable row level security;
alter table public.customers  enable row level security;
alter table public.sales      enable row level security;
alter table public.sale_items enable row level security;

do $$
declare t text;
begin
  foreach t in array array['settings','products','customers','sales','sale_items'] loop
    execute format('drop policy if exists "authenticated full access" on public.%I', t);
    execute format(
      'create policy "authenticated full access" on public.%I
         for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

grant usage, select on sequence public.invoice_seq to authenticated;
grant execute on function public.complete_sale(text, text, text, jsonb) to authenticated;
grant select on public.product_stock, public.customer_stats to authenticated;
