-- Grand Hill Back Office — 0005 subcontractor portal
--
-- HOW TO RUN: Supabase dashboard > SQL Editor > paste this whole file > Run.
-- Run it once, after 0004_convert_lead.sql, and BEFORE deploying the app version that uses it.
-- Wrapped in a transaction: if anything fails nothing is applied.
--
-- ACCESS MODEL FOR A SUBCONTRACTOR LOGIN
--   Subcontractors no longer read tables directly: those rows include internal notes.
--   They go through the portal_* functions below, which return a fixed list of fields for
--   their own company only. They never see contracts, margins, clients, other subs or notes.
--   Documents they upload stay "pending" and don't count until staff approve them.

begin;

-- ---------------------------------------------------------------- document review
create type public.doc_review_status as enum ('pending', 'approved', 'rejected');

alter table public.subcontractor_documents
  -- existing documents and anything staff upload are approved; the portal inserts 'pending'
  add column review_status    public.doc_review_status not null default 'approved',
  add column reviewed_by      uuid references auth.users (id) on delete set null,
  add column reviewed_at      timestamptz,
  add column rejection_reason text;

-- One document of each type waiting for review per company.
create unique index subcontractor_documents_one_pending
  on public.subcontractor_documents (subcontractor_id, doc_type)
  where review_status = 'pending';

-- Compliance only counts approved documents.
create or replace view public.v_sub_documents_status
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
join public.subcontractors s on s.id = d.subcontractor_id
where d.review_status = 'approved';

-- ---------------------------------------------------------------- close direct reads
-- These policies exposed whole rows, including the internal notes.
drop policy subcontractors_own_read on public.subcontractors;
drop policy sub_documents_own_read on public.subcontractor_documents;

-- ---------------------------------------------------------------- portal functions
-- The caller's company, or an error if the caller isn't a subcontractor login.
create function public.portal_sub_id()
returns uuid
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select subcontractor_id into v_id
    from public.profiles
   where id = auth.uid() and role = 'subcontractor';
  if v_id is null then
    raise exception 'not_allowed';
  end if;
  return v_id;
end;
$$;

create function public.portal_company()
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_sub uuid := public.portal_sub_id();
begin
  return (
    select jsonb_build_object(
      'id', s.id,
      'company_name', s.company_name,
      'legal_name', s.legal_name,
      'trades', s.trades,
      'contact_name', s.contact_name,
      'email', s.email,
      'phone', s.phone,
      'city', s.city,
      'state', s.state,
      'status', s.status
    )
    from public.subcontractors s
    where s.id = v_sub
  );
end;
$$;

create function public.portal_update_contact(p_contact_name text, p_email text, p_phone text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_sub   uuid := public.portal_sub_id();
  v_name  text := nullif(trim(p_contact_name), '');
  v_email text := nullif(lower(trim(p_email)), '');
  v_phone text := nullif(trim(p_phone), '');
begin
  if v_email is not null and (length(v_email) > 320 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then
    raise exception 'invalid_email';
  end if;
  if length(v_name) > 200 or length(v_phone) > 50 then
    raise exception 'too_long';
  end if;

  update public.subcontractors
     set contact_name = v_name, email = v_email, phone = v_phone
   where id = v_sub;

  return public.portal_company();
end;
$$;

create function public.portal_documents()
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
        'id', d.id,
        'doc_type', d.doc_type,
        'file_path', d.file_path,
        'issued_on', d.issued_on,
        'expires_on', d.expires_on,
        'review_status', d.review_status,
        'rejection_reason', d.rejection_reason,
        'created_at', d.created_at
      )
      order by d.created_at desc
    )
    from public.subcontractor_documents d
    where d.subcontractor_id = v_sub
  ), '[]'::jsonb);
end;
$$;

-- Registers a file already uploaded to the caller's own folder as a document pending review.
create function public.portal_submit_document(p_doc_type public.doc_type, p_file_path text, p_issued_on date, p_expires_on date)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_sub uuid := public.portal_sub_id();
  v_id  uuid;
begin
  if p_doc_type not in ('coi', 'w9', 'license') then
    raise exception 'invalid_type';
  end if;
  if split_part(coalesce(p_file_path, ''), '/', 1) <> v_sub::text then
    raise exception 'invalid_file';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'sub-documents' and o.name = p_file_path) then
    raise exception 'invalid_file';
  end if;
  if exists (select 1 from public.subcontractor_documents d where d.file_path = p_file_path) then
    raise exception 'invalid_file';
  end if;
  if p_doc_type in ('coi', 'license') and p_expires_on is null then
    raise exception 'expiry_required';
  end if;
  if p_expires_on is not null and p_expires_on < current_date then
    raise exception 'already_expired';
  end if;
  if p_issued_on is not null and p_expires_on is not null and p_expires_on < p_issued_on then
    raise exception 'invalid_dates';
  end if;
  if exists (
    select 1 from public.subcontractor_documents d
     where d.subcontractor_id = v_sub and d.doc_type = p_doc_type and d.review_status = 'pending'
  ) then
    raise exception 'already_pending';
  end if;

  insert into public.subcontractor_documents
    (subcontractor_id, doc_type, file_path, issued_on, expires_on, review_status, uploaded_by)
  values
    (v_sub, p_doc_type, p_file_path, p_issued_on, p_expires_on, 'pending', auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- The caller's work: project basics, their trade, their agreed amount and their own payments.
create function public.portal_assignments()
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
        'agreed_amount', a.agreed_amount,
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
    where a.subcontractor_id = v_sub
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.portal_sub_id() from public, anon, authenticated;
revoke all on function public.portal_company() from public, anon;
revoke all on function public.portal_update_contact(text, text, text) from public, anon;
revoke all on function public.portal_documents() from public, anon;
revoke all on function public.portal_submit_document(public.doc_type, text, date, date) from public, anon;
revoke all on function public.portal_assignments() from public, anon;
grant execute on function public.portal_company() to authenticated;
grant execute on function public.portal_update_contact(text, text, text) to authenticated;
grant execute on function public.portal_documents() to authenticated;
grant execute on function public.portal_submit_document(public.doc_type, text, date, date) to authenticated;
grant execute on function public.portal_assignments() to authenticated;

-- ---------------------------------------------------------------- private files
-- Only document formats, up to 20 MB. Blocks e.g. an HTML file later opened by staff.
update storage.buckets
   set file_size_limit = 20971520,
       allowed_mime_types = array[
         'application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/heif',
         'application/msword',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
         'application/octet-stream'
       ]
 where id = 'sub-documents';

-- A subcontractor reads and adds files only inside their own folder. No update or delete.
create policy sub_documents_files_own_read on storage.objects for select to authenticated
  using (
    bucket_id = 'sub-documents'
    and public.current_app_role() = 'subcontractor'
    and (storage.foldername(name))[1] = public.current_subcontractor_id()::text
  );

create policy sub_documents_files_own_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'sub-documents'
    and public.current_app_role() = 'subcontractor'
    and (storage.foldername(name))[1] = public.current_subcontractor_id()::text
    and lower(storage.extension(name)) in ('pdf', 'jpg', 'jpeg', 'png')
  );

commit;
