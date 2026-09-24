// POST /api/enhance — { profile_id, target_role?, language? }
// Rewrite experience bullets with Claude Sonnet, return a revertible diff,
// write the enhancements audit row. Costs 1 credit; refunded on failure.
import { requireUser, requireOwnProfile } from './_lib/auth.js';
import { supabaseAdmin } from './_lib/supabaseAdmin.js';
import { claudeJSON } from './_lib/claude.js';
import { debitCredits, refundCredits } from './_lib/credits.js';
import { checkRateLimit, rateLimited } from './_lib/ratelimit.js';
import { computeCompleteness } from './_lib/profileSchema.js';

const COST = 1;
const LANGS = new Set(['en', 'fr', 'ar']);

const ENHANCE_SYSTEM = `You are a senior resume writer. Rewrite experience bullets to be stronger and ATS-friendly.
For each bullet:
- Lead with a strong action verb; remove weak verbs (helped, worked on, responsible for).
- Add a quantified result where the source implies one; if no number exists, sharpen the
  outcome without fabricating figures. NEVER invent metrics, employers, or facts.
- Keep each bullet to one line, achievement-focused (action → method → result).
- Match the target role's vocabulary when a target_role is provided.
- Write in the requested language (en|fr|ar). For fr, use professional European French.
Return JSON: { "experience": [ { "id": "...", "bullets": ["..."] } ] } — ids must match input.`;

const ENHANCE_SCHEMA = {
  type: 'object',
  properties: {
    experience: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          bullets: { type: 'array', items: { type: 'string' } },
        },
        required: ['id', 'bullets'],
        additionalProperties: false,
      },
    },
  },
  required: ['experience'],
  additionalProperties: false,
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed.', code: 'METHOD_NOT_ALLOWED' });
  }

  const user = await requireUser(req, res);
  if (!user) return;

  if (!checkRateLimit(user.id, 'enhance', 20, 60 * 60 * 1000)) return rateLimited(res);

  const { profile_id, target_role, language } = req.body || {};
  if (!profile_id) {
    return res.status(400).json({ ok: false, error: 'profile_id is required.', code: 'BAD_REQUEST' });
  }
  const lang = LANGS.has(language) ? language : 'en';

  const profileRow = await requireOwnProfile(res, user.id, profile_id);
  if (!profileRow) return;

  const profile = profileRow.data;
  const experience = profile?.experience || [];
  if (!experience.length) {
    return res.status(400).json({
      ok: false,
      error: 'This profile has no experience entries to enhance yet.',
      code: 'NO_EXPERIENCE',
    });
  }

  const debit = await debitCredits(user.id, COST, 'enhance', profile_id);
  if (!debit.ok) {
    return res.status(402).json({ ok: false, error: debit.error, code: debit.code });
  }

  try {
    // Send only what the model needs: ids, roles, and the source bullets.
    const input = experience.map((exp) => ({
      id: exp.id,
      title: exp.title,
      company: exp.company,
      bullets: exp.raw_bullets?.length ? exp.raw_bullets : exp.bullets,
    }));

    const result = await claudeJSON({
      system: ENHANCE_SYSTEM,
      user: `Target role: ${target_role || 'none'}\nLanguage: ${lang}\nProfile experience: ${JSON.stringify(input)}`,
      schema: ENHANCE_SCHEMA,
    });

    const byId = new Map((result.experience || []).map((e) => [e.id, e.bullets]));
    const diff = {};

    profile.experience = experience.map((exp) => {
      const newBullets = byId.get(exp.id);
      if (!newBullets?.length) return exp;
      // Enhancer writes bullets, never destroys raw_bullets (users can revert).
      const raw = exp.raw_bullets?.length ? exp.raw_bullets : exp.bullets;
      diff[exp.id] = { before: exp.bullets, after: newBullets };
      return { ...exp, raw_bullets: raw, bullets: newBullets };
    });

    profile.meta.last_edited_at = new Date().toISOString();
    profile.completeness = computeCompleteness(profile);

    const { error: updateError } = await supabaseAdmin
      .from('profiles')
      .update({ data: profile, updated_at: new Date().toISOString() })
      .eq('id', profile_id);
    if (updateError) throw updateError;

    const { data: enhancementRow } = await supabaseAdmin
      .from('enhancements')
      .insert({
        user_id: user.id,
        profile_id,
        target_role: target_role || null,
        diff,
        language: lang,
      })
      .select('id')
      .single();

    return res.status(200).json({
      ok: true,
      data: { enhancement_id: enhancementRow?.id, diff, profile },
      credits_remaining: debit.balance,
    });
  } catch (err) {
    console.error('enhance failed:', err);
    const balance = await refundCredits(user.id, COST, 'refund', profile_id);
    return res.status(502).json({
      ok: false,
      error: 'Enhancement failed — your credit was refunded. Please try again.',
      code: 'ENHANCE_FAILED',
      credits_remaining: balance ?? undefined,
    });
  }
}
