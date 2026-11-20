-- Grand Hill Back Office — 0001 foundations
-- Roles, subcontractors, compliance documents, clients and bids, all protected by Row Level Security.
--
-- HOW TO RUN: Supabase dashboard > SQL Editor > paste this whole file > Run.
-- Run it once. It is wrapped in a transaction, so if anything fails nothing is applied.
--
-- ACCESS MODEL
--   super_admin  full access, including who has which role (Adrian)
--   admin        full access to business data, cannot change roles (Adiel)
--   subcontractor read-only access to their own company and documents (portal, built later)
--   no profile   no access at all. Creating an auth user alone grants nothing.

begin;

-- ---------------------------------------------------------------- types
create type public.app_role    as enum ('super_admin', 'admin', 'subcontractor');
create type public.sub_status  as enum ('prospect', 'prequalified', 'active', 'inactive');
create type public.doc_type    as enum ('coi', 'w9', 'license', 'agreement', 'other');
create type public.bid_status  as enum ('new', 'estimating', 'submitted', 'won', 'lost', 'declined');
create type public.client_type as enum ('general_contractor', 'developer', 'property_manager', 'direct_commercial', 'residential', 'other');

-- ---------------------------------------------------------------- shared trigger
create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------- tables
create table public.subcontractors (
  id           uuid primary key default gen_random_uuid(),
  company_name text not null check (length(trim(company_name)) > 0),
  legal_name   text,
  trades       text[] not null default '{}',
  contact_name text,
  email        text,
  phone        text,
  city         text,
  state        text not null default 'FL',
  status       public.sub_status not null default 'prospect',
  notes        text,
  created_by   uuid default auth.uid() references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table public.profiles (
  id               uuid primary key references auth.users (id) on delete cascade,
  email            text,
  full_name        text,
  role             public.app_role not null,
  subcontractor_id uuid references public.subcontractors (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- a subcontractor login must be tied to a company; staff logins must not be
  check ((role = 'subcontractor') = (subcontractor_id is not null))
);

create table public.subcontractor_documents (
  id               uuid primary key default gen_random_uuid(),
  subcontractor_id uuid not null references public.subcontractors (id) on delete cascade,
  doc_type         public.doc_type not null,
  file_path        text,                      -- object path inside the private 'sub-documents' bucket
  issued_on        date,
  expires_on       date,
  notes            text,
  uploaded_by      uuid default auth.uid() references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  check (expires_on is null or issued_on is null or expires_on >= issued_on)
);

create table public.clients (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (length(trim(name)) > 0),
  type         public.client_type not null default 'other',
  contact_name text,
  email        text,
  phone        text,
  notes        text,
  created_by   uuid default auth.uid() references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table public.bids (
  id              uuid primary key default gen_random_uuid(),
  title           text not null check (length(trim(title)) > 0),
  client_id       uuid references public.clients (id) on delete set null,
  status          public.bid_status not null default 'new',
  due_date        date,
  location        text,
  scope           text,
  estimated_value numeric(14, 2) check (estimated_value is null or estimated_value >= 0),
  our_price       numeric(14, 2) check (our_price is null or our_price >= 0),
  notes           text,
  created_by      uuid default auth.uid() references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index on public.subcontractors (status);
create index on public.subcontractor_documents (subcontractor_id, doc_type);
create index on public.subcontractor_documents (expires_on);
create index on public.bids (status, due_date);
create index on public.bids (client_id);
create index on public.profiles (subcontractor_id);

create trigger set_updated_at before update on public.subcontractors for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.profiles       for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.clients        for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.bids           for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- role helpers
-- SECURITY DEFINER so policies can read profiles without recursing into profiles' own policies.
create function public.current_app_role()
returns public.app_role
language sql stable security definer
set search_path = ''
as $$ select role from public.profiles where id = auth.uid() $$;

create function public.current_subcontractor_id()
returns uuid
language sql stable security definer
set search_path = ''
as $$ select subcontractor_id from public.profiles where id = auth.uid() $$;

create function public.is_staff()
returns boolean
language sql stable security definer
set search_path = ''
as $$ select coalesce(public.current_app_role() in ('super_admin', 'admin'), false) $$;

create function public.is_super_admin()
returns boolean
language sql stable security definer
set search_path = ''
as $$ select coalesce(public.current_app_role() = 'super_admin', false) $$;

revoke execute on function public.current_app_role()        from public, anon;
revoke execute on function public.current_subcontractor_id() from public, anon;
revoke execute on function public.is_staff()                 from public, anon;
revoke execute on function public.is_super_admin()           from public, anon;
grant  execute on function public.current_app_role()        to authenticated;
grant  execute on function public.current_subcontractor_id() to authenticated;
grant  execute on function public.is_staff()                 to authenticated;
grant  execute on function public.is_super_admin()           to authenticated;

-- Never allow the last super admin to be demoted or deleted (would lock everyone out of role management).
create function public.protect_last_super_admin()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if old.role = 'super_admin'
     and (tg_op = 'DELETE' or new.role <> 'super_admin')
     and not exists (select 1 from public.profiles where role = 'super_admin' and id <> old.id)
  then
    raise exception 'No se puede quitar al ultimo super admin';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger protect_last_super_admin
  before update or delete on public.profiles
  for each row execute function public.protect_last_super_admin();

-- ---------------------------------------------------------------- row level security
alter table public.profiles                enable row level security;
alter table public.subcontractors          enable row level security;
alter table public.subcontractor_documents enable row level security;
alter table public.clients                 enable row level security;
alter table public.bids                    enable row level security;

-- Supabase grants table access to anon by default; close that door explicitly.
revoke all on public.profiles, public.subcontractors, public.subcontractor_documents, public.clients, public.bids from anon;

-- profiles: everyone reads their own row, staff read all, only super admin writes
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_staff());
create policy profiles_insert on public.profiles for insert to authenticated
  with check (public.is_super_admin());
create policy profiles_update on public.profiles for update to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());
create policy profiles_delete on public.profiles for delete to authenticated
  using (public.is_super_admin());

-- subcontractors: staff full access; a subcontractor reads only their own company
create policy subcontractors_staff on public.subcontractors for all to authenticated
  using (public.is_staff()) with check (public.is_staff());
create policy subcontractors_own_read on public.subcontractors for select to authenticated
  using (id = public.current_subcontractor_id());

-- documents: staff full access; a subcontractor reads only their own documents
create policy sub_documents_staff on public.subcontractor_documents for all to authenticated
  using (public.is_staff()) with check (public.is_staff());
create policy sub_documents_own_read on public.subcontractor_documents for select to authenticated
  using (subcontractor_id = public.current_subcontractor_id());

-- clients and bids: staff only (subcontractors never see them)
create policy clients_staff on public.clients for all to authenticated
  using (public.is_staff()) with check (public.is_staff());
create policy bids_staff on public.bids for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- ---------------------------------------------------------------- compliance view
-- Respects the caller's RLS (security_invoker), so each role only sees what it may.
create view public.v_sub_documents_status
with (security_invoker = true) as
select
  d.id,
  d.subcontractor_id,
  s.company_name,
  d.doc_type,
  d.issued_on,
  d.expires_on,
  (d.expires_on - current_date) as days_left,
  case
    when d.expires_on is null                      then 'no_expiry'
    when d.expires_on < current_date               then 'expired'
    when d.expires_on <= current_date + 30         then 'expiring'
    else 'valid'
  end as validity
from public.subcontractor_documents d
join public.subcontractors s on s.id = d.subcontractor_id;

revoke all on public.v_sub_documents_status from anon;
grant select on public.v_sub_documents_status to authenticated;

-- ---------------------------------------------------------------- private file storage
insert into storage.buckets (id, name, public)
values ('sub-documents', 'sub-documents', false)
on conflict (id) do nothing;

create policy sub_documents_files_staff on storage.objects for all to authenticated
  using (bucket_id = 'sub-documents' and public.is_staff())
  with check (bucket_id = 'sub-documents' and public.is_staff());

-- ---------------------------------------------------------------- first super admin
-- Adrian. The auth user must already exist (Authentication > Users).
insert into public.profiles (id, email, full_name, role)
select id, email, 'Adrian Gerig', 'super_admin'
from auth.users
where lower(email) = 'adriangerig@gmail.com'
on conflict (id) do update set role = excluded.role, full_name = excluded.full_name;

-- Adiel (admin): create his login in Authentication > Users first, then run:
--   insert into public.profiles (id, email, full_name, role)
--   select id, email, 'Julio Adiel Canelo', 'admin' from auth.users where lower(email) = 'ADIEL_EMAIL_HERE';

commit;
