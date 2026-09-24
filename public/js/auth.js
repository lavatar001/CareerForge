// Sign-in / sign-up / session handling. Switches boot → auth screen or workspace.
import { supabase, isConfigured } from './supabaseClient.js';
import { t } from './i18n.js';
import { icon } from './icons.js';
import { loadProfile } from './profile.js';
import { state, resetState } from './state.js';

const $ = (id) => document.getElementById(id);

let mode = 'signin'; // 'signin' | 'signup'
let currentUserId = null;

function showAuthMessage(text, kind = 'error') {
  const el = $('auth-message');
  if (!text) {
    el.className = 'hidden';
    el.innerHTML = '';
    return;
  }
  el.className = `alert alert-${kind}`;
  const span = document.createElement('span');
  span.textContent = text;
  el.innerHTML = icon(kind === 'error' ? 'alert' : 'info');
  el.appendChild(span);
}

// supabase-js surfaces unreachable hosts as a raw "Failed to fetch" TypeError.
function isNetworkError(err) {
  const msg = String(err?.message || '');
  return err?.name === 'AuthRetryableFetchError' || err instanceof TypeError || /failed to fetch|networkerror|load failed/i.test(msg);
}

function setView(signedIn) {
  $('view-boot').classList.add('hidden');
  $('view-auth').classList.toggle('hidden', signedIn);
  $('view-app').classList.toggle('hidden', !signedIn);
}

function renderMode() {
  const signup = mode === 'signup';
  $('auth-heading').textContent = t(signup ? 'auth_title_signup' : 'auth_title');
  $('auth-sub').textContent = t(signup ? 'auth_subtitle_signup' : 'auth_subtitle');
  $('auth-submit').textContent = t(signup ? 'sign_up' : 'sign_in');
  $('auth-toggle').textContent = t(signup ? 'auth_have_account' : 'auth_no_account');
  $('auth-password').setAttribute('autocomplete', signup ? 'new-password' : 'current-password');
}

export function initAuth() {
  // Deep link from the landing page: app.html?mode=signup
  if (new URLSearchParams(location.search).get('mode') === 'signup') mode = 'signup';
  renderMode();
  document.addEventListener('cf:langchange', renderMode);

  if (!isConfigured) {
    setView(false);
    showAuthMessage(t('not_configured'));
    $('auth-form').classList.add('opacity-50', 'pointer-events-none');
    return;
  }

  $('auth-toggle').addEventListener('click', () => {
    mode = mode === 'signin' ? 'signup' : 'signin';
    showAuthMessage(null);
    renderMode();
  });

  $('auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!e.currentTarget.reportValidity()) return;

    const email = $('auth-email').value.trim();
    const password = $('auth-password').value;
    const btn = $('auth-submit');
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    showAuthMessage(null);

    try {
      if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        if (!data.session) {
          showAuthMessage(t('auth_check_email'), 'info');
          return;
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err) {
      console.error('auth failed:', err);
      showAuthMessage(isNetworkError(err) ? t('error_network') : err.message || t('error_generic'));
    } finally {
      btn.disabled = false;
      btn.setAttribute('aria-busy', 'false');
    }
  });

  document.querySelectorAll('.js-signout').forEach((btn) =>
    btn.addEventListener('click', async () => {
      await supabase.auth.signOut();
    })
  );

  supabase.auth.onAuthStateChange((_event, session) => {
    const signedIn = Boolean(session);
    setView(signedIn);

    if (!signedIn) {
      currentUserId = null;
      resetState(); // drop profile PII from memory
      $('auth-password').value = '';
      return;
    }

    // Token refreshes re-fire this event — only load when the user changes.
    if (session.user.id !== currentUserId) {
      currentUserId = session.user.id;
      state.userEmail = session.user.email || '';
      document.querySelectorAll('.js-user-email').forEach((el) => {
        el.textContent = state.userEmail;
      });
      loadProfile();
    }
  });
}
