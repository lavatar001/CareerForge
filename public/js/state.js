// Single in-memory app state (no localStorage — resumes are PII).
// Modules mutate via the setters below; every change fires `cf:state`
// so workflow.js can re-render the stepper, forge and views.

export const state = {
  loaded: false,        // first /api/profile round-trip finished
  profileId: null,
  profile: null,        // canonical Profile JSON (profiles.data)
  credits: null,
  lastDiff: null,       // diff from the latest /api/enhance call this session
  lastAts: null,        // { score, matched_keywords, missing_keywords, breakdown }
  userEmail: '',
};

export function emit() {
  document.dispatchEvent(new CustomEvent('cf:state'));
}

export function setProfile(profileId, profile) {
  state.profileId = profileId || null;
  state.profile = profile || null;
  state.loaded = true;
  emit();
}

export function setCredits(balance) {
  if (balance === undefined || balance === null) return;
  state.credits = balance;
  document.querySelectorAll('.js-credits').forEach((el) => {
    el.textContent = balance;
  });
}

export function setLastAts(result) {
  state.lastAts = result || null;
  emit();
}

export function resetState() {
  state.loaded = false;
  state.profileId = null;
  state.profile = null;
  state.credits = null;
  state.lastDiff = null;
  state.lastAts = null;
  state.userEmail = '';
  document.querySelectorAll('.js-credits').forEach((el) => {
    el.textContent = '—';
  });
  emit();
}

// ─── Derived facts (read straight from the Profile JSON) ──────────────

function sameList(a = [], b = []) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

// A role counts as enhanced when its bullets differ from the parser's raw_bullets.
export function enhancedRoleIds(profile = state.profile) {
  return (profile?.experience || [])
    .filter((exp) => (exp.bullets || []).length && !sameList(exp.bullets, exp.raw_bullets))
    .map((exp) => exp.id);
}

export function isEnhanced(profile = state.profile) {
  return enhancedRoleIds(profile).length > 0;
}

// Rebuild a before/after diff from the profile itself, so the Enhance view
// survives reloads without another API call.
export function diffFromProfile(profile = state.profile) {
  const ids = new Set(enhancedRoleIds(profile));
  const diff = {};
  for (const exp of profile?.experience || []) {
    if (ids.has(exp.id)) diff[exp.id] = { before: exp.raw_bullets || [], after: exp.bullets || [] };
  }
  return diff;
}

export function skillCount(profile = state.profile) {
  const s = profile?.skills || {};
  return (s.hard || []).length + (s.tools || []).length + (s.soft || []).length;
}
