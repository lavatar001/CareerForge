// POST /api/parse — { resume_text, filename, storage_path?, mime_type? }
// Extract Profile JSON (Gemini Flash-Lite), upsert profiles, link resumes.
// Free with upload; rate-limited.
import { requireUser } from './_lib/auth.js';
import { supabaseAdmin } from './_lib/supabaseAdmin.js';
import { geminiJSON } from './_lib/gemini.js';
import { checkRateLimit, rateLimited } from './_lib/ratelimit.js';
import { getBalance } from './_lib/credits.js';
import {
  emptyProfile,
  mergeIntoSkeleton,
  normalizeProfile,
  computeCompleteness,
} from './_lib/profileSchema.js';

const PARSE_SYSTEM = `You extract structured data from resume text. Output ONLY valid minified JSON matching
the CareerForge Profile schema — no markdown, no code fences, no commentary.
Rules:
- Preserve the candidate's own wording in raw_bullets; do not rewrite here.
- Normalize all dates to YYYY-MM. Use "present" for current roles.
- Detect the document language and set meta.detected_language (en|fr|ar).
- Leave any unknown field as "" or []. Never invent employers, dates, or skills.
- Populate gulf_fields only if explicitly present in the text; otherwise leave empty.
- Assign stable ids: exp_1, exp_2, edu_1, ...
Return the JSON object and nothing else.

The schema:
{"schema_version":"1.0","meta":{"source_filename":"","parsed_at":"","detected_language":"en"},"contact":{"full_name":"","email":"","phone":"","location":{"city":"","country":"","country_code":""},"links":{"linkedin":"","portfolio":"","github":"","other":[]}},"headline":"","summary":"","experience":[{"id":"exp_1","title":"","company":"","location":"","start_date":"YYYY-MM","end_date":"YYYY-MM|present","is_current":false,"raw_bullets":[""],"skills_used":[""]}],"education":[{"id":"edu_1","degree":"","field":"","institution":"","location":"","start_date":"","end_date":"","grade":""}],"skills":{"hard":[],"soft":[],"tools":[]},"languages":[{"language":"","proficiency":"native|fluent|professional|basic"}],"certifications":[{"name":"","issuer":"","date":"","expires":null}],"projects":[{"name":"","description":"","link":"","skills":[]}],"awards":[{"name":"","issuer":"","date":""}],"gulf_fields":{"nationality":"","visa_status":"","visa_expiry":"","driving_license":"","date_of_birth":"","marital_status":"","photo_url":"","notice_period":""}}`;

const MAX_RESUME_CHARS = 60000;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed.', code: 'METHOD_NOT_ALLOWED' });
  }

  const user = await requireUser(req, res);
  if (!user) return;

  if (!checkRateLimit(user.id, 'parse', 10, 60 * 60 * 1000)) return rateLimited(res);

  const { resume_text, filename, storage_path, mime_type } = req.body || {};
  if (!resume_text || typeof resume_text !== 'string' || resume_text.trim().length < 50) {
    return res.status(400).json({
      ok: false,
      error: 'We could not read enough text from that file. Try a text-based PDF or DOCX.',
      code: 'EMPTY_RESUME_TEXT',
    });
  }

  try {
    const parsed = await geminiJSON({
      model: 'gemini-2.5-flash-lite',
      system: PARSE_SYSTEM,
      user: resume_text.slice(0, MAX_RESUME_CHARS),
    });

    let profile = mergeIntoSkeleton(emptyProfile(), parsed);
    profile = normalizeProfile(profile);
    profile.meta.source_filename = filename || '';
    profile.meta.parsed_at = new Date().toISOString();
    profile.meta.last_edited_at = profile.meta.parsed_at;
    profile.completeness = computeCompleteness(profile);

    // Upsert the user's primary profile (one canonical profile in v1).
    const { data: existing } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('user_id', user.id)
      .eq('is_primary', true)
      .maybeSingle();

    let profileRow;
    if (existing) {
      const { data, error } = await supabaseAdmin
        .from('profiles')
        .update({ data: profile, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
        .select()
        .single();
      if (error) throw error;
      profileRow = data;
    } else {
      const { data, error } = await supabaseAdmin
        .from('profiles')
        .insert({ user_id: user.id, data: profile, is_primary: true })
        .select()
        .single();
      if (error) throw error;
      profileRow = data;
    }

    // Link the uploaded file (client uploaded it to the private bucket first).
    if (storage_path) {
      await supabaseAdmin.from('resumes').insert({
        user_id: user.id,
        storage_path,
        filename: filename || null,
        mime_type: mime_type || null,
        parsed_profile_id: profileRow.id,
      });
    }

    return res.status(200).json({
      ok: true,
      data: { profile_id: profileRow.id, profile },
      credits_remaining: await getBalance(user.id),
    });
  } catch (err) {
    console.error('parse failed:', err);
    return res.status(502).json({
      ok: false,
      error: 'We could not parse that resume right now. Please try again.',
      code: 'PARSE_FAILED',
    });
  }
}
