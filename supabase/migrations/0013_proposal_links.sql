-- Grand Hill Back Office — 0013 proposal links (online acceptance)
--
-- HOW TO RUN: Supabase dashboard > SQL Editor > paste this whole file > Run. Once, after 0012.
-- Apply it BEFORE deploying the app version (and the email-alerts function) that use it.
--
-- Staff create a link for a client: a frozen copy of the proposal (what the client sees, never
-- costs) plus an unguessable token. The client opens /p/<token> without an account and accepts
-- or rejects it. Only two functions are open to anonymous visitors, and both need the token.

begin;

create type public.proposal_status as enum ('sent', 'accepted', 'rejected', 'withdrawn');

create table public.proposal_links (
  id                  uuid primary key default gen_random_uuid(),
  bid_id              uuid not null references public.bids (id) on delete cascade,
  -- 64 hex chars from two random UUIDs (~244 random bits): can't be guessed or enumerated
  token               text not null unique default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  lang                text not null check (lang in ('es', 'en')),
  content             jsonb not null,           -- the proposal exactly as sent
  total               numeric(14, 2),
  valid_until         date not null,
  status              public.proposal_status not null default 'sent',
  view_count          int not null default 0,
  first_viewed_at     timestamptz,
  last_viewed_at      timestamptz,
  decided_at          timestamptz,
  signer_name         text,
  signer_email        text,
  client_note         text,
  decision_ip         text,
  decision_user_agent text,
  created_by          uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at          timestamptz not null default now(),
  check ((status in ('accepted', 'rejected')) = (decided_at is not null))
);

create index on public.proposal_links (bid_id, created_at desc);

-- Staff may only create links and withdraw open ones. Views and decisions come only from the
-- public functions below (which run as the table owner, not as "authenticated").
create function public.proposal_links_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.status := 'sent';
      new.view_count := 0;
      new.first_viewed_at := null;
      new.last_viewed_at := null;
      new.decided_at := null;
      new.signer_name := null;
      new.signer_email := null;
      new.client_note := null;
      new.decision_ip := null;
      new.decision_user_agent := null;
      new.created_by := auth.uid();
    elsif not (old.status = 'sent' and new.status = 'withdrawn') then
      raise exception 'Solo se puede anular una propuesta enviada';
    end if;
  end if;
  return new;
end;
$$;

create trigger proposal_links_guard before insert or update on public.proposal_links
  for each row execute function public.proposal_links_guard();

-- A new link replaces the bid's previous open ones.
create function public.proposal_links_supersede()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.proposal_links
     set status = 'withdrawn'
   where bid_id = new.bid_id and id <> new.id and status = 'sent';
  return null;
end;
$$;

create trigger proposal_links_supersede after insert on public.proposal_links
  for each row execute function public.proposal_links_supersede();

alter table public.proposal_links enable row level security;
revoke all on public.proposal_links from anon, authenticated;
grant select on public.proposal_links to authenticated;
grant insert (bid_id, lang, content, total, valid_until) on public.proposal_links to authenticated;
grant update (status) on public.proposal_links to authenticated;

create policy proposal_links_staff_read on public.proposal_links for select to authenticated using (public.is_staff());
create policy proposal_links_staff_insert on public.proposal_links for insert to authenticated with check (public.is_staff());
create policy proposal_links_staff_update on public.proposal_links for update to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- ---------------------------------------------------------------- public functions (token only)
create function public.florida_today()
returns date
language sql stable
set search_path = ''
as $$ select (now() at time zone 'America/New_York')::date $$;

-- What the client sees. Counts the visit, except staff previews (p_preview only skips the count).
create function public.public_proposal(p_token text, p_preview boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.proposal_links%rowtype;
begin
  if p_token is null or length(p_token) <> 64 then
    return null;
  end if;
  if coalesce(p_preview, false) then
    select * into v from public.proposal_links where token = p_token;
  else
    update public.proposal_links
       set view_count = view_count + 1,
           first_viewed_at = coalesce(first_viewed_at, now()),
           last_viewed_at = now()
     where token = p_token
    returning * into v;
  end if;
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'lang', v.lang,
    'content', v.content,
    'valid_until', v.valid_until,
    'status', v.status,
    'expired', v.valid_until < public.florida_today(),
    'decided_at', v.decided_at,
    'signer_name', v.signer_name
  );
end;
$$;

-- The client's answer. Accepting also marks the bid as won.
create function public.public_proposal_decide(p_token text, p_accept boolean, p_name text, p_email text, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v       public.proposal_links%rowtype;
  v_name  text := nullif(trim(p_name), '');
  v_email text := nullif(lower(trim(p_email)), '');
  v_note  text := nullif(trim(p_note), '');
  v_hdrs  jsonb := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);
begin
  if p_token is null or length(p_token) <> 64 or p_accept is null then
    raise exception 'not_found';
  end if;
  select * into v from public.proposal_links where token = p_token for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v.status <> 'sent' then
    raise exception 'not_open';
  end if;
  if v.valid_until < public.florida_today() then
    raise exception 'expired';
  end if;
  if p_accept and (v_name is null or length(v_name) < 2) then
    raise exception 'name_required';
  end if;
  if length(v_name) > 200 or length(v_note) > 2000 then
    raise exception 'too_long';
  end if;
  if v_email is not null and (length(v_email) > 320 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then
    raise exception 'invalid_email';
  end if;

  update public.proposal_links
     set status = case when p_accept then 'accepted'::public.proposal_status else 'rejected'::public.proposal_status end,
         decided_at = now(),
         signer_name = v_name,
         signer_email = v_email,
         client_note = v_note,
         decision_ip = left(split_part(coalesce(v_hdrs ->> 'x-forwarded-for', v_hdrs ->> 'x-real-ip', ''), ',', 1), 100),
         decision_user_agent = left(v_hdrs ->> 'user-agent', 500)
   where id = v.id;

  if p_accept then
    update public.bids set status = 'won' where id = v.bid_id and status <> 'won';
  end if;

  return jsonb_build_object('status', case when p_accept then 'accepted' else 'rejected' end, 'decided_at', now(), 'signer_name', v_name);
end;
$$;

revoke all on function public.public_proposal(text, boolean) from public;
revoke all on function public.public_proposal_decide(text, boolean, text, text, text) from public;
revoke all on function public.proposal_links_supersede() from public, anon, authenticated;
grant execute on function public.public_proposal(text, boolean) to anon, authenticated;
grant execute on function public.public_proposal_decide(text, boolean, text, text, text) to anon, authenticated;
grant execute on function public.florida_today() to anon, authenticated;

commit;
