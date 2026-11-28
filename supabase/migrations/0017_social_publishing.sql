-- Grand Hill Back Office — 0017 publishing to Facebook and Instagram
--
-- HOW TO RUN: Supabase dashboard > SQL Editor > paste this whole file > Run. Once, after 0016.
-- Safe before Meta is connected: nothing is published until a super admin turns on
-- "Publicar automáticamente" in Configuración, and the schedule needs the same Vault secret as the
-- email alerts (see README, "Publicación en Facebook e Instagram").
--
-- Every 5 minutes pg_cron calls the social-publish Edge Function, which publishes the scheduled
-- posts that are due on the Facebook Page and the Instagram account. One delivery row per post and
-- network records what happened. LinkedIn and Google are still published by hand.

begin;

alter table public.app_settings
  add column meta_autopublish boolean not null default false;
grant update (meta_autopublish) on public.app_settings to authenticated;

-- ---------------------------------------------------------------- deliveries
create table public.social_deliveries (
  id           uuid primary key default gen_random_uuid(),
  post_id      uuid not null references public.social_posts (id) on delete cascade,
  channel      text not null check (channel in ('facebook', 'instagram')),
  -- publishing: being sent now · processing: Instagram still preparing a video · published · failed
  status       text not null default 'publishing' check (status in ('publishing', 'processing', 'published', 'failed')),
  attempts     int  not null default 1,
  container_id text,          -- Instagram media container, kept while a video is processed
  external_id  text,          -- id of the post on the network
  permalink    text,
  error        text,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  created_at   timestamptz not null default now(),
  unique (post_id, channel)
);

alter table public.social_deliveries enable row level security;
revoke all on public.social_deliveries from anon, authenticated;
grant select on public.social_deliveries to authenticated;
create policy social_deliveries_staff_read on public.social_deliveries for select to authenticated
  using (public.is_staff());

-- Reserves the deliveries to make now. Called by the Edge Function only (service role).
--   p_post null: the scheduler. Posts due (scheduled, date reached) when automatic publishing is on;
--                failed deliveries are retried up to 3 attempts, 10 minutes apart.
--   p_post set:  "Publicar ahora" on one scheduled post; its failed deliveries are retried.
-- Instagram videos still processing are handed back to check again.
-- A delivery interrupted mid-send is never retried automatically (it may have gone out): it becomes
-- failed after 15 minutes, for someone to check the network and retry by hand.
create function public.claim_social_deliveries(p_post uuid default null)
returns setof public.social_deliveries
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_auto boolean := coalesce((select s.meta_autopublish from public.app_settings s), false);
  p record;
  ch text;
begin
  update public.social_deliveries
     set status = 'failed', error = 'interrupted', finished_at = now()
   where status = 'publishing' and started_at < now() - interval '15 minutes';

  for p in
    select sp.id, sp.channels
      from public.social_posts sp
     where sp.status = 'scheduled'
       and sp.channels && array['facebook', 'instagram']::text[]
       and (case when p_post is null then v_auto and sp.scheduled_at <= now() else sp.id = p_post end)
     order by sp.scheduled_at
     for update skip locked
  loop
    foreach ch in array array['facebook', 'instagram'] loop
      continue when not (ch = any (p.channels));
      return query
        with claimed as (
          insert into public.social_deliveries as d (post_id, channel)
          values (p.id, ch)
          on conflict (post_id, channel) do update
            set status = 'publishing', attempts = d.attempts + 1, error = null, started_at = now(), finished_at = null
            where d.status = 'failed'
              and (p_post is not null
                   or (d.error is distinct from 'interrupted' and d.attempts < 3 and d.finished_at < now() - interval '10 minutes'))
          returning d.*
        )
        select * from claimed;
    end loop;
  end loop;

  return query
    with resumed as (
      update public.social_deliveries d
         set status = 'publishing', started_at = now()
       where d.status = 'processing' and (p_post is null or d.post_id = p_post)
      returning d.*
    )
    select * from resumed;
end;
$$;

revoke all on function public.claim_social_deliveries(uuid) from public, anon, authenticated;
grant execute on function public.claim_social_deliveries(uuid) to service_role;

-- Hands back a delivery the function claimed but had no time to make: a new one is dropped, a retry
-- goes back to failed so the next run takes it again.
create function public.release_social_delivery(p_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.social_deliveries where id = p_id and status = 'publishing' and attempts = 1;
  update public.social_deliveries
     set status = 'failed', error = 'deferred', attempts = attempts - 1, finished_at = now() - interval '10 minutes'
   where id = p_id and status = 'publishing';
$$;

revoke all on function public.release_social_delivery(uuid) from public, anon, authenticated;
grant execute on function public.release_social_delivery(uuid) to service_role;

-- ---------------------------------------------------------------- schedule
create function public.invoke_social_publish()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text;
begin
  if not coalesce((select s.meta_autopublish from public.app_settings s), false) then
    return; -- automatic publishing is off
  end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'email_alerts_secret' limit 1;
  if v_secret is null then
    return;
  end if;
  perform net.http_post(
    url := 'https://erxcfmihgdltdvmvznzo.supabase.co/functions/v1/social-publish',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-alerts-secret', v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
end;
$$;

revoke all on function public.invoke_social_publish() from public, anon, authenticated;

select cron.schedule('social-publish', '*/5 * * * *', 'select public.invoke_social_publish()');

commit;
