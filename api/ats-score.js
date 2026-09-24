// POST /api/ats-score — { profile_id, job_description }
// Deterministic, explainable ATS score: keyword gap (Gemini keyword extraction)
// + section completeness + formatting health. Costs 1 credit; refunded on failure.
import { requireUser, requireOwnProfile } from './_lib/auth.js';
import { supabaseAdmin } from './_lib/supabaseAdmin.js';
import { geminiJSON } from './_lib/gemini.js';
import { debitCredits, refundCredits } from './_lib/credits.js';
import { checkRateLimit, rateLimited } from './_lib/ratelimit.js';
import { computeCompleteness } from './_lib/profileSchema.js';

const COST = 1;

const KEYWORDS_SYSTEM = `You extract ATS keywords from a job description. Output ONLY valid minified JSON:
{"keywords":["..."]}
Rules:
- Include hard skills, tools, technologies, certifications, and job titles.
- Exclude soft skills, company names, benefits, and generic words (team, experience).
- Lowercase everything, deduplicate, 10 to 30 keywords.
Return the JSON object and nothing else.`;

function profileText(profile) {
  const parts = [
    profile.headline,
    profile.summary,
    ...(profile.skills?.hard || []),
    ...(profile.skills?.soft || []),
    ...(profile.skills?.tools || []),
    ...(profile.certifications || []).map((c) => c.name),
    ...(profile.projects || []).flatMap((p) => [p.name, p.description, ...(p.skills || [])]),
  ];
  for (const exp of profile.experience || []) {
    parts.push(exp.title, exp.company, ...(exp.bullets || []), ...(exp.skills_used || []));
  }
  for (const edu of profile.education || []) {
    parts.push(edu.degree, edu.field, edu.institution);
  }
  return parts.filter(Boolean).join(' ').toLowerCase();
}

function formattingHealth(profile) {
  let points = 0;
  const total = 4;
  const dateOk = (d) => !d || d === 'present' || /^\d{4}(-\d{2})?$/.test(d);
  if ((profile.experience || []).every((e) => dateOk(e.start_date) && dateOk(e.end_date))) points++;
  if ((profile.experience || []).some((e) => (e.bullets || []).length > 0)) points++;
  if (profile.contact?.email && /\S+@\S+\.\S+/.test(profile.contact.email)) points++;
  if (profile.contact?.phone) points++;
  return points / total;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed.', code: 'METHOD_NOT_ALLOWED' });
  }

  const user = await requireUser(req, res);
  if (!user) return;

  if (!checkRateLimit(user.id, 'ats-score', 20, 60 * 60 * 1000)) return rateLimited(res);

  const { profile_id, job_description } = req.body || {};
  if (!profile_id || !job_description || String(job_description).trim().length < 50) {
    return res.status(400).json({
      ok: false,
      error: 'profile_id and a job description (at least a few sentences) are required.',
      code: 'BAD_REQUEST',
    });
  }

  const profileRow = await requireOwnProfile(res, user.id, profile_id);
  if (!profileRow) return;

  const debit = await debitCredits(user.id, COST, 'ats', profile_id);
  if (!debit.ok) {
    return res.status(402).json({ ok: false, error: debit.error, code: debit.code });
  }

  try {
    const { keywords } = await geminiJSON({
      model: 'gemini-2.5-flash',
      system: KEYWORDS_SYSTEM,
      user: String(job_description).slice(0, 20000),
      maxOutputTokens: 2048,
    });

    const cleaned = [...new Set((keywords || []).map((k) => String(k).toLowerCase().trim()).filter(Boolean))];
    const haystack = profileText(profileRow.data);

    const matched = cleaned.filter((k) => haystack.includes(k));
    const missing = cleaned.filter((k) => !haystack.includes(k));

    const keywordScore = cleaned.length ? matched.length / cleaned.length : 0;
    const completeness = computeCompleteness(profileRow.data);
    const sectionScore = completeness.score / 100;
    const formatScore = formattingHealth(profileRow.data);

    // score = 0.60*keyword_match + 0.25*section_completeness + 0.15*formatting_health
    const score = Math.round(100 * (0.6 * keywordScore + 0.25 * sectionScore + 0.15 * formatScore));

    const breakdown = {
      keyword: Math.round(keywordScore * 100),
      sections: Math.round(sectionScore * 100),
      formatting: Math.round(formatScore * 100),
      weights: { keyword: 0.6, sections: 0.25, formatting: 0.15 },
    };

    const { data: scoreRow } = await supabaseAdmin
      .from('ats_scores')
      .insert({
        user_id: user.id,
        profile_id,
        score,
        matched_keywords: matched,
        missing_keywords: missing,
        breakdown,
      })
      .select('id')
      .single();

    return res.status(200).json({
      ok: true,
      data: {
        ats_score_id: scoreRow?.id,
        score,
        matched_keywords: matched,
        missing_keywords: missing,
        breakdown,
        disclaimer: 'Estimated ATS match — guidance, not a promise.',
      },
      credits_remaining: debit.balance,
    });
  } catch (err) {
    console.error('ats-score failed:', err);
    const balance = await refundCredits(user.id, COST, 'refund', profile_id);
    return res.status(502).json({
      ok: false,
      error: 'Scoring failed — your credit was refunded. Please try again.',
      code: 'ATS_FAILED',
      credits_remaining: balance ?? undefined,
    });
  }
}
