# CareerForge

Resume-enhancement + job-matching SaaS — Gulf + francophone edge.
**Phase 1 (core engine)** is implemented: auth, CV upload + parse, bullet enhancement, ATS scoring.

## Setup

1. **Supabase** — create a project, then in the SQL editor run, in order:
   - `sql/schema.sql` (tables, credit functions, signup grant trigger, private `resumes` bucket)
   - `sql/policies.sql` (RLS on every table + Storage policies)
2. **Client config** — put your project URL and anon key in `public/js/config.js`
   (these two values are the only ones allowed client-side).
3. **Vercel** — import the repo, then set the environment variables from `.env.example`:
   `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`.
4. Deploy. The landing page is `/` (`index.html`); the authenticated dashboard lives at `/app.html`.

## What works (Phase 1)

| Feature | Route | Model | Credits |
|---|---|---|---|
| Sign up / sign in | Supabase Auth (client) | — | 5 free on signup |
| CV upload → Profile JSON | `POST /api/parse` | Gemini Flash-Lite | 0 |
| Bullet enhancement + diff | `POST /api/enhance` | Claude Sonnet | 1 (refund on failure) |
| ATS keyword-gap score | `POST /api/ats-score` | Gemini Flash + local scoring | 1 (refund on failure) |
| Load profile + balance | `GET /api/profile` | — | 0 |

Text extraction (pdf.js / mammoth) happens **in the browser** — raw files are never sent to AI.
The original file is stored in the private `resumes` Storage bucket, owner-only via RLS.

UI is bilingual-by-design: `en` / `fr` / `ar` with RTL, strings in `public/js/i18n.js`.

## Next phases

See `CLAUDE.md` §12 — Phase 2: Application Kit · Phase 3: Job matching (JSearch) ·
Phase 4: Payments + landing · Phase 5: Chrome extension, interview prep, WhatsApp alerts.
