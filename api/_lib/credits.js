// Check + debit credits atomically via the debit_credits Postgres function.
// Debit BEFORE the expensive AI call; refund (grant) if the call throws.
import { supabaseAdmin } from './supabaseAdmin.js';

// Returns { ok: true, balance } or { ok: false, code, error }.
export async function debitCredits(userId, cost, reason, ref = null) {
  const { data, error } = await supabaseAdmin.rpc('debit_credits', {
    p_user_id: userId,
    p_cost: cost,
    p_reason: reason,
    p_ref: ref,
  });

  if (error) {
    console.error('debit_credits rpc failed:', error.message);
    return { ok: false, code: 'CREDITS_ERROR', error: 'Could not process credits. Try again.' };
  }
  if (data === -1) {
    return { ok: false, code: 'INSUFFICIENT_CREDITS', error: 'Not enough credits for this action.' };
  }
  return { ok: true, balance: data };
}

// Refund after a failed downstream call. Best-effort — log but never throw.
export async function refundCredits(userId, amount, reason, ref = null) {
  const { data, error } = await supabaseAdmin.rpc('grant_credits', {
    p_user_id: userId,
    p_amount: amount,
    p_reason: reason,
    p_ref: ref,
  });
  if (error) {
    console.error('grant_credits rpc failed (refund lost!):', error.message, { userId, amount, reason });
    return null;
  }
  return data;
}

export async function getBalance(userId) {
  const { data } = await supabaseAdmin
    .from('credits')
    .select('balance')
    .eq('user_id', userId)
    .maybeSingle();
  return data?.balance ?? 0;
}
