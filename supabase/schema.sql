-- Luxe Perfume — account tables.
-- Run once in the Supabase dashboard: SQL Editor → New query → paste → Run.
-- Safe to re-run: every statement is idempotent.

-- ── PROFILES: name + taste preferences ─────────────────────────────
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  name        text not null default '',
  preferences jsonb,                       -- { scents:[], brands:[], genders:[], bodyCare:bool }
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "Profiles: read own" on public.profiles;
create policy "Profiles: read own" on public.profiles
  for select to authenticated using ((select auth.uid()) = id);

drop policy if exists "Profiles: create own" on public.profiles;
create policy "Profiles: create own" on public.profiles
  for insert to authenticated with check ((select auth.uid()) = id);

drop policy if exists "Profiles: update own" on public.profiles;
create policy "Profiles: update own" on public.profiles
  for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

-- Create the profile row automatically when someone signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── WISHLIST: liked product ids ────────────────────────────────────
create table if not exists public.wishlist_items (
  user_id    uuid not null references auth.users (id) on delete cascade,
  product_id integer not null,
  created_at timestamptz not null default now(),
  primary key (user_id, product_id)
);

alter table public.wishlist_items enable row level security;

drop policy if exists "Wishlist: read own" on public.wishlist_items;
create policy "Wishlist: read own" on public.wishlist_items
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "Wishlist: add own" on public.wishlist_items;
create policy "Wishlist: add own" on public.wishlist_items
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "Wishlist: remove own" on public.wishlist_items;
create policy "Wishlist: remove own" on public.wishlist_items
  for delete to authenticated using ((select auth.uid()) = user_id);

-- ── ORDERS: pickup order history ───────────────────────────────────
-- Customers can only READ their own orders. Rows are written by the
-- Cloudflare Worker with the secret key, so order history can't be forged
-- from the browser.
create table if not exists public.orders (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  reference    text not null unique,          -- e.g. LP-20261002-AB12CD34
  email        text not null,
  pickup_store text not null,
  pickup_date  text not null,
  pickup_time  text not null,
  items        jsonb not null,                -- [{ id, name, brand, price, qty }]
  item_count   integer not null,
  total        numeric(10, 2) not null,
  status       text not null default 'placed'
               check (status in ('placed', 'paid', 'cancelled', 'refunded')),
  placed_at    timestamptz not null default now(),
  cancelled_at timestamptz
);

create index if not exists orders_user_placed_idx on public.orders (user_id, placed_at desc);

-- Online payment (Stripe). Paid orders are stored for guests too, so user_id
-- is optional; guest rows have no user_id and so are never readable by customers.
alter table public.orders alter column user_id drop not null;
alter table public.orders add column if not exists customer_name text;
alter table public.orders add column if not exists phone text;
alter table public.orders add column if not exists stripe_session_id text unique;
alter table public.orders add column if not exists stripe_payment_intent text;
alter table public.orders add column if not exists paid_at timestamptz;
alter table public.orders add column if not exists refunded_at timestamptz;
alter table public.orders add column if not exists notified_at timestamptz;  -- store email sent

-- Shipping orders (US and Puerto Rico), shipped by Luxe Fragrances. They have
-- no pickup date or time.
alter table public.orders alter column pickup_date drop not null;
alter table public.orders alter column pickup_time drop not null;
alter table public.orders add column if not exists fulfillment text not null default 'pickup';
alter table public.orders add column if not exists shipping_address jsonb;  -- { line1, line2, city, state, zip, country }
alter table public.orders add column if not exists shipping_cost numeric(10, 2) not null default 0;
alter table public.orders drop constraint if exists orders_fulfillment_check;
alter table public.orders add constraint orders_fulfillment_check check (fulfillment in ('pickup', 'shipping'));

-- Staff dashboard (staff.html): orders move on from paid to ready (pickup),
-- shipped (shipping) and collected (pickup), and record who changed them.
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check
  check (status in ('placed', 'paid', 'ready', 'shipped', 'collected', 'cancelled', 'refunded'));
alter table public.orders add column if not exists ready_at timestamptz;
alter table public.orders add column if not exists shipped_at timestamptz;
alter table public.orders add column if not exists collected_at timestamptz;
alter table public.orders add column if not exists tracking_carrier text;
alter table public.orders add column if not exists tracking_number text;
alter table public.orders add column if not exists updated_by uuid references auth.users (id) on delete set null;

create index if not exists orders_store_placed_idx on public.orders (pickup_store, placed_at desc);

alter table public.orders enable row level security;

drop policy if exists "Orders: read own" on public.orders;
create policy "Orders: read own" on public.orders
  for select to authenticated using ((select auth.uid()) = user_id);

-- ── STAFF: who can use the staff dashboard ─────────────────────────
-- Each staff member signs up on the site like a customer, then is added here
-- by hand (SQL Editor):
--   insert into public.staff (user_id, store, name)
--   select id, 'Perfume World', 'Jane' from auth.users where email = 'jane@example.com';
-- store is 'Luxe Fragrances', 'Perfume World', or 'all' (every store).
-- No policies: only the Worker (secret key) can read it, so nobody can make
-- themselves staff from the browser.
create table if not exists public.staff (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  store      text not null check (store in ('Luxe Fragrances', 'Perfume World', 'all')),
  name       text not null default '',
  created_at timestamptz not null default now()
);

alter table public.staff enable row level security;

-- ── API access ─────────────────────────────────────────────────────
-- Row-level security above still decides WHICH rows each person can touch.
grant usage on schema public to authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, delete on public.wishlist_items to authenticated;
grant select on public.orders to authenticated;
grant usage on schema public to service_role;
grant all on public.profiles, public.wishlist_items, public.orders, public.staff to service_role;
