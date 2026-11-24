-- Grand Hill Back Office — 0007 settings
--
-- HOW TO RUN: Supabase dashboard > SQL Editor > paste this whole file > Run. Once, after 0006.
-- Apply it BEFORE deploying the app version with the Settings page.
--
-- One row with the settings super admins change from the app (Configuración):
-- who gets website leads, and how email alerts behave. It starts with today's behavior,
-- so applying it changes nothing until someone edits it.

begin;

create table public.app_settings (
  id                  boolean primary key default true check (id),  -- only one row
  website_lead_owner  uuid references public.profiles (id) on delete set null,
  digest_enabled      boolean  not null default true,
  digest_hour         smallint not null default 8 check (digest_hour between 6 and 11),
  digest_muted        uuid[]   not null default '{}',   -- staff who don't get the daily digest
  expiry_days         smallint[] not null default '{30,15,7}'
                        check (cardinality(expiry_days) between 1 and 6 and 1 <= all (expiry_days) and 120 >= all (expiry_days)),
  subs_alerts_enabled boolean  not null default true,
  updated_by          uuid references auth.users (id) on delete set null,
  updated_at          timestamptz not null default now()
);

create function public.app_settings_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.id := true;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

create trigger app_settings_touch before update on public.app_settings
  for each row execute function public.app_settings_touch();

-- Today's behavior: website leads go to Adrian, subcontractor alerts are on.
insert into public.app_settings (website_lead_owner)
select (
  select id from public.profiles
   where lower(email) = 'adriangerig@gmail.com' and role in ('super_admin', 'admin')
   limit 1
);

alter table public.app_settings enable row level security;
revoke all on public.app_settings from anon, authenticated;
grant select on public.app_settings to authenticated;
grant update (website_lead_owner, digest_enabled, digest_hour, digest_muted, expiry_days, subs_alerts_enabled)
  on public.app_settings to authenticated;

create policy app_settings_staff_read on public.app_settings for select to authenticated
  using (public.is_staff());
create policy app_settings_super_admin_update on public.app_settings for update to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

commit;
