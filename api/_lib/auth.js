// Verify the Supabase JWT from the Authorization header. Returns the user or
// sends a 401 and returns null. First call in every handler.
import { supabaseAdmin } from './supabaseAdmin.js';

export async function requireUser(req, res) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    res.status(401).json({ ok: false, error: 'You must be signed in.', code: 'UNAUTHENTICATED' });
    return null;
  }

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) {
    res.status(401).json({ ok: false, error: 'Your session has expired. Please sign in again.', code: 'UNAUTHENTICATED' });
    return null;
  }

  return data.user;
}

// Fetch a profile row and confirm it belongs to the user. Sends 404 and
// returns null on failure.
export async function requireOwnProfile(res, userId, profileId) {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('id', profileId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error || !data) {
    res.status(404).json({ ok: false, error: 'Profile not found.', code: 'PROFILE_NOT_FOUND' });
    return null;
  }
  return data;
}
