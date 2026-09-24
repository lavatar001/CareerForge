# CLAUDE.md — CareerForge

> Build-context file for Claude Code. Read this at the start of **every** session before writing code.
> Goal: a resume-enhancement + job-matching SaaS with a Gulf + francophone edge. Ship complete, production-ready files — never scaffolds, never `TODO` stubs.

---

## 0. Golden rules (read first, obey always)

1. **The Profile JSON is the single source of truth.** Every feature reads from or writes to it. Never invent a parallel data shape.
2. **No secrets client-side, ever.** All API keys (Gemini, Claude, JSearch, Stripe/Paddle, Twilio) live in serverless env vars. Every AI/job/payment call goes through an `/api/*` function.
3. **Row-Level Security on every table that touches user data.** A user can only ever read/write their own rows. No exceptions.
4. **Route by task, not by loyalty.** Gemini Flash-Lite/Flash for extraction, parsing, classification, matching. Claude Sonnet for anything a user reads and judges quality on (enhancement, letters, interview answers).
5. **Ship whole files.** No `// ... rest of code` placeholders. If a file is long, write all of it.
6. **Privacy is a feature, not an afterthought.** Data-deletion flow and privacy policy exist from day one. Resumes are sensitive PII.
7. **Fail cheap.** Hard per-user credit caps, request rate-limits, and Gemini context caching keep AI spend bounded. Assume retries will happen.
8. **Bilingual by design.** Every user-facing string and every generated document supports `en` / `fr` / `ar`. Arabic is RTL.

---

## 1. What we're building

**Core loop:**

```
Upload CV (PDF/DOCX)
   → parse to Profile JSON (Gemini Flash-Lite)
   → enhance bullets + ATS score (Claude Sonnet + scoring fn)
   → match live jobs (JSearch) with fit scores
   → one-click Application Kit per job (Claude Sonnet)
        · tailored CV variant · motivation letter · follow-up email · LinkedIn message
   → Chrome extension autofills the application
   → tracker logs it (kanban)
```

**Standout / moat features:** Gulf CV format + EN/FR/AR output · Application Kit bundle · ATS keyword-gap · WhatsApp job alerts · interview prep · Chrome autofill + auto-log.

**Positioning:** "Don't just fix your CV — land the interview." Outcome, not document. Gulf + francophone first.

---

## 2. Tech stack (pinned — do not substitute without asking)

| Layer | Choice | Notes |
|---|---|---|
| Frontend | Static **HTML + Tailwind (CDN) + vanilla JS** | No build tools. No React unless explicitly requested. |
| Hosting | **Vercel** | Static site + serverless functions in `/api`. |
| Serverless | Vercel Node functions (`/api/*.js`) | All privileged logic. Verify Supabase JWT on entry. |
| Auth + DB + storage | **Supabase** (Postgres, Auth, Storage) | RLS everywhere. Resume files in a private Storage bucket. |
| CV text extraction | `pdf.js` + `mammoth.js` (client-side) | Extract raw text in the browser, POST text to `/api/parse`. Never upload raw files to AI. |
| Parsing / extraction / matching | **Gemini** — `gemini-2.5-flash-lite` (parse), `gemini-2.5-flash` (match) | Cheap, high volume. JSON-only system prompts. |
| Quality writing | **Claude** — `claude-sonnet-5` | Enhancement, letters, interview answers. |
| Job feed | **JSearch** via RapidAPI | Country codes: `ae`, `sa`, `qa`, `eg`, `fr`, `gb`, `us`. `/estimated-salary` for ranges. |
| PDF export | HTML/CSS templates + browser print-CSS | v1 = client `window.print()` to PDF. Server render is a later upgrade. |
| Payments | **Stripe** (works in UAE) or **Paddle** (merchant-of-record, handles VAT) | Gumroad for the launch lifetime deal. |
| Alerts | **Twilio / WhatsApp Business API** | Matched-job digests. Email is secondary. |

> ⚠️ Model strings drift. If a model string errors, check the provider's current model list and update this table — do not silently swap providers.

---

## 3. Repository structure

```
/
├── CLAUDE.md                  ← this file
├── index.html                 ← landing page
├── app.html                   ← authenticated dashboard shell
├── /public
│   ├── /css
│   │   └── forge.css          ← "The Forge" design system: tokens, glass/ink surfaces, forge tubes, components
│   ├── /js
│   │   ├── state.js           ← single in-memory app state + derived facts; fires `cf:state`
│   │   ├── workflow.js        ← hash router, 5-step rail/bottom nav, Forge, Overview "next step"
│   │   ├── icons.js           ← inline SVG icon set (no emoji icons) + <i data-icon> hydrator
│   │   ├── supabaseClient.js  ← Supabase init (anon key only — safe client-side)
│   │   ├── auth.js            ← sign-in / sign-up / session
│   │   ├── parse.js           ← pdf.js + mammoth extraction, calls /api/parse
│   │   ├── profile.js         ← profile editor UI, reads/writes Profile JSON
│   │   ├── jobs.js            ← job search + match UI
│   │   ├── kit.js             ← Application Kit UI
│   │   ├── tracker.js         ← kanban applications (direct Supabase, RLS-protected)
│   │   └── i18n.js            ← en/fr/ar string tables + RTL toggle
│   └── /templates             ← resume export templates (ATS-safe, single-column)
├── /api
│   ├── _lib
│   │   ├── auth.js            ← verify Supabase JWT, return user or 401
│   │   ├── supabaseAdmin.js   ← service-role client (server only)
│   │   ├── gemini.js          ← Gemini call wrapper + JSON parse/repair
│   │   ├── claude.js          ← Claude call wrapper
│   │   ├── jsearch.js         ← JSearch wrapper + normalizer
│   │   ├── credits.js         ← check + debit credits atomically
│   │   └── ratelimit.js       ← per-user rate limiting
│   ├── parse.js
│   ├── enhance.js
│   ├── ats-score.js
│   ├── jobs/search.js
│   ├── jobs/match.js
│   ├── kit/generate.js
│   ├── interview/prep.js
│   ├── alerts/run.js          ← cron target (Vercel Cron)
│   └── webhooks/payments.js
├── /extension                 ← Chrome extension (Phase 5)
│   ├── manifest.json
│   ├── content.js             ← autofill logic
│   └── background.js
├── /sql
│   ├── schema.sql             ← tables
│   └── policies.sql           ← RLS policies
└── vercel.json                ← routes + cron config
```

---

## 4. Canonical Profile JSON (the heart of the app)

Stored as `jsonb` in `profiles.data`. `schema_version` lets us migrate safely. Every generator reads this; the parser writes it; the editor mutates it.

```jsonc
{
  "schema_version": "1.0",
  "meta": {
    "source_filename": "string",
    "parsed_at": "ISO-8601",
    "detected_language": "en | fr | ar",
    "last_edited_at": "ISO-8601"
  },
  "contact": {
    "full_name": "string",
    "email": "string",
    "phone": "string",
    "location": { "city": "", "country": "", "country_code": "" },
    "links": { "linkedin": "", "portfolio": "", "github": "", "other": [] }
  },
  "headline": "string",              // e.g. "Senior Backend Engineer"
  "summary": "string",               // 2–4 sentence professional summary
  "experience": [
    {
      "id": "exp_1",
      "title": "",
      "company": "",
      "location": "",
      "start_date": "YYYY-MM",
      "end_date": "YYYY-MM | present",
      "is_current": false,
      "bullets": ["enhanced achievement bullets"],
      "raw_bullets": ["original bullets, pre-enhancement"],
      "skills_used": ["string"]
    }
  ],
  "education": [
    {
      "id": "edu_1",
      "degree": "", "field": "", "institution": "", "location": "",
      "start_date": "YYYY-MM", "end_date": "YYYY-MM", "grade": ""
    }
  ],
  "skills": { "hard": ["string"], "soft": ["string"], "tools": ["string"] },
  "languages": [ { "language": "", "proficiency": "native | fluent | professional | basic" } ],
  "certifications": [ { "name": "", "issuer": "", "date": "YYYY-MM", "expires": "YYYY-MM | null" } ],
  "projects": [ { "name": "", "description": "", "link": "", "skills": [] } ],
  "awards": [ { "name": "", "issuer": "", "date": "YYYY-MM" } ],

  // Region layer — populated only when the user chooses "Gulf CV" format. Optional everywhere.
  "gulf_fields": {
    "nationality": "",
    "visa_status": "",            // "Employment Visa" | "Visit Visa" | "Golden Visa" | ...
    "visa_expiry": "YYYY-MM",
    "driving_license": "",        // e.g. "UAE — Manual"
    "date_of_birth": "YYYY-MM-DD",
    "marital_status": "",
    "photo_url": "",              // Supabase Storage signed URL
    "notice_period": ""
  },

  "target": {
    "roles": ["string"],
    "locations": ["string"],
    "seniority": "entry | mid | senior | lead | exec",
    "work_mode": "remote | hybrid | onsite | any"
  },

  "completeness": { "score": 0, "missing": ["headline", "summary", "..."] }
}
```

**Rules for the schema:**
- Ids are stable strings (`exp_1`, `edu_1`) so diffs and enhancements can target a specific entry.
- The parser fills `raw_bullets`; the enhancer writes `bullets` and never destroys `raw_bullets` (users can revert).
- `gulf_fields` is always present but may be all-empty; only rendered in Gulf template mode.
- Dates are `YYYY-MM`. Normalize anything the parser sees into this format.

---

## 5. Database schema (Supabase / Postgres)

`/sql/schema.sql`. `auth.users` is Supabase-managed; everything references `auth.uid()`.

```sql
-- profiles: one canonical Profile JSON per user (can support multiple later via is_primary)
create table profiles (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  data         jsonb not null default '{}'::jsonb,      -- the canonical Profile JSON
  is_primary   boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index on profiles(user_id);

-- resumes: uploaded file metadata (files live in Storage, not here)
create table resumes (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  storage_path  text not null,                          -- private bucket path
  filename      text,
  mime_type     text,
  parsed_profile_id uuid references profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index on resumes(user_id);

-- enhancements: an audit trail of each enhancement pass
create table enhancements (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  profile_id   uuid not null references profiles(id) on delete cascade,
  target_role  text,
  diff         jsonb,                                    -- {exp_id: {before:[], after:[]}}
  language     text default 'en',
  created_at   timestamptz not null default now()
);

-- ats_scores: a score against a specific job description
create table ats_scores (
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
create table saved_jobs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  job_id      text not null,                            -- JSearch job id
  job         jsonb not null,                           -- normalized job object
  fit_score   int,                                      -- 0–100
  created_at  timestamptz not null default now(),
  unique (user_id, job_id)
);

-- applications: the kanban tracker
create table applications (
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
create index on applications(user_id, status);

-- kits: generated Application Kits
create table kits (
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
create table credits (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  balance     int not null default 0,
  updated_at  timestamptz not null default now()
);

-- credit_transactions: append-only ledger
create table credit_transactions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  delta       int not null,                             -- + grant, − debit
  reason      text not null,                            -- 'enhance'|'kit'|'ats'|'signup_grant'|'purchase'|'refund'
  ref         text,                                     -- related entity id
  created_at  timestamptz not null default now()
);
create index on credit_transactions(user_id, created_at desc);

-- subscriptions: mirror of Stripe/Paddle state (written by webhook only)
create table subscriptions (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  provider      text,                                   -- 'stripe'|'paddle'
  plan          text not null default 'free',           -- 'free'|'pro'|'lifetime'
  status        text not null default 'active',
  current_period_end timestamptz,
  updated_at    timestamptz not null default now()
);

-- alert_prefs: WhatsApp/email job-alert settings
create table alert_prefs (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  whatsapp_number text,
  channel       text default 'whatsapp',                -- 'whatsapp'|'email'|'none'
  frequency     text default 'daily',                   -- 'daily'|'weekly'
  query         jsonb,                                   -- {roles, locations, country}
  last_sent_at  timestamptz
);
```

### Row-Level Security (`/sql/policies.sql`)

Enable RLS on every table and apply the owner-only pattern. `subscriptions` and `credits` are **written only by serverless (service role)**; users may read their own.

```sql
-- Template applied to all user-owned tables:
alter table profiles enable row level security;
create policy "own_select" on profiles for select using (auth.uid() = user_id);
create policy "own_insert" on profiles for insert with check (auth.uid() = user_id);
create policy "own_update" on profiles for update using (auth.uid() = user_id);
create policy "own_delete" on profiles for delete using (auth.uid() = user_id);

-- Repeat the same four policies for:
--   resumes, enhancements, ats_scores, saved_jobs, applications, kits,
--   credit_transactions (select only for users), alert_prefs.

-- Read-only for users, no client writes:
alter table credits enable row level security;
create policy "own_select" on credits for select using (auth.uid() = user_id);
-- (no insert/update/delete policies → only service role can mutate)

alter table subscriptions enable row level security;
create policy "own_select" on subscriptions for select using (auth.uid() = user_id);
-- (writes only via webhook using service role)
```

> The **service-role key** bypasses RLS and is used only inside `/api/_lib/supabaseAdmin.js`. It must never be exposed to the client.

---

## 6. API routes

All routes: `POST` unless noted, JSON in/out. First line of every handler: verify the Supabase JWT via `_lib/auth.js` → `401` if invalid. Credit-consuming routes call `_lib/credits.js` to check + debit **before** the expensive call, and refund on failure.

| Route | Body | Does | Model | Credits |
|---|---|---|---|---|
| `/api/parse` | `{ resume_text, filename }` | Extract Profile JSON, upsert `profiles`, link `resumes` | Gemini Flash-Lite | 0 (free w/ upload) |
| `/api/enhance` | `{ profile_id, target_role?, language? }` | Rewrite bullets w/ metrics, return diff, write `enhancements` | Claude Sonnet | 1 |
| `/api/ats-score` | `{ profile_id, job_description }` | Keyword gap + section + formatting score, write `ats_scores` | Gemini (keywords) + local fn | 1 |
| `/api/jobs/search` | `{ profile_id?, query?, country, language?, filters? }` | JSearch search, normalize, fit-rank | JSearch + Gemini Flash | 0 (rate-limited) |
| `/api/jobs/match` | `{ profile_id, jobs[] }` | Fit-score a set of jobs vs profile | Gemini Flash | 0 |
| `/api/kit/generate` | `{ profile_id, job_id? \| job_description, language, components[] }` | Tailored CV variant + letter + email + LinkedIn msg | Claude Sonnet | 3 |
| `/api/interview/prep` | `{ profile_id, job_description }` | Likely questions + STAR answers from real profile | Claude Sonnet | 2 |
| `/api/alerts/run` | cron (no user body) | Iterate `alert_prefs`, search JSearch, send WhatsApp | JSearch + Twilio | 0 |
| `/api/webhooks/payments` | provider payload | Update `subscriptions` + grant credits | — | — |
| `GET /api/profile` | — | Return current user's primary profile | — | 0 |

**Not serverless** — do these directly from the client via Supabase (RLS protects them): applications CRUD, saved-jobs CRUD, profile edits (the editor writes `profiles.data` directly), alert-pref edits.

### Standard response envelope

```jsonc
// success
{ "ok": true, "data": { ... }, "credits_remaining": 42 }
// error
{ "ok": false, "error": "human-readable message", "code": "INSUFFICIENT_CREDITS" }
```

---

## 7. The two core AI calls (system prompts)

These two determine product quality. Keep them strict.

### 7a. Parse → Profile JSON  (`/api/parse`, Gemini Flash-Lite)

```
SYSTEM:
You extract structured data from resume text. Output ONLY valid minified JSON matching
the CareerForge Profile schema — no markdown, no code fences, no commentary.
Rules:
- Preserve the candidate's own wording in raw_bullets; do not rewrite here.
- Normalize all dates to YYYY-MM. Use "present" for current roles.
- Detect the document language and set meta.detected_language (en|fr|ar).
- Leave any unknown field as "" or []. Never invent employers, dates, or skills.
- Populate gulf_fields only if explicitly present in the text; otherwise leave empty.
- Assign stable ids: exp_1, exp_2, edu_1, ...
Return the JSON object and nothing else.

USER:
<raw resume text>
```

Wrap the response in `_lib/gemini.js` with a JSON-repair step (strip stray fences, parse, and on failure re-request once with "Your last output was not valid JSON. Return valid JSON only.").

### 7b. Enhance bullets  (`/api/enhance`, Claude Sonnet)

```
SYSTEM:
You are a senior resume writer. Rewrite experience bullets to be stronger and ATS-friendly.
For each bullet:
- Lead with a strong action verb; remove weak verbs (helped, worked on, responsible for).
- Add a quantified result where the source implies one; if no number exists, sharpen the
  outcome without fabricating figures. NEVER invent metrics, employers, or facts.
- Keep each bullet to one line, achievement-focused (action → method → result).
- Match the target role's vocabulary when a target_role is provided.
- Write in the requested language (en|fr|ar). For fr, use professional European French.
Return JSON: { "experience": [ { "id": "...", "bullets": ["..."] } ] } — ids must match input.

USER:
Target role: <target_role or "none">
Language: <language>
Profile experience: <experience array from Profile JSON>
```

Enhancement writes new `bullets`, keeps `raw_bullets`, and stores the before/after in `enhancements.diff` so the UI can show a revertible diff.

> **French letters are not translated English.** The `lettre de motivation` has its own structure (formal opening, motivation for *this* employer, fit, courteous close). Give it a dedicated prompt path in `/api/kit/generate`, not a Google-Translate pass.

---

## 8. ATS scoring (deterministic, explainable)

`/api/ats-score` — score is 0–100, weighted. Must be explainable (users trust a breakdown, not a black box).

```
score = 0.60 * keyword_match      // % of JD keywords present in profile
      + 0.25 * section_completeness // has contact, summary, experience, education, skills
      + 0.15 * formatting_health    // single-column-safe, dates parseable, no risky elements
```

- Extract JD keywords with Gemini Flash (hard skills, tools, titles), dedupe, lowercase.
- `matched_keywords` = intersection with profile skills + bullet text.
- `missing_keywords` = JD keywords absent from profile — this list is the product; surface it prominently.
- Never call it a guarantee. Copy: "Estimated ATS match — guidance, not a promise."

---

## 9. Credits & plans

| Action | Credits |
|---|---|
| Parse / upload | 0 |
| Enhancement pass | 1 |
| ATS score | 1 |
| Application Kit | 3 |
| Interview prep | 2 |
| Job search / match | 0 (rate-limited) |

**Free plan:** signup grants 5 credits (`signup_grant`). Enough for 1 enhancement + 1 ATS + 1 kit to feel the value.
**Pro (~AED 45 / ~$12 mo):** unlimited with a fair-use soft cap (e.g. 300 credits/mo, then throttle) to bound cost.
**Credit packs:** one-time purchases for non-subscribers (a segment competitors ignore).
**Lifetime (Gumroad launch):** `plan='lifetime'`, large monthly credit grant.

Debit logic (`_lib/credits.js`): read balance → if `< cost` return `INSUFFICIENT_CREDITS` → else insert a negative `credit_transactions` row and decrement `credits.balance` in one transaction. Refund (insert positive txn) if the downstream AI call throws.

---

## 10. Environment variables

```
# Supabase
SUPABASE_URL=
SUPABASE_ANON_KEY=            # safe client-side
SUPABASE_SERVICE_ROLE_KEY=   # SERVER ONLY — never ship to client

# AI
GEMINI_API_KEY=
ANTHROPIC_API_KEY=

# Jobs
RAPIDAPI_KEY=                # JSearch
RAPIDAPI_HOST=jsearch.p.rapidapi.com

# Payments
STRIPE_SECRET_KEY=           # or PADDLE_API_KEY
PAYMENTS_WEBHOOK_SECRET=

# Alerts
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_WHATSAPP_FROM=

APP_URL=https://careerforge...
```

Client JS may reference **only** `SUPABASE_URL` and `SUPABASE_ANON_KEY`. Everything else is serverless-only.

---

## 11. Conventions

- **Language:** plain modern JS (ES modules) in serverless; vanilla JS in the browser. No TypeScript, no bundler, unless asked.
- **Tailwind:** CDN classes only (no config/compiler → only base utility classes work).
- **Design system:** brand colours, type and components live in `public/css/forge.css` as CSS variables (`--ink`, `--iris`, `--mint`, `--saffron`…). Use its classes (`glass`, `ink-card`, `btn-*`, `chip-*`, `forge`/`tube`) instead of raw hex. Fonts: Bricolage Grotesque (display) · Geist (body) · Geist Mono (data) · IBM Plex Sans Arabic (ar). Never letter-space Arabic.
- **Workflow:** the app is a guided path — Upload → Review → Enhance → Match → Apply — with step state derived from the Profile JSON (`state.js`). New features add a step/view in `workflow.js`, not a new page.
- **i18n:** all UI strings from `i18n.js` keyed by `en|fr|ar`. Toggle `dir="rtl"` on `<html>` for Arabic.
- **Errors:** never leak stack traces or provider errors to the client. Log server-side, return the clean envelope.
- **Idempotency:** `/api/webhooks/payments` must be idempotent (check event id before granting credits).
- **No `localStorage` for anything sensitive.** Session comes from Supabase; app state in memory.
- **Accessibility:** labelled inputs, keyboard-navigable, sufficient contrast.
- **Every serverless file is complete and deployable on its own.**

---

## 12. Phase-by-phase build prompts

Feed these to Claude Code one at a time. Each should return complete files.

**Phase 1 — Core engine**
> Build auth (`auth.js` + Supabase), the upload+extract flow (`parse.js` using pdf.js/mammoth, client-side text extraction), and `/api/parse` (Gemini Flash-Lite → Profile JSON → upsert `profiles`, link `resumes`). Then `/api/enhance` (Claude Sonnet, returns diff, writes `enhancements`). Then the ATS scoring function and `/api/ats-score`. Include `_lib/auth.js`, `_lib/supabaseAdmin.js`, `_lib/gemini.js`, `_lib/claude.js`, `_lib/credits.js`. Give me every file, complete, plus `/sql/schema.sql` and `/sql/policies.sql`.

**Phase 2 — Application Kit**
> Build `/api/kit/generate` (Claude Sonnet): tailored CV variant + motivation letter + follow-up email + LinkedIn message, in the requested language, with a dedicated French `lettre de motivation` path. Build the `kit.js` UI and 2 ATS-safe single-column export templates with print-CSS. Debit 3 credits with refund-on-failure.

**Phase 3 — Job matching**
> Build `_lib/jsearch.js` (search + normalizer), `/api/jobs/search` (country/language params, defaults `ae`/`fr`), `/api/jobs/match` (Gemini Flash fit-scoring), saved-jobs (client-side Supabase), and salary ranges via the JSearch estimated-salary endpoint. Build `jobs.js` UI with fit-score ranking.

**Phase 4 — Money + launch**
> Build the credit system UI, `/api/webhooks/payments` (idempotent, updates `subscriptions`, grants credits), the pricing page, `i18n.js` (en/fr/ar with RTL), and the landing page. Wire the free-tier signup grant.

**Phase 5 — Moat**
> Build the Chrome extension (`/extension`: `manifest.json`, `content.js` autofill from Profile JSON, `background.js` + auto-log to `applications`), `/api/interview/prep`, and `/api/alerts/run` (Vercel Cron → JSearch → Twilio WhatsApp) with `alert_prefs` UI. Add the Gulf CV template + full Arabic output.

---

## 13. Definition of done (per feature)

- [ ] JWT verified; RLS enforced; no secret reaches the client.
- [ ] Credits checked + debited + refunded on failure where applicable.
- [ ] Works in `en`, `fr`, `ar` (RTL verified for `ar`).
- [ ] Errors return the clean envelope; nothing sensitive logged client-side.
- [ ] AI outputs validated/repaired before use (no crash on bad JSON).
- [ ] Data-deletion path still intact (feature doesn't orphan user data).
- [ ] Files are complete — no stubs, no `TODO`.

---

*CareerForge · single source of truth for Claude Code. Update this file when the schema, routes, or stack change — it is the contract every session builds against.*
