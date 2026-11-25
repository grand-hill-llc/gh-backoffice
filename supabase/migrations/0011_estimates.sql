-- Grand Hill Back Office — 0011 estimates
--
-- HOW TO RUN: Supabase dashboard > SQL Editor > paste this whole file > Run. Once, after 0010.
-- Apply it BEFORE deploying the app version that uses it.
--
-- How a bid's price is built: the quotes received from subcontractors per trade, and the
-- estimate lines (cost + markup). Once a bid has lines, its estimated cost and price are the
-- sum of those lines, kept in sync by the database and no longer typed by hand.
-- Staff only: subcontractors don't see quotes or estimates here.

begin;

-- ---------------------------------------------------------------- quotes from subcontractors
create table public.sub_quotes (
  id               uuid primary key default gen_random_uuid(),
  bid_id           uuid not null references public.bids (id) on delete cascade,
  subcontractor_id uuid not null references public.subcontractors (id) on delete cascade,
  trade            text,
  amount           numeric(14, 2) not null check (amount >= 0),
  received_on      date not null default current_date,
  valid_until      date,
  reference        text,                 -- quote number, link to the PDF in Drive…
  notes            text,
  created_by       uuid default auth.uid() references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (valid_until is null or valid_until >= received_on)
);

create index on public.sub_quotes (bid_id);
create index on public.sub_quotes (subcontractor_id);
create trigger set_updated_at before update on public.sub_quotes for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- estimate lines
create table public.estimate_lines (
  id           uuid primary key default gen_random_uuid(),
  bid_id       uuid not null references public.bids (id) on delete cascade,
  position     int  not null default 0,
  trade        text,                                   -- internal grouping, e.g. "Pintura"
  description  text not null check (length(trim(description)) > 0),  -- what the client reads
  quantity     numeric(12, 2) not null default 1 check (quantity > 0),
  unit         text,                                   -- sq ft, unidad, global…
  unit_cost    numeric(14, 2) not null check (unit_cost >= 0),
  markup_pct   numeric(6, 2) not null default 20 check (markup_pct between 0 and 500),
  sub_quote_id uuid references public.sub_quotes (id) on delete set null,  -- where the cost came from
  -- Same formula as the app (src/lib/estimates.ts): cost rounded to cents, then the markup.
  cost_amount  numeric(14, 2) generated always as (round(quantity * unit_cost, 2)) stored,
  price_amount numeric(14, 2) generated always as (round(round(quantity * unit_cost, 2) * (1 + markup_pct / 100), 2)) stored,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index on public.estimate_lines (bid_id, position);
create trigger set_updated_at before update on public.estimate_lines for each row execute function public.set_updated_at();

-- A line's quote must belong to the same bid.
create function public.estimate_lines_check()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.bid_id := old.bid_id;
  end if;
  if new.sub_quote_id is not null and not exists (
    select 1 from public.sub_quotes q where q.id = new.sub_quote_id and q.bid_id = new.bid_id
  ) then
    raise exception 'La cotización no pertenece a este bid';
  end if;
  return new;
end;
$$;

create trigger estimate_lines_check before insert or update on public.estimate_lines
  for each row execute function public.estimate_lines_check();

-- ---------------------------------------------------------------- bid totals
-- The bid's estimated cost and price follow its lines.
create function public.estimate_sync_bid()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_bid uuid := coalesce(new.bid_id, old.bid_id);
begin
  if exists (select 1 from public.estimate_lines where bid_id = v_bid) then
    update public.bids b
       set estimated_value = s.cost, our_price = s.price
      from (select sum(cost_amount) as cost, sum(price_amount) as price
              from public.estimate_lines where bid_id = v_bid) s
     where b.id = v_bid;
  end if;
  return null;
end;
$$;

create trigger estimate_sync_bid after insert or update or delete on public.estimate_lines
  for each row execute function public.estimate_sync_bid();

-- While a bid has lines, its totals can't be typed by hand (only the sync above changes them).
create function public.bids_keep_estimate_totals()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if pg_trigger_depth() = 1 and exists (select 1 from public.estimate_lines where bid_id = new.id) then
    new.estimated_value := old.estimated_value;
    new.our_price := old.our_price;
  end if;
  return new;
end;
$$;

create trigger bids_keep_estimate_totals before update on public.bids
  for each row execute function public.bids_keep_estimate_totals();

-- ---------------------------------------------------------------- settings
alter table public.app_settings
  add column default_markup_pct numeric(6, 2) not null default 20 check (default_markup_pct between 0 and 500);
grant update (default_markup_pct) on public.app_settings to authenticated;

-- ---------------------------------------------------------------- access
alter table public.sub_quotes     enable row level security;
alter table public.estimate_lines enable row level security;
revoke all on public.sub_quotes, public.estimate_lines from anon;

create policy sub_quotes_staff on public.sub_quotes for all to authenticated
  using (public.is_staff()) with check (public.is_staff());
create policy estimate_lines_staff on public.estimate_lines for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

commit;
