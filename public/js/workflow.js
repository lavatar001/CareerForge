// Guided workflow: hash router, step states, rail + bottom nav, the Forge,
// and the Overview "next best action". Everything is derived from the
// in-memory Profile JSON (state.js) — no parallel data shape.
import { state, isEnhanced, enhancedRoleIds, skillCount } from './state.js';
import { t, applyI18n } from './i18n.js';
import { icon, hydrateIcons } from './icons.js';
import { renderProfileView, renderEnhanceView, renderAtsView } from './profile.js';

const $ = (id) => document.getElementById(id);

// Ordered workflow. `n` is the visible step number (overview has none).
const STEPS = [
  { id: 'overview', n: null, label: 'nav_overview', short: 'short_overview', icon: 'overview' },
  { id: 'upload', n: 1, label: 'step_upload', short: 'short_upload', icon: 'upload' },
  { id: 'profile', n: 2, label: 'step_profile', short: 'short_profile', icon: 'user' },
  { id: 'enhance', n: 3, label: 'step_enhance', short: 'short_enhance', icon: 'sparkles' },
  { id: 'match', n: 4, label: 'step_match', short: 'short_match', icon: 'target' },
  { id: 'apply', n: 5, label: 'step_apply', short: null, icon: 'send' },
];
const GATED = new Set(['profile', 'enhance', 'match']);

let currentView = null;

function esc(s) {
  const div = document.createElement('div');
  div.textContent = s ?? '';
  return div.innerHTML;
}

// ─── Derived workflow facts ───────────────────────────────────────────

function facts() {
  const p = state.profile;
  const roles = p?.experience || [];
  return {
    hasProfile: Boolean(p),
    completeness: p?.completeness?.score ?? 0,
    missingSections: p?.completeness?.missing || [],
    roles: roles.length,
    enhancedCount: enhancedRoleIds(p).length,
    enhanced: isEnhanced(p),
    skills: skillCount(p),
    ats: state.lastAts,
  };
}

// done | next | todo | locked  (+ meta text for the rail)
function stepStates() {
  const f = facts();
  const done = {
    overview: false,
    upload: f.hasProfile,
    profile: f.hasProfile,
    enhance: f.enhanced,
    match: Boolean(f.ats),
    apply: false,
  };
  const next = state.loaded ? ['upload', 'enhance', 'match'].find((id) => !done[id]) || null : null;

  const meta = {
    profile: f.hasProfile ? `${f.completeness}%` : '',
    enhance: f.hasProfile && f.roles ? `${f.enhancedCount}/${f.roles}` : '',
    match: f.ats ? String(f.ats.score) : '',
    apply: t('soon'),
  };

  const out = {};
  for (const s of STEPS) {
    let st = 'todo';
    if (s.id === 'apply') st = 'locked';
    else if (done[s.id]) st = 'done';
    else if (s.id === next) st = 'next';
    out[s.id] = { state: st, meta: meta[s.id] || '' };
  }
  return out;
}

function nextAction() {
  const f = facts();
  if (!f.hasProfile) {
    return { title: 'next_upload_title', desc: 'next_upload_desc', cta: 'cta_upload', href: '#upload', cost: 'cost_free' };
  }
  if (!f.enhanced) {
    return { title: 'next_enhance_title', desc: 'next_enhance_desc', cta: 'cta_enhance', href: '#enhance', cost: 'cost_1' };
  }
  if (!f.ats) {
    return { title: 'next_match_title', desc: 'next_match_desc', cta: 'cta_match', href: '#match', cost: 'cost_1' };
  }
  const missing = f.ats.missing_keywords?.length || 0;
  if (missing > 0) {
    return { title: 'next_gap_title', desc: 'next_gap_desc', vars: { n: missing }, cta: 'cta_review', href: '#match', cost: null };
  }
  return { title: 'next_ready_title', desc: 'next_ready_desc', cta: 'cta_match', href: '#match', cost: 'cost_1' };
}

// ─── The Forge (signature) ────────────────────────────────────────────

export function renderForge(el, tubes) {
  if (!el) return;
  const signature = JSON.stringify(tubes);
  if (el.dataset.signature === signature) return; // unchanged — don't re-pour
  el.dataset.signature = signature;

  el.innerHTML =
    '<div class="forge-dish"></div>' +
    tubes
      .map((tb) => {
        const fill = tb.locked ? 0 : Math.max(0, Math.min(100, tb.value ?? 0));
        const variant = tb.variant ? ` is-${tb.variant}` : '';
        return `
        <div class="tube-wrap">
          <span class="tube-value">${tb.locked ? '&nbsp;' : esc(tb.display)}</span>
          <div class="tube" style="--h: calc(var(--tube-h) * ${tb.ratio})">
            <div class="tube-gloss"></div>
            <div class="tube-fill${variant}" style="--fill: 0" data-fill="${fill}"></div>
            ${tb.locked ? `<div class="tube-lock">${icon('lock')}</div>` : ''}
          </div>
          <span class="tube-label">${esc(tb.label)}</span>
        </div>`;
      })
      .join('');
  el.setAttribute('aria-label', tubes.map((tb) => `${tb.label}: ${tb.locked ? t('soon') : tb.display}`).join(', '));
  // Pour after paint so the transform transition runs.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      el.querySelectorAll('.tube-fill').forEach((f) => f.style.setProperty('--fill', f.dataset.fill));
    })
  );
}

function forgeTubes() {
  const f = facts();
  const enhancedPct = f.roles ? Math.round((f.enhancedCount / f.roles) * 100) : 0;
  const atsScore = f.ats?.score ?? null;
  return [
    { label: t('forge_profile'), value: f.completeness, display: f.hasProfile ? `${f.completeness}%` : '—', ratio: 0.82 },
    { label: t('forge_enhanced'), value: enhancedPct, display: f.hasProfile ? `${enhancedPct}%` : '—', ratio: 1 },
    {
      label: t('forge_ats'),
      value: atsScore ?? 0,
      display: atsScore === null ? '—' : String(atsScore),
      ratio: 0.9,
      variant: atsScore === null ? null : atsScore >= 75 ? 'mint' : atsScore < 50 ? 'saffron' : null,
    },
    { label: t('forge_kit'), locked: true, ratio: 0.7 },
  ];
}

// ─── Navigation chrome ────────────────────────────────────────────────

function renderRail(states) {
  const list = $('rail-steps');
  if (!list) return;
  list.innerHTML = STEPS.map((s) => {
    const st = states[s.id];
    const dot =
      s.n === null
        ? icon('overview', 'w-4 h-4')
        : st.state === 'done'
          ? icon('check', 'w-4 h-4')
          : st.state === 'locked'
            ? icon('lock', 'w-4 h-4')
            : s.n;
    const current = s.id === currentView ? ' aria-current="page"' : '';
    return `
      <li>
        <a href="#${s.id}" class="step-link" data-state="${st.state}"${current}>
          <span class="step-dot">${dot}</span>
          <span class="truncate">${esc(t(s.label))}</span>
          ${st.meta ? `<span class="step-meta">${esc(st.meta)}</span>` : ''}
        </a>
      </li>`;
  }).join('');
}

function renderBottomNav(states) {
  const nav = $('bottom-nav');
  if (!nav) return;
  nav.innerHTML = STEPS.filter((s) => s.short)
    .map((s) => {
      const st = states[s.id].state;
      const current = s.id === currentView ? ' aria-current="page"' : '';
      return `<a href="#${s.id}" data-state="${st}"${current}>${icon(
        st === 'done' && s.n ? 'check-circle' : s.icon
      )}<span>${esc(t(s.short))}</span></a>`;
    })
    .join('');
}

function renderHeader() {
  const step = STEPS.find((s) => s.id === currentView) || STEPS[0];
  const title = t(step.label);
  $('view-title').textContent = title;
  $('view-kicker').textContent = step.n ? t('step_of', { n: step.n }) : 'CareerForge';
  document.title = `${title} — CareerForge`;
}

// ─── Overview ─────────────────────────────────────────────────────────

function statTile(iconName, value, label, href) {
  return `
    <a href="${href}" class="glass glass-sm stat-tile group hover:bg-white/80 transition-colors">
      <span class="flex items-center justify-between">
        <span class="icon-tile !w-9 !h-9 !rounded-xl">${icon(iconName, '!w-[18px] !h-[18px]')}</span>
        <span class="text-mute opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity">${icon('arrow-up-right', 'w-4 h-4')}</span>
      </span>
      <span class="stat-value mt-3">${esc(value)}</span>
      <span class="stat-label">${esc(label)}</span>
    </a>`;
}

function renderOverview() {
  const f = facts();
  const name = state.profile?.contact?.full_name?.trim().split(/\s+/)[0];
  $('ov-greeting').textContent = name ? t('greeting', { name }) : t('greeting_anon');

  if (!state.loaded) {
    $('ov-next-title').innerHTML = '<span class="skeleton block h-9 w-4/5 opacity-30"></span>';
    $('ov-next-desc').innerHTML = '<span class="skeleton block h-4 w-3/5 mt-2 opacity-30"></span>';
    $('ov-next-cta').classList.add('invisible');
    $('ov-next-cost').classList.add('hidden');
  } else {
    const a = nextAction();
    $('ov-next-title').textContent = t(a.title, a.vars);
    $('ov-next-desc').textContent = t(a.desc, a.vars);
    $('ov-next-cta').classList.remove('invisible');
    $('ov-next-cta').setAttribute('href', a.href);
    $('ov-next-cta-label').textContent = t(a.cta);
    $('ov-next-cost').classList.toggle('hidden', !a.cost);
    if (a.cost) $('ov-next-cost').textContent = t(a.cost);
  }

  renderForge($('ov-forge'), forgeTubes());

  $('ov-stats').innerHTML = [
    statTile('user', f.hasProfile ? `${f.completeness}%` : '—', t('stat_completeness'), '#profile'),
    statTile('briefcase', f.hasProfile ? String(f.roles) : '—', t('stat_roles'), '#profile'),
    statTile('award', f.hasProfile ? String(f.skills) : '—', t('stat_skills'), '#profile'),
    statTile('target', f.ats ? String(f.ats.score) : '—', t('stat_ats'), '#match'),
  ].join('');

  // Profile gaps card
  const gaps = $('ov-gaps');
  if (!f.hasProfile) {
    gaps.innerHTML = `<p class="text-sm text-mute">${esc(t('profile_empty'))}</p>`;
  } else if (!f.missingSections.length) {
    gaps.innerHTML = `<p class="alert alert-success !mt-0">${icon('check-circle')}<span>${esc(t('card_gaps_empty'))}</span></p>`;
  } else {
    gaps.innerHTML = `
      <div class="flex flex-wrap gap-1.5">${f.missingSections
        .map((m) => `<span class="chip chip-saffron">${icon('plus')}${esc(t(`sec_${m}`))}</span>`)
        .join('')}</div>
      <p class="text-sm text-mute mt-3 leading-relaxed">${esc(t('card_gaps_hint'))}</p>`;
  }

  // Keyword gap card
  const kw = $('ov-keywords');
  const missing = f.ats?.missing_keywords || [];
  if (!f.ats) {
    kw.innerHTML = `<p class="text-sm text-mute leading-relaxed">${esc(t('card_keywords_empty'))}</p>`;
  } else if (!missing.length) {
    kw.innerHTML = `<p class="alert alert-success !mt-0">${icon('check-circle')}<span>${esc(t('ats_missing_none'))}</span></p>`;
  } else {
    const shown = missing.slice(0, 14);
    const extra = missing.length - shown.length;
    kw.innerHTML = `<div class="flex flex-wrap gap-1.5">${shown
      .map((k) => `<span class="chip chip-saffron chip-key">${esc(k)}</span>`)
      .join('')}${extra > 0 ? `<span class="chip chip-key">+${extra}</span>` : ''}</div>`;
  }
}

// ─── Gates (views that need a profile) ────────────────────────────────

function renderGates() {
  document.querySelectorAll('[data-view]').forEach((section) => {
    const gate = section.querySelector('[data-gate]');
    const gated = section.querySelector('[data-gated]');
    if (!gate || !gated) return;
    const blocked = GATED.has(section.dataset.view) && (!state.loaded || !state.profile);
    gated.classList.toggle('hidden', blocked);
    gate.classList.toggle('hidden', !blocked);
    if (!blocked) return;
    gate.innerHTML = !state.loaded
      ? `<div class="glass p-7 space-y-4" aria-hidden="true">
           <div class="skeleton h-7 w-1/3"></div><div class="skeleton h-4 w-2/3"></div><div class="skeleton h-4 w-1/2"></div>
         </div>`
      : `<div class="glass gate-card">
           <span class="icon-tile !w-14 !h-14">${icon('file-text', '!w-6 !h-6')}</span>
           <p class="font-display text-xl font-semibold max-w-md">${esc(t('profile_empty'))}</p>
           <a href="#upload" class="btn btn-primary">${icon('upload')}<span>${esc(t('cta_upload'))}</span></a>
         </div>`;
  });

  $('upload-replace')?.classList.toggle('hidden', !state.profile);
}

// ─── Router ───────────────────────────────────────────────────────────

function viewFromHash() {
  const id = (location.hash || '').replace(/^#/, '');
  return STEPS.some((s) => s.id === id) ? id : 'overview';
}

function showView(id, { focus = false } = {}) {
  currentView = id;
  document.querySelectorAll('[data-view]').forEach((el) => {
    el.classList.toggle('is-active', el.dataset.view === id);
  });
  renderAll();
  if (focus) {
    window.scrollTo(0, 0);
    $('view-title')?.focus({ preventScroll: true });
  }
}

export function renderAll() {
  if (!currentView) return;
  const states = stepStates();
  renderRail(states);
  renderBottomNav(states);
  renderHeader();
  renderGates();
  renderOverview();
  renderProfileView();
  renderEnhanceView();
  renderAtsView();
  hydrateIcons($('view-app'));
  applyI18n($('view-app'));
}

export function initWorkflow() {
  window.addEventListener('hashchange', () => showView(viewFromHash(), { focus: true }));
  document.addEventListener('cf:state', renderAll);
  document.addEventListener('cf:langchange', () => {
    const forge = $('ov-forge');
    if (forge) delete forge.dataset.signature; // labels changed — rebuild
    renderAll();
  });
  showView(viewFromHash());
}
