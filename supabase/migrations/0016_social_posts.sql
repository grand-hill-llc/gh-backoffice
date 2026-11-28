-- Grand Hill Back Office — 0016 social posts (content planner)
--
-- HOW TO RUN: Supabase dashboard > SQL Editor > paste this whole file > Run. Once, after 0015.
-- Apply it BEFORE deploying the app version with the Content page.
--
-- The plan of what Grand Hill publishes on Facebook, Instagram, LinkedIn and Google: text, images
-- or videos, networks, date and status. Publishing still happens by hand in each network (the post
-- is then marked as published); a later step connects Facebook and Instagram to publish from here.
--
-- Approval is a setting (off by default): when on, posts an admin schedules wait for a super admin.
-- The database enforces it, not just the app. Staff only.

begin;

create type public.social_post_status as enum ('draft', 'pending', 'scheduled', 'published');

alter table public.app_settings
  add column posts_require_approval boolean not null default false;
grant update (posts_require_approval) on public.app_settings to authenticated;

-- ---------------------------------------------------------------- posts
create table public.social_posts (
  id            uuid primary key default gen_random_uuid(),
  title         text not null check (length(trim(title)) between 1 and 200),  -- internal name
  body          text not null default '' check (length(body) <= 63206),       -- the caption
  channels      text[] not null default '{}'
                  check (channels <@ array['facebook', 'instagram', 'linkedin', 'google']::text[]),
  status        public.social_post_status not null default 'draft',
  scheduled_at  timestamptz,
  published_at  timestamptz,
  published_url text check (published_url is null or published_url ~* '^https?://'),
  notes         text,
  review_note   text check (review_note is null or length(review_note) <= 2000),  -- why it went back
  reviewed_by   uuid references public.profiles (id) on delete set null,
  reviewed_at   timestamptz,
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- Ideas can be loose; anything past a draft needs networks, and a date unless already out.
  check (status = 'draft' or cardinality(channels) > 0),
  check (status not in ('pending', 'scheduled') or scheduled_at is not null),
  check ((status = 'published') = (published_at is not null))
);

create index on public.social_posts (scheduled_at);
create index on public.social_posts (status);
create trigger set_updated_at before update on public.social_posts for each row execute function public.set_updated_at();

-- Who did what is stamped here, and the approval rule is applied here.
create function public.social_posts_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  needs_approval boolean := coalesce((select s.posts_require_approval from public.app_settings s), false)
                            and not public.is_super_admin();
  changed boolean;
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
    new.reviewed_by := null;
    new.reviewed_at := null;
    new.review_note := null;
    changed := true;
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    changed := new.body is distinct from old.body
            or new.channels is distinct from old.channels
            or new.scheduled_at is distinct from old.scheduled_at;
    -- Only a super admin reviews.
    if public.is_super_admin() and old.status = 'pending' and new.status in ('scheduled', 'draft') then
      new.reviewed_by := auth.uid();
      new.reviewed_at := now();
      if new.status = 'scheduled' then new.review_note := null; end if;
    else
      new.reviewed_by := old.reviewed_by;
      new.reviewed_at := old.reviewed_at;
      if not public.is_super_admin() then new.review_note := old.review_note; end if;
    end if;
  end if;

  if needs_approval then
    -- Scheduling (or changing a scheduled post) waits for a super admin instead.
    if new.status = 'scheduled' and (tg_op = 'INSERT' or old.status <> 'scheduled' or changed) then
      new.status := 'pending';
    end if;
    if new.status = 'published' and (tg_op = 'INSERT' or old.status not in ('scheduled', 'published')) then
      raise exception 'Esta publicación necesita aprobación';
    end if;
  end if;

  if new.status = 'published' then
    new.published_at := coalesce(new.published_at, now());
  else
    new.published_at := null;
    new.published_url := null;
  end if;
  return new;
end;
$$;

create trigger social_posts_guard before insert or update on public.social_posts
  for each row execute function public.social_posts_guard();

-- ---------------------------------------------------------------- images and videos
create table public.social_post_media (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.social_posts (id) on delete cascade,
  position   int not null default 0,
  path       text not null unique,          -- storage object in the social-media bucket
  mime_type  text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime')),
  size_bytes bigint check (size_bytes is null or size_bytes between 1 and 52428800),
  created_at timestamptz not null default now(),
  check (path like post_id::text || '/%')
);

create index on public.social_post_media (post_id, position);

-- New or removed media on a scheduled post also goes back to approval when the rule applies.
create function public.social_post_media_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  pid uuid := coalesce(new.post_id, old.post_id);
begin
  if coalesce((select s.posts_require_approval from public.app_settings s), false) and not public.is_super_admin() then
    update public.social_posts set status = 'pending' where id = pid and status = 'scheduled';
  end if;
  return null;
end;
$$;

create trigger social_post_media_touch after insert or delete on public.social_post_media
  for each row execute function public.social_post_media_touch();

-- ---------------------------------------------------------------- access
alter table public.social_posts enable row level security;
alter table public.social_post_media enable row level security;
revoke all on public.social_posts, public.social_post_media from anon;

create policy social_posts_staff on public.social_posts for all to authenticated
  using (public.is_staff()) with check (public.is_staff());
create policy social_post_media_staff on public.social_post_media for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- Private bucket: images and videos up to 50 MB (the Supabase free plan's limit per file).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('social-media', 'social-media', false, 52428800,
        array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime'])
on conflict (id) do nothing;

create policy social_media_files_staff on storage.objects for all to authenticated
  using (bucket_id = 'social-media' and public.is_staff())
  with check (bucket_id = 'social-media' and public.is_staff());

commit;
