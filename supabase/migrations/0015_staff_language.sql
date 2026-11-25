-- Grand Hill Back Office — 0015 staff language
--
-- HOW TO RUN: Supabase dashboard > SQL Editor > paste this whole file > Run. Once, after 0014.
-- Then redeploy email-alerts and website-lead (both also work before it: they default to Spanish).
--
-- Language of what the system writes for the team: the daily digest, the proposal answer emails and
-- the note a website request leaves in the lead's history. Emails to subcontractors stay bilingual.
-- Each person still picks the app's language for themselves in their menu.

begin;

alter table public.app_settings
  add column staff_lang text not null default 'es' check (staff_lang in ('es', 'en'));

grant update (staff_lang) on public.app_settings to authenticated;

commit;
