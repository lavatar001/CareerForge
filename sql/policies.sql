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
