// Profile / Enhance / Match views + the two AI-backed forms.
// Reads and writes the canonical Profile JSON via state.js; workflow.js
// re-renders on every `cf:state` event, so handlers only mutate state.
import { supabase, api } from './supabaseClient.js';
import { t, getLang } from './i18n.js';
import { icon } from './icons.js';
import { state, setProfile, setCredits, setLastAts, diffFromProfile, enhancedRoleIds } from './state.js';

const $ = (id) => document.getElementById(id);

// Re-exported for existing importers.
export { setCredits };

function esc(s) {
  const div = document.createElement('div');
  div.textContent = s ?? '';
  return div.innerHTML;
}

// YYYY-MM → localized "Mar 2021"; "present" → translated.
function fmtDate(d) {
  if (!d) return '';
  if (d === 'present') return t('present');
  const m = /^(\d{4})-(\d{2})$/.exec(d);
  if (!m) return d;
  try {
    return new Intl.DateTimeFormat(getLang(), { month: 'short', year: 'numeric' }).format(
      new Date(Number(m[1]), Number(m[2]) - 1, 1)
    );
  } catch {
    return d;
  }
}

function range(start, end) {
  const a = fmtDate(start);
  const b = fmtDate(end);
  return a || b ? `${a}${a && b ? ' — ' : ''}${b}` : '';
}

function chip(text, cls = '') {
  return `<span class="chip ${cls}">${esc(text)}</span>`;
}

function emptyLine() {
  return `<p class="text-sm text-mute">${esc(t('no_entries'))}</p>`;
}

function initials(name) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

function setStatus(id, text, kind = 'info') {
  const el = $(id);
  if (!el) return;
  if (!text) {
    el.className = 'hidden';
    el.innerHTML = '';
    return;
  }
  const iconName = kind === 'error' ? 'alert' : kind === 'success' ? 'check-circle' : 'info';
  el.className = `alert alert-${kind}`;
  el.innerHTML = `${icon(iconName)}<span>${esc(text)}</span>`;
}

function setBusy(btn, busy) {
  btn.disabled = busy;
  btn.setAttribute('aria-busy', String(busy));
}

// ─── Profile view ─────────────────────────────────────────────────────

export function renderProfileView() {
  const profile = state.profile;
  if (!profile || !$('p-name')) return;

  const c = profile.contact || {};
  const ini = initials(c.full_name);
  $('p-initials').innerHTML = ini ? esc(ini) : icon('user', 'w-7 h-7');
  $('p-name').textContent = c.full_name || '—';
  $('p-headline').textContent = profile.headline || '';
  $('p-headline').classList.toggle('hidden', !profile.headline);

  const place = [c.location?.city, c.location?.country].filter(Boolean).join(', ');
  const contactBits = [
    c.email && `<span class="chip">${icon('mail')}${esc(c.email)}</span>`,
    c.phone && `<span class="chip font-mono" dir="ltr">${icon('phone')}${esc(c.phone)}</span>`,
    place && `<span class="chip">${icon('map-pin')}${esc(place)}</span>`,
    c.links?.linkedin && `<span class="chip">${icon('globe')}${esc(c.links.linkedin.replace(/^https?:\/\/(www\.)?/, ''))}</span>`,
  ].filter(Boolean);
  $('p-contact').innerHTML = contactBits.join('');

  $('p-summary').textContent = profile.summary || '';
  $('p-summary').classList.toggle('hidden', !profile.summary);

  // Experience timeline
  const enhanced = new Set(enhancedRoleIds(profile));
  const roles = profile.experience || [];
  $('p-exp-count').textContent = String(roles.length);
  $('p-experience').innerHTML = roles.length
    ? roles
        .map((exp) => {
          const bullets = exp.bullets || [];
          const badge = enhanced.has(exp.id)
            ? `<span class="badge chip-mint">${icon('sparkles')}${esc(t('badge_enhanced'))}</span>`
            : `<span class="badge bg-white text-[var(--ink-mute)] border border-[#e1e3f3]">${esc(t('badge_original'))}</span>`;
          return `
          <li class="timeline-item">
            <div class="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
              <div class="min-w-0">
                <h4 class="font-semibold text-ink">${esc(exp.title) || '—'}</h4>
                <p class="text-sm text-iris font-medium">${esc(exp.company)}${exp.location ? ` · <span class="text-mute font-normal">${esc(exp.location)}</span>` : ''}</p>
              </div>
              <div class="flex items-center gap-2 shrink-0">
                <span class="font-mono text-xs text-mute">${esc(range(exp.start_date, exp.end_date))}</span>
                ${badge}
              </div>
            </div>
            ${
              bullets.length
                ? `<ul class="mt-3 space-y-1.5 text-sm text-soft leading-relaxed list-disc ps-5 marker:text-[#a5a8d8]">${bullets
                    .map((b) => `<li>${esc(b)}</li>`)
                    .join('')}</ul>`
                : `<p class="mt-2 text-sm text-mute">${esc(t('no_bullets'))}</p>`
            }
          </li>`;
        })
        .join('')
    : `<li>${emptyLine()}</li>`;

  // Completeness
  const score = profile.completeness?.score ?? 0;
  const missing = profile.completeness?.missing || [];
  const ring = $('p-ring');
  ring.style.setProperty('--ring-color', score >= 85 ? 'var(--mint)' : score >= 60 ? 'var(--iris)' : 'var(--saffron-bright)');
  requestAnimationFrame(() => ring.style.setProperty('--val', score));
  $('p-ring-value').textContent = `${score}%`;
  $('p-missing-summary').textContent = missing.length ? `${missing.length} · ${t('missing_label')}` : t('card_gaps_empty');
  $('p-missing').innerHTML = missing
    .map((m) => `<span class="chip chip-saffron">${icon('plus')}${esc(t(`sec_${m}`))}</span>`)
    .join('');

  // Skills / languages / education
  const s = profile.skills || {};
  const skillChips = [
    ...(s.hard || []).map((x) => chip(x, 'chip-iris')),
    ...(s.tools || []).map((x) => chip(x, 'chip-key')),
    ...(s.soft || []).map((x) => chip(x)),
  ];
  $('p-skills').innerHTML = skillChips.length ? skillChips.join('') : emptyLine();

  const langs = profile.languages || [];
  $('p-languages').innerHTML = langs.length
    ? langs
        .map(
          (l) =>
            `<span class="chip">${esc(l.language)}${l.proficiency ? `<span class="font-mono text-[0.7rem] text-mute">· ${esc(l.proficiency)}</span>` : ''}</span>`
        )
        .join('')
    : emptyLine();

  const edu = profile.education || [];
  $('p-education').innerHTML = edu.length
    ? edu
        .map(
          (e) => `
        <div class="flex gap-3">
          <span class="icon-tile !w-9 !h-9 !rounded-xl">${icon('graduation', '!w-[18px] !h-[18px]')}</span>
          <div class="min-w-0">
            <p class="text-sm font-semibold text-ink">${esc(e.degree)}${e.field ? ` — ${esc(e.field)}` : ''}</p>
            <p class="text-sm text-soft">${esc(e.institution)}</p>
            <p class="font-mono text-xs text-mute mt-0.5">${esc(range(e.start_date, e.end_date))}</p>
          </div>
        </div>`
        )
        .join('')
    : emptyLine();
}

// ─── Enhance view ─────────────────────────────────────────────────────

export function renderEnhanceView() {
  const container = $('enhance-diff');
  if (!container || !state.profile) return;

  const diff = state.lastDiff && Object.keys(state.lastDiff).length ? state.lastDiff : diffFromProfile();
  const entries = Object.entries(diff || {});
  $('enhance-next').classList.toggle('hidden', !entries.length);
  $('enhance-next').classList.toggle('flex', entries.length > 0);

  if (!entries.length) {
    container.innerHTML = `
      <div class="rounded-[20px] border-[1.5px] border-dashed border-[#c9cbea] p-8 text-center flex flex-col items-center gap-3">
        <span class="icon-tile">${icon('sparkles')}</span>
        <p class="text-soft max-w-sm">${esc(t('enhance_empty_diff'))}</p>
      </div>`;
    return;
  }

  container.innerHTML = entries
    .map(([id, { before, after }]) => {
      const exp = (state.profile.experience || []).find((e) => e.id === id);
      return `
      <article class="rounded-[20px] bg-white/80 border border-[#e4e6f4] p-5">
        <header class="flex flex-wrap items-center justify-between gap-2">
          <h4 class="font-semibold text-ink">${esc(exp?.title || id)}${exp?.company ? ` <span class="text-mute font-normal">· ${esc(exp.company)}</span>` : ''}</h4>
          <span class="badge chip-mint">${icon('sparkles')}${esc(t('badge_enhanced'))}</span>
        </header>
        <div class="grid md:grid-cols-2 gap-5 mt-4 text-sm leading-relaxed">
          <div>
            <p class="eyebrow !text-[var(--ink-mute)]">${esc(t('diff_before'))}</p>
            <ul class="diff-before list-disc ps-5 mt-2 space-y-1.5">${(before || []).map((b) => `<li>${esc(b)}</li>`).join('')}</ul>
          </div>
          <div class="md:border-s md:ps-5 border-[#e4e6f4]">
            <p class="eyebrow">${esc(t('diff_after'))}</p>
            <ul class="diff-after list-disc ps-5 mt-2 space-y-1.5">${(after || []).map((b) => `<li>${esc(b)}</li>`).join('')}</ul>
          </div>
        </div>
      </article>`;
    })
    .join('');
}

// ─── Match (ATS) view ─────────────────────────────────────────────────

const WEIGHTS = [
  { key: 'keyword', label: 'breakdown_keyword', w: 0.6 },
  { key: 'sections', label: 'breakdown_sections', w: 0.25 },
  { key: 'formatting', label: 'breakdown_formatting', w: 0.15 },
];

function band(score) {
  if (score >= 75) return { label: 'band_strong', ring: 'var(--mint)', text: 'var(--mint)' };
  if (score >= 50) return { label: 'band_fair', ring: 'var(--iris)', text: 'var(--iris-deep)' };
  return { label: 'band_low', ring: 'var(--saffron-bright)', text: 'var(--saffron)' };
}

export function renderAtsView() {
  if (!$('ats-weights')) return;

  $('ats-weights').innerHTML = WEIGHTS.map(
    (w) => `
      <li class="flex items-center gap-3">
        <span class="font-mono text-xs text-iris w-12 shrink-0">×${w.w.toFixed(2)}</span>
        <span class="text-soft">${esc(t(w.label))}</span>
      </li>`
  ).join('');

  const d = state.lastAts;
  $('ats-empty').classList.toggle('hidden', Boolean(d));
  $('ats-result').classList.toggle('hidden', !d);
  if (!d) return;

  const score = Math.round(d.score ?? 0);
  const b = band(score);
  const ring = $('ats-ring');
  ring.style.setProperty('--ring-color', b.ring);
  $('ats-score-value').textContent = score;
  $('ats-band').textContent = t(b.label);
  $('ats-band').style.color = b.text;

  const breakdown = d.breakdown || {};
  $('ats-breakdown').innerHTML = WEIGHTS.map((w) => {
    const v = Math.round(Number(breakdown[w.key]) || 0);
    return `
      <div>
        <dt class="flex items-center justify-between text-sm">
          <span class="text-soft">${esc(t(w.label))} <span class="font-mono text-[0.7rem] text-mute">×${w.w.toFixed(2)}</span></span>
          <span class="font-mono font-medium">${v}%</span>
        </dt>
        <dd class="bar mt-1.5"><span data-p="${v / 100}"></span></dd>
      </div>`;
  }).join('');

  const missing = d.missing_keywords || [];
  const matched = d.matched_keywords || [];
  $('ats-missing').innerHTML = missing.length
    ? missing.map((k) => chip(k, 'chip-saffron chip-key')).join('')
    : `<p class="text-sm text-[var(--mint)]">${esc(t('ats_missing_none'))}</p>`;
  $('ats-matched').innerHTML = matched.length
    ? matched.map((k) => chip(k, 'chip-mint chip-key')).join('')
    : `<p class="text-sm text-mute">${esc(t('ats_matched_none'))}</p>`;

  // Animate ring + bars from zero after paint.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      ring.style.setProperty('--val', score);
      $('ats-breakdown')
        .querySelectorAll('.bar > span')
        .forEach((s) => s.style.setProperty('--p', s.dataset.p));
    })
  );
}

// ─── Data loading ─────────────────────────────────────────────────────

// Latest ATS score for this profile — read directly (RLS: own rows only).
async function loadLatestAts(profileId) {
  if (!supabase || !profileId) return null;
  try {
    const { data, error } = await supabase
      .from('ats_scores')
      .select('score, matched_keywords, missing_keywords, breakdown, created_at')
      .eq('profile_id', profileId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return null;
    return data || null;
  } catch {
    return null;
  }
}

// Direct RLS-protected read (own rows only) — used when /api/profile is
// unreachable, e.g. a static preview without the serverless functions.
async function loadProfileDirect() {
  try {
    const [profileRes, creditsRes] = await Promise.all([
      supabase.from('profiles').select('id, data, updated_at').eq('is_primary', true).maybeSingle(),
      supabase.from('credits').select('balance').maybeSingle(),
    ]);
    if (profileRes.error && creditsRes.error) return null;
    const row = profileRes.data;
    return {
      ok: true,
      data: row ? { profile_id: row.id, profile: row.data, updated_at: row.updated_at } : null,
      credits_remaining: creditsRes.data?.balance ?? null,
    };
  } catch {
    return null;
  }
}

export async function loadProfile() {
  let result = await api('/api/profile');
  if (!result.ok) result = await loadProfileDirect();
  if (!result?.ok) {
    setProfile(null, null);
    return;
  }
  setCredits(result.credits_remaining);
  const data = result.data;
  if (!data) {
    setProfile(null, null);
    return;
  }
  state.lastAts = await loadLatestAts(data.profile_id);
  setProfile(data.profile_id, data.profile);
}

// ─── Forms ────────────────────────────────────────────────────────────

export function initPanels() {
  // Default the output language to the UI language until the user picks one.
  const langSelect = $('enhance-lang');
  langSelect.value = getLang();
  let langTouched = false;
  langSelect.addEventListener('change', () => {
    langTouched = true;
  });
  document.addEventListener('cf:langchange', (e) => {
    if (!langTouched) langSelect.value = e.detail.lang;
  });

  $('enhance-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!state.profileId) return;

    const btn = $('enhance-submit');
    setBusy(btn, true);
    setStatus('enhance-status', t('enhance_working'));

    const result = await api('/api/enhance', {
      method: 'POST',
      body: {
        profile_id: state.profileId,
        target_role: $('enhance-role').value.trim() || undefined,
        language: langSelect.value || getLang(),
      },
    });

    setBusy(btn, false);
    setCredits(result.credits_remaining);
    if (!result.ok) {
      setStatus('enhance-status', result.error || t('error_generic'), 'error');
      return;
    }

    setStatus('enhance-status', t('enhance_done'), 'success');
    state.lastDiff = result.data.diff || null;
    setProfile(state.profileId, result.data.profile);
    if (window.matchMedia('(max-width: 1279px)').matches) {
      $('enhance-diff').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });

  $('ats-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!state.profileId) return;
    const jd = $('ats-jd').value.trim();
    if (!jd) {
      $('ats-jd').focus();
      return;
    }

    const btn = $('ats-submit');
    setBusy(btn, true);
    setStatus('ats-status', t('ats_working'));

    const result = await api('/api/ats-score', {
      method: 'POST',
      body: { profile_id: state.profileId, job_description: jd },
    });

    setBusy(btn, false);
    setCredits(result.credits_remaining);
    if (!result.ok) {
      setStatus('ats-status', result.error || t('error_generic'), 'error');
      return;
    }

    setStatus('ats-status', null);
    setLastAts(result.data);
    if (window.matchMedia('(max-width: 1279px)').matches) {
      $('ats-result').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
}
