-- Grand Hill Back Office — 0006 email alerts
--
-- HOW TO RUN: Supabase dashboard > SQL Editor > paste this whole file > Run. Once, after 0005.
-- Safe to apply before everything else is ready: the schedule does nothing until the
-- 'email_alerts_secret' exists in Vault (see README, "Alertas por correo").
--
-- Every 15 minutes pg_cron calls the email-alerts Edge Function. The function decides what is due:
-- review results at any time; the staff digest and expiry reminders on weekday mornings in Florida.

begin;

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

-- ---------------------------------------------------------------- send log
-- One row per email. The unique key is what prevents sending the same alert twice.
create table public.email_log (
  id          uuid primary key default gen_random_uuid(),
  dedupe_key  text not null unique,
  kind        text not null,
  recipient   text not null,
  status      text not null default 'sending' check (status in ('sending', 'sent', 'failed')),
  attempts    int  not null default 1,
  provider_id text,
  error       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.email_log enable row level security;
revoke all on public.email_log from anon, authenticated;

-- Reserves an email for sending. Returns false if it was already sent, is being sent right now,
-- or ran out of retries. A send interrupted over 15 minutes ago can be retried.
create function public.claim_email(p_key text, p_kind text, p_recipient text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.email_log (dedupe_key, kind, recipient)
  values (p_key, p_kind, p_recipient)
  on conflict (dedupe_key) do update
    set status = 'sending', attempts = public.email_log.attempts + 1, error = null, updated_at = now()
    where public.email_log.attempts < 5
      and (
        public.email_log.status = 'failed'
        or (public.email_log.status = 'sending' and public.email_log.updated_at < now() - interval '15 minutes')
      )
  returning id into v_id;
  return v_id is not null;
end;
$$;

revoke all on function public.claim_email(text, text, text) from public, anon, authenticated;
grant execute on function public.claim_email(text, text, text) to service_role;

-- ---------------------------------------------------------------- schedule
create function public.invoke_email_alerts()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'email_alerts_secret' limit 1;
  if v_secret is null then
    return; -- alerts not activated yet
  end if;

  perform net.http_post(
    url := 'https://erxcfmihgdltdvmvznzo.supabase.co/functions/v1/email-alerts',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-alerts-secret', v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
end;
$$;

revoke all on function public.invoke_email_alerts() from public, anon, authenticated;

select cron.schedule('email-alerts', '*/15 * * * *', 'select public.invoke_email_alerts()');

commit;
