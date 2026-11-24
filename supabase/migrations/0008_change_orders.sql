-- Grand Hill Back Office — 0008 change orders
--
-- HOW TO RUN: Supabase dashboard > SQL Editor > paste this whole file > Run. Once, after 0007.
-- Apply it BEFORE deploying the app version that uses it.
--
-- A change order adds to or takes away from a project's scope. It can change what the client pays
-- (contract_delta), the estimated cost (cost_delta) and, optionally, what one assigned subcontractor
-- is paid (sub_delta). The project's original amounts never change: the app adds the APPROVED
-- change orders on top. Pending and rejected ones are kept for the record but don't count.

begin;

create type public.change_order_status as enum ('pending', 'approved', 'rejected');

create table public.change_orders (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.projects (id) on delete cascade,
  number         int  not null,                      -- CO 1, 2, 3… per project, assigned automatically
  title          text not null check (length(trim(title)) > 0),
  description    text,
  status         public.change_order_status not null default 'pending',
  contract_delta numeric(14, 2) not null default 0,  -- + more for the client to pay, − credit
  cost_delta     numeric(14, 2) not null default 0,  -- + more cost to deliver, − savings
  -- restrict: an assignment with change orders can't be removed until those are
  project_sub_id uuid references public.project_subs (id) on delete restrict,
  sub_delta      numeric(14, 2),                     -- change to that sub's agreed amount
  requested_on   date not null default current_date,
  decided_on     date,                               -- when it was approved or rejected
  reference      text,                               -- client's PO, signed document…
  created_by     uuid default auth.uid() references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (project_id, number),
  check ((project_sub_id is null) = (sub_delta is null)),
  check (contract_delta <> 0 or cost_delta <> 0 or coalesce(sub_delta, 0) <> 0),
  check ((status = 'pending') = (decided_on is null))
);

create index on public.change_orders (project_id, status);
create index on public.change_orders (project_sub_id);

create trigger set_updated_at before update on public.change_orders
  for each row execute function public.set_updated_at();

-- Next number in its project, and the assignment (if any) must belong to the same project.
create function public.change_orders_prepare()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(hashtext('change_orders:' || new.project_id::text));
    select coalesce(max(number), 0) + 1 into new.number from public.change_orders where project_id = new.project_id;
  else
    new.number := old.number;
    new.project_id := old.project_id;
  end if;

  if new.project_sub_id is not null and not exists (
    select 1 from public.project_subs ps where ps.id = new.project_sub_id and ps.project_id = new.project_id
  ) then
    raise exception 'La asignación no pertenece a este proyecto';
  end if;
  return new;
end;
$$;

create trigger change_orders_prepare
  before insert or update on public.change_orders
  for each row execute function public.change_orders_prepare();

alter table public.change_orders enable row level security;
revoke all on public.change_orders from anon;

create policy change_orders_staff on public.change_orders for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- ---------------------------------------------------------------- portal
-- Same as in 0005, plus the subcontractor's approved changes: agreed_amount is now the current
-- amount, base_amount the original, and change_orders only what affects them (never contract or cost).
create or replace function public.portal_assignments()
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_sub uuid := public.portal_sub_id();
begin
  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', a.id,
        'project_name', p.name,
        'location', p.location,
        'status', p.status,
        'start_date', p.start_date,
        'end_date', p.end_date,
        'trade', a.trade,
        'base_amount', a.agreed_amount,
        'agreed_amount', case
          when a.agreed_amount is null and co.total is null then null
          else coalesce(a.agreed_amount, 0) + coalesce(co.total, 0)
        end,
        'change_orders', coalesce(co.list, '[]'::jsonb),
        'payments', coalesce((
          select jsonb_agg(
            jsonb_build_object('id', m.id, 'occurred_on', m.occurred_on, 'amount', m.amount, 'reference', m.reference)
            order by m.occurred_on desc, m.created_at desc
          )
          from public.project_movements m
          where m.project_sub_id = a.id and m.kind = 'sub_payment'
        ), '[]'::jsonb)
      )
      order by p.start_date desc nulls last, a.created_at desc
    )
    from public.project_subs a
    join public.projects p on p.id = a.project_id
    left join lateral (
      select
        sum(c.sub_delta) as total,
        jsonb_agg(
          jsonb_build_object('number', c.number, 'title', c.title, 'decided_on', c.decided_on, 'amount', c.sub_delta)
          order by c.number
        ) as list
      from public.change_orders c
      where c.project_sub_id = a.id and c.status = 'approved'
    ) co on true
    where a.subcontractor_id = v_sub
  ), '[]'::jsonb);
end;
$$;

commit;
