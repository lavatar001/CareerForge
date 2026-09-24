// GET /api/profile — return the current user's primary profile (and balance).
import { requireUser } from './_lib/auth.js';
import { supabaseAdmin } from './_lib/supabaseAdmin.js';
import { getBalance } from './_lib/credits.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed.', code: 'METHOD_NOT_ALLOWED' });
  }

  const user = await requireUser(req, res);
  if (!user) return;

  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, data, updated_at')
    .eq('user_id', user.id)
    .eq('is_primary', true)
    .maybeSingle();

  if (error) {
    console.error('profile fetch failed:', error.message);
    return res.status(500).json({ ok: false, error: 'Could not load your profile.', code: 'PROFILE_FETCH_FAILED' });
  }

  return res.status(200).json({
    ok: true,
    data: data ? { profile_id: data.id, profile: data.data, updated_at: data.updated_at } : null,
    credits_remaining: await getBalance(user.id),
  });
}
