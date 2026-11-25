-- Grand Hill Back Office — 0014 proposal emails
--
-- HOW TO RUN: Supabase dashboard > SQL Editor > paste this whole file > Run. Once, after 0013.
-- Apply it BEFORE deploying the app version that uses it, then deploy the send-proposal function.
--
-- Every time someone emails a proposal link to the client from the app. Only the send-proposal
-- Edge Function writes here (with the service role), after Resend answers; staff can read it to
-- see who got the proposal, when, and from whom.

begin;

create table public.proposal_emails (
  id               uuid primary key default gen_random_uuid(),
  proposal_link_id uuid not null references public.proposal_links (id) on delete cascade,
  recipient        text not null check (length(recipient) between 3 and 320),
  cc               text[] not null default '{}' check (cardinality(cc) <= 5),
  message          text check (message is null or length(message) <= 4000),
  status           text not null check (status in ('sent', 'failed')),
  resend_id        text,
  error            text check (error is null or length(error) <= 500),
  sent_by          uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now()
);

create index on public.proposal_emails (proposal_link_id, created_at);

alter table public.proposal_emails enable row level security;

revoke all on public.proposal_emails from anon, authenticated;
grant select on public.proposal_emails to authenticated;

create policy proposal_emails_staff_read on public.proposal_emails for select to authenticated
  using (public.is_staff());

commit;
