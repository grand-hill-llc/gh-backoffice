-- Grand Hill Back Office — 0010 file links
--
-- HOW TO RUN: Supabase dashboard > SQL Editor > paste this whole file > Run. Once, after 0009.
-- Apply it BEFORE deploying the app version that uses it.
--
-- Files for bids and projects (plans, contracts, photos, invoices, signed change orders) stay in
-- Google Drive or similar; the app only keeps a named link to them. Nothing is stored in Supabase
-- Storage, so this uses no storage quota. Staff only: subcontractors never see these links.

begin;

create table public.record_links (
  id         uuid primary key default gen_random_uuid(),
  bid_id     uuid references public.bids (id) on delete cascade,
  project_id uuid references public.projects (id) on delete cascade,
  label      text not null check (length(trim(label)) between 1 and 120),
  -- https only: blocks javascript: and other schemes that could run code when clicked
  url        text not null check (url ~* '^https://[^[:space:]]+$' and length(url) <= 2000),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  -- belongs to exactly one bid or one project
  check ((bid_id is null) <> (project_id is null))
);

create index on public.record_links (bid_id);
create index on public.record_links (project_id);

alter table public.record_links enable row level security;
revoke all on public.record_links from anon;

create policy record_links_staff on public.record_links for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

commit;
