-- Grand Hill Back Office — 0012 proposal settings
--
-- HOW TO RUN: Supabase dashboard > SQL Editor > paste this whole file > Run. Once, after 0011.
-- Apply it BEFORE deploying the app version that uses it.
--
-- What the client proposal shows, edited by super admins in Configuración: whether the
-- estimate lines appear (always with their selling price, never cost or markup), how long the
-- proposal is valid, the standard terms and Grand Hill's contact details.

begin;

alter table public.app_settings
  add column proposal_show_lines    boolean  not null default true,
  add column proposal_validity_days smallint not null default 30 check (proposal_validity_days between 1 and 365),
  add column proposal_terms         text check (proposal_terms is null or length(proposal_terms) <= 5000),
  add column company_address        text check (company_address is null or length(company_address) <= 300),
  add column company_phone          text check (company_phone is null or length(company_phone) <= 50),
  add column company_email          text check (company_email is null or length(company_email) <= 320),
  add column company_license        text check (company_license is null or length(company_license) <= 100);

grant update (proposal_show_lines, proposal_validity_days, proposal_terms,
              company_address, company_phone, company_email, company_license)
  on public.app_settings to authenticated;

commit;
