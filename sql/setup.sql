-- CareerForge — one-shot setup (schema.sql + policies.sql). Safe to re-run.

-- CareerForge — Postgres schema (run in the Supabase SQL editor).
-- auth.users is Supabase-managed; everything references auth.uid().

-- profiles: one canonical Profile JSON per user (can support multiple later via is_primary)
create table if not exists profiles (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  data         jsonb not null default '{}'::jsonb,      -- the canonical Profile JSON
  is_primary   boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists profiles_user_id_idx on profiles(user_id);

-- resumes: uploaded file metadata (files live in Storage, not here)
create table if not exists resumes (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  storage_path  text not null,                          -- private bucket path
  filename      text,
  mime_type     text,
  parsed_profile_id uuid references profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists resumes_user_id_idx on resumes(user_id);

-- enhancements: an audit trail of each enhancement pass
create table if not exists enhancements (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  profile_id   uuid not null references profiles(id) on delete cascade,
  target_role  text,
  diff         jsonb,                                    -- {exp_id: {before:[], after:[]}}
  language     text default 'en',
  created_at   timestamptz not null default now()
);

-- ats_scores: a score against a specific job description
create table if not exists ats_scores (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  profile_id    uuid not null references profiles(id) on delete cascade,
  job_id        text,                                   -- JSearch job id if from a match
  score         int not null,                           -- 0–100
  matched_keywords  text[] default '{}',
  missing_keywords  text[] default '{}',
  breakdown     jsonb,                                  -- {keyword, sections, formatting}
  created_at    timestamptz not null default now()
);

-- saved_jobs: user-bookmarked listings (normalized JSearch payload cached in `job`)
create table if not exists saved_jobs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  job_id      text not null,                            -- JSearch job id
  job         jsonb not null,                           -- normalized job object
  fit_score   int,                                      -- 0–100
  created_at  timestamptz not null default now(),
  unique (user_id, job_id)
);

-- applications: the kanban tracker
create table if not exists applications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  job_id      text,
  company     text,
  role        text,
  job         jsonb,
  status      text not null default 'saved',            -- saved|applied|interview|offer|rejected
  kit_id      uuid,
  applied_at  timestamptz,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists applications_user_status_idx on applications(user_id, status);

-- kits: generated Application Kits
create table if not exists kits (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  profile_id    uuid not null references profiles(id) on delete cascade,
  job_id        text,
  language      text default 'en',
  cv_variant    jsonb,                                  -- tailored Profile JSON snapshot
  letter        text,
  follow_up_email text,
  linkedin_message text,
  created_at    timestamptz not null default now()
);

-- credits: current balance per user (source of truth = ledger sum, this is a cache)
create table if not exists credits (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  balance     int not null default 0,
  updated_at  timestamptz not null default now()
);

-- credit_transactions: append-only ledger
create table if not exists credit_transactions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  delta       int not null,                             -- + grant, − debit
  reason      text not null,                            -- 'enhance'|'kit'|'ats'|'signup_grant'|'purchase'|'refund'
  ref         text,                                     -- related entity id
  created_at  timestamptz not null default now()
);
create index if not exists credit_txn_user_idx on credit_transactions(user_id, created_at desc);

-- subscriptions: mirror of Stripe/Paddle state (written by webhook only)
create table if not exists subscriptions (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  provider      text,                                   -- 'stripe'|'paddle'
  plan          text not null default 'free',           -- 'free'|'pro'|'lifetime'
  status        text not null default 'active',
  current_period_end timestamptz,
  updated_at    timestamptz not null default now()
);

-- alert_prefs: WhatsApp/email job-alert settings
create table if not exists alert_prefs (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  whatsapp_number text,
  channel       text default 'whatsapp',                -- 'whatsapp'|'email'|'none'
  frequency     text default 'daily',                   -- 'daily'|'weekly'
  query         jsonb,                                   -- {roles, locations, country}
  last_sent_at  timestamptz
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Credit functions: check + debit / grant atomically. SECURITY DEFINER so they
-- run with owner privileges; called ONLY from serverless via the service role.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function debit_credits(p_user_id uuid, p_cost int, p_reason text, p_ref text default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  new_balance int;
begin
  if p_cost <= 0 then
    raise exception 'cost must be positive';
  end if;
  update credits
     set balance = balance - p_cost, updated_at = now()
   where user_id = p_user_id and balance >= p_cost
  returning balance into new_balance;

  if new_balance is null then
    return -1;  -- insufficient credits (or no credits row)
  end if;

  insert into credit_transactions (user_id, delta, reason, ref)
  values (p_user_id, -p_cost, p_reason, p_ref);

  return new_balance;
end;
$$;

create or replace function grant_credits(p_user_id uuid, p_amount int, p_reason text, p_ref text default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  new_balance int;
begin
  if p_amount <= 0 then
    raise exception 'amount must be positive';
  end if;
  insert into credits (user_id, balance)
  values (p_user_id, p_amount)
  on conflict (user_id)
  do update set balance = credits.balance + p_amount, updated_at = now()
  returning balance into new_balance;

  insert into credit_transactions (user_id, delta, reason, ref)
  values (p_user_id, p_amount, p_reason, p_ref);

  return new_balance;
end;
$$;

-- Revoke direct execution from clients — only the service role may call these.
revoke execute on function debit_credits(uuid, int, text, text) from anon, authenticated;
revoke execute on function grant_credits(uuid, int, text, text) from anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Free-tier signup grant: 5 credits on account creation.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into credits (user_id, balance) values (new.id, 5)
  on conflict (user_id) do nothing;
  insert into credit_transactions (user_id, delta, reason) values (new.id, 5, 'signup_grant');
  insert into subscriptions (user_id, plan, status) values (new.id, 'free', 'active')
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ─────────────────────────────────────────────────────────────────────────────
-- Private Storage bucket for uploaded resume files.
-- ─────────────────────────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public)
values ('resumes', 'resumes', false)
on conflict (id) do nothing;

-- CareerForge — Row-Level Security policies (run after schema.sql).
-- Owner-only pattern: a user can only ever read/write their own rows.
-- The service-role key (serverless only) bypasses RLS.

-- profiles
alter table profiles enable row level security;
drop policy if exists "own_select" on profiles;
create policy "own_select" on profiles for select using (auth.uid() = user_id);
drop policy if exists "own_insert" on profiles;
create policy "own_insert" on profiles for insert with check (auth.uid() = user_id);
drop policy if exists "own_update" on profiles;
create policy "own_update" on profiles for update using (auth.uid() = user_id);
drop policy if exists "own_delete" on profiles;
create policy "own_delete" on profiles for delete using (auth.uid() = user_id);

-- resumes
alter table resumes enable row level security;
drop policy if exists "own_select" on resumes;
create policy "own_select" on resumes for select using (auth.uid() = user_id);
drop policy if exists "own_insert" on resumes;
create policy "own_insert" on resumes for insert with check (auth.uid() = user_id);
drop policy if exists "own_update" on resumes;
create policy "own_update" on resumes for update using (auth.uid() = user_id);
drop policy if exists "own_delete" on resumes;
create policy "own_delete" on resumes for delete using (auth.uid() = user_id);

-- enhancements
alter table enhancements enable row level security;
drop policy if exists "own_select" on enhancements;
create policy "own_select" on enhancements for select using (auth.uid() = user_id);
drop policy if exists "own_insert" on enhancements;
create policy "own_insert" on enhancements for insert with check (auth.uid() = user_id);
drop policy if exists "own_update" on enhancements;
create policy "own_update" on enhancements for update using (auth.uid() = user_id);
drop policy if exists "own_delete" on enhancements;
create policy "own_delete" on enhancements for delete using (auth.uid() = user_id);

-- ats_scores
alter table ats_scores enable row level security;
drop policy if exists "own_select" on ats_scores;
create policy "own_select" on ats_scores for select using (auth.uid() = user_id);
drop policy if exists "own_insert" on ats_scores;
create policy "own_insert" on ats_scores for insert with check (auth.uid() = user_id);
drop policy if exists "own_update" on ats_scores;
create policy "own_update" on ats_scores for update using (auth.uid() = user_id);
drop policy if exists "own_delete" on ats_scores;
create policy "own_delete" on ats_scores for delete using (auth.uid() = user_id);

-- saved_jobs
alter table saved_jobs enable row level security;
drop policy if exists "own_select" on saved_jobs;
create policy "own_select" on saved_jobs for select using (auth.uid() = user_id);
drop policy if exists "own_insert" on saved_jobs;
create policy "own_insert" on saved_jobs for insert with check (auth.uid() = user_id);
drop policy if exists "own_update" on saved_jobs;
create policy "own_update" on saved_jobs for update using (auth.uid() = user_id);
drop policy if exists "own_delete" on saved_jobs;
create policy "own_delete" on saved_jobs for delete using (auth.uid() = user_id);

-- applications
alter table applications enable row level security;
drop policy if exists "own_select" on applications;
create policy "own_select" on applications for select using (auth.uid() = user_id);
drop policy if exists "own_insert" on applications;
create policy "own_insert" on applications for insert with check (auth.uid() = user_id);
drop policy if exists "own_update" on applications;
create policy "own_update" on applications for update using (auth.uid() = user_id);
drop policy if exists "own_delete" on applications;
create policy "own_delete" on applications for delete using (auth.uid() = user_id);

-- kits
alter table kits enable row level security;
drop policy if exists "own_select" on kits;
create policy "own_select" on kits for select using (auth.uid() = user_id);
drop policy if exists "own_insert" on kits;
create policy "own_insert" on kits for insert with check (auth.uid() = user_id);
drop policy if exists "own_update" on kits;
create policy "own_update" on kits for update using (auth.uid() = user_id);
drop policy if exists "own_delete" on kits;
create policy "own_delete" on kits for delete using (auth.uid() = user_id);

-- credit_transactions: users may read their own ledger; only service role writes
alter table credit_transactions enable row level security;
drop policy if exists "own_select" on credit_transactions;
create policy "own_select" on credit_transactions for select using (auth.uid() = user_id);
-- (no insert/update/delete policies → only service role can mutate)

-- credits: read-only for users, no client writes
alter table credits enable row level security;
drop policy if exists "own_select" on credits;
create policy "own_select" on credits for select using (auth.uid() = user_id);
-- (no insert/update/delete policies → only service role can mutate)

-- subscriptions: read-only for users; writes only via payments webhook (service role)
alter table subscriptions enable row level security;
drop policy if exists "own_select" on subscriptions;
create policy "own_select" on subscriptions for select using (auth.uid() = user_id);

-- alert_prefs
alter table alert_prefs enable row level security;
drop policy if exists "own_select" on alert_prefs;
create policy "own_select" on alert_prefs for select using (auth.uid() = user_id);
drop policy if exists "own_insert" on alert_prefs;
create policy "own_insert" on alert_prefs for insert with check (auth.uid() = user_id);
drop policy if exists "own_update" on alert_prefs;
create policy "own_update" on alert_prefs for update using (auth.uid() = user_id);
drop policy if exists "own_delete" on alert_prefs;
create policy "own_delete" on alert_prefs for delete using (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Storage: private `resumes` bucket — each user can only touch their own folder
-- (object path convention: {user_id}/{timestamp}_{filename}).
-- ─────────────────────────────────────────────────────────────────────────────

drop policy if exists "resumes_own_read" on storage.objects;
create policy "resumes_own_read" on storage.objects for select
  using (bucket_id = 'resumes' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "resumes_own_insert" on storage.objects;
create policy "resumes_own_insert" on storage.objects for insert
  with check (bucket_id = 'resumes' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "resumes_own_delete" on storage.objects;
create policy "resumes_own_delete" on storage.objects for delete
  using (bucket_id = 'resumes' and auth.uid()::text = (storage.foldername(name))[1]);
