-- Grand Hill Back Office — 0002 projects
-- Won jobs: the project itself, the subcontractors assigned to it, and every receipt and payment.
--
-- HOW TO RUN: Supabase dashboard > SQL Editor > paste this whole file > Run.
-- Run it once, after 0001_foundations.sql. Wrapped in a transaction: if anything fails nothing is applied.
--
-- ACCESS: staff (super_admin, admin) only, like clients and bids. Subcontractors see nothing here yet.

begin;

-- ---------------------------------------------------------------- types
create type public.project_status as enum ('scheduled', 'in_progress', 'completed', 'closed');
-- receipt: money in from the client · sub_payment: money out to an assigned sub · expense: any other cost (materials, own labour…)
create type public.movement_kind  as enum ('receipt', 'sub_payment', 'expense');

-- ---------------------------------------------------------------- tables
create table public.projects (
  id              uuid primary key default gen_random_uuid(),
  name            text not null check (length(trim(name)) > 0),
  client_id       uuid references public.clients (id) on delete set null,
  bid_id          uuid unique references public.bids (id) on delete set null,   -- at most one project per bid
  status          public.project_status not null default 'scheduled',
  location        text,
  start_date      date,
  end_date        date,
  contract_amount numeric(14, 2) check (contract_amount is null or contract_amount >= 0),  -- what the client pays
  budgeted_cost   numeric(14, 2) check (budgeted_cost is null or budgeted_cost >= 0),      -- estimated cost to deliver
  notes           text,
  created_by      uuid default auth.uid() references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (end_date is null or start_date is null or end_date >= start_date)
);

-- A subcontractor working on a project, for one trade, at an agreed amount.
create table public.project_subs (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references public.projects (id) on delete cascade,
  -- restrict: a sub with work on record can't be deleted from the directory (mark it inactive instead)
  subcontractor_id uuid not null references public.subcontractors (id) on delete restrict,
  trade            text,
  agreed_amount    numeric(14, 2) check (agreed_amount is null or agreed_amount >= 0),
  notes            text,
  created_at       timestamptz not null default now()
);

-- Every movement of money on a project.
create table public.project_movements (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.projects (id) on delete cascade,
  kind           public.movement_kind not null,
  -- restrict: an assignment with payments recorded can't be removed until those payments are
  project_sub_id uuid references public.project_subs (id) on delete restrict,
  amount         numeric(14, 2) not null check (amount > 0),
  occurred_on    date not null default current_date,
  reference      text,   -- check number, invoice, transfer id…
  notes          text,
  created_by     uuid default auth.uid() references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  -- a payment to a sub must say which assignment; receipts and expenses must not
  check ((kind = 'sub_payment') = (project_sub_id is not null))
);

create index on public.projects (status);
create index on public.projects (client_id);
create index on public.project_subs (project_id);
create index on public.project_subs (subcontractor_id);
create index on public.project_movements (project_id, occurred_on);
create index on public.project_movements (project_sub_id);

create trigger set_updated_at before update on public.projects for each row execute function public.set_updated_at();

-- A payment's assignment must belong to the same project.
create function public.check_movement_assignment()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.project_sub_id is not null and not exists (
    select 1 from public.project_subs ps where ps.id = new.project_sub_id and ps.project_id = new.project_id
  ) then
    raise exception 'La asignación no pertenece a este proyecto';
  end if;
  return new;
end;
$$;

create trigger check_movement_assignment
  before insert or update on public.project_movements
  for each row execute function public.check_movement_assignment();

-- ---------------------------------------------------------------- row level security
alter table public.projects          enable row level security;
alter table public.project_subs      enable row level security;
alter table public.project_movements enable row level security;

revoke all on public.projects, public.project_subs, public.project_movements from anon;

create policy projects_staff on public.projects for all to authenticated
  using (public.is_staff()) with check (public.is_staff());
create policy project_subs_staff on public.project_subs for all to authenticated
  using (public.is_staff()) with check (public.is_staff());
create policy project_movements_staff on public.project_movements for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

commit;
