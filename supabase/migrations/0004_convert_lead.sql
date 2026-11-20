-- Grand Hill Back Office — 0004 convert lead
-- Turns a qualified lead into a client + bid in one transaction, so a failure halfway
-- never leaves a client without its bid or a lead half converted.
--
-- HOW TO RUN: Supabase dashboard > SQL Editor > paste this whole file > Run. Once, after 0003_leads.sql.
--
-- SECURITY INVOKER: it runs with the caller's permissions, so the same RLS that protects
-- clients, bids and leads applies. Only staff can convert.

begin;

create function public.convert_lead(
  p_lead_id   uuid,
  p_client_id uuid,   -- existing client to use, or null to create p_new_client
  p_new_client jsonb, -- { name, type, contact_name, email, phone } when p_client_id is null
  p_bid       jsonb,  -- { title, location, scope, due_date, status }
  p_note      text    -- activity note written on the lead, e.g. "Convertido en cliente + bid"
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_lead   public.leads%rowtype;
  v_client uuid;
  v_bid    uuid;
begin
  if not public.is_staff() then
    raise exception 'not_allowed';
  end if;

  -- Lock the lead so two people can't convert it at the same time.
  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then
    raise exception 'lead_not_found';
  end if;
  if v_lead.status in ('converted', 'lost') then
    raise exception 'lead_not_open';
  end if;

  if p_client_id is not null then
    v_client := p_client_id;
  else
    insert into public.clients (name, type, contact_name, email, phone)
    values (
      trim(p_new_client ->> 'name'),
      coalesce(nullif(p_new_client ->> 'type', ''), 'other')::public.client_type,
      nullif(trim(p_new_client ->> 'contact_name'), ''),
      nullif(lower(trim(p_new_client ->> 'email')), ''),
      nullif(trim(p_new_client ->> 'phone'), '')
    )
    returning id into v_client;
  end if;

  insert into public.bids (title, client_id, status, due_date, location, scope)
  values (
    trim(p_bid ->> 'title'),
    v_client,
    coalesce(nullif(p_bid ->> 'status', ''), 'new')::public.bid_status,
    nullif(p_bid ->> 'due_date', '')::date,
    nullif(trim(p_bid ->> 'location'), ''),
    nullif(trim(p_bid ->> 'scope'), '')
  )
  returning id into v_bid;

  update public.leads
     set status = 'converted', client_id = v_client, bid_id = v_bid, next_follow_up = null
   where id = p_lead_id;

  if nullif(trim(p_note), '') is not null then
    insert into public.lead_activities (lead_id, kind, summary) values (p_lead_id, 'note', trim(p_note));
  end if;

  return jsonb_build_object('client_id', v_client, 'bid_id', v_bid);
end;
$$;

revoke execute on function public.convert_lead(uuid, uuid, jsonb, jsonb, text) from public, anon;
grant  execute on function public.convert_lead(uuid, uuid, jsonb, jsonb, text) to authenticated;

commit;
