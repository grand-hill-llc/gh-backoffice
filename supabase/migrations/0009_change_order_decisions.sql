-- Grand Hill Back Office — 0009 change order decisions
--
-- HOW TO RUN: Supabase dashboard > SQL Editor > paste this whole file > Run. Once, after 0008.
-- Apply it BEFORE deploying the app version and the email-alerts function that use it.
--
-- Records who approved or rejected each change order and exactly when. The database fills
-- both from the signed-in user, so they can't be typed in or faked from the app.

begin;

alter table public.change_orders
  add column decided_by uuid references public.profiles (id) on delete set null,
  add column decided_at timestamptz;

-- Orders decided before this migration: the date is known, the person isn't.
update public.change_orders
   set decided_at = decided_on::timestamptz
 where status <> 'pending' and decided_at is null;

-- From here on the trigger below fills them.
create or replace function public.change_orders_prepare()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(hashtext('change_orders:' || new.project_id::text));
    select coalesce(max(number), 0) + 1 into new.number from public.change_orders where project_id = new.project_id;
  else
    new.number := old.number;
    new.project_id := old.project_id;
  end if;

  -- Who decided and when: set on approving or rejecting, cleared when it goes back to pending.
  if new.status = 'pending' then
    new.decided_by := null;
    new.decided_at := null;
  elsif tg_op = 'INSERT' or new.status is distinct from old.status then
    new.decided_by := auth.uid();
    new.decided_at := now();
  else
    new.decided_by := old.decided_by;
    new.decided_at := old.decided_at;
  end if;

  if new.project_sub_id is not null and not exists (
    select 1 from public.project_subs ps where ps.id = new.project_sub_id and ps.project_id = new.project_id
  ) then
    raise exception 'La asignación no pertenece a este proyecto';
  end if;
  return new;
end;
$$;

commit;
