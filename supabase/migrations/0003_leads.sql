-- Grand Hill Back Office — 0003 leads
-- The CRM step before a bid: people interested in working with Grand Hill, who follows up, and what was said.
--
-- HOW TO RUN: Supabase dashboard > SQL Editor > paste this whole file > Run.
-- Run it once, after 0002_projects.sql. Wrapped in a transaction: if anything fails nothing is applied.
--
-- A lead lives until the opportunity is qualified; from there it becomes a client + bid (client_id / bid_id).
-- ACCESS: staff (super_admin, admin) only.

begin;

-- ---------------------------------------------------------------- types
create type public.lead_status   as enum ('new', 'contacted', 'qualified', 'converted', 'lost');
create type public.lead_source   as enum ('website', 'instagram', 'facebook', 'whatsapp', 'referral', 'other');
create type public.activity_kind as enum ('call', 'email', 'message', 'meeting', 'note');

-- ---------------------------------------------------------------- tables
create table public.leads (
  id             uuid primary key default gen_random_uuid(),
  name           text not null check (length(trim(name)) > 0),   -- the person
  company        text,
  email          text,
  phone          text,
  source         public.lead_source not null default 'other',
  status         public.lead_status not null default 'new',
  owner_id       uuid references public.profiles (id) on delete set null,  -- who follows up
  interest       text,          -- what they need: service, scope
  location       text,
  next_follow_up date,          -- when to contact them next
  lost_reason    text,
  notes          text,
  -- set when the lead is converted (next step of the CRM)
  client_id      uuid references public.clients (id) on delete set null,
  bid_id         uuid references public.bids (id) on delete set null,
  created_by     uuid default auth.uid() references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table public.lead_activities (
  id          uuid primary key default gen_random_uuid(),
  lead_id     uuid not null references public.leads (id) on delete cascade,
  kind        public.activity_kind not null,
  occurred_at timestamptz not null default now(),
  summary     text not null check (length(trim(summary)) > 0),
  created_by  uuid default auth.uid() references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);

create index on public.leads (status, next_follow_up);
create index on public.leads (owner_id);
create index on public.lead_activities (lead_id, occurred_at desc);

create trigger set_updated_at before update on public.leads for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- row level security
alter table public.leads           enable row level security;
alter table public.lead_activities enable row level security;

revoke all on public.leads, public.lead_activities from anon;

create policy leads_staff on public.leads for all to authenticated
  using (public.is_staff()) with check (public.is_staff());
create policy lead_activities_staff on public.lead_activities for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

commit;
