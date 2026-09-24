// Supabase browser client (anon key only — safe client-side).
import { CF_CONFIG } from './config.js';

export const isConfigured = Boolean(CF_CONFIG.SUPABASE_URL && CF_CONFIG.SUPABASE_ANON_KEY);

// supabase-js is loaded globally from the CDN in app.html.
export const supabase = isConfigured
  ? window.supabase.createClient(CF_CONFIG.SUPABASE_URL, CF_CONFIG.SUPABASE_ANON_KEY)
  : null;

// Access token for calling /api/* routes.
export async function getAccessToken() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token ?? null;
}

// Authenticated JSON fetch against our serverless API.
export async function api(path, { method = 'GET', body } = {}) {
  const token = await getAccessToken();
  const resp = await fetch(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json;
  try {
    json = await resp.json();
  } catch {
    json = { ok: false, error: 'Unexpected server response.', code: 'BAD_RESPONSE' };
  }
  return json;
}
