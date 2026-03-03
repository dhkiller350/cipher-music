/* ═══════════════════════════════════════════════════════════
   CIPHER MUSIC — Application Logic
   ═══════════════════════════════════════════════════════════ */

// ── Configuration ─────────────────────────────────────────
const CONFIG = {
  YOUTUBE_API_KEY:     "AIzaSyAxMywGGrwQ2FoXClwrOn6LmuWPuYGCKBY",
  EMAILJS_SERVICE_ID:  "service_p32tpor",
  EMAILJS_TEMPLATE_ID: "template_vjpbh3p",
  EMAILJS_PUBLIC_KEY:  "IJSM7Zp-wxJkkxVN7",
  // Admin contact email — receives payment notifications
  ADMIN_EMAIL:         'demosn505@gmail.com',
  // Admin payment server URL — set to your PHP host once deployed.
  // Leave empty ('') to disable the server-side notification.
  ADMIN_NOTIFY_URL:    '',
  // Stripe publishable key — intentionally public; designed to be included in
  // frontend code (see https://stripe.com/docs/keys).  Rotate via Stripe Dashboard.
  STRIPE_PUBLISHABLE_KEY: 'pk_live_51T6lyV7TyEikNneRz4SWf4BTz1JfiCbMGscyXZ8L9WnaJ8cV38M3UBaM8lM5JnpkvcnzMZSETx5fHSDrgJKiSUsc00FIkvKuVS',
  // Your CashApp $cashtag — customers will send payment here.
  CASHAPP_TAG: '$CIPHERPREMIUM',
  // Stripe webhook endpoint — register this URL in the Stripe Dashboard
  // under Developers → Webhooks → Add endpoint.
  // Set the CIPHER_STRIPE_WEBHOOK_SECRET env var on your server to the
  // "Signing secret" shown there (whsec_…).
  // URL: https://your-server/admin/webhook.php
  STRIPE_WEBHOOK_ENDPOINT: '/admin/webhook.php'
};

// Admin server base URL — runtime-configurable.
// Priority: 1) localStorage 'cipher_admin_server_url'
//           2) derived from CONFIG.ADMIN_NOTIFY_URL (static fallback)
//           3) empty string (server features disabled)
function _loadAdminBase() {
  const stored = (localStorage.getItem('cipher_admin_server_url') || '').trim().replace(/\/+$/, '');
  if (stored) return stored;
  if (CONFIG.ADMIN_NOTIFY_URL) return CONFIG.ADMIN_NOTIFY_URL.replace(/\/[^/]+$/, '');
  return '';
}
let ADMIN_BASE_URL      = _loadAdminBase();
let ADMIN_STATUS_URL   = ADMIN_BASE_URL ? ADMIN_BASE_URL + '/status.php'     : '';
let ADMIN_USERS_URL    = ADMIN_BASE_URL ? ADMIN_BASE_URL + '/users.php'      : '';
let ADMIN_LOG_URL      = ADMIN_BASE_URL ? ADMIN_BASE_URL + '/access_log.php' : '';
// Notify URL for payment notifications (sibling of the base)
function _adminNotifyUrl() {
  return ADMIN_BASE_URL ? ADMIN_BASE_URL + '/notify.php' : CONFIG.ADMIN_NOTIFY_URL || '';
}
/** Call after saving a new server URL to localStorage. */
function _refreshAdminUrls() {
  ADMIN_BASE_URL    = _loadAdminBase();
  ADMIN_STATUS_URL  = ADMIN_BASE_URL ? ADMIN_BASE_URL + '/status.php'     : '';
  ADMIN_USERS_URL   = ADMIN_BASE_URL ? ADMIN_BASE_URL + '/users.php'      : '';
  ADMIN_LOG_URL     = ADMIN_BASE_URL ? ADMIN_BASE_URL + '/access_log.php' : '';
}

/**
 * Send a best-effort access log event to the PHP server.
 * @param {'login'|'signup'|'access'|'logout'} event
 * @param {string} email
 * @param {string} username
 */
function _logAccessEvent(event, email, username) {
  if (!ADMIN_LOG_URL) return;
  try {
    fetch(ADMIN_LOG_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event,
        email:    email    || '',
        username: username || '',
        ua:       navigator.userAgent || '',
        ts:       Date.now()
      })
    }).catch(() => {}); // best-effort — never block the user
  } catch (_) { /* ignore */ }
}

const APP_VERSION = '2.9'; // bump to show changelog on next load

// ── API key presence check (no network call — save quota) ──
if (!CONFIG.YOUTUBE_API_KEY || CONFIG.YOUTUBE_API_KEY.length < 20) {
  console.error('[Cipher] YOUTUBE_API_KEY is missing or too short — search will not work.');
}

// ── Admin / Maintenance state ──────────────────────────────
// Loaded from localStorage so settings survive page refreshes.
const YOUTUBE_DAILY_QUOTA  = 10000;          // YouTube Data API v3 daily quota units
const MAX_DISPLAYED_LOGS   = 50;             // max entries shown in the admin log panel
const ADMIN_PIN_KEY = 'cipher_admin_pin';    // localStorage key for PIN hash
// Pre-computed SHA-256 of the default admin PIN ("5555").
const DEFAULT_ADMIN_PIN_HASH = 'c1f330d0aff31c1c87403f1e4347bcc21aff7c179908723535f2b31723702525';
const MAINT_KEY    = 'cipher_maintenance';   // localStorage key for maintenance flag
const _adminDefaults = { maintenanceMode: false, isAdminSession: false, quotaUsedToday: 0, fromOverlay: false };
const adminState = Object.assign({}, _adminDefaults);
const _adminLogs = []; // in-memory error log (max 200 entries)

/**
 * SHA-256 hash of input using Web Crypto API.
 * Returns hex string.  Async because SubtleCrypto is async.
 */
async function sha256Hex(input) {
  const encoded = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Push a message to the admin log.
 * Called by the console.error interceptor — does NOT re-call console.error
 * to avoid infinite recursion.
 */
function _pushAdminLog(msg) {
  _adminLogs.unshift({ ts: new Date().toISOString(), msg: String(msg) });
  if (_adminLogs.length > 200) _adminLogs.length = 200;
  if (document.getElementById('admin-panel')?.classList.contains('open')) {
    renderAdminLog();
  }
}

/** Log a message directly (also logs to console.error). */
function adminLog(msg) {
  _pushAdminLog(msg);
  console.error('[CipherAdmin]', msg); // intentionally uses the original console.error
}

/** Escape user-supplied strings before inserting into innerHTML. */
function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Return today's date string in US Pacific time (where YouTube resets quota). */
function _pacificDateString() {
  try {
    return new Date().toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles' });
  } catch (_) {
    return new Date().toDateString(); // fallback for browsers without Intl timezone
  }
}

// Load maintenance flag and quota from localStorage at startup
(function loadAdminState() {
  // Without a configured server, localStorage is the only source of truth for
  // maintenance mode — but a downloaded/offline copy can get permanently stuck
  // if the flag was set to '1' in a previous session and there is no remote state
  // to override it.  Clear it automatically so offline users are never locked out.
  if (!_loadAdminBase()) {
    localStorage.setItem(MAINT_KEY, '0');
  }
  adminState.maintenanceMode = localStorage.getItem(MAINT_KEY) === '1';
  // Seed default admin PIN (5555) if none has been set yet.
  if (!localStorage.getItem(ADMIN_PIN_KEY)) {
    localStorage.setItem(ADMIN_PIN_KEY, DEFAULT_ADMIN_PIN_HASH);
  }
  const quota = JSON.parse(localStorage.getItem('cipher_quota_today') || 'null');
  if (quota && quota.date === _pacificDateString()) {
    adminState.quotaUsedToday = quota.used || 0;
  } else {
    // New Pacific day — reset the counter
    adminState.quotaUsedToday = 0;
  }
  // Intercept console.error so all uncaught errors appear in the admin log.
  // Delegate to _pushAdminLog (not adminLog) to avoid calling console.error recursively.
  const _origError = console.error.bind(console);
  console.error = (...args) => {
    _origError(...args);
    const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
    _pushAdminLog(msg);
  };
})();

/** Returns ms until the next midnight in US Pacific time (when YouTube resets its daily quota). */
function _msUntilPacificMidnight() {
  try {
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false
    }).formatToParts(now);
    const h = +parts.find(p => p.type === 'hour').value;
    const m = +parts.find(p => p.type === 'minute').value;
    const s = +parts.find(p => p.type === 'second').value;
    const msIntoDay = (h * 3600 + m * 60 + s) * 1000;
    return 24 * 60 * 60 * 1000 - msIntoDay;
  } catch (_) {
    // Fallback: schedule for 24 hours from now if Intl timezone is unavailable
    return 24 * 60 * 60 * 1000;
  }
}

/** Schedule a quota reset at the next Pacific midnight, then re-schedule daily. */
function _scheduleQuotaMidnightReset() {
  setTimeout(() => {
    adminState.quotaUsedToday = 0;
    localStorage.removeItem('cipher_quota_today');
    _searchCache = {};
    _scheduleQuotaMidnightReset(); // re-schedule for the following midnight
  }, _msUntilPacificMidnight());
}

/** Persist today's quota counter to localStorage (keyed by Pacific date). */
function _saveQuota() {
  localStorage.setItem('cipher_quota_today', JSON.stringify({
    date: _pacificDateString(),
    used: adminState.quotaUsedToday
  }));
}

// ── State ──────────────────────────────────────────────────
const AD_FREQUENCY        = 5;   // songs between ads for free users
const AD_COUNTDOWN_SECS   = 5;   // seconds before ad can be skipped
const MAX_RECENT_SONGS    = 20;  // max items in recently-played list
const MAX_VIDEO_HEIGHT    = 360; // max video player height in pixels
const MAX_AVATAR_SIZE     = 2 * 1024 * 1024; // 2 MB max profile picture
const state = {
  user: null,               // { username, email, memberSince }
  currentView: 'login',
  searchResults: [],
  currentIndex: -1,
  ytPlayer: null,
  ytReady: false,
  isPlaying: false,
  selectedPlan: null,
  paymentRef: null,             // unique reference for the current payment attempt
  pendingSignup: null,      // { username, email, passwordHash }
  pendingCode: null,        // 6-digit string
  pendingReset: null,       // { email } – set during password-reset flow
  featuredLoaded: false,    // whether trending music is already loaded
  activeChip: 'trending songs 2025',
  activePlan: 'free',       // currently subscribed plan
  songsPlayed: 0,           // session play count
  minutesListened: 0,       // session listening minutes
  videoMode: false,         // whether video mode is on
  songsSinceAd: 0,          // for free-user ad counter
  deferredInstallPrompt: null,  // PWA install prompt
  queue: [],                // play queue (array of YouTube items)
  isMuted: false,           // mute state
  sleepTimerId: null,       // sleep timer timeout ID
  ratePromptShown: false,   // whether rate-app prompt was shown this session
  currentPlaylistId: null,  // currently open playlist ID
  addToPlaylistTarget: null // item waiting to be added to a playlist
};

// ── DOM helpers ────────────────────────────────────────────
const $  = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

// ── Listening-time timer ──────────────────────────────────
let _listeningTimerId = null;

function startListeningTimer() {
  if (_listeningTimerId) return;
  _listeningTimerId = setInterval(() => {
    state.minutesListened += 1 / 60; // tick every second = 1/60 of a minute
  }, 1000);
}

function stopListeningTimer() {
  if (_listeningTimerId) {
    clearInterval(_listeningTimerId);
    _listeningTimerId = null;
  }
}

// ── Wake Lock API ─────────────────────────────────────────
// Prevents the screen from turning off while music is playing.
let _wakeLock = null;

async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    if (_wakeLock) return; // already held
    _wakeLock = await navigator.wakeLock.request('screen');
    _wakeLock.addEventListener('release', () => { _wakeLock = null; });
  } catch (_) { /* not fatal */ }
}

async function releaseWakeLock() {
  if (_wakeLock) {
    try { await _wakeLock.release(); } catch (_) {}
    _wakeLock = null;
  }
}

// ── Visibility / background tracking ─────────────────────
// Tracks whether the user deliberately paused (in foreground) vs. the OS
// force-pausing the player when the screen locks or the user switches apps.
let _userExplicitlyPaused = false; // set only by the user's own tap/click
let _wasPlayingWhenHidden = false;
let _bgResumeTimer        = null;  // debounce timer for auto-resume

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    // Record playback state before iOS can fire PAUSED.
    // Also keep the flag from a PAUSED event that arrived first (race-condition).
    _wasPlayingWhenHidden = _wasPlayingWhenHidden || state.isPlaying;
  } else {
    // Coming back to foreground (screen unlocked / app switched back)
    clearTimeout(_bgResumeTimer);
    requestWakeLock();
    if (_wasPlayingWhenHidden && !_userExplicitlyPaused) {
      _wasPlayingWhenHidden = false;
      startBgAudioKeepAlive();
      // iOS may have force-paused the YouTube player while we were hidden.
      if (!state.isPlaying && state.ytPlayer && state.ytReady) {
        state.ytPlayer.playVideo();
      }
    }
    _wasPlayingWhenHidden = false;
  }
});

// ── Page Lifecycle: pagehide / freeze ─────────────────────
// On iOS/iPadOS "pagehide" fires when the page is being navigated away or
// put into the back/forward cache.  We must NOT stop audio here or it kills
// background playback.  "freeze" fires when the browser suspends the page
// (Page Lifecycle API); we simply keep the AudioContext alive.
window.addEventListener('pagehide', (e) => {
  // Keep the audio session open so music continues in the background,
  // whether the page is being cached (persisted) or navigated away.
  if (state.isPlaying) {
    startBgAudioKeepAlive();
  }
});

if ('onfreeze' in document) {
  document.addEventListener('freeze', () => {
    // Browser is freezing the page; resume AudioContext so it isn't discarded.
    if (_bgAudioCtx && _bgAudioCtx.state === 'suspended') {
      _bgAudioCtx.resume().catch(() => {});
    }
  });
}

// ── iOS Background Audio Keep-Alive ──────────────────────
// On iOS (Safari/PWA) the audio session is suspended when the screen locks
// or when the user switches apps.  Playing a near-silent 1 Hz tone via the
// Web Audio API maintains the audio session so the YouTube iframe keeps
// playing in the background.
let _bgAudioCtx    = null;
let _bgGainNode    = null;
let _bgOscillator  = null;

function startBgAudioKeepAlive() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return; // not supported

    if (!_bgAudioCtx) {
      _bgAudioCtx = new AudioContext();
      // Near-silent gain (not zero — zero can be optimized away)
      _bgGainNode = _bgAudioCtx.createGain();
      _bgGainNode.gain.value = 0.001;
      _bgGainNode.connect(_bgAudioCtx.destination);
    }

    // Resume if suspended (common after a background/foreground cycle on iOS)
    if (_bgAudioCtx.state === 'suspended') {
      _bgAudioCtx.resume().catch(err => console.debug('[BgAudio] resume failed:', err));
    }

    // Always (re-)create the oscillator — it may have been stopped/cleaned up
    // by the browser during a background→foreground cycle
    if (_bgOscillator) {
      try { _bgOscillator.stop(); } catch (_) {}
    }
    _bgOscillator = _bgAudioCtx.createOscillator();
    _bgOscillator.frequency.value = 1;  // 1 Hz sub-audible (inaudible at 0.001 gain)
    _bgOscillator.connect(_bgGainNode);
    _bgOscillator.start();
  } catch (err) {
    console.debug('[BgAudio] startBgAudioKeepAlive failed:', err);
  }
}

function stopBgAudioKeepAlive() {
  if (_bgOscillator) {
    try { _bgOscillator.stop(); } catch (_) {}
    _bgOscillator = null;
  }
  if (_bgAudioCtx) {
    try { _bgAudioCtx.suspend(); } catch (err) {
      console.debug('[BgAudio] suspend failed:', err);
    }
  }
}

// ── Media Session API ─────────────────────────────────────
// Shows Now Playing info on the OS lock screen and enables
// hardware media keys (headphones, lock-screen controls).
function updateMediaSession(item) {
  if (!('mediaSession' in navigator)) return;
  const title   = decodeHTMLEntities(item.snippet?.title || '');
  const artist  = item.snippet?.channelTitle || 'Cipher Music';
  const thumb   = item.snippet?.thumbnails?.high?.url
               || item.snippet?.thumbnails?.medium?.url
               || '';

  navigator.mediaSession.metadata = new MediaMetadata({
    title,
    artist,
    album: 'Cipher Music',
    artwork: thumb ? [
      { src: thumb, sizes: '480x360', type: 'image/jpeg' },
      { src: thumb, sizes: '320x180', type: 'image/jpeg' }
    ] : []
  });

  navigator.mediaSession.setActionHandler('play',          () => { state.ytPlayer?.playVideo();  });
  navigator.mediaSession.setActionHandler('pause',         () => { state.ytPlayer?.pauseVideo(); });
  navigator.mediaSession.setActionHandler('previoustrack', () => playPrev());
  navigator.mediaSession.setActionHandler('nexttrack',     () => playNext());
  navigator.mediaSession.setActionHandler('stop',          () => { state.ytPlayer?.stopVideo(); });

  // Lock-screen shuffle/repeat actions (supported on Android Chrome / some iOS versions)
  try {
    navigator.mediaSession.setActionHandler('shuffle', () => toggleShuffle());
  } catch (_) {}
  try {
    navigator.mediaSession.setActionHandler('togglerepeat', () => cycleRepeat());
  } catch (_) {}

  // Seek backward / forward (10-second steps) — best-effort on YT embeds
  const seekStep = 10;
  try {
    navigator.mediaSession.setActionHandler('seekbackward', (details) => {
      const step = details?.seekOffset ?? seekStep;
      const current = state.ytPlayer?.getCurrentTime?.() ?? 0;
      state.ytPlayer?.seekTo(Math.max(0, current - step), true);
    });
  } catch (_) {}
  try {
    navigator.mediaSession.setActionHandler('seekforward', (details) => {
      const step = details?.seekOffset ?? seekStep;
      const current = state.ytPlayer?.getCurrentTime?.() ?? 0;
      state.ytPlayer?.seekTo(current + step, true);
    });
  } catch (_) {}
}

/** Cycle repeat mode: off → all → one → off */
function cycleRepeat() {
  const settings = JSON.parse(localStorage.getItem('cipher_settings') || '{}');
  const order    = ['off', 'all', 'one'];
  const idx      = order.indexOf(settings.repeatMode || 'off');
  settings.repeatMode = order[(idx + 1) % order.length];
  localStorage.setItem('cipher_settings', JSON.stringify(settings));
  // Sync the <select> on the settings page (if visible)
  const sel = $('#repeat-mode');
  if (sel) sel.value = settings.repeatMode;
  // Update the player-bar repeat button appearance
  updateRepeatButton(settings.repeatMode);
}

/** Update the player-bar repeat button visual state. */
function updateRepeatButton(mode) {
  const btn = $('#btn-repeat');
  if (!btn) return;
  btn.dataset.mode = mode || 'off';
  const titles = { off: 'Repeat: Off', all: 'Repeat: All', one: 'Repeat: One' };
  btn.title = titles[mode] || 'Repeat: Off';
  btn.classList.toggle('active',  mode === 'all' || mode === 'one');
  btn.classList.toggle('repeat-one', mode === 'one');
  btn.setAttribute('aria-pressed', String(mode !== 'off'));
}

// ═══════════════════════════════════════════════════════════
// CLOCK & GREETING
// ═══════════════════════════════════════════════════════════
function updateClock() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const clockEl = $('#clock-display');
  if (clockEl) clockEl.textContent = `${hh}:${mm}:${ss}`;

  const h = now.getHours();
  let greeting = 'Good Evening';
  if (h >= 5  && h < 12) greeting = 'Good Morning';
  else if (h >= 12 && h < 18) greeting = 'Good Afternoon';
  const greetEl = $('#greeting-text');
  if (greetEl) greetEl.textContent = greeting;
}

// ═══════════════════════════════════════════════════════════
// TOAST NOTIFICATIONS
// ═══════════════════════════════════════════════════════════
function showToast(message, type = 'info', duration = 4000) {
  const container = $('#toast-container');
  if (!container) return;

  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span>${icons[type] || ''}</span><span>${escapeHTML(message)}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-out');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
  }, duration);
}

// ═══════════════════════════════════════════════════════════
// PASSWORD HASHING (Web Crypto API)
// ═══════════════════════════════════════════════════════════
async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// ═══════════════════════════════════════════════════════════
// ACCOUNTS (multi-user localStorage)
// ═══════════════════════════════════════════════════════════
function getAccounts() {
  try { return JSON.parse(localStorage.getItem('cipher_accounts') || '[]'); } catch { return []; }
}

function saveAccount(account) {
  const accounts = getAccounts();
  accounts.push(account);
  localStorage.setItem('cipher_accounts', JSON.stringify(accounts));
  // Sync to server so the admin can see users from all devices
  if (ADMIN_USERS_URL) {
    fetch(ADMIN_USERS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: account.username, email: account.email, memberSince: account.memberSince })
    }).catch(() => {}); // best-effort, never block the user
  }
}

function findAccount(emailOrUsername) {
  const needle = emailOrUsername.toLowerCase();
  return getAccounts().find(a =>
    a.email.toLowerCase() === needle || a.username.toLowerCase() === needle
  );
}

// ═══════════════════════════════════════════════════════════
// AUTH — Session
// ═══════════════════════════════════════════════════════════
function loadUser() {
  const stored = localStorage.getItem('cipher_user');
  if (stored) {
    try { state.user = JSON.parse(stored); } catch { /* ignore */ }
  }
  // If the currently signed-in user's email was banned, sign them out and show banned view
  if (state.user) {
    const banned = JSON.parse(localStorage.getItem('cipher_banned_emails') || '[]');
    if (banned.some(e => e.toLowerCase() === state.user.email.toLowerCase())) {
      clearUser();
      showBannedView();
      return;
    }
  }
}

function saveUser(user) {
  state.user = user;
  localStorage.setItem('cipher_user', JSON.stringify(user));
}

function clearUser() {
  state.user = null;
  localStorage.removeItem('cipher_user');
}

/** Show the "Account Deleted / Banned" full-screen view with a countdown redirect. */
function showBannedView() {
  showView('banned');
  let secs = 10;
  const el = document.getElementById('banned-countdown-secs');
  const timer = setInterval(() => {
    secs--;
    if (el) el.textContent = secs;
    if (secs <= 0) {
      clearInterval(timer);
      showView('login');
    }
  }, 1000);
}

function updateHeaderUser() {
  const el = $('#user-name-display');
  if (!el) return;
  if (state.user) {
    el.textContent = state.user.username;
    el.classList.remove('hidden');
  } else {
    el.classList.add('hidden');
  }
}

// ═══════════════════════════════════════════════════════════
// EMAIL VERIFICATION — EmailJS
// ═══════════════════════════════════════════════════════════
function generateCode() {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return String(100000 + (arr[0] % 900000));
}

function isEmailJSConfigured() {
  return CONFIG.EMAILJS_SERVICE_ID !== 'YOUR_SERVICE_ID' &&
         CONFIG.EMAILJS_PUBLIC_KEY  !== 'YOUR_PUBLIC_KEY';
}

async function sendVerificationEmail(toEmail, toName, code) {
  // Always show the code on screen so testers can use it directly
  const hint = $('#demo-code-hint');
  const val  = $('#demo-code-value');
  if (hint) hint.classList.remove('hidden');
  if (val)  val.textContent = code;

  if (!isEmailJSConfigured()) return;

  try {
    if (typeof emailjs === 'undefined') throw new Error('EmailJS not loaded');
    emailjs.init(CONFIG.EMAILJS_PUBLIC_KEY);
    await emailjs.send(CONFIG.EMAILJS_SERVICE_ID, CONFIG.EMAILJS_TEMPLATE_ID, {
      to_email:          toEmail,
      to_name:           toName,
      verification_code: code
    });
    showToast('Verification code also sent to ' + toEmail, 'success');
  } catch (err) {
    console.warn('EmailJS send failed:', err);
  }
}

// ═══════════════════════════════════════════════════════════
// SIGN-UP FLOW
// ═══════════════════════════════════════════════════════════
function validateSignup() {
  const username = $('#su-username')?.value.trim();
  const email    = $('#su-email')?.value.trim();
  const password = $('#su-password')?.value;
  const confirm  = $('#su-confirm')?.value;
  const terms    = $('#su-terms')?.checked;

  let valid = true;

  const setErr = (id, msg) => {
    const el = $(`#${id}`);
    if (el) el.textContent = msg;
    if (msg) valid = false;
  };

  setErr('err-su-username', (username?.length ?? 0) < 2 ? 'Username must be at least 2 characters.' : '');

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email ?? '');
  setErr('err-su-email', !emailOk ? 'Please enter a valid email address.' : '');

  if (emailOk) {
    const banned = JSON.parse(localStorage.getItem('cipher_banned_emails') || '[]');
    if (banned.some(b => b.toLowerCase() === (email ?? '').toLowerCase())) {
      setErr('err-su-email', 'Account not created — this email has been banned.');
    } else if (findAccount(email ?? '')) {
      setErr('err-su-email', 'An account with this email already exists. Sign in instead.');
    }
  }

  setErr('err-su-password', (password?.length ?? 0) < 8 ? 'Password must be at least 8 characters.' : '');
  setErr('err-su-confirm',  password !== confirm ? 'Passwords do not match.' : '');
  setErr('err-su-terms',    !terms ? 'You must agree to the terms to continue.' : '');

  return valid;
}

async function handleSignup(e) {
  e.preventDefault();
  if (!validateSignup()) return;

  const username = $('#su-username').value.trim();
  const email    = $('#su-email').value.trim();
  const password = $('#su-password').value;

  const btn = $('#create-account-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }

  const passwordHash = await hashPassword(password);
  const code = generateCode();

  state.pendingSignup = {
    username,
    email,
    passwordHash,
    memberSince: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  };
  state.pendingCode = code;

  // Reset verify view state
  const hint = $('#demo-code-hint');
  if (hint) hint.classList.add('hidden');
  const emailDisp = $('#verify-email-display');
  if (emailDisp) emailDisp.textContent = email;
  const subtitle = $('#verify-subtitle');
  if (subtitle) subtitle.textContent = 'We sent a 6-digit code to';

  // Clear OTP boxes
  $$('.otp-box').forEach(box => { box.value = ''; box.classList.remove('filled'); });
  $('#err-otp').textContent = '';

  await sendVerificationEmail(email, username, code);

  if (btn) { btn.disabled = false; btn.textContent = 'Create Account'; }

  showView('verify');
}

// ═══════════════════════════════════════════════════════════
// VERIFY FLOW
// ═══════════════════════════════════════════════════════════
function getOtpValue() {
  return $$('.otp-box').map(b => b.value).join('');
}

function handleVerify() {
  const entered = getOtpValue();
  const errEl   = $('#err-otp');

  if (entered.length < 6) {
    if (errEl) errEl.textContent = 'Please enter all 6 digits.';
    return;
  }

  if (entered !== state.pendingCode) {
    if (errEl) errEl.textContent = 'Incorrect code. Please try again.';
    $$('.otp-box').forEach(b => b.classList.add('error'));
    setTimeout(() => $$('.otp-box').forEach(b => b.classList.remove('error')), 600);
    return;
  }

  if (errEl) errEl.textContent = '';

  if (state.pendingReset) {
    // Password-reset flow: proceed to the new-password form
    state.pendingCode = null;
    showView('reset');
    return;
  }

  // Sign-up flow: create the account
  saveAccount(state.pendingSignup);

  // Log the user in immediately
  const user = {
    username:    state.pendingSignup.username,
    email:       state.pendingSignup.email,
    memberSince: state.pendingSignup.memberSince
  };
  saveUser(user);
  updateHeaderUser();
  _logAccessEvent('signup', user.email, user.username);

  state.pendingSignup = null;
  state.pendingCode   = null;

  showToast('Welcome to Cipher Music, ' + user.username + '! 🎵', 'success');
  showView('player');
}

async function handleResendCode() {
  if (state.pendingReset) {
    showToast('Resending code…', 'info');
    await sendVerificationEmail(state.pendingReset.email, state.pendingReset.email, state.pendingCode);
    return;
  }
  if (!state.pendingSignup || !state.pendingCode) return;
  showToast('Resending code…', 'info');
  await sendVerificationEmail(state.pendingSignup.email, state.pendingSignup.username, state.pendingCode);
}

// ═══════════════════════════════════════════════════════════
// FORGOT / RESET PASSWORD FLOW
// ═══════════════════════════════════════════════════════════
async function handleForgotSubmit(e) {
  e.preventDefault();
  const email  = $('#forgot-email')?.value.trim();
  const errEl  = $('#err-forgot-email');

  if (!email) {
    if (errEl) errEl.textContent = 'Please enter your email address.';
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    if (errEl) errEl.textContent = 'Please enter a valid email address.';
    return;
  }
  if (errEl) errEl.textContent = '';

  const account = findAccount(email);
  if (!account) {
    if (errEl) errEl.textContent = 'No account found with that email address.';
    return;
  }

  const btn = $('#send-reset-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }

  const code = generateCode();
  state.pendingReset  = { email: account.email };
  state.pendingSignup = null;
  state.pendingCode   = code;

  // Prepare verify view
  const hint = $('#demo-code-hint');
  if (hint) hint.classList.add('hidden');
  const emailDisp = $('#verify-email-display');
  if (emailDisp) emailDisp.textContent = account.email;
  const subtitle = $('#verify-subtitle');
  if (subtitle) subtitle.textContent = 'We sent a password-reset code to';

  $$('.otp-box').forEach(box => { box.value = ''; box.classList.remove('filled'); });
  const otpErr = $('#err-otp');
  if (otpErr) otpErr.textContent = '';

  await sendVerificationEmail(account.email, account.username, code);

  if (btn) { btn.disabled = false; btn.textContent = 'Send Reset Code'; }

  showView('verify');
}

function handleResetPassword(e) {
  e.preventDefault();
  const password = $('#reset-password')?.value;
  const confirm  = $('#reset-confirm')?.value;

  let valid = true;
  const setErr = (id, msg) => {
    const el = $(`#${id}`);
    if (el) el.textContent = msg;
    if (msg) valid = false;
  };

  setErr('err-reset-password', (password?.length ?? 0) < 8 ? 'Password must be at least 8 characters.' : '');
  setErr('err-reset-confirm',  password !== confirm ? 'Passwords do not match.' : '');
  if (!valid) return;

  hashPassword(password).then(passwordHash => {
    const accounts = getAccounts().map(a => {
      if (a.email.toLowerCase() === state.pendingReset.email.toLowerCase()) {
        return { ...a, passwordHash };
      }
      return a;
    });
    localStorage.setItem('cipher_accounts', JSON.stringify(accounts));

    state.pendingReset = null;

    showToast('Password updated! Please sign in with your new password.', 'success');
    showView('login');
  });
}


// ═══════════════════════════════════════════════════════════
function validateLogin() {
  const emailOrUser = $('#login-email')?.value.trim();
  const password    = $('#login-password')?.value;

  let valid = true;

  const setErr = (id, msg) => {
    const el = $(`#${id}`);
    if (el) el.textContent = msg;
    if (msg) valid = false;
  };

  setErr('err-login-email',    !emailOrUser ? 'Please enter your email or username.' : '');
  setErr('err-login-password', (password?.length ?? 0) < 1 ? 'Please enter your password.' : '');

  return valid;
}

async function handleLogin(e) {
  e.preventDefault();
  if (!validateLogin()) return;

  const emailOrUser = $('#login-email').value.trim();
  const password    = $('#login-password').value;

  // Check if this email/username belongs to a banned account
  const banned = JSON.parse(localStorage.getItem('cipher_banned_emails') || '[]');
  const matchBanned = banned.some(b => b.toLowerCase() === emailOrUser.toLowerCase());
  if (matchBanned) {
    const el = $('#err-login-email');
    if (el) el.textContent = 'Account not created — either banned or disconnected.';
    return;
  }

  const account = findAccount(emailOrUser);
  if (!account) {
    const el = $('#err-login-email');
    if (el) el.textContent = 'No account found with that email or username.';
    return;
  }

  // Also check by the found account's email
  if (banned.some(b => b.toLowerCase() === account.email.toLowerCase())) {
    const el = $('#err-login-email');
    if (el) el.textContent = 'Account not created — either banned or disconnected.';
    return;
  }

  const passwordHash = await hashPassword(password);
  if (passwordHash !== account.passwordHash) {
    const el = $('#err-login-password');
    if (el) el.textContent = 'Incorrect password.';
    return;
  }

  const user = {
    username:    account.username,
    email:       account.email,
    memberSince: account.memberSince
  };

  saveUser(user);
  updateHeaderUser();
  _logAccessEvent('login', user.email, user.username);
  showView('player');
}
// ═══════════════════════════════════════════════════════════
function showView(viewName) {
  state.currentView = viewName;

  $('#sidebar')?.classList.remove('sidebar-open');
  $('#sidebar-toggle')?.classList.remove('active');

  $$('.view').forEach(v => v.classList.remove('active'));
  const target = $(`#view-${viewName}`);
  if (target) target.classList.add('active');

  const sidebar = $('#sidebar');
  const noSidebar = ['login', 'signup', 'verify', 'forgot', 'reset', 'banned'].includes(viewName);

  if (noSidebar) {
    sidebar.classList.add('hidden');
  } else {
    sidebar.classList.remove('hidden');
    $$('.nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.view === viewName);
    });
  }

  if (viewName === 'profile') populateProfile();
  if (viewName === 'liked') populateLiked();
  if (viewName === 'playlists') populatePlaylists();
  if (viewName === 'player' && !state.featuredLoaded) loadFeaturedMusic();
}

// ═══════════════════════════════════════════════════════════
// YOUTUBE IFrame API
// ═══════════════════════════════════════════════════════════
window.onYouTubeIframeAPIReady = function () {
  state.ytReady = true;
  state.ytPlayer = new YT.Player('yt-player', {
    height: '180',
    width: '320',
    playerVars: {
      autoplay:         0,
      controls:         1,  // show controls (needed for iOS background audio)
      playsinline:      1,  // prevent iOS from going fullscreen automatically
      rel:              0,  // no related videos at end
      modestbranding:   1,  // minimal YouTube branding
      fs:               1,  // allow fullscreen button
      iv_load_policy:   3,  // hide video annotations
      disablekb:        0,  // allow keyboard shortcuts
      cc_load_policy:   0,  // don't show captions by default
      hl:               'en'
    },
    events: { onStateChange: onPlayerStateChange }
  });
};

function onPlayerStateChange(event) {
  const playing = event.data === YT.PlayerState.PLAYING;
  state.isPlaying = playing;
  $('#play-icon')?.classList.toggle('hidden', playing);
  $('#pause-icon')?.classList.toggle('hidden', !playing);
  setSoundwavePlaying(playing);

  if (playing) {
    _userExplicitlyPaused = false; // clear on any play event
    clearTimeout(_bgResumeTimer);
    startListeningTimer();
    requestWakeLock();
    startBgAudioKeepAlive(); // keep iOS audio session alive in background
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = 'playing';
    }
  } else {
    stopListeningTimer();
    if (event.data === YT.PlayerState.PAUSED) {
      releaseWakeLock();
      if (document.hidden) {
        // Screen locked or app switched — the OS paused us, NOT the user.
        // Mark that we were playing so foreground-return can resume.
        _wasPlayingWhenHidden = true;
        // Attempt to auto-resume after a short delay.
        // 800ms: long enough for iOS to finish locking the screen before we
        // restart playback, but short enough to not cause a noticeable gap.
        clearTimeout(_bgResumeTimer);
        _bgResumeTimer = setTimeout(() => {
          if (document.hidden && !_userExplicitlyPaused && state.ytPlayer && state.ytReady) {
            startBgAudioKeepAlive();
            state.ytPlayer.playVideo();
          }
        }, 800);
      } else {
        // User explicitly paused in foreground
        _userExplicitlyPaused = true;
        stopBgAudioKeepAlive();
      }
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'paused';
      }
    }
  }

  if (event.data === YT.PlayerState.ENDED) {
    setSoundwavePlaying(false);
    const settings = JSON.parse(localStorage.getItem('cipher_settings') || '{}');
    const repeat   = settings.repeatMode || 'off';
    if (repeat === 'one') {
      playVideo(state.currentIndex);
    } else if (playNextWithQueue()) {
      // Queue item played — nothing more to do
    } else if (settings.shuffle) {
      // Shuffle: pick a random track from the available results
      const next = Math.floor(Math.random() * state.searchResults.length);
      playVideo(next);
    } else {
      // Advance to next track in list, or wrap on repeat-all
      if (repeat === 'all' && state.currentIndex >= state.searchResults.length - 1) {
        playVideo(0); // wrap around to the beginning
      } else if (state.currentIndex < state.searchResults.length - 1) {
        playNext();
      }
      // If at the last track with no repeat, stop — nothing to do
    }
  }
}

function setSoundwavePlaying(playing) {
  const sw = $('#np-soundwave');
  if (sw) sw.classList.toggle('paused', !playing);
  if (!playing) stopBeatSyncWaveform();
}

// ═══════════════════════════════════════════════════════════
// BEAT-SYNC WAVEFORM
// ═══════════════════════════════════════════════════════════
let _beatRafId = null;
let _beatPhase = 0;

function startBeatSyncWaveform() {
  if (_beatRafId) return; // already running
  const sw = $('#np-soundwave');
  if (!sw) return;
  sw.classList.add('beat-sync');
  const bars = Array.from(sw.querySelectorAll('span'));
  const NUM = bars.length || 15;

  // Sine-based pseudo-random beat pattern (fast with accent every ~0.5s)
  function tick() {
    _beatPhase += 0.06;
    bars.forEach((bar, i) => {
      // Stagger phase per bar to get a wave effect
      const phase = _beatPhase + i * 0.42;
      // Multi-frequency: base (slow sway) + beat accent (fast bounce)
      const base   = 0.5 + 0.5 * Math.sin(phase * 1.3);
      const beat   = 0.5 + 0.5 * Math.abs(Math.sin(phase * 3.7 + i * 0.9));
      const noise  = 0.5 + 0.5 * Math.sin(phase * 7.1 + i * 1.7);
      const h = Math.round(3 + base * 8 + beat * 9 + noise * 4); // 3–24 px
      bar.style.height = h + 'px';
    });
    _beatRafId = requestAnimationFrame(tick);
  }
  _beatRafId = requestAnimationFrame(tick);
}

function stopBeatSyncWaveform() {
  if (_beatRafId) { cancelAnimationFrame(_beatRafId); _beatRafId = null; }
  const sw = $('#np-soundwave');
  if (sw) {
    sw.classList.remove('beat-sync');
    sw.querySelectorAll('span').forEach(bar => bar.style.height = '');
  }
}

// ═══════════════════════════════════════════════════════════
// LYRICS
// ═══════════════════════════════════════════════════════════
let _lyricsVisible = false;

function initLyricsToggle() {
  const btn = document.getElementById('btn-toggle-lyrics');
  if (!btn) return;
  btn.addEventListener('click', () => {
    _lyricsVisible = !_lyricsVisible;
    const body = document.getElementById('np-lyrics-body');
    if (body) body.classList.toggle('lyrics-expanded', _lyricsVisible);
    btn.classList.toggle('active', _lyricsVisible);
    btn.textContent = _lyricsVisible ? 'Hide' : 'Lyrics';
  });
}

/**
 * Parse a YouTube video title into likely song title + artist.
 * Handles "Artist - Title", "Title by Artist", "Title (feat. X)" patterns.
 */
function _parseSongTitle(ytTitle) {
  let title = ytTitle.replace(/\(Official.*?\)/gi, '').replace(/\[.*?\]/gi, '').trim();
  let artist = '';
  const dashMatch = title.match(/^(.+?)\s*[-–—]\s*(.+)$/);
  if (dashMatch) {
    artist = dashMatch[1].trim();
    title  = dashMatch[2].trim();
  }
  // Strip trailing parenthetical noise
  title = title.replace(/\s*\(.*?\)\s*$/g, '').trim();
  return { title, artist };
}

/**
 * Fetch lyrics from lrclib.net (free, no API key required).
 * Falls back to a simple "Audio playing" message if unavailable.
 */
async function fetchLyricsForTrack(ytTitle, channelTitle) {
  const contentEl = document.getElementById('np-lyrics-content');
  if (!contentEl) return;
  contentEl.textContent = '♩ Loading lyrics…';
  contentEl.className = 'np-lyrics-loading';

  const { title, artist } = _parseSongTitle(ytTitle);
  const artistQuery = artist || channelTitle || '';

  try {
    // lrclib.net: https://lrclib.net/api/search?q=artist+title
    const query = encodeURIComponent(`${artistQuery} ${title}`.trim());
    const res = await fetch(`https://lrclib.net/api/search?q=${query}`, {
      signal: AbortSignal.timeout ? AbortSignal.timeout(5000) : undefined
    });
    if (!res.ok) throw new Error('API error');
    const results = await res.json();
    const match = results?.[0];
    if (match?.plainLyrics) {
      // Show first ~8 lines in collapsed view, full in expanded
      const lines = match.plainLyrics.split('\n').filter(l => l.trim()).slice(0, 50);
      contentEl.textContent = lines.slice(0, 8).join('\n');
      contentEl.dataset.fullLyrics = lines.join('\n');
      contentEl.className = '';
      // Update expanded view if already open
      const body = document.getElementById('np-lyrics-body');
      if (body?.classList.contains('lyrics-expanded')) {
        contentEl.textContent = lines.join('\n');
      }
    } else {
      contentEl.textContent = 'No lyrics found for this track.';
      contentEl.className = 'np-lyrics-loading';
    }
  } catch (_) {
    contentEl.textContent = 'Audio is playing — enjoy the music';
    contentEl.className = '';
  }
}

function playVideo(index) {
  if (!state.ytReady || !state.ytPlayer || index < 0 || index >= state.searchResults.length) return;

  // Stop previous listening timer before starting new track
  stopListeningTimer();

  state.currentIndex = index;
  const item = state.searchResults[index];
  const videoId = item.id?.videoId;
  if (!videoId) return;

  state.ytPlayer.loadVideoById(videoId);
  state.isPlaying = true;

  // Start background audio keep-alive here (on the user gesture) so iOS
  // allows the AudioContext to be created/resumed
  startBgAudioKeepAlive();

  updateNowPlaying(item);
  updateNowPlayingPanel(item);
  updateMediaSession(item);  // lock-screen / headphone controls
  showPlayerBar();
  highlightCard(index);

  const vol = parseInt($('#volume-slider')?.value ?? 80, 10);
  state.ytPlayer.setVolume(vol);

  // Track play count and start listening timer
  state.songsPlayed++;
  startListeningTimer();
  updateProfileStats();
  addToRecentlyPlayed(item);
  maybeShowAd();
  maybeShowRatePrompt();
}

// When a track ends naturally and there are queued items, play from queue
function playNextWithQueue() {
  if (state.queue.length > 0) {
    const next = state.queue.shift();
    state.searchResults = [next, ...state.searchResults.slice(state.currentIndex + 1)];
    state.currentIndex = -1;
    playVideo(0);
    renderQueuePanel();
    return true;
  }
  return false;
}

function updateNowPlayingPanel(item) {
  const panel   = $('#np-panel');
  const art     = $('#np-panel-art');
  const title   = $('#np-panel-title');
  const channel = $('#np-panel-channel');
  const bg      = $('#np-panel-bg');

  const thumb   = item.snippet?.thumbnails?.high?.url || item.snippet?.thumbnails?.medium?.url || '';
  const titleTxt = decodeHTMLEntities(item.snippet?.title || '');
  const ch      = item.snippet?.channelTitle || '';

  if (art)     art.src = thumb;
  if (title)   title.textContent = titleTxt;
  if (channel) channel.textContent = ch;
  if (bg && thumb) bg.style.backgroundImage = `url(${thumb})`;

  const settings = JSON.parse(localStorage.getItem('cipher_settings') || '{}');
  const showSW   = settings.showSoundwave !== false;
  const sw       = $('#np-soundwave');
  if (sw) sw.style.display = showSW ? 'flex' : 'none';

  if (panel) panel.classList.remove('hidden');
  setSoundwavePlaying(true);
  startBeatSyncWaveform();

  // Fetch lyrics for this track
  fetchLyricsForTrack(titleTxt, ch);
}

function updateNowPlaying(item) {
  const thumb   = item.snippet?.thumbnails?.default?.url || '';
  const title   = item.snippet?.title || '';
  const channel = item.snippet?.channelTitle || '';

  const npThumb   = $('#np-thumb');
  const npTitle   = $('#np-title');
  const npChannel = $('#np-channel');

  if (npThumb)   npThumb.src = thumb;
  if (npTitle)   npTitle.textContent = decodeHTMLEntities(title);
  if (npChannel) npChannel.textContent = channel;
}

function showPlayerBar() {
  $('#player-bar')?.classList.remove('hidden');
}

function highlightCard(index) {
  $$('.result-card').forEach((c, i) => c.classList.toggle('playing', i === index));
}

// ═══════════════════════════════════════════════════════════
// LIKED SONGS
// ═══════════════════════════════════════════════════════════
function getLiked() {
  try { return JSON.parse(localStorage.getItem('cipher_liked') || '[]'); } catch { return []; }
}

function getLikedIds() {
  return new Set(getLiked().map(s => s.videoId));
}

function saveLiked(list) {
  localStorage.setItem('cipher_liked', JSON.stringify(list));
}

function toggleLike(btn) {
  const videoId = btn.dataset.videoid;
  const title   = btn.dataset.title;
  const channel = btn.dataset.channel;
  const thumb   = btn.dataset.thumb;
  if (!videoId) return;

  let liked = getLiked();
  const idx = liked.findIndex(s => s.videoId === videoId);
  if (idx === -1) {
    liked.push({ videoId, title, channel, thumb });
    btn.classList.add('liked');
    btn.querySelector('svg')?.setAttribute('fill', 'currentColor');
    btn.setAttribute('aria-label', 'Unlike ' + title);
    showToast('Added to Liked Songs ♥', 'success');
  } else {
    liked.splice(idx, 1);
    btn.classList.remove('liked');
    btn.querySelector('svg')?.setAttribute('fill', 'none');
    btn.setAttribute('aria-label', 'Like ' + title);
    showToast('Removed from Liked Songs', 'info');
  }
  saveLiked(liked);

  // Refresh liked view if open
  if (state.currentView === 'liked') populateLiked();
}

function populateLiked() {
  let liked = getLiked();
  const grid    = $('#liked-grid');
  const empty   = $('#liked-empty');
  const label   = $('#liked-count-label');
  const playBtn = $('#btn-play-liked');

  if (label) label.textContent = `${liked.length} song${liked.length !== 1 ? 's' : ''}`;
  if (playBtn) playBtn.classList.toggle('hidden', liked.length === 0);

  if (!liked.length) {
    if (grid) grid.innerHTML = '';
    empty?.classList.remove('hidden');
    return;
  }

  empty?.classList.add('hidden');

  // Apply sort
  const sortEl = $('#liked-sort');
  const sortVal = sortEl?.value || 'date-desc';
  liked = [...liked];
  if (sortVal === 'date-asc') {
    liked.reverse();
  } else if (sortVal === 'title-asc') {
    liked.sort((a, b) => a.title.localeCompare(b.title));
  } else if (sortVal === 'title-desc') {
    liked.sort((a, b) => b.title.localeCompare(a.title));
  } else if (sortVal === 'channel') {
    liked.sort((a, b) => a.channel.localeCompare(b.channel));
  }
  // date-desc is the default order (as stored)

  // Build fake "items" compatible with renderResults
  const items = liked.map(s => ({
    id: { videoId: s.videoId },
    videoId: s.videoId,
    snippet: {
      title: s.title,
      channelTitle: s.channel,
      thumbnails: { medium: { url: s.thumb } }
    }
  }));

  // Store liked items as search results so playVideo works
  state.searchResults = items;

  grid.innerHTML = items.map((item, idx) => {
    const thumb   = item.snippet?.thumbnails?.medium?.url || '';
    const title   = decodeHTMLEntities(item.snippet?.title || '');
    const channel = item.snippet?.channelTitle || '';
    const videoId = item.id?.videoId || '';
    return `
      <div class="result-card" data-index="${idx}" data-videoid="${escapeAttr(videoId)}" role="article">
        <img class="result-thumb" src="${thumb}" alt="${escapeAttr(title)}" loading="lazy" />
        <div class="result-info">
          <p class="result-title" title="${escapeAttr(title)}">${title}</p>
          <p class="result-channel">${escapeHTML(channel)}</p>
          <div class="card-actions">
            <button class="btn-primary result-play-btn" data-index="${idx}" aria-label="Play ${escapeAttr(title)}">▶ Play</button>
            <button class="btn-like liked" data-videoid="${escapeAttr(videoId)}" data-title="${escapeAttr(title)}" data-channel="${escapeAttr(channel)}" data-thumb="${escapeAttr(thumb)}" aria-label="Unlike ${escapeAttr(title)}">
              <svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" width="16" height="16">
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
              </svg>
            </button>
            <button class="btn-card-action btn-queue-add" data-index="${idx}" aria-label="Add to queue" title="Add to queue">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </button>
            <button class="btn-card-action btn-playlist-add" data-index="${idx}" aria-label="Add to playlist" title="Add to playlist">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/></svg>
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  bindCardEvents(grid);
}

function playNext() {
  const next = state.currentIndex + 1;
  if (next < state.searchResults.length) playVideo(next);
}

function playPrev() {
  // If more than 3 seconds into the track, restart it instead of going back
  if (state.ytPlayer && state.ytReady) {
    const currentTime = state.ytPlayer.getCurrentTime?.() ?? 0;
    if (currentTime > 3) { replayTrack(); return; }
  }
  const prev = state.currentIndex - 1;
  if (prev >= 0) {
    playVideo(prev);
  } else {
    showToast('Already at the first track.', 'info', 2000);
  }
}

function replayTrack() {
  if (!state.ytPlayer || !state.ytReady) return;
  state.ytPlayer.seekTo(0, true);
  if (!state.isPlaying) state.ytPlayer.playVideo();
}

function toggleShuffle() {
  const settings = JSON.parse(localStorage.getItem('cipher_settings') || '{}');
  const newVal = !settings.shuffle;
  settings.shuffle = newVal;
  localStorage.setItem('cipher_settings', JSON.stringify(settings));
  // Sync settings toggle if on settings page
  const el = $('#toggle-shuffle');
  if (el) el.checked = newVal;
  // Update button active state
  const btn = $('#btn-shuffle');
  if (btn) {
    btn.classList.toggle('active', newVal);
    btn.setAttribute('aria-pressed', String(newVal));
  }
  showToast(newVal ? 'Shuffle on 🔀' : 'Shuffle off', 'info', 2000);
}

function togglePlayPause() {
  if (!state.ytPlayer || !state.ytReady) return;
  if (state.isPlaying) {
    _userExplicitlyPaused = true; // user-initiated pause
    state.ytPlayer.pauseVideo();
  } else {
    state.ytPlayer.playVideo();
  }
}

function decodeHTMLEntities(str) {
  const txt = document.createElement('textarea');
  txt.innerHTML = str;
  return txt.value;
}

// ═══════════════════════════════════════════════════════════
// YOUTUBE SEARCH
// ═══════════════════════════════════════════════════════════

// In-session search cache — keyed by "query|channelId".
// Survives page navigation within the tab but clears on close.
// Avoids burning 100 quota units for repeated searches.
let _searchCache = {};

/**
 * Search YouTube for videos matching `query`.
 * @param {string} query  - Search terms
 * @param {string} [channelId] - Optional YouTube channel ID to restrict results.
 *   When provided, results are ordered by viewCount; otherwise by relevance.
 */
async function searchYouTube(query, channelId = '') {
  // Maintenance mode blocks search for non-admins
  if (adminState.maintenanceMode && !adminState.isAdminSession) {
    throw Object.assign(new Error('maintenance'), { code: 'MAINTENANCE' });
  }

  // ── Cache check ──────────────────────────────────────────
  const cacheKey = `${query}|${channelId}`;
  if (_searchCache[cacheKey]) return _searchCache[cacheKey];

  const url = new URL('https://www.googleapis.com/youtube/v3/search');
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('type', 'video');
  url.searchParams.set('maxResults', '25'); // reduced from 50 to save quota
  url.searchParams.set('q', query);
  url.searchParams.set('key', CONFIG.YOUTUBE_API_KEY);
  url.searchParams.set('videoCategoryId', '10'); // 10 = Music category
  // Order by relevance for searches, viewCount for channel browsing
  if (channelId) {
    url.searchParams.set('channelId', channelId);
    url.searchParams.set('order', 'viewCount');
  } else {
    url.searchParams.set('order', 'relevance');
  }

  let response;
  try {
    response = await fetch(url.toString());
  } catch (networkErr) {
    // No internet connection or fetch failed
    throw Object.assign(new Error('Network error — check your internet connection.'), { code: 'NETWORK' });
  }

  if (!response.ok) {
    // Parse the YouTube API error body for a specific reason code
    let reason = '';
    try {
      const errBody = await response.json();
      reason = errBody?.error?.errors?.[0]?.reason || '';
      // Log to admin error log
      adminLog(`YouTube API ${response.status}: ${reason || response.statusText}`);
    } catch (_) {}

    if (response.status === 403) {
      if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded') {
        throw Object.assign(new Error('Daily search quota exceeded. Try again tomorrow or contact support.'), { code: 'QUOTA' });
      }
      if (reason === 'keyInvalid') {
        throw Object.assign(new Error('API key invalid. Please contact support.'), { code: 'KEY_INVALID' });
      }
      throw Object.assign(new Error('Access denied. Check API key restrictions.'), { code: 'FORBIDDEN' });
    }
    if (response.status === 400) {
      throw Object.assign(new Error('Bad request. Try a different search term.'), { code: 'BAD_REQUEST' });
    }
    throw Object.assign(new Error(`YouTube API error ${response.status}. Try again in a moment.`), { code: 'API_ERROR' });
  }

  const data = await response.json();
  // Track quota usage (each search costs ~100 units)
  adminState.quotaUsedToday = (adminState.quotaUsedToday || 0) + 100;
  _saveQuota();

  const results = filterMusicOnly(data.items || []);
  // Store in session cache to avoid redundant API calls
  _searchCache[cacheKey] = results;
  return results;
}

/**
 * Remove non-music videos from a list of YouTube search results.
 * Blocks: reviews, reactions, gaming, let's-plays, unboxing, tutorials,
 * vlogs, podcasts, compilation critiques, and other non-music content.
 */
function filterMusicOnly(items) {
  // Keywords whose presence in a title strongly signals non-music content.
  const blocklist = [
    /\breview\b/i,
    /\breaction\b/i,
    /\blet[''\u2019]?s\s+play\b/i,
    /\bgameplay\b/i,
    /\bgaming\b/i,
    /\bunboxing\b/i,
    /\btutorial\b/i,
    /\bhow\s+to\b/i,
    /\bvlog\b/i,
    /\bpodcast\b/i,
    /\binterview\b/i,
    /\bexplained\b/i,
    /\banalysis\b/i,
    /\bbreakdown\b/i,
    /\brant\b/i,
    /\bcommentary\b/i,
    /\bwalkthrough\b/i,
    /\bspeedrun\b/i,
  ];

  return items.filter(item => {
    const title   = item.snippet?.title || '';
    const channel = item.snippet?.channelTitle || '';
    // Block if the title matches any non-music keyword
    if (blocklist.some(re => re.test(title))) return false;
    // Block channels that are obviously gaming/tech, not music
    if (/gaming|esport|let[''\u2019]?s\s+play/i.test(channel)) return false;
    return true;
  });
}

function bindCardEvents(container) {
  container.querySelectorAll('.result-play-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      playVideo(parseInt(btn.dataset.index, 10));
    });
  });

  container.querySelectorAll('.result-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.btn-like') || e.target.closest('.btn-card-action')) return;
      playVideo(parseInt(card.dataset.index, 10));
    });
  });

  container.querySelectorAll('.btn-like').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleLike(btn);
    });
  });

  container.querySelectorAll('.btn-queue-add').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.index, 10);
      if (idx >= 0 && idx < state.searchResults.length) {
        addToQueue(state.searchResults[idx]);
      }
    });
  });

  container.querySelectorAll('.btn-playlist-add').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.index, 10);
      if (idx >= 0 && idx < state.searchResults.length) {
        openAddToPlaylistModal(state.searchResults[idx]);
      }
    });
  });
}

function renderResults(items, gridId = 'search-results') {
  const grid        = $(`#${gridId}`);
  const noRes       = $('#no-results');
  const placeholder = $('#search-placeholder');

  if (placeholder) placeholder.classList.add('hidden');

  if (!items.length) {
    if (grid) grid.innerHTML = '';
    noRes?.classList.remove('hidden');
    return;
  }

  noRes?.classList.add('hidden');

  const liked = getLikedIds();

  grid.innerHTML = items.map((item, idx) => {
    const thumb   = item.snippet?.thumbnails?.medium?.url || '';
    const title   = decodeHTMLEntities(item.snippet?.title || '');
    const channel = item.snippet?.channelTitle || '';
    const videoId = item.id?.videoId || item.videoId || '';
    const isLiked = liked.has(videoId);
    return `
      <div class="result-card" data-index="${idx}" data-videoid="${escapeAttr(videoId)}" role="article">
        <img class="result-thumb" src="${thumb}" alt="${escapeAttr(title)}" loading="lazy" />
        <div class="result-info">
          <p class="result-title" title="${escapeAttr(title)}">${title}</p>
          <p class="result-channel">${escapeHTML(channel)}</p>
          <div class="card-actions">
            <button class="btn-primary result-play-btn" data-index="${idx}" aria-label="Play ${escapeAttr(title)}">▶ Play</button>
            <button class="btn-like${isLiked ? ' liked' : ''}" data-videoid="${escapeAttr(videoId)}" data-title="${escapeAttr(title)}" data-channel="${escapeAttr(channel)}" data-thumb="${escapeAttr(thumb)}" aria-label="${isLiked ? 'Unlike' : 'Like'} ${escapeAttr(title)}">
              <svg viewBox="0 0 24 24" fill="${isLiked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" width="16" height="16">
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
              </svg>
            </button>
            <button class="btn-card-action btn-queue-add" data-index="${idx}" aria-label="Add to queue" title="Add to queue">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </button>
            <button class="btn-card-action btn-playlist-add" data-index="${idx}" aria-label="Add to playlist" title="Add to playlist">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/></svg>
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  bindCardEvents(grid);
}

function escapeHTML(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Clear the local quota counter and session search cache, then retry the search.
 * Called when the user taps "Reset & Try Again" on the quota-exceeded error screen.
 */
function resetQuotaAndRetry() {
  // Clear local quota counter so a fresh day starts
  adminState.quotaUsedToday = 0;
  localStorage.removeItem('cipher_quota_today');
  // Clear session search cache so results are fetched fresh
  _searchCache = {};
  // Retry the current search
  handleSearch();
}

async function handleSearch(query, channelId = '') {
  const q = query || $('#search-input')?.value.trim();
  if (!q) return;

  const grid = $('#search-results');
  grid.innerHTML = '<div class="loading-spinner"><div class="spinner"></div></div>';
  $('#no-results')?.classList.add('hidden');
  $('#search-placeholder')?.classList.add('hidden');

  try {
    const items = await searchYouTube(q, channelId);
    state.searchResults = items;
    renderResults(items);
  } catch (err) {
    adminLog('handleSearch error: ' + err.message);
    const code = err.code || '';
    let msg = 'Search failed. Please try again.';
    let action = '';
    if (code === 'MAINTENANCE') {
      msg = '🔧 Cipher Music is under maintenance.';
      action = 'We\'ll be back shortly! Check back soon.';
    } else if (code === 'QUOTA') {
      msg = '🔄 Search temporarily unavailable.';
      action = 'YouTube search is momentarily at capacity. Tap below to try again — it usually resolves quickly.';
    } else if (code === 'KEY_INVALID') {
      msg = '⚠️ Service configuration error.';
      action = 'Please contact support. (API key issue)';
    } else if (code === 'NETWORK') {
      msg = '📡 No internet connection.';
      action = 'Check your Wi-Fi or mobile data and try again.';
    } else if (code === 'FORBIDDEN') {
      msg = '⚠️ Search access denied.';
      action = 'The API key may have domain restrictions. Contact support.';
    } else {
      action = err.message || 'An unexpected error occurred.';
    }
    const retryBtn = code === 'QUOTA'
      ? '<button class="btn-primary btn-retry-search" onclick="resetQuotaAndRetry()">🔄 Reset &amp; Try Again</button>'
      : '<button class="btn-primary btn-retry-search" onclick="handleSearch()">↺ Retry</button>';
    grid.innerHTML = `<div class="empty-state search-error-state">
      <p class="search-error-title">${msg}</p>
      <p class="search-error-detail">${action}</p>
      ${retryBtn}
    </div>`;
  }
}

// ── Auto-load featured/trending music when player first opens ──
function loadFeaturedMusic() {
  state.featuredLoaded = true;
  handleSearch(state.activeChip);
}

// ═══════════════════════════════════════════════════════════
// PROFILE
// ═══════════════════════════════════════════════════════════
function populateProfile() {
  if (!state.user) return;

  const avatar   = $('#profile-avatar');
  const username = $('#profile-username');
  const email    = $('#profile-email');
  const since    = $('#profile-since');

  const initials = (state.user.username || '?').substring(0, 2).toUpperCase();

  if (avatar)   avatar.textContent = initials;
  if (username) username.textContent = state.user.username;
  if (email)    email.textContent = state.user.email;
  if (since)    since.textContent = `Member since ${state.user.memberSince}`;

  // Pre-fill edit fields
  const epUser = $('#ep-username');
  const epEmail = $('#ep-email');
  if (epUser) epUser.value = state.user.username;
  if (epEmail) epEmail.value = state.user.email;

  updateProfileStats();
  loadProfilePicture();
  const likedEl = $('#stat-liked-songs');
  if (likedEl) likedEl.textContent = getLiked().length;
}

function updateProfileStats() {
  const songsEl  = $('#stat-songs-played');
  const hoursEl  = $('#stat-hours');
  const genreEl  = $('#stat-fav-genre');

  if (songsEl) songsEl.textContent = state.songsPlayed;
  if (hoursEl) hoursEl.textContent = Math.round(state.minutesListened / 60 * 10) / 10;
  if (genreEl) {
    const chipMap = {
      'trending music 2025': 'Trending',
      'new music releases 2025': 'New Releases',
      'hip hop rap hits 2025': 'Hip-Hop',
      'pop music hits 2025': 'Pop',
      'r&b soul music 2025': 'R&B',
      'rock music hits': 'Rock',
      'electronic dance music EDM 2025': 'Electronic',
      'country music hits 2025': 'Country',
      'latin music reggaeton 2025': 'Latin',
      'k-pop kpop hits 2025': 'K-Pop',
      'afrobeats afro music 2025': 'Afrobeats',
      'reggae dancehall music': 'Reggae',
      'jazz music playlist': 'Jazz',
      'classical music orchestra': 'Classical',
      'metal rock heavy music': 'Metal',
      'indie alternative music 2025': 'Indie',
      'gospel praise worship music': 'Gospel',
      'blues music songs': 'Blues',
      'workout gym motivation music 2025': 'Workout',
      'lo-fi chill study music': 'Lo-Fi'
    };
    genreEl.textContent = chipMap[state.activeChip] || 'Music';
  }
}

function handleEditProfile(e) {
  e.preventDefault();
  const username = $('#ep-username')?.value.trim();
  const email    = $('#ep-email')?.value.trim();

  let valid = true;
  const setErr = (id, msg) => {
    const el = $(`#${id}`);
    if (el) el.textContent = msg;
    if (msg) valid = false;
  };

  setErr('err-ep-username', (username?.length ?? 0) < 2 ? 'Username must be at least 2 characters.' : '');

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email ?? '');
  setErr('err-ep-email', !emailOk ? 'Please enter a valid email address.' : '');

  if (!valid) return;

  // Check if email is taken by another account
  const other = getAccounts().find(a =>
    a.email.toLowerCase() === email.toLowerCase() &&
    a.email.toLowerCase() !== state.user.email.toLowerCase()
  );
  if (other) {
    setErr('err-ep-email', 'That email is already in use by another account.');
    return;
  }

  // Update the account in the accounts list
  const accounts = getAccounts().map(a => {
    if (a.email.toLowerCase() === state.user.email.toLowerCase()) {
      return { ...a, username, email };
    }
    return a;
  });
  localStorage.setItem('cipher_accounts', JSON.stringify(accounts));

  // Update session user
  saveUser({ ...state.user, username, email });
  updateHeaderUser();
  populateProfile();

  $('#edit-profile-section')?.classList.add('hidden');
  showToast('Profile updated successfully!', 'success');
}

async function handleChangePassword(e) {
  e.preventDefault();
  const current = $('#cp-current')?.value;
  const newPw   = $('#cp-new')?.value;
  const confirm = $('#cp-confirm')?.value;

  let valid = true;
  const setErr = (id, msg) => {
    const el = $(`#${id}`);
    if (el) el.textContent = msg;
    if (msg) valid = false;
  };

  setErr('err-cp-current', !current ? 'Please enter your current password.' : '');
  setErr('err-cp-new',     (newPw?.length ?? 0) < 8 ? 'Password must be at least 8 characters.' : '');
  setErr('err-cp-confirm', newPw !== confirm ? 'Passwords do not match.' : '');
  if (!valid) return;

  // Verify current password
  const account = findAccount(state.user.email);
  if (!account) return;
  const currentHash = await hashPassword(current);
  if (currentHash !== account.passwordHash) {
    setErr('err-cp-current', 'Incorrect current password.');
    return;
  }

  const newHash = await hashPassword(newPw);
  const accounts = getAccounts().map(a => {
    if (a.email.toLowerCase() === state.user.email.toLowerCase()) {
      return { ...a, passwordHash: newHash };
    }
    return a;
  });
  localStorage.setItem('cipher_accounts', JSON.stringify(accounts));

  // Clear form
  ['cp-current', 'cp-new', 'cp-confirm'].forEach(id => {
    const el = $(`#${id}`);
    if (el) el.value = '';
  });

  showToast('Password changed successfully!', 'success');
}

// ═══════════════════════════════════════════════════════════
// PAYMENT / UPGRADE
// ═══════════════════════════════════════════════════════════

/**
 * Generate a unique payment reference ID for this upgrade attempt.
 * This reference MUST be included in the CashApp note so the owner
 * can match the payment to the correct account.
 */
function generatePaymentRef() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // unambiguous chars
  // Use crypto.getRandomValues for unpredictable, non-colliding references
  const bytes = new Uint8Array(8);
  (window.crypto || crypto).getRandomValues(bytes);
  let ref = 'CPH-';
  for (let i = 0; i < 8; i++) ref += chars[bytes[i] % chars.length];
  return ref;
}

/**
 * Deterministic activation code tied to plan + email + ref.
 * Owner computes this offline with the same inputs, then sends it to the user.
 *
 * OWNER TOOL: run this in browser console to generate codes:
 *   generateActivationCode('pro',     'user@email.com', 'CPH-XXXXXXXX')
 *   generateActivationCode('premium', 'user@email.com', 'CPH-XXXXXXXX')
 */
function generateActivationCode(plan, email, ref) {
  const input = `${plan}|${email.trim().toLowerCase()}|${ref}|CM2026_CIPHER`;
  let h1 = 0xDEADBEEF, h2 = 0x41C6CE57;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = (Math.imul(h1 ^ c, 2654435761) >>> 0);
    h2 = (Math.imul(h2 ^ c, 1597334677) >>> 0);
  }
  h1 = (Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)) >>> 0;
  h2 = (Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)) >>> 0;
  return ((h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0'))
    .toUpperCase().slice(0, 10);
}

/**
 * Append a payment record to the persistent admin payment log.
 * Duplicate refs are ignored so re-submits don't create extra entries.
 */
function _logPayment(pending) {
  const log = JSON.parse(localStorage.getItem('cipher_payment_log') || '[]');
  if (!log.some(p => p.ref === pending.ref)) {
    log.push(Object.assign({}, pending, { status: 'pending', loggedAt: Date.now() }));
    localStorage.setItem('cipher_payment_log', JSON.stringify(log));
  }
}

function selectPlan(plan) {
  state.selectedPlan = plan;

  const section = $('#payment-form-section');
  const success = $('#payment-success');
  const form    = $('#payment-form');
  const planLabel = $('#selected-plan-label');
  const activationSection = $('#payment-activation-section');

  if (plan === 'free') {
    section?.classList.add('hidden');
    savePlan('free');
    showToast('Switched to Free plan.', 'info', 2000);
    return;
  }

  const planNames   = { pro: 'Pro Pack — $9.99/mo', premium: 'Premium — $19.99/mo' };
  const planAmounts = { pro: '9.99', premium: '19.99' };
  if (planLabel) planLabel.textContent = planNames[plan] || plan;

  // Generate a fresh payment ref for this selection
  state.paymentRef = generatePaymentRef();

  // Populate CashApp block with ref + amount
  const refEl  = $('#cashapp-ref-value');
  const amtEl  = $('#cashapp-amount-value');
  const tagEl  = $('#cashapp-tag-link');
  if (refEl) refEl.textContent = state.paymentRef;
  if (amtEl) amtEl.textContent = '$' + (planAmounts[plan] || '');
  if (tagEl) {
    tagEl.textContent = CONFIG.CASHAPP_TAG;
    tagEl.href = 'https://cash.app/' + CONFIG.CASHAPP_TAG +
                 '/' + (planAmounts[plan] || '');
  }
  // Update the example note with the user's real ref and email
  const noteExEl = $('#cashapp-note-example');
  if (noteExEl) {
    const userEmail = state.user?.email || 'your@email.com';
    noteExEl.textContent = state.paymentRef + ' · ' + userEmail;
  }

  // Reset to Stripe by default
  const stripeRadio = $('#method-stripe');
  if (stripeRadio) { stripeRadio.checked = true; _updatePaymentMethod('stripe'); }

  success?.classList.add('hidden');
  activationSection?.classList.add('hidden');
  form?.classList.remove('hidden');
  section?.classList.remove('hidden');
  section?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Mount Stripe Card Element (idempotent — skip if already mounted)
  _mountStripeCard();
}

/** Show/hide Stripe card vs CashApp instruction block based on selected method. */
function _updatePaymentMethod(method) {
  const cardBlock = $('#stripe-card-block');
  const cashBlock = $('#cashapp-payment-block');
  const submitBtn = $('#payment-submit-btn');
  if (cardBlock) cardBlock.classList.toggle('hidden', method !== 'stripe');
  if (cashBlock) cashBlock.classList.toggle('hidden', method !== 'cashapp');
  if (submitBtn) submitBtn.textContent = method === 'cashapp' ? "I've Sent Payment →" : 'Pay with Card →';
}

function validatePayment() {
  const name  = $('#pay-name')?.value.trim();
  const email = $('#pay-email')?.value.trim();

  let valid = true;
  const setErr = (id, msg) => {
    const el = $(`#${id}`);
    if (el) el.textContent = msg;
    if (msg) valid = false;
  };

  setErr('err-pay-name',  (name?.length ?? 0) < 2   ? 'Please enter your name.'        : '');
  setErr('err-pay-email', !/^[^@]+@[^@]+\.[^@]+$/.test(email ?? '') ? 'Please enter a valid email.' : '');
  return valid;
}

function updatePlanBanner() {
  const nameEl  = $('#current-plan-name');
  const badgeEl = $('#current-plan-badge');
  const planLabels = { free: 'Free', pro: 'Pro Pack', premium: 'Premium' };
  if (nameEl) nameEl.textContent = planLabels[state.activePlan] || 'Free';
  if (badgeEl) badgeEl.textContent = 'Active';
}

function loadPlan() {
  const saved = localStorage.getItem('cipher_active_plan');
  if (saved) state.activePlan = saved;
  updatePlanBadge();
  updateProfilePlanCard();
  applyPlanGates();

  // If there's a pending payment, restore the activation-code form
  if (state.activePlan === 'pending') {
    const pending = JSON.parse(localStorage.getItem('cipher_pending_payment') || 'null');
    if (pending) {
      state.selectedPlan = pending.plan;
      state.paymentRef   = pending.ref;
      const section = $('#payment-form-section');
      const planLabel = $('#selected-plan-label');
      const planNames = { pro: 'Pro Pack — $9.99/mo', premium: 'Premium — $19.99/mo' };
      if (planLabel) planLabel.textContent = planNames[pending.plan] || pending.plan;
      $('#payment-form')?.classList.add('hidden');
      const activationSection = $('#payment-activation-section');
      if (activationSection) {
        activationSection.classList.remove('hidden');
      }
      section?.classList.remove('hidden');
    }
  }
}

function savePlan(plan) {
  state.activePlan = plan;
  localStorage.setItem('cipher_active_plan', plan);
  updatePlanBanner();
  updatePlanBadge();
  updateProfilePlanCard();
  applyPlanGates();
}

function updatePlanBadge() {
  const badge = $('#plan-badge');
  if (!badge) return;
  if (state.activePlan === 'pro') {
    badge.textContent = '⭐ Pro Pack';
    badge.className = 'plan-badge plan-badge-pro';
  } else if (state.activePlan === 'premium') {
    badge.textContent = '💎 Premium';
    badge.className = 'plan-badge plan-badge-premium';
  } else if (state.activePlan === 'pending') {
    badge.textContent = '⏳ Pending';
    badge.className = 'plan-badge plan-badge-pending';
  } else {
    badge.className = 'plan-badge hidden';
  }
}

// ── Plan tier helpers ─────────────────────────────────────
function isPro()     { return state.activePlan === 'pro' || state.activePlan === 'premium'; }
function isPremium() { return state.activePlan === 'premium'; }

/**
 * Gate a user action behind a minimum plan tier.
 * If the user doesn't have the required tier, shows an upgrade toast and
 * navigates to the upgrade view.  Returns true if allowed.
 */
function requirePlan(minTier) {
  const tierOrder = { free: 0, pro: 1, premium: 2 };
  if ((tierOrder[state.activePlan] ?? 0) >= (tierOrder[minTier] ?? 0)) return true;
  const tierLabels = { pro: 'Pro Pack', premium: 'Premium' };
  showToast(`⭐ ${tierLabels[minTier] || 'Pro Pack'} required — upgrade to unlock this feature.`, 'info', 4000);
  showView('upgrade');
  return false;
}

/** Apply visual locked-state to settings rows based on current plan. */
function applyPlanGates() {
  $$('[data-requires]').forEach(row => {
    const required = row.dataset.requires;
    const allowed  = required === 'pro' ? isPro() : isPremium();
    row.classList.toggle('setting-gated', !allowed);
  });
  updateProfilePlanCard();
}

/** Update the plan-perks card on the profile page. */
function updateProfilePlanCard() {
  const planName  = $('#profile-plan-name');
  const planBadge = $('#profile-plan-badge');
  const upgradeBtn = $('#btn-profile-upgrade');
  const perksList = $('#profile-plan-perks');

  const labels = { free: 'Free', pro: 'Pro Pack', premium: 'Premium' };
  if (planName) planName.textContent = labels[state.activePlan] || 'Free';

  if (planBadge) {
    if (state.activePlan === 'pro') {
      planBadge.textContent = '⭐ Pro Pack';
      planBadge.className   = 'plan-badge plan-badge-pro';
    } else if (state.activePlan === 'premium') {
      planBadge.textContent = '💎 Premium';
      planBadge.className   = 'plan-badge plan-badge-premium';
    } else {
      planBadge.className = 'plan-badge hidden';
    }
  }

  if (upgradeBtn) {
    upgradeBtn.classList.toggle('hidden', state.activePlan === 'premium');
    upgradeBtn.textContent = state.activePlan === 'pro' ? '💎 Upgrade to Premium' : '⭐ Upgrade to Pro Pack';
  }

  if (perksList) {
    const allPerks = [
      { text: 'Standard audio quality',        tier: 'free'    },
      { text: 'Unlimited search',               tier: 'free'    },
      { text: 'Basic playlists',                tier: 'free'    },
      { text: 'High quality audio',             tier: 'pro'     },
      { text: 'Ad-free listening',              tier: 'pro'     },
      { text: 'Unlimited playlists',            tier: 'pro'     },
      { text: 'Sleep timer',                    tier: 'pro'     },
      { text: 'Playback speed control',         tier: 'pro'     },
      { text: 'Download history',               tier: 'pro'     },
      { text: 'Lossless / highest audio',       tier: 'premium' },
      { text: 'Custom equalizer presets',       tier: 'premium' },
      { text: 'Custom accent colour',           tier: 'premium' },
      { text: 'Exclusive genres & content',     tier: 'premium' },
      { text: 'Priority support',               tier: 'premium' },
    ];
    const tierOrder = { free: 0, pro: 1, premium: 2 };
    const userTier  = tierOrder[state.activePlan] ?? 0;
    const tierBadges = {
      pro:     '<span class="perk-tier-badge badge-pro">⭐ Pro</span>',
      premium: '<span class="perk-tier-badge badge-premium">💎 Premium</span>',
    };
    perksList.innerHTML = allPerks.map(p => {
      const unlocked  = userTier >= (tierOrder[p.tier] ?? 0);
      const badgeHtml = tierBadges[p.tier] || '';
      return `<li class="profile-perk-item ${unlocked ? 'perk-unlocked' : 'perk-locked'}">
        <span class="perk-check">${unlocked ? '✓' : '🔒'}</span>
        <span class="perk-text">${p.text}${badgeHtml}</span>
      </li>`;
    }).join('');
  }
}

// ═══════════════════════════════════════════════════════════
// RECENTLY PLAYED
// ═══════════════════════════════════════════════════════════
function getRecentlyPlayed() {
  try { return JSON.parse(localStorage.getItem('cipher_recent') || '[]'); } catch { return []; }
}

function addToRecentlyPlayed(item) {
  const videoId = item.id?.videoId || item.videoId || '';
  if (!videoId) return;
  const title   = decodeHTMLEntities(item.snippet?.title || '');
  const channel = item.snippet?.channelTitle || '';
  const thumb   = item.snippet?.thumbnails?.default?.url || item.snippet?.thumbnails?.medium?.url || '';
  let recent = getRecentlyPlayed().filter(s => s.videoId !== videoId);
  recent.unshift({ videoId, title, channel, thumb, playedAt: Date.now() });
  if (recent.length > MAX_RECENT_SONGS) recent = recent.slice(0, MAX_RECENT_SONGS);
  localStorage.setItem('cipher_recent', JSON.stringify(recent));
  renderRecentlyPlayed();
}

function renderRecentlyPlayed() {
  const recent  = getRecentlyPlayed();
  const section = $('#recently-played-section');
  const list    = $('#recently-played-list');
  if (!section || !list) return;
  if (!recent.length) { section.classList.add('hidden'); return; }
  section.classList.remove('hidden');
  list.innerHTML = recent.map(s => `
    <div class="recent-item" data-videoid="${escapeAttr(s.videoId)}" role="button" tabindex="0" aria-label="Play ${escapeAttr(s.title)}">
      <img class="recent-thumb" src="${escapeAttr(s.thumb)}" alt="" loading="lazy" />
      <div class="recent-info">
        <p class="recent-title">${escapeHTML(s.title)}</p>
        <p class="recent-channel">${escapeHTML(s.channel)}</p>
      </div>
      <button class="recent-play-btn" data-videoid="${escapeAttr(s.videoId)}" aria-label="Play">▶</button>
    </div>
  `).join('');

  list.querySelectorAll('.recent-play-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      playFromRecent(btn.dataset.videoid);
    });
  });
  list.querySelectorAll('.recent-item').forEach(item => {
    item.addEventListener('click', () => playFromRecent(item.dataset.videoid));
  });
}

function playFromRecent(videoId) {
  const idx = state.searchResults.findIndex(s => (s.id?.videoId || s.videoId) === videoId);
  if (idx !== -1) { playVideo(idx); return; }
  const recent = getRecentlyPlayed();
  const s = recent.find(r => r.videoId === videoId);
  if (!s) return;
  const item = { id: { videoId }, snippet: { title: s.title, channelTitle: s.channel, thumbnails: { default: { url: s.thumb }, medium: { url: s.thumb } } } };
  state.searchResults = [item, ...state.searchResults];
  playVideo(0);
}

// ═══════════════════════════════════════════════════════════
// AD SYSTEM (free users only)
// ═══════════════════════════════════════════════════════════
let _adTimerId = null;

function maybeShowAd() {
  if (state.activePlan !== 'free') return;
  state.songsSinceAd = (state.songsSinceAd || 0) + 1;
  if (state.songsSinceAd < AD_FREQUENCY) return;
  state.songsSinceAd = 0;
  showAd();
}

function showAd() {
  const overlay  = $('#ad-overlay');
  const skipBtn  = $('#btn-ad-skip');
  const countdown = $('#ad-countdown');
  const secSpan  = $('#ad-skip-seconds');
  if (!overlay) return;

  if (state.ytPlayer && state.ytReady && state.isPlaying) {
    state.ytPlayer.pauseVideo();
  }

  overlay.classList.remove('hidden');
  let sec = AD_COUNTDOWN_SECS;
  if (skipBtn) { skipBtn.disabled = true; skipBtn.textContent = `Skip in ${sec}s`; }
  if (secSpan) secSpan.textContent = sec;
  if (countdown) countdown.textContent = sec;

  _adTimerId = setInterval(() => {
    sec--;
    if (secSpan) secSpan.textContent = sec;
    if (countdown) countdown.textContent = sec;
    if (sec <= 0) {
      clearInterval(_adTimerId);
      if (skipBtn) { skipBtn.disabled = false; skipBtn.textContent = 'Skip Ad'; }
    }
  }, 1000);
}

function closeAd() {
  clearInterval(_adTimerId);
  const overlay = $('#ad-overlay');
  if (overlay) overlay.classList.add('hidden');
  if (state.ytPlayer && state.ytReady) {
    state.ytPlayer.playVideo();
  }
}

// ═══════════════════════════════════════════════════════════
// PROFILE PICTURE
// ═══════════════════════════════════════════════════════════
function loadProfilePicture() {
  const pic = localStorage.getItem('cipher_avatar');
  const avatar = $('#profile-avatar');
  if (!avatar) return;
  if (pic) {
    avatar.style.backgroundImage = `url(${pic})`;
    avatar.style.backgroundSize = 'cover';
    avatar.style.backgroundPosition = 'center';
    avatar.textContent = '';
    avatar.classList.add('has-pic');
  } else {
    avatar.style.backgroundImage = '';
    avatar.classList.remove('has-pic');
    const initials = (state.user?.username || '?').substring(0, 2).toUpperCase();
    avatar.textContent = initials;
  }
}

function handleAvatarUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > MAX_AVATAR_SIZE) { showToast(`Image must be under ${MAX_AVATAR_SIZE / (1024 * 1024)} MB`, 'error'); return; }
  const reader = new FileReader();
  reader.onload = (ev) => {
    localStorage.setItem('cipher_avatar', ev.target.result);
    loadProfilePicture();
    showToast('Profile picture updated! 📸', 'success');
  };
  reader.readAsDataURL(file);
}

// ═══════════════════════════════════════════════════════════
// VIDEO MODE
// ═══════════════════════════════════════════════════════════
function toggleVideoMode() {
  state.videoMode = !state.videoMode;
  const container = $('#yt-player-container');
  const btn = $('#btn-video-mode');
  if (container) container.classList.toggle('yt-hidden', !state.videoMode);
  if (btn) btn.classList.toggle('active', state.videoMode);

  if (state.videoMode && state.ytPlayer && state.ytReady) {
    state.ytPlayer.setSize(container.clientWidth, Math.min(container.clientHeight, MAX_VIDEO_HEIGHT));
  }
}

// ═══════════════════════════════════════════════════════════
// PWA INSTALL
// ═══════════════════════════════════════════════════════════
const INSTALL_INSTRUCTIONS = 'To install: tap Share → "Add to Home Screen" (iOS Safari) or use the browser menu → "Add to Home Screen" (Android/Desktop Chrome)';

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  state.deferredInstallPrompt = e;

  // Show the floating install banner (unless previously dismissed this session)
  if (!sessionStorage.getItem('pwa-banner-dismissed')) {
    const banner = $('#pwa-install-banner');
    if (banner) banner.classList.remove('hidden');
    document.body.classList.add('pwa-banner-visible');
  }

  // Show the dedicated install row in Settings
  const promptRow = $('#install-prompt-row');
  if (promptRow) promptRow.style.display = '';
});

window.addEventListener('appinstalled', () => {
  // Hide banner once installed
  $('#pwa-install-banner')?.classList.add('hidden');
  document.body.classList.remove('pwa-banner-visible');
  state.deferredInstallPrompt = null;
  showToast('Cipher Music installed! 🎉', 'success');
});

function triggerInstallPrompt() {
  if (state.deferredInstallPrompt) {
    state.deferredInstallPrompt.prompt();
    state.deferredInstallPrompt.userChoice.then((choice) => {
      state.deferredInstallPrompt = null;
      const banner = $('#pwa-install-banner');
      if (banner) banner.classList.add('hidden');
      document.body.classList.remove('pwa-banner-visible');
      if (choice.outcome === 'accepted') {
        showToast('Cipher Music installed! 🎉', 'success');
      }
    });
  } else {
    showToast(INSTALL_INSTRUCTIONS, 'info', 7000);
  }
}

function handleInstallApp() {
  triggerInstallPrompt();
}

// ── Stripe Elements helpers ─────────────────────────────────
let _stripeInstance = null;
let _stripeCard     = null;
let _stripeCardMounted = false;

function _mountStripeCard() {
  const mountEl = document.getElementById('stripe-card-element');
  if (!mountEl || _stripeCardMounted) return;
  if (typeof Stripe === 'undefined') {
    console.warn('[Cipher] Stripe.js not loaded');
    return;
  }
  if (!_stripeInstance) {
    _stripeInstance = Stripe(CONFIG.STRIPE_PUBLISHABLE_KEY);
  }
  const elements = _stripeInstance.elements();
  _stripeCard = elements.create('card', {
    style: {
      base: {
        color: '#e0e0e0',
        fontFamily: 'inherit',
        fontSize: '15px',
        '::placeholder': { color: '#888' }
      },
      invalid: { color: '#ff4444' }
    }
  });
  _stripeCard.mount(mountEl);
  _stripeCard.on('change', event => {
    const errEl = document.getElementById('err-stripe-card');
    if (errEl) errEl.textContent = event.error ? event.error.message : '';
  });
  _stripeCardMounted = true;
}

async function handlePayment(e) {
  e.preventDefault();
  if (!validatePayment()) return;

  const plan   = state.selectedPlan || 'pro';
  const email  = $('#pay-email')?.value.trim() || '';
  const name   = $('#pay-name')?.value.trim() || '';
  const ref    = state.paymentRef || generatePaymentRef();
  const method = $('input[name="pay-method"]:checked')?.value || 'stripe';

  const submitBtn = $('#payment-submit-btn');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Processing…'; }

  try {
    let paymentMethodId = null;

    if (method === 'stripe') {
      // Tokenize card via Stripe.js
      if (_stripeInstance && _stripeCard) {
        const { paymentMethod, error } = await _stripeInstance.createPaymentMethod({
          type: 'card',
          card: _stripeCard,
          billing_details: { name, email }
        });
        if (error) {
          const errEl = $('#err-stripe-card');
          if (errEl) errEl.textContent = error.message;
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Pay with Card →'; }
          return;
        }
        paymentMethodId = paymentMethod.id;
      }
    }

    // Store the pending payment
    const pending = { plan, email, name, ref, method, paymentMethodId, ts: Date.now() };
    localStorage.setItem('cipher_pending_payment', JSON.stringify(pending));
    savePlan('pending');
    _logPayment(pending);

    // Notify admin (best-effort — no customer auto-email; owner sends code manually)
    sendAdminPaymentNotification(pending).catch(() => {});

    // Show activation section
    $('#payment-form')?.classList.add('hidden');
    $('#payment-activation-section')?.classList.remove('hidden');
    const msg = method === 'cashapp'
      ? '✅ Payment noted! The owner will email your activation code shortly.'
      : '✅ Card saved! The owner will email your activation code shortly.';
    showToast(msg, 'success', 7000);
  } catch (err) {
    console.error('[Cipher] Payment error:', err);
    showToast('Payment error — please try again.', 'error', 5000);
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = method === 'cashapp' ? "I've Sent Payment →" : 'Pay with Card →';
    }
  }
}

/**
 * Send a payment-pending notification to the admin email (demosn505@gmail.com).
 * Uses the existing EmailJS integration; the template needs an admin_email variable.
 */
async function sendAdminPaymentNotification(pending) {
  // 1. Notify via PHP server (if configured)
  const notifyUrl = _adminNotifyUrl();
  if (notifyUrl) {
    try {
      await fetch(notifyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pending)
      });
    } catch (err) {
      console.warn('[Cipher] PHP server notification failed:', err.message);
    }
  }

  // 2. Send email notification to admin via EmailJS (best-effort)
  if (!isEmailJSConfigured()) return;
  try {
    if (typeof emailjs === 'undefined') throw new Error('EmailJS not loaded');
    emailjs.init(CONFIG.EMAILJS_PUBLIC_KEY);
    const planNames = { pro: 'Pro Pack ($9.99/mo)', premium: 'Premium ($19.99/mo)' };
    await emailjs.send(CONFIG.EMAILJS_SERVICE_ID, CONFIG.EMAILJS_TEMPLATE_ID, {
      to_email:          CONFIG.ADMIN_EMAIL,
      to_name:           'Cipher Admin',
      admin_email:       CONFIG.ADMIN_EMAIL,
      customer_name:     pending.name || '(not provided)',
      customer_email:    pending.email,
      payment_plan:      planNames[pending.plan] || pending.plan,
      payment_ref:       pending.ref,
      activation_code:   generateActivationCode(pending.plan, pending.email, pending.ref),
      payment_time:      new Date(pending.ts).toLocaleString()
    });
  } catch (err) {
    console.warn('[Cipher] Admin payment email notification failed:', err.message);
  }
}


/** Called when the user enters their activation code from the owner. */
function handleActivationCode() {
  const pending = JSON.parse(localStorage.getItem('cipher_pending_payment') || 'null');
  if (!pending) { showToast('No pending payment found. Please start over.', 'error'); return; }

  // Check if this payment ref has been revoked by the admin
  const revokedRefs = JSON.parse(localStorage.getItem('cipher_revoked_refs') || '[]');
  if (revokedRefs.includes(pending.ref)) {
    setFieldError('err-activation-code', 'This payment has been revoked. Please contact support.');
    return;
  }

  const entered = ($('#activation-code-input')?.value || '').trim().toUpperCase();
  const expected = generateActivationCode(pending.plan, pending.email, pending.ref);

  if (entered !== expected) {
    setFieldError('err-activation-code', 'Invalid code — please check the code sent to your email.');
    return;
  }
  setFieldError('err-activation-code', '');

  // Code is correct — activate the plan
  localStorage.removeItem('cipher_pending_payment');
  savePlan(pending.plan);
  const planNames = { pro: 'Pro Pack', premium: 'Premium' };
  const planName = planNames[pending.plan] || 'Pro Pack';
  const titleEl = $('#payment-success-title');
  if (titleEl) titleEl.textContent = `You're now a Cipher ${planName} member! 🎉`;
  $('#payment-activation-section')?.classList.add('hidden');
  $('#payment-success')?.classList.remove('hidden');
  showToast('Welcome to Cipher ' + planName + '! 🎉', 'success');
}

function setFieldError(id, msg) {
  const el = $(`#${id}`);
  if (el) el.textContent = msg;
}

// ═══════════════════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════════════════
function applyDarkMode(enabled) {
  document.body.classList.toggle('dark-mode', enabled);
}

function loadSettings() {
  const settings = JSON.parse(localStorage.getItem('cipher_settings') || '{}');

  const toggleAutoplay      = $('#toggle-autoplay');
  const toggleHq            = $('#toggle-hq');
  const toggleShuffle       = $('#toggle-shuffle');
  const repeatMode          = $('#repeat-mode');
  const playbackSpeed       = $('#playback-speed');
  const eqPreset            = $('#eq-preset');
  const toggleSoundwave     = $('#toggle-soundwave');
  const toggleNotifications = $('#toggle-notifications');
  const toggleDark          = $('#toggle-dark-mode');
  const langSelect          = $('#language-select');

  if (toggleAutoplay)      toggleAutoplay.checked      = settings.autoplay       ?? true;
  if (toggleHq)            toggleHq.checked            = settings.hq             ?? false;
  if (toggleShuffle)       toggleShuffle.checked       = settings.shuffle        ?? false;
  if (repeatMode)          repeatMode.value            = settings.repeatMode     ?? 'off';
  if (playbackSpeed)       playbackSpeed.value         = settings.playbackSpeed  ?? '1';
  if (eqPreset)            eqPreset.value              = settings.eqPreset       ?? 'flat';
  if (toggleSoundwave)     toggleSoundwave.checked     = settings.showSoundwave  !== false;
  if (toggleNotifications) toggleNotifications.checked = settings.notifications  ?? true;
  if (toggleDark) {
    const dark = settings.darkMode ?? true;
    toggleDark.checked = dark;
    applyDarkMode(dark);
  }
  if (langSelect) langSelect.value = settings.language ?? 'en';

  // Sync player-bar shuffle button with saved setting
  const shuffleOn = settings.shuffle ?? false;
  const shuffleBtn = $('#btn-shuffle');
  if (shuffleBtn) {
    shuffleBtn.classList.toggle('active', shuffleOn);
    shuffleBtn.setAttribute('aria-pressed', String(shuffleOn));
  }
  // Sync player-bar repeat button with saved setting
  updateRepeatButton(settings.repeatMode ?? 'off');
}

function saveSettings() {
  const settings = {
    autoplay:       $('#toggle-autoplay')?.checked       ?? true,
    hq:             $('#toggle-hq')?.checked             ?? false,
    shuffle:        $('#toggle-shuffle')?.checked        ?? false,
    repeatMode:     $('#repeat-mode')?.value             ?? 'off',
    playbackSpeed:  $('#playback-speed')?.value          ?? '1',
    eqPreset:       $('#eq-preset')?.value               ?? 'flat',
    showSoundwave:  $('#toggle-soundwave')?.checked      !== false,
    notifications:  $('#toggle-notifications')?.checked  ?? true,
    darkMode:       $('#toggle-dark-mode')?.checked      ?? true,
    language:       $('#language-select')?.value         ?? 'en'
  };
  localStorage.setItem('cipher_settings', JSON.stringify(settings));
}

// ═══════════════════════════════════════════════════════════
// PLAY QUEUE
// ═══════════════════════════════════════════════════════════
function addToQueue(item) {
  if (!item) return;
  state.queue.push(item);
  renderQueuePanel();
  const title = decodeHTMLEntities(item.snippet?.title || 'track');
  showToast(`Added to queue: ${title}`, 'success', 2500);
}

function renderQueuePanel() {
  const section = $('#queue-section');
  const list    = $('#queue-list');
  const badge   = $('#queue-count-badge');
  if (!section || !list) return;

  if (!state.queue.length) {
    section.classList.add('hidden');
    return;
  }

  section.classList.remove('hidden');
  if (badge) badge.textContent = `(${state.queue.length})`;

  list.innerHTML = state.queue.map((item, idx) => {
    const thumb   = item.snippet?.thumbnails?.default?.url || item.snippet?.thumbnails?.medium?.url || '';
    const title   = decodeHTMLEntities(item.snippet?.title || '');
    const channel = item.snippet?.channelTitle || '';
    return `
      <div class="queue-item">
        <span class="queue-num">${idx + 1}</span>
        <img class="recent-thumb" src="${escapeAttr(thumb)}" alt="" loading="lazy" />
        <div class="recent-info">
          <p class="recent-title">${escapeHTML(title)}</p>
          <p class="recent-channel">${escapeHTML(channel)}</p>
        </div>
        <button class="queue-remove-btn" data-idx="${idx}" aria-label="Remove from queue" title="Remove">✕</button>
      </div>
    `;
  }).join('');

  list.querySelectorAll('.queue-remove-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.queue.splice(parseInt(btn.dataset.idx, 10), 1);
      renderQueuePanel();
    });
  });
}

// ═══════════════════════════════════════════════════════════
// PLAYLISTS
// ═══════════════════════════════════════════════════════════
function getPlaylists() {
  try { return JSON.parse(localStorage.getItem('cipher_playlists') || '[]'); } catch { return []; }
}

function savePlaylists(playlists) {
  localStorage.setItem('cipher_playlists', JSON.stringify(playlists));
}

function createPlaylist(name) {
  const id = 'pl_' + Date.now();
  const playlists = getPlaylists();
  playlists.push({ id, name, songs: [], createdAt: Date.now() });
  savePlaylists(playlists);
  return id;
}

function deletePlaylist(id) {
  savePlaylists(getPlaylists().filter(p => p.id !== id));
}

function renamePlaylist(id, newName) {
  savePlaylists(getPlaylists().map(p => p.id === id ? { ...p, name: newName } : p));
}

function addSongToPlaylist(playlistId, song) {
  const playlists = getPlaylists();
  const pl = playlists.find(p => p.id === playlistId);
  if (!pl) return false;
  if (pl.songs.find(s => s.videoId === song.videoId)) return false; // already in playlist
  pl.songs.push(song);
  savePlaylists(playlists);
  return true;
}

function removeSongFromPlaylist(playlistId, videoId) {
  const playlists = getPlaylists();
  const pl = playlists.find(p => p.id === playlistId);
  if (!pl) return;
  pl.songs = pl.songs.filter(s => s.videoId !== videoId);
  savePlaylists(playlists);
}

function populatePlaylists() {
  const playlists = getPlaylists();
  const grid = $('#playlists-grid');
  const empty = $('#playlists-empty');

  // Always show the list view
  $('#playlists-list-view')?.classList.remove('hidden');
  $('#playlist-detail-view')?.classList.add('hidden');

  if (!grid) return;

  if (!playlists.length) {
    grid.innerHTML = '';
    empty?.classList.remove('hidden');
    return;
  }

  empty?.classList.add('hidden');
  grid.innerHTML = playlists.map(pl => `
    <div class="playlist-card glass-card" data-plid="${escapeAttr(pl.id)}">
      <div class="playlist-card-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="32" height="32">
          <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/>
          <line x1="8" y1="18" x2="21" y2="18"/>
        </svg>
      </div>
      <div class="playlist-card-info">
        <p class="playlist-card-name">${escapeHTML(pl.name)}</p>
        <p class="playlist-card-count">${pl.songs.length} song${pl.songs.length !== 1 ? 's' : ''}</p>
      </div>
      <button class="btn-primary playlist-open-btn" data-plid="${escapeAttr(pl.id)}">Open</button>
    </div>
  `).join('');

  grid.querySelectorAll('.playlist-open-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openPlaylist(btn.dataset.plid);
    });
  });
  grid.querySelectorAll('.playlist-card').forEach(card => {
    card.addEventListener('click', () => openPlaylist(card.dataset.plid));
  });
}

function openPlaylist(id) {
  const playlists = getPlaylists();
  const pl = playlists.find(p => p.id === id);
  if (!pl) return;

  state.currentPlaylistId = id;

  const nameEl  = $('#playlist-detail-name');
  const countEl = $('#playlist-detail-count');
  const grid    = $('#playlist-detail-grid');
  const empty   = $('#playlist-detail-empty');
  const playBtn = $('#btn-play-playlist');

  if (nameEl)  nameEl.textContent  = pl.name;
  if (countEl) countEl.textContent = `${pl.songs.length} song${pl.songs.length !== 1 ? 's' : ''}`;

  $('#playlists-list-view')?.classList.add('hidden');
  $('#playlist-detail-view')?.classList.remove('hidden');

  if (playBtn) playBtn.classList.toggle('hidden', pl.songs.length === 0);

  if (!grid) return;

  if (!pl.songs.length) {
    grid.innerHTML = '';
    empty?.classList.remove('hidden');
    return;
  }

  empty?.classList.add('hidden');

  const items = pl.songs.map(s => ({
    id: { videoId: s.videoId },
    videoId: s.videoId,
    snippet: { title: s.title, channelTitle: s.channel, thumbnails: { medium: { url: s.thumb } } }
  }));
  state.searchResults = items;

  grid.innerHTML = items.map((item, idx) => {
    const thumb   = item.snippet?.thumbnails?.medium?.url || '';
    const title   = decodeHTMLEntities(item.snippet?.title || '');
    const channel = item.snippet?.channelTitle || '';
    const videoId = item.id?.videoId || '';
    return `
      <div class="result-card" data-index="${idx}" data-videoid="${escapeAttr(videoId)}" role="article">
        <img class="result-thumb" src="${thumb}" alt="${escapeAttr(title)}" loading="lazy" />
        <div class="result-info">
          <p class="result-title" title="${escapeAttr(title)}">${title}</p>
          <p class="result-channel">${escapeHTML(channel)}</p>
          <div class="card-actions">
            <button class="btn-primary result-play-btn" data-index="${idx}" aria-label="Play ${escapeAttr(title)}">▶ Play</button>
            <button class="btn-like${getLikedIds().has(videoId) ? ' liked' : ''}" data-videoid="${escapeAttr(videoId)}" data-title="${escapeAttr(title)}" data-channel="${escapeAttr(channel)}" data-thumb="${escapeAttr(thumb)}" aria-label="Like ${escapeAttr(title)}">
              <svg viewBox="0 0 24 24" fill="${getLikedIds().has(videoId) ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" width="16" height="16">
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
              </svg>
            </button>
            <button class="btn-card-action btn-remove-from-playlist" data-videoid="${escapeAttr(videoId)}" aria-label="Remove from playlist" title="Remove">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="3,6 5,6 21,6"/><path d="M19,6l-1,14H6L5,6"/><path d="M10,11v6"/><path d="M14,11v6"/></svg>
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  bindCardEvents(grid);
  grid.querySelectorAll('.btn-remove-from-playlist').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeSongFromPlaylist(state.currentPlaylistId, btn.dataset.videoid);
      openPlaylist(state.currentPlaylistId);
    });
  });
}

function openAddToPlaylistModal(item) {
  const videoId = item.id?.videoId || item.videoId || '';
  const title   = decodeHTMLEntities(item.snippet?.title || '');
  const channel = item.snippet?.channelTitle || '';
  const thumb   = item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.default?.url || '';

  state.addToPlaylistTarget = { videoId, title, channel, thumb };

  const playlists = getPlaylists();
  const pickerList = $('#playlist-picker-list');
  if (pickerList) {
    if (!playlists.length) {
      pickerList.innerHTML = '<p style="color:var(--text-secondary);font-size:0.85rem;text-align:center;padding:8px 0">No playlists yet.</p>';
    } else {
      pickerList.innerHTML = playlists.map(pl => `
        <button class="playlist-picker-item" data-plid="${escapeAttr(pl.id)}">
          <span class="playlist-picker-name">${escapeHTML(pl.name)}</span>
          <span class="playlist-picker-count">${pl.songs.length} songs</span>
        </button>
      `).join('');
      pickerList.querySelectorAll('.playlist-picker-item').forEach(btn => {
        btn.addEventListener('click', () => {
          const added = addSongToPlaylist(btn.dataset.plid, state.addToPlaylistTarget);
          closeModal('modal-add-to-playlist');
          showToast(added ? `Added to ${btn.querySelector('.playlist-picker-name').textContent}` : 'Already in that playlist', added ? 'success' : 'info', 2500);
          state.addToPlaylistTarget = null;
        });
      });
    }
  }

  openModal('modal-add-to-playlist');
}

// ═══════════════════════════════════════════════════════════
// SLEEP TIMER
// ═══════════════════════════════════════════════════════════
function setSleepTimer(minutes) {
  if (state.sleepTimerId) {
    clearTimeout(state.sleepTimerId);
    state.sleepTimerId = null;
  }
  const indicator = $('#sleep-timer-indicator');
  if (indicator) indicator.classList.add('hidden');

  if (!minutes || minutes <= 0) return;
  showToast(`Sleep timer set for ${minutes} minutes 😴`, 'info', 3000);
  if (indicator) indicator.classList.remove('hidden');

  state.sleepTimerId = setTimeout(() => {
    if (state.ytPlayer && state.ytReady && state.isPlaying) {
      state.ytPlayer.pauseVideo();
    }
    showToast('Sleep timer: playback paused 😴', 'info', 5000);
    state.sleepTimerId = null;
    const sel = $('#sleep-timer-select');
    if (sel) sel.value = '0';
    const ind = $('#sleep-timer-indicator');
    if (ind) ind.classList.add('hidden');
  }, minutes * 60 * 1000);
}

// ═══════════════════════════════════════════════════════════
// SHARE SONG
// ═══════════════════════════════════════════════════════════
function shareCurrentSong() {
  if (state.currentIndex < 0 || !state.searchResults.length) {
    showToast('Nothing is playing yet.', 'info', 2500);
    return;
  }
  const item    = state.searchResults[state.currentIndex];
  const videoId = item?.id?.videoId || item?.videoId || '';
  const title   = decodeHTMLEntities(item?.snippet?.title || 'Check this out');
  const url     = `https://www.youtube.com/watch?v=${videoId}`;

  if (navigator.share) {
    navigator.share({ title, url, text: `🎵 ${title} — Listen on Cipher Music` }).catch(() => {
      // Share was dismissed or failed; fall back to clipboard
      navigator.clipboard?.writeText(url).then(() => {
        showToast('Link copied to clipboard! 🔗', 'success', 3000);
      }).catch(() => {});
    });
  } else {
    navigator.clipboard?.writeText(url).then(() => {
      showToast('Link copied to clipboard! 🔗', 'success', 3000);
    }).catch(() => {
      showToast(`Share: ${url}`, 'info', 6000);
    });
  }
}

// ═══════════════════════════════════════════════════════════
// KEYBOARD SHORTCUTS
// ═══════════════════════════════════════════════════════════
function handleKeyboardShortcuts(e) {
  // Don't fire shortcuts when typing in an input/textarea
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;

  const authViews = ['login', 'signup', 'verify', 'forgot', 'reset'];
  if (authViews.includes(state.currentView)) return;

  switch (e.key) {
    case ' ':
      e.preventDefault();
      togglePlayPause();
      break;
    case 'ArrowLeft':
      e.preventDefault();
      playPrev();
      break;
    case 'ArrowRight':
      e.preventDefault();
      playNext();
      break;
    case 'l':
    case 'L': {
      // Like/unlike the currently playing song
      if (state.currentIndex >= 0 && state.searchResults[state.currentIndex]) {
        const item    = state.searchResults[state.currentIndex];
        const videoId = item?.id?.videoId || item?.videoId || '';
        const title   = decodeHTMLEntities(item?.snippet?.title || '');
        const channel = item?.snippet?.channelTitle || '';
        const thumb   = item?.snippet?.thumbnails?.medium?.url || item?.snippet?.thumbnails?.default?.url || '';
        if (videoId) {
          let liked = getLiked();
          const idx = liked.findIndex(s => s.videoId === videoId);
          if (idx === -1) {
            liked.push({ videoId, title, channel, thumb });
            showToast('Added to Liked Songs ♥', 'success', 2000);
          } else {
            liked.splice(idx, 1);
            showToast('Removed from Liked Songs', 'info', 2000);
          }
          saveLiked(liked);
          if (state.currentView === 'liked') populateLiked();
        }
      }
      break;
    }
    case 'm':
    case 'M':
      toggleMute();
      break;
    case 'q':
    case 'Q': {
      if (state.currentIndex >= 0 && state.searchResults[state.currentIndex]) {
        addToQueue(state.searchResults[state.currentIndex]);
      }
      break;
    }
  }
}

function toggleMute() {
  if (!state.ytPlayer || !state.ytReady) return;
  state.isMuted = !state.isMuted;
  if (state.isMuted) {
    state.ytPlayer.mute();
    showToast('Muted 🔇', 'info', 1500);
  } else {
    state.ytPlayer.unMute();
    showToast('Unmuted 🔊', 'info', 1500);
  }
}

// ═══════════════════════════════════════════════════════════
// CHANGELOG / WHAT'S NEW
// ═══════════════════════════════════════════════════════════
function maybeShowChangelog() {
  const seen = localStorage.getItem('cipher_seen_version');
  if (seen !== APP_VERSION) {
    openModal('modal-changelog');
  }
}

function dismissChangelog() {
  localStorage.setItem('cipher_seen_version', APP_VERSION);
  closeModal('modal-changelog');
}

// ═══════════════════════════════════════════════════════════
// ACCENT COLOUR PICKER
// ═══════════════════════════════════════════════════════════
function applyAccentColor(color) {
  document.documentElement.style.setProperty('--accent', color);
  // Derive glow from the accent color with alpha
  document.documentElement.style.setProperty('--accent-glow', color + '40');
  document.documentElement.style.setProperty('--border-accent', color + '59');
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = color;
}

function loadAccentColor() {
  const saved = localStorage.getItem('cipher_accent_color');
  if (saved) {
    applyAccentColor(saved);
    const picker = $('#accent-color-picker');
    if (picker) picker.value = saved;
  }
}

function resetAccentColor() {
  localStorage.removeItem('cipher_accent_color');
  applyAccentColor('#00d4ff');
  const picker = $('#accent-color-picker');
  if (picker) picker.value = '#00d4ff';
  showToast('Accent colour reset to default.', 'info', 2000);
}

// ═══════════════════════════════════════════════════════════
// RATE APP PROMPT
// ═══════════════════════════════════════════════════════════
function maybeShowRatePrompt() {
  if (state.ratePromptShown) return;
  if (state.songsPlayed === 5) {
    state.ratePromptShown = true;
    // Small delay so it doesn't show right as the song starts
    setTimeout(() => {
      showToast('Enjoying Cipher Music? ⭐ We\'d love your feedback!', 'info', 6000);
    }, 3000);
  }
}

// ═══════════════════════════════════════════════════════════
// MODAL HELPERS
// ═══════════════════════════════════════════════════════════
function openModal(id) {
  const modal = $(`#${id}`);
  if (modal) modal.classList.remove('hidden');
}

function closeModal(id) {
  const modal = $(`#${id}`);
  if (modal) modal.classList.add('hidden');
}

function closeSidebar() {
  $('#sidebar')?.classList.remove('sidebar-open');
  $('#sidebar-backdrop')?.classList.add('hidden');
  $('#sidebar-toggle')?.classList.remove('active');
}

// ═══════════════════════════════════════════════════════════
// EVENT WIRING
// ═══════════════════════════════════════════════════════════
function bindEvents() {

  // ── Login form ──
  $('#login-form')?.addEventListener('submit', handleLogin);

  // ── Password toggle (login) ──
  $('#toggle-pw-btn')?.addEventListener('click', () => {
    const pwInput = $('#login-password');
    const eyeIcon = $('#pw-eye-icon');
    if (!pwInput) return;
    const isText = pwInput.type === 'text';
    pwInput.type = isText ? 'password' : 'text';
    if (eyeIcon) {
      eyeIcon.innerHTML = isText
        ? '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>'
        : '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>';
    }
  });

  // ── Forgot password link ──
  $('#forgot-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    const emailInput = $('#forgot-email');
    if (emailInput) emailInput.value = '';
    const errEl = $('#err-forgot-email');
    if (errEl) errEl.textContent = '';
    showView('forgot');
  });

  // ── Back to login from forgot ──
  $('#back-to-login-from-forgot')?.addEventListener('click', (e) => {
    e.preventDefault();
    showView('login');
  });

  // ── Forgot password form ──
  $('#forgot-form')?.addEventListener('submit', handleForgotSubmit);

  // ── Reset password form ──
  $('#reset-form')?.addEventListener('submit', handleResetPassword);

  // ── Password toggle (reset) ──
  $('#reset-toggle-pw')?.addEventListener('click', function () {
    const pwInput = $('#reset-password');
    if (!pwInput) return;
    pwInput.type = pwInput.type === 'text' ? 'password' : 'text';
  });

  // ── Go to sign-up ──
  $('#signup-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    showView('signup');
  });

  // ── Go back to login from sign-up ──
  $('#signin-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    showView('login');
  });

  // ── Sign-up form ──
  $('#signup-form')?.addEventListener('submit', handleSignup);

  // ── Password toggle (sign-up) ──
  $('#su-toggle-pw')?.addEventListener('click', function () {
    const pwInput = $('#su-password');
    if (!pwInput) return;
    pwInput.type = pwInput.type === 'text' ? 'password' : 'text';
  });

  // ── OTP auto-advance & backspace ──
  $$('.otp-box').forEach((box, idx, boxes) => {
    box.addEventListener('input', () => {
      const val = box.value.replace(/\D/g, '');
      box.value = val;
      box.classList.toggle('filled', val.length > 0);
      if (val && idx < boxes.length - 1) boxes[idx + 1].focus();
    });

    box.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !box.value && idx > 0) {
        boxes[idx - 1].focus();
        boxes[idx - 1].value = '';
        boxes[idx - 1].classList.remove('filled');
      }
    });

    // Allow paste of full code into first box
    box.addEventListener('paste', (e) => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '');
      boxes.forEach((b, i) => {
        b.value = text[i] || '';
        b.classList.toggle('filled', !!text[i]);
      });
      const focusIdx = Math.min(text.length, boxes.length - 1);
      boxes[focusIdx].focus();
    });
  });

  // ── Verify button ──
  $('#verify-btn')?.addEventListener('click', handleVerify);

  // ── Resend code ──
  $('#resend-code-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    handleResendCode();
  });

  // ── Back from verify: goes to signup (sign-up flow) or forgot (reset flow) ──
  $('#back-to-signup')?.addEventListener('click', (e) => {
    e.preventDefault();
    if (state.pendingReset) {
      state.pendingReset = null;
      state.pendingCode  = null;
      showView('forgot');
    } else {
      showView('signup');
    }
  });

  // ── Sidebar navigation ──
  $$('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      if (state.user) showView(item.dataset.view);
    });
  });

  // ── Genre chips — support optional channelId for NullRaze etc. ──
  $$('.genre-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      $$('.genre-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      state.activeChip = chip.dataset.query;
      handleSearch(chip.dataset.query, chip.dataset.channel || '');
    });
  });

  // ── Liked Songs: Play All ──
  $('#btn-play-liked')?.addEventListener('click', () => {
    const liked = getLiked();
    if (!liked.length) return;
    const items = liked.map(s => ({
      id: { videoId: s.videoId },
      videoId: s.videoId,
      snippet: {
        title: s.title,
        channelTitle: s.channel,
        thumbnails: { medium: { url: s.thumb } }
      }
    }));
    state.searchResults = items;
    playVideo(0);
    showView('player');
  });

  // ── Search ──
  $('#search-btn')?.addEventListener('click', () => handleSearch());
  $('#search-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleSearch();
  });

  // ── Player controls ──
  $('#btn-play-pause')?.addEventListener('click', togglePlayPause);
  $('#btn-next')?.addEventListener('click', playNext);
  $('#btn-prev')?.addEventListener('click', playPrev);
  $('#btn-replay')?.addEventListener('click', replayTrack);
  $('#btn-shuffle')?.addEventListener('click', toggleShuffle);
  $('#btn-repeat')?.addEventListener('click', cycleRepeat);

  $('#volume-slider')?.addEventListener('input', (e) => {
    if (state.ytPlayer && state.ytReady) {
      state.ytPlayer.setVolume(parseInt(e.target.value, 10));
    }
  });

  // ── Upgrade / plan selection ──
  $$('.plan-select-btn').forEach(btn => {
    btn.addEventListener('click', () => selectPlan(btn.dataset.plan));
  });

  // ── Payment form ──
  $('#payment-form')?.addEventListener('submit', handlePayment);
  $('#btn-activate-plan')?.addEventListener('click', handleActivationCode);
  // Wire up payment method radio buttons
  $$('input[name="pay-method"]').forEach(radio => {
    radio.addEventListener('change', () => _updatePaymentMethod(radio.value));
  });

  // ── Gated settings: intercept clicks on locked rows ──
  document.addEventListener('click', e => {
    const row = e.target.closest('[data-requires]');
    if (!row) return;
    const required = row.dataset.requires;
    if (row.classList.contains('setting-gated')) {
      e.preventDefault();
      requirePlan(required);
    }
  }, true); // capture phase so we catch checkbox/select interactions

  // ── Settings toggles ──
  $('#toggle-dark-mode')?.addEventListener('change', function () {
    applyDarkMode(this.checked);
    saveSettings();
  });

  ['toggle-autoplay', 'toggle-hq', 'toggle-soundwave', 'toggle-notifications'].forEach(id => {
    $(`#${id}`)?.addEventListener('change', saveSettings);
  });

  // Keep shuffle setting in sync between settings page toggle and player-bar button
  $('#toggle-shuffle')?.addEventListener('change', function () {
    saveSettings();
    const btn = $('#btn-shuffle');
    if (btn) {
      btn.classList.toggle('active', this.checked);
      btn.setAttribute('aria-pressed', String(this.checked));
    }
  });

  ['playback-speed', 'eq-preset', 'language-select'].forEach(id => {
    $(`#${id}`)?.addEventListener('change', saveSettings);
  });

  // Keep repeat-mode select in sync with the player-bar repeat button
  $('#repeat-mode')?.addEventListener('change', function () {
    saveSettings();
    updateRepeatButton(this.value);
  });

  // ── Sign out ──
  $('#btn-signout')?.addEventListener('click', () => {
    clearUser();
    updateHeaderUser();
    state.featuredLoaded = false;
    showView('login');
  });

  // ── Delete account ──
  $('#btn-delete-account')?.addEventListener('click', () => {
    if (window.confirm('Are you sure you want to delete your account? This cannot be undone.')) {
      // Remove from accounts array
      const accounts = getAccounts().filter(a => a.email !== state.user?.email);
      localStorage.setItem('cipher_accounts', JSON.stringify(accounts));
      clearUser();
      localStorage.removeItem('cipher_settings');
      updateHeaderUser();
      state.featuredLoaded = false;
      showView('login');
    }
  });

  // ── Profile edit ──
  $('#edit-profile-btn')?.addEventListener('click', () => {
    const section = $('#edit-profile-section');
    if (!section) return;
    const hidden = section.classList.contains('hidden');
    section.classList.toggle('hidden', !hidden);
    if (hidden) {
      // Pre-fill with current values when opening
      const epUser = $('#ep-username');
      const epEmail = $('#ep-email');
      if (epUser) epUser.value = state.user?.username || '';
      if (epEmail) epEmail.value = state.user?.email || '';
      ['err-ep-username','err-ep-email'].forEach(id => { const el = $(`#${id}`); if (el) el.textContent = ''; });
      section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });

  $('#cancel-edit-btn')?.addEventListener('click', () => {
    $('#edit-profile-section')?.classList.add('hidden');
  });

  $('#edit-profile-form')?.addEventListener('submit', handleEditProfile);

  $('#change-password-form')?.addEventListener('submit', handleChangePassword);

  // ── Now Playing panel close ──
  $('#np-panel-close')?.addEventListener('click', () => {
    $('#np-panel')?.classList.add('hidden');
  });

  // ── Settings: Clear history ──
  $('#btn-clear-history')?.addEventListener('click', () => {
    state.songsPlayed = 0;
    state.minutesListened = 0;
    updateProfileStats();
    showToast('Listening history cleared.', 'success');
  });

  // ── Settings: Export data ──
  $('#btn-export-data')?.addEventListener('click', () => {
    if (!state.user) return;
    const data = {
      profile: state.user,
      settings: JSON.parse(localStorage.getItem('cipher_settings') || '{}'),
      exportedAt: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = 'cipher-music-data.json';
    a.click();
    URL.revokeObjectURL(url);
    showToast('Data exported!', 'success');
  });

  // ── Settings: Change password → profile edit ──
  $('#btn-change-password')?.addEventListener('click', () => {
    showView('profile');
    setTimeout(() => {
      $('#edit-profile-section')?.classList.remove('hidden');
      const cpCurrent = $('#cp-current');
      if (cpCurrent) { cpCurrent.focus(); cpCurrent.scrollIntoView({ behavior: 'smooth' }); }
    }, 100);
  });

  // ── Keyboard: Escape closes verify/signup/reset AND modals ──
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      // Close the first open modal found and stop
      const modalIds = ['modal-changelog', 'modal-create-playlist', 'modal-rename-playlist', 'modal-add-to-playlist'];
      const openModalId = modalIds.find(id => {
        const m = $(`#${id}`);
        return m && !m.classList.contains('hidden');
      });
      if (openModalId) {
        closeModal(openModalId);
        return;
      }
      if (state.currentView === 'verify') {
        if (state.pendingReset) {
          state.pendingReset = null;
          state.pendingCode  = null;
          showView('forgot');
        } else {
          showView('signup');
        }
      } else if (state.currentView === 'reset') {
        showView('forgot');
      }
    } else {
      handleKeyboardShortcuts(e);
    }
  });

  // ── Video mode ──
  $('#btn-video-mode')?.addEventListener('click', toggleVideoMode);
  $('#btn-close-video')?.addEventListener('click', () => {
    if (state.videoMode) toggleVideoMode();
  });
  $('#btn-fullscreen-video')?.addEventListener('click', () => {
    const container = $('#yt-player-container');
    if (!container) return;
    if (container.requestFullscreen) container.requestFullscreen();
    else if (container.webkitRequestFullscreen) container.webkitRequestFullscreen();
    else if (container.mozRequestFullScreen) container.mozRequestFullScreen();
  });

  // ── Ad overlay ──
  $('#btn-ad-skip')?.addEventListener('click', closeAd);
  $('#btn-ad-upgrade')?.addEventListener('click', () => {
    closeAd();
    showView('upgrade');
  });

  // ── Recently played clear ──
  $('#btn-clear-recent')?.addEventListener('click', () => {
    localStorage.removeItem('cipher_recent');
    renderRecentlyPlayed();
    showToast('Recently played cleared.', 'success');
  });

  // ── Avatar upload ──
  $('#avatar-file-input')?.addEventListener('change', handleAvatarUpload);

  // ── Install app ──
  $('#btn-install-app')?.addEventListener('click', handleInstallApp);
  $('#btn-install-app-fallback')?.addEventListener('click', handleInstallApp);
  // Floating banner buttons
  $('#btn-pwa-install')?.addEventListener('click', () => triggerInstallPrompt());
  $('#btn-pwa-dismiss')?.addEventListener('click', () => {
    $('#pwa-install-banner')?.classList.add('hidden');
  });

  // ── PWA install banner ──
  $('#btn-pwa-install')?.addEventListener('click', handleInstallApp);
  $('#btn-pwa-dismiss')?.addEventListener('click', () => {
    const banner = $('#pwa-install-banner');
    if (banner) banner.classList.add('hidden');
    sessionStorage.setItem('pwa-banner-dismissed', '1');
  });

  // ── Hamburger sidebar toggle ──
  $('#sidebar-toggle')?.addEventListener('click', () => {
    const sidebar  = $('#sidebar');
    const backdrop = $('#sidebar-backdrop');
    const toggle   = $('#sidebar-toggle');
    const isOpen   = sidebar?.classList.contains('sidebar-open');
    sidebar?.classList.toggle('sidebar-open', !isOpen);
    backdrop?.classList.toggle('hidden', isOpen);
    toggle?.classList.toggle('active', !isOpen);
  });

  // ── Sidebar backdrop — click to close ──
  $('#sidebar-backdrop')?.addEventListener('click', closeSidebar);

  // ── Close sidebar when a nav item is tapped on mobile ──
  $$('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      if (window.innerWidth <= 1024) closeSidebar();
    });
  });

  // ── Share song ──
  $('#btn-share-song')?.addEventListener('click', shareCurrentSong);

  // ── Lyrics toggle ──
  initLyricsToggle();

  // ── NP panel: Add to queue ──
  $('#btn-add-to-queue-np')?.addEventListener('click', () => {
    if (state.currentIndex >= 0 && state.searchResults[state.currentIndex]) {
      addToQueue(state.searchResults[state.currentIndex]);
    }
  });

  // ── NP panel: Add to playlist ──
  $('#btn-add-np-to-playlist')?.addEventListener('click', () => {
    if (state.currentIndex >= 0 && state.searchResults[state.currentIndex]) {
      openAddToPlaylistModal(state.searchResults[state.currentIndex]);
    }
  });

  // ── Queue: Clear ──
  $('#btn-clear-queue')?.addEventListener('click', () => {
    state.queue = [];
    renderQueuePanel();
    showToast('Queue cleared.', 'info', 2000);
  });

  // ── Liked songs: Sort ──
  $('#liked-sort')?.addEventListener('change', () => populateLiked());

  // ── Playlists: Create new ──
  $('#btn-create-playlist')?.addEventListener('click', () => {
    const inp = $('#new-playlist-name');
    if (inp) inp.value = '';
    const err = $('#err-playlist-name');
    if (err) err.textContent = '';
    openModal('modal-create-playlist');
    setTimeout(() => inp?.focus(), 100);
  });

  // ── Playlists: Confirm create ──
  $('#btn-confirm-create-playlist')?.addEventListener('click', () => {
    const inp = $('#new-playlist-name');
    const name = inp?.value.trim();
    const err = $('#err-playlist-name');
    if (!name) { if (err) err.textContent = 'Please enter a name.'; return; }
    if (err) err.textContent = '';
    createPlaylist(name);
    closeModal('modal-create-playlist');
    populatePlaylists();
    showToast(`Playlist "${name}" created! 🎵`, 'success', 2500);
  });

  $('#new-playlist-name')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('#btn-confirm-create-playlist')?.click();
  });

  // ── Playlists: Cancel create ──
  $('#btn-cancel-create-playlist')?.addEventListener('click', () => closeModal('modal-create-playlist'));
  $('#modal-create-playlist-overlay')?.addEventListener('click', () => closeModal('modal-create-playlist'));

  // ── Playlists: Back from detail ──
  $('#btn-back-playlists')?.addEventListener('click', () => {
    state.currentPlaylistId = null;
    populatePlaylists();
  });

  // ── Playlists: Play all ──
  $('#btn-play-playlist')?.addEventListener('click', () => {
    if (!state.searchResults.length) return;
    showView('player');
    playVideo(0);
  });

  // ── Playlists: Rename ──
  $('#btn-rename-playlist')?.addEventListener('click', () => {
    if (!state.currentPlaylistId) return;
    const pl = getPlaylists().find(p => p.id === state.currentPlaylistId);
    if (!pl) return;
    const inp = $('#rename-playlist-name');
    if (inp) inp.value = pl.name;
    const err = $('#err-rename-playlist');
    if (err) err.textContent = '';
    openModal('modal-rename-playlist');
    setTimeout(() => inp?.focus(), 100);
  });

  $('#btn-confirm-rename-playlist')?.addEventListener('click', () => {
    const name = $('#rename-playlist-name')?.value.trim();
    const err  = $('#err-rename-playlist');
    if (!name) { if (err) err.textContent = 'Please enter a name.'; return; }
    if (err) err.textContent = '';
    renamePlaylist(state.currentPlaylistId, name);
    closeModal('modal-rename-playlist');
    openPlaylist(state.currentPlaylistId);
    showToast('Playlist renamed!', 'success', 2000);
  });

  $('#rename-playlist-name')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('#btn-confirm-rename-playlist')?.click();
  });

  $('#btn-cancel-rename-playlist')?.addEventListener('click', () => closeModal('modal-rename-playlist'));
  $('#modal-rename-playlist-overlay')?.addEventListener('click', () => closeModal('modal-rename-playlist'));

  // ── Playlists: Delete ──
  $('#btn-delete-playlist')?.addEventListener('click', () => {
    if (!state.currentPlaylistId) return;
    const pl = getPlaylists().find(p => p.id === state.currentPlaylistId);
    if (pl && window.confirm(`Delete playlist "${pl.name}"? This cannot be undone.`)) {
      deletePlaylist(state.currentPlaylistId);
      state.currentPlaylistId = null;
      populatePlaylists();
      showToast('Playlist deleted.', 'info', 2000);
    }
  });

  // ── Add to playlist modal ──
  $('#btn-cancel-add-to-playlist')?.addEventListener('click', () => closeModal('modal-add-to-playlist'));
  $('#modal-add-to-playlist-overlay')?.addEventListener('click', () => closeModal('modal-add-to-playlist'));
  $('#btn-new-playlist-from-picker')?.addEventListener('click', () => {
    closeModal('modal-add-to-playlist');
    const inp = $('#new-playlist-name');
    if (inp) inp.value = '';
    const err = $('#err-playlist-name');
    if (err) err.textContent = '';
    openModal('modal-create-playlist');
    setTimeout(() => inp?.focus(), 100);
  });

  // ── Changelog ──
  $('#btn-close-changelog')?.addEventListener('click', dismissChangelog);
  $('#modal-changelog-overlay')?.addEventListener('click', dismissChangelog);

  // ── Sleep timer ──
  $('#sleep-timer-select')?.addEventListener('change', function () {
    setSleepTimer(parseInt(this.value, 10) || 0);
  });

  // ── Accent colour picker ──
  $('#accent-color-picker')?.addEventListener('input', function () {
    applyAccentColor(this.value);
    localStorage.setItem('cipher_accent_color', this.value);
  });
  $('#btn-reset-accent')?.addEventListener('click', resetAccentColor);
}

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════
function init() {
  loadUser();
  loadSettings();
  loadPlan();
  loadAccentColor();
  updateHeaderUser();
  updateClock();
  setInterval(updateClock, 1000);
  updatePlanBanner();
  updatePlanBadge();
  renderRecentlyPlayed();

  // Register service worker (use relative path so it works on GitHub Pages subpaths)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  bindEvents();
  initAdminPanel(); // attach admin panel keyboard shortcut

  // Auto-reset YouTube quota counter and search cache at Pacific midnight,
  // matching when YouTube's API quota actually resets.
  _scheduleQuotaMidnightReset();

  // Hash-based routing: allow direct links to signup/reset
  const hash = window.location.hash.slice(1);
  if (hash === 'signup' && !state.user) {
    showView('signup');
  } else if (hash === 'reset' && !state.user) {
    showView('forgot');
  } else if (state.user) {
    showView('player');
    // Show changelog after a short delay so the player loads first
    setTimeout(maybeShowChangelog, 800);
  } else {
    showView('login');
  }

  // Show maintenance overlay/banner if active for non-admin visitors
  if (adminState.maintenanceMode && !adminState.isAdminSession) {
    _applyMaintenanceOverlay();
  }

  // Start polling for remote maintenance state changes (cross-device)
  _startMaintenancePoller();

  // Open admin panel if ?debug=1 or ?admin=1 is in the URL
  const _params = new URLSearchParams(window.location.search);

  // ?reset — clear maintenance mode, then reload without the param
  if (_params.get('reset') !== null) {
    _disableMaintenanceMode();
    const url = new URL(window.location.href);
    url.searchParams.delete('reset');
    window.location.replace(url.toString());
    return;
  }

  if (_params.get('debug') === '1' || _params.get('admin') === '1') {
    // Bypass the email check and go straight to the PIN modal — same as Ctrl+Shift+D.
    // The admin PIN is still required, so this is safe for offline/downloaded copies
    // where no account may be logged in.
    setTimeout(() => openAdminFromOverlay(), 400);
  }
}

document.addEventListener('DOMContentLoaded', init);

// ═══════════════════════════════════════════════════════════
// ADMIN / DEBUG PANEL
// ═══════════════════════════════════════════════════════════

// Lowercase admin email constant — evaluated once at module parse time.
const ADMIN_EMAIL_LC = CONFIG.ADMIN_EMAIL.toLowerCase();

/**
 * Returns true if the currently logged-in user is the designated admin.
 * Shows an error toast and returns false for everyone else.
 */
function _assertAdminUser() {
  const email = (state.user?.email || '').toLowerCase().trim();
  if (email === ADMIN_EMAIL_LC) return true;
  showToast('⛔ Admin access is restricted to the site owner.', 'error', 4000);
  return false;
}

// ── Admin: Payments panel ─────────────────────────────────────────────────────

/** Render all logged payment requests in the admin panel. */
function renderAdminPayments() {
  const el = document.getElementById('admin-payments-list');
  if (!el) return;

  const planNames = { pro: 'Pro Pack ($9.99/mo)', premium: 'Premium ($19.99/mo)' };

  const _renderList = (log) => {
    if (log.length === 0) {
      el.innerHTML = '<p class="admin-hint">No payment requests logged yet.</p>';
      return;
    }
    el.innerHTML = log.slice().reverse().map(p => {
      const code = generateActivationCode(p.plan, p.email, p.ref);
      const revoked   = p.status === 'revoked';
      const confirmed = p.status === 'confirmed';
      const statusHtml = revoked
        ? '<span class="admin-pay-badge admin-pay-revoked">🚫 Revoked</span>'
        : confirmed
          ? '<span class="admin-pay-badge admin-pay-confirmed">✅ Confirmed</span>'
          : '<span class="admin-pay-badge admin-pay-pending">⏳ Pending</span>';
      const confirmBtn = (confirmed || revoked) ? '' :
        `<button class="btn-outline admin-action-btn" onclick="adminConfirmPayment(${escapeHtml(JSON.stringify(p.ref))})">✅ Mark Confirmed</button>`;
      const revokeBtn = revoked ? '' :
        `<button class="btn-outline admin-action-btn admin-revoke-btn" onclick="adminRevokePayment(${escapeHtml(JSON.stringify(p.ref))})">🚫 Revoke</button>`;
      return `<div class="admin-payment-card${revoked ? ' admin-payment-revoked' : ''}">
        <div class="admin-payment-row"><strong>${escapeHtml(p.name || '(no name)')}</strong>${statusHtml}</div>
        <div class="admin-payment-row admin-hint"><span>${escapeHtml(p.email)}</span><span>${escapeHtml(planNames[p.plan] || p.plan)}</span></div>
        <div class="admin-payment-row admin-hint"><span>Ref: <code>${escapeHtml(p.ref)}</code></span><span>${new Date(p.ts).toLocaleDateString()}</span></div>
        <div class="admin-payment-code-row"><code class="admin-activation-code">${escapeHtml(code)}</code><button class="admin-copy-btn" onclick="adminCopyCode(${escapeHtml(JSON.stringify(code))})">Copy</button></div>
        <div class="admin-payment-actions">${confirmBtn}${revokeBtn}</div>
      </div>`;
    }).join('');
  };

  // Render local log immediately
  const localLog = JSON.parse(localStorage.getItem('cipher_payment_log') || '[]');
  _renderList(localLog);

  // Fetch from server and merge (cross-device payments)
  if (ADMIN_BASE_URL) {
    const serverPaymentsUrl = ADMIN_BASE_URL + '/data/payments.json';
    fetch(serverPaymentsUrl + '?_=' + Date.now(), { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(serverPayments => {
        if (!Array.isArray(serverPayments)) return;
        // Merge: server + local, de-duped by ref
        const seen = new Set();
        const merged = [...serverPayments, ...localLog].filter(p => {
          if (seen.has(p.ref)) return false;
          seen.add(p.ref);
          return true;
        });
        _renderList(merged);
        // Update local log with confirmed statuses from server
        const updated = localLog.map(lp => {
          const sp = serverPayments.find(s => s.ref === lp.ref);
          return sp ? Object.assign({}, lp, { status: sp.status || lp.status }) : lp;
        });
        localStorage.setItem('cipher_payment_log', JSON.stringify(updated));
      })
      .catch(() => {}); // keep local view on error
  }
}

/** Mark a payment as confirmed in the admin log. */
function adminConfirmPayment(ref) {
  const log = JSON.parse(localStorage.getItem('cipher_payment_log') || '[]');
  const idx = log.findIndex(p => p.ref === ref);
  if (idx < 0) return;
  log[idx].status = 'confirmed';
  localStorage.setItem('cipher_payment_log', JSON.stringify(log));
  renderAdminPayments();
  showToast('✅ Payment marked as confirmed.', 'success', 2500);
}

/** Revoke a payment — the activation code will be rejected at next use. */
function adminRevokePayment(ref) {
  if (!confirm(`Revoke payment ${ref}?\nThe activation code will stop working.`)) return;
  const log = JSON.parse(localStorage.getItem('cipher_payment_log') || '[]');
  const idx = log.findIndex(p => p.ref === ref);
  if (idx >= 0) {
    log[idx].status = 'revoked';
    localStorage.setItem('cipher_payment_log', JSON.stringify(log));
  }
  // Store in a separate fast-lookup set for activation code checks
  const revoked = JSON.parse(localStorage.getItem('cipher_revoked_refs') || '[]');
  if (!revoked.includes(ref)) {
    revoked.push(ref);
    localStorage.setItem('cipher_revoked_refs', JSON.stringify(revoked));
  }
  renderAdminPayments();
  showToast('🚫 Payment revoked — activation code disabled.', 'info', 3000);
}

/** Copy an activation code to clipboard. */
function adminCopyCode(code) {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(code)
      .then(() => showToast('📋 Activation code copied!', 'success', 2000))
      .catch(() => showToast('Copy failed — code: ' + code, 'info', 6000));
  } else {
    showToast('Code: ' + code, 'info', 8000);
  }
}

// ── Admin: Users panel ────────────────────────────────────────────────────────

/** Render all registered accounts in the admin panel. */
function renderAdminUsers() {
  const el = document.getElementById('admin-users-list');
  if (!el) return;

  // Sync remote banned list into localStorage (if server configured)
  if (ADMIN_BASE_URL) {
    const token = localStorage.getItem(ADMIN_PIN_KEY) || DEFAULT_ADMIN_PIN_HASH;
    fetch(`${ADMIN_BASE_URL}/api.php?resource=banned&token=${encodeURIComponent(token)}&_=${Date.now()}`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.ok && Array.isArray(data.banned)) {
          const existing = JSON.parse(localStorage.getItem('cipher_banned_emails') || '[]');
          const merged = [...new Set([...existing, ...data.banned].map(e => e.toLowerCase()))];
          localStorage.setItem('cipher_banned_emails', JSON.stringify(merged));
        }
      }).catch(() => {});
  }

  // Render local accounts immediately
  const _render = (accounts) => {
    const banned = JSON.parse(localStorage.getItem('cipher_banned_emails') || '[]');
    if (accounts.length === 0) {
      el.innerHTML = '<p class="admin-hint">No registered accounts found.</p>';
      return;
    }
    el.innerHTML = accounts.map(a => {
      const isBanned = banned.some(b => b === a.email?.toLowerCase());
      return `<div class="admin-user-row${isBanned ? ' admin-user-banned' : ''}">
        <div class="admin-user-info">
          <span class="admin-user-name">${escapeHtml(a.username)}${isBanned ? ' <span class="admin-banned-tag">BANNED</span>' : ''}</span>
          <span class="admin-hint">${escapeHtml(a.email)}</span>
          <span class="admin-hint">Since ${escapeHtml(a.memberSince || a.registeredAt || '—')}</span>
        </div>
        <button class="admin-delete-btn" onclick="adminDeleteUser(${escapeHtml(JSON.stringify(a.email))})" title="Ban &amp; remove account">🗑</button>
      </div>`;
    }).join('');
  };

  const localAccounts = getAccounts();
  _render(localAccounts);

  // If server is configured, fetch remote users and merge (cross-device)
  if (ADMIN_USERS_URL) {
    const token = localStorage.getItem(ADMIN_PIN_KEY) || DEFAULT_ADMIN_PIN_HASH;
    fetch(`${ADMIN_USERS_URL}?token=${encodeURIComponent(token)}&_=${Date.now()}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(data => {
        if (!data.ok || !Array.isArray(data.users)) return;
        // Merge: server list + local accounts, de-duped by email
        const seen = new Set();
        const merged = [...data.users, ...localAccounts].filter(a => {
          const key = (a.email || '').toLowerCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        _render(merged);
      })
      .catch(() => {}); // keep local view on error
  }
}

/** Remove an account by email (security / bot cleanup). */
function adminDeleteUser(email) {
  if (!confirm(`Remove account for ${email}?\nThis will ban the email and cannot be undone.`)) return;
  // Add to banned list
  const banned = JSON.parse(localStorage.getItem('cipher_banned_emails') || '[]');
  if (!banned.some(b => b.toLowerCase() === email.toLowerCase())) {
    banned.push(email.toLowerCase());
    localStorage.setItem('cipher_banned_emails', JSON.stringify(banned));
  }
  // Remove locally
  const accounts = getAccounts().filter(a => a.email.toLowerCase() !== email.toLowerCase());
  localStorage.setItem('cipher_accounts', JSON.stringify(accounts));
  // If the currently signed-in user was the one deleted, sign them out
  if (state.user?.email?.toLowerCase() === email.toLowerCase()) {
    clearUser();
  }
  // Remove from server
  if (ADMIN_USERS_URL) {
    const token = localStorage.getItem(ADMIN_PIN_KEY) || DEFAULT_ADMIN_PIN_HASH;
    fetch(ADMIN_USERS_URL, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
      body: JSON.stringify({ email })
    }).catch(() => {});
  }
  renderAdminUsers();
  showToast('Account banned and removed.', 'success', 2500);
}

function initAdminPanel() {
  // Ctrl+Shift+D (desktop) — bypasses email check, shows PIN modal.
  // If maintenance mode is active, it is lifted automatically after a correct PIN.
  document.addEventListener('keydown', e => {
    if (e.ctrlKey && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
      e.preventDefault();
      openAdminFromOverlay();
    }
  });

  // 5-tap on the app logo / header title (mobile shortcut)
  const TAP_TIMEOUT_MS = 2000; // window in which 5 taps must occur
  let _tapCount = 0, _tapTimer = null;
  const tapTargets = ['.header-brand', '.brand-name', '.logo-icon'];
  tapTargets.forEach(sel => {
    const el = document.querySelector(sel);
    if (!el) return;
    el.addEventListener('click', () => {
      _tapCount++;
      clearTimeout(_tapTimer);
      if (_tapCount >= 5) {
        _tapCount = 0;
        openAdminPanel();
        return;
      }
      _tapTimer = setTimeout(() => { _tapCount = 0; }, TAP_TIMEOUT_MS);
    });
  });
}

function openAdminPanel() {
  const panel = document.getElementById('admin-panel');
  if (!panel) return;

  // Only the designated admin account may access the panel
  if (!_assertAdminUser()) return;

  if (adminState.isAdminSession) {
    // Already authenticated — toggle
    panel.classList.toggle('open');
    if (panel.classList.contains('open')) refreshAdminPanel();
    return;
  }

  // Show custom PIN modal (password-masked input, no plain-text prompt())
  showAdminPinModal();
}

/** Show the admin PIN entry modal. */
function showAdminPinModal() {
  const modal = document.getElementById('admin-pin-modal');
  if (!modal) return;
  const input = document.getElementById('admin-pin-input');
  if (input) { input.value = ''; input.focus(); }
  modal.classList.remove('hidden');
}

/** Called by the "Admin Access" button on the maintenance overlay. */
function openAdminFromOverlay() {
  adminState.fromOverlay = true;
  showAdminPinModal();
}

/** Called by the PIN modal submit button. */
async function submitAdminPin() {
  const input = document.getElementById('admin-pin-input');
  const pin = input?.value || '';
  document.getElementById('admin-pin-modal')?.classList.add('hidden');
  const fromOverlay = adminState.fromOverlay;
  adminState.fromOverlay = false;

  if (!pin) return;

  // Fall back to the default PIN hash if nothing is stored (e.g. fresh session or cleared storage).
  const expectedHash = localStorage.getItem(ADMIN_PIN_KEY) || DEFAULT_ADMIN_PIN_HASH;

  const enteredHash = await sha256Hex(pin);
  if (enteredHash !== expectedHash) {
    showToast('❌ Incorrect admin PIN.', 'error', 3000);
    return;
  }

  adminState.isAdminSession = true;

  // If the user came from the maintenance overlay or keyboard shortcut,
  // lift maintenance (only if it is actually on) and open panel
  if (fromOverlay && adminState.maintenanceMode) {
    _disableMaintenanceMode();
    showToast('✅ Maintenance mode OFF — app is live.', 'success', 3000);
  }

  const panel = document.getElementById('admin-panel');
  panel?.classList.add('open');
  refreshAdminPanel();
}

function closeAdminPanel() {
  document.getElementById('admin-panel')?.classList.remove('open');
}

function refreshAdminPanel() {
  // API key (masked)
  const keyEl = document.getElementById('admin-api-key');
  if (keyEl) {
    const k = CONFIG.YOUTUBE_API_KEY || '';
    keyEl.textContent = k ? k.slice(0, 8) + '…' + k.slice(-4) : '(not set)';
    keyEl.style.color = k.length >= 20 ? '#00d4ff' : '#ff4444';
  }
  // Version
  const verEl = document.getElementById('admin-version');
  if (verEl) verEl.textContent = APP_VERSION;
  // Quota
  const qEl = document.getElementById('admin-quota');
  if (qEl) qEl.textContent = `~${adminState.quotaUsedToday} / ${YOUTUBE_DAILY_QUOTA} units today`;
  // Maintenance toggle
  const mEl = document.getElementById('admin-maint-toggle');
  if (mEl) mEl.checked = adminState.maintenanceMode;
  // Log
  renderAdminLog();
  // Payments & Users
  renderAdminPayments();
  renderAdminUsers();
}

function renderAdminLog() {
  const logEl = document.getElementById('admin-log');
  if (!logEl) return;
  if (_adminLogs.length === 0) {
    logEl.textContent = 'No errors logged.';
    return;
  }
  logEl.textContent = _adminLogs.slice(0, MAX_DISPLAYED_LOGS)
    .map(e => `[${e.ts.slice(11, 19)}] ${e.msg}`)
    .join('\n');
}

async function adminToggleMaintenance() {
  adminState.maintenanceMode = !adminState.maintenanceMode;
  localStorage.setItem(MAINT_KEY, adminState.maintenanceMode ? '1' : '0');

  // Broadcast to other same-origin tabs immediately
  try {
    const bc = new BroadcastChannel('cipher_maint');
    bc.postMessage({ maintenance: adminState.maintenanceMode, ts: Date.now() });
    bc.close();
  } catch (_) { /* BroadcastChannel not supported — graceful degradation */ }

  if (adminState.maintenanceMode) {
    // Run diagnostic checks, log all results
    const checkResults = await _runMaintenanceChecks();

    // POST state + check log to server (so all devices see it)
    _postMaintenanceState(adminState.maintenanceMode, checkResults);

    document.getElementById('maintenance-banner')?.classList.remove('hidden');
    showToast('🔧 Maintenance mode ON — running checks…', 'info', 4000);
  } else {
    // Lift maintenance
    _postMaintenanceState(false, []);
    document.getElementById('maintenance-banner')?.classList.add('hidden');
    document.getElementById('maintenance-overlay')?.classList.add('hidden');
    showToast('✅ Maintenance mode OFF — app is live.', 'success', 3000);
  }
  refreshAdminPanel();
}

/**
 * Run a battery of diagnostic checks and log every result.
 * Returns the check-log array for sending to the server.
 */
async function _runMaintenanceChecks() {
  const ts = new Date().toISOString();
  const results = [];

  function logCheck(label, ok, detail) {
    const msg = `[MAINT ${ts.slice(11, 19)}] ${ok ? '✅' : '❌'} ${label}${detail ? ' — ' + detail : ''}`;
    _pushAdminLog(msg);
    results.push({ msg, ok });
  }

  // 1. HTTPS / Secure context
  const isSecure = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  logCheck('HTTPS / Secure context', isSecure, location.protocol);

  // 2. API key presence
  const keyOk = !!(CONFIG.YOUTUBE_API_KEY && CONFIG.YOUTUBE_API_KEY.length >= 20);
  logCheck('YouTube API key present', keyOk, keyOk ? CONFIG.YOUTUBE_API_KEY.slice(0,8)+'…' : 'missing or too short');

  // 3. YouTube API reachability (live network call)
  try {
    const ctrl = new AbortController();
    const tId = setTimeout(() => ctrl.abort(), 8000);
    const signal = AbortSignal.timeout ? AbortSignal.timeout(8000) : ctrl.signal;
    const r = await fetch(
      `https://www.googleapis.com/youtube/v3/search?part=id&type=video&q=cipher&maxResults=1&key=${CONFIG.YOUTUBE_API_KEY}`,
      { signal }
    );
    clearTimeout(tId);
    const body = await r.json().catch(() => ({}));
    if (r.ok) {
      adminState.quotaUsedToday += 100;
      _saveQuota();
      logCheck('YouTube API reachable', true, `HTTP ${r.status}`);
    } else {
      const reason = body?.error?.errors?.[0]?.reason || r.statusText;
      logCheck('YouTube API reachable', false, `HTTP ${r.status}: ${reason}`);
    }
  } catch (e) {
    logCheck('YouTube API reachable', false, e.message);
  }

  // 4. EmailJS config
  const ejsOk = !!(CONFIG.EMAILJS_SERVICE_ID && CONFIG.EMAILJS_TEMPLATE_ID && CONFIG.EMAILJS_PUBLIC_KEY);
  logCheck('EmailJS config present', ejsOk);

  // 5. Service worker registration
  const swOk = 'serviceWorker' in navigator;
  const swReg = swOk ? await navigator.serviceWorker.getRegistration().catch(() => null) : null;
  logCheck('Service worker registered', swOk && !!swReg, swReg ? swReg.scope : (swOk ? 'not registered' : 'not supported'));

  // 6. App manifest
  const manifestLink = document.querySelector('link[rel="manifest"]');
  const manifestOk = !!manifestLink;
  if (manifestOk) {
    try {
      const r = await fetch(manifestLink.href, { cache: 'no-store' });
      logCheck('manifest.json fetchable', r.ok, `HTTP ${r.status}`);
    } catch (e) {
      logCheck('manifest.json fetchable', false, e.message);
    }
  } else {
    logCheck('App manifest link found', false, 'no <link rel="manifest">');
  }

  // 7. localStorage availability & space
  try {
    localStorage.setItem('_maint_test', '1');
    localStorage.removeItem('_maint_test');
    logCheck('localStorage accessible', true);
  } catch (e) {
    logCheck('localStorage accessible', false, e.message);
  }

  // 8. Admin email configured
  logCheck('Admin email set', !!CONFIG.ADMIN_EMAIL, CONFIG.ADMIN_EMAIL || 'not set');

  // 9. Admin server endpoint
  if (ADMIN_BASE_URL) {
    try {
      const r = await fetch(ADMIN_STATUS_URL, { cache: 'no-store' });
      logCheck('Admin server reachable', r.ok, `HTTP ${r.status}`);
    } catch (e) {
      logCheck('Admin server reachable', false, e.message);
    }
  } else {
    logCheck('Admin server endpoint', false, 'ADMIN_NOTIFY_URL not configured');
  }

  // Refresh log display
  renderAdminLog();
  return results;
}

/** POST maintenance state (and optional check log) to the server. */
function _postMaintenanceState(on, log = []) {
  if (!ADMIN_STATUS_URL) return;
  const token = localStorage.getItem(ADMIN_PIN_KEY) || DEFAULT_ADMIN_PIN_HASH;
  fetch(ADMIN_STATUS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ maintenance: on, token, log })
  }).catch(() => {}); // best-effort
}

/** Show full-screen maintenance overlay for non-admin users. */
function _applyMaintenanceOverlay() {
  document.getElementById('maintenance-banner')?.classList.remove('hidden');
  document.getElementById('maintenance-overlay')?.classList.remove('hidden');
}

/** Remove maintenance overlay. */
function _removeMaintenanceOverlay() {
  document.getElementById('maintenance-banner')?.classList.add('hidden');
  document.getElementById('maintenance-overlay')?.classList.add('hidden');
}

/** Shared helper: disable maintenance mode, lift overlay, post to server. */
function _disableMaintenanceMode() {
  adminState.maintenanceMode = false;
  localStorage.setItem(MAINT_KEY, '0');
  _removeMaintenanceOverlay();
  try { _postMaintenanceState(false, []); } catch (_) { /* best-effort */ }
}

/** Poll the status endpoint every 30 s for cross-device maintenance changes. */
function _startMaintenancePoller() {
  // Listen for same-origin tab broadcasts
  try {
    const bc = new BroadcastChannel('cipher_maint');
    bc.onmessage = (ev) => {
      const on = !!ev.data?.maintenance;
      if (on === adminState.maintenanceMode) return;
      adminState.maintenanceMode = on;
      localStorage.setItem(MAINT_KEY, on ? '1' : '0');
      if (on && !adminState.isAdminSession) {
        _applyMaintenanceOverlay();
        setTimeout(() => location.reload(), 1500);
      } else if (!on) {
        _removeMaintenanceOverlay();
      }
    };
  } catch (_) { /* not supported */ }

  // Poll remote server (cross-device) if endpoint is configured
  if (!ADMIN_STATUS_URL) return;
  // Guard: only start one poller per page load
  if (window._cipherMaintPollId) clearInterval(window._cipherMaintPollId);
  let _lastMaintTs = 0;
  async function _poll() {
    try {
      const r = await fetch(ADMIN_STATUS_URL + '?_=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) return;
      const data = await r.json();
      const on = !!data.maintenance;
      const ts = data.ts || 0;
      if (ts <= _lastMaintTs) return; // nothing new
      _lastMaintTs = ts;
      if (on === adminState.maintenanceMode) return; // no change
      adminState.maintenanceMode = on;
      localStorage.setItem(MAINT_KEY, on ? '1' : '0');
      if (on && !adminState.isAdminSession) {
        _applyMaintenanceOverlay();
        setTimeout(() => location.reload(), 1500); // reload so users see fresh state
      } else if (!on) {
        _removeMaintenanceOverlay();
        if (!adminState.isAdminSession) setTimeout(() => location.reload(), 800);
      }
    } catch (_) { /* network error — ignore */ }
  }
  window._cipherMaintPollId = setInterval(_poll, 15_000);
}

async function adminTestApiKey() {
  const resultEl = document.getElementById('admin-api-test-result');
  if (resultEl) resultEl.textContent = 'Testing…';
  try {
    const r = await fetch(
      `https://www.googleapis.com/youtube/v3/search?part=id&type=video&q=test&maxResults=1&key=${CONFIG.YOUTUBE_API_KEY}`
    );
    const body = await r.json();
    if (r.ok) {
      if (resultEl) { resultEl.textContent = `✅ Key works! (HTTP ${r.status})`; resultEl.style.color = '#00d4ff'; }
      adminState.quotaUsedToday += 100;
      _saveQuota(); // persist so quota display stays accurate
    } else {
      const reason = body?.error?.errors?.[0]?.reason || r.statusText;
      if (resultEl) { resultEl.textContent = `❌ ${r.status}: ${reason}`; resultEl.style.color = '#ff4444'; }
      adminLog(`API key test failed: ${r.status} ${reason}`);
    }
    refreshAdminPanel();
  } catch (e) {
    if (resultEl) { resultEl.textContent = `❌ Network error: ${e.message}`; resultEl.style.color = '#ff4444'; }
  }
}

function adminClearCache() {
  if (!confirm('Clear app cache and service worker? The page will reload.')) return;
  caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k)))).then(() => {
    navigator.serviceWorker?.getRegistrations().then(regs => {
      Promise.all(regs.map(r => r.unregister())).then(() => window.location.reload(true));
    });
  });
}

async function adminChangePin() {
  const newPin = document.getElementById('admin-change-pin-input')?.value?.trim() || '';
  if (!newPin || newPin.length < 4 || !/^\d+$/.test(newPin)) {
    showToast('PIN must be at least 4 digits.', 'error'); return;
  }
  const hash = await sha256Hex(newPin);
  localStorage.setItem(ADMIN_PIN_KEY, hash);
  const inp = document.getElementById('admin-change-pin-input');
  if (inp) inp.value = '';
  showToast('✅ Admin PIN updated.', 'success');
}

/** First-time PIN setup — shown when ?debug=1 and no PIN is set. */
async function adminSetInitialPin() {
  const pin = document.getElementById('admin-new-pin-input')?.value?.trim() || '';
  if (!pin || pin.length < 4 || !/^\d+$/.test(pin)) {
    showToast('PIN must be at least 4 digits.', 'error'); return;
  }
  const hash = await sha256Hex(pin);
  localStorage.setItem(ADMIN_PIN_KEY, hash);
  adminState.isAdminSession = true;
  if (document.getElementById('admin-setup-section')) {
    document.getElementById('admin-setup-section').classList.add('hidden');
    document.getElementById('admin-main-sections')?.classList.remove('hidden');
  }
  refreshAdminPanel();
  showToast('✅ Admin PIN set! Panel unlocked.', 'success');
}

// ═══════════════════════════════════════════════════════════
// CONSOLE HELPERS — owner / developer access
// ─────────────────────────────────────────────────────────
// These are available in the browser DevTools console.
// Open DevTools → Console tab, then type  CipherAdmin.help()
// ═══════════════════════════════════════════════════════════
window.CipherAdmin = {
  /** Print all available commands. */
  help() {
    /* eslint-disable no-console */
    console.log(
      '%cCipher Music — Console Commands\n' +
      '%c' +
      'CipherAdmin.help()           — show this message\n' +
      'CipherAdmin.maintenanceOff() — turn OFF maintenance mode\n' +
      'CipherAdmin.maintenanceOn()  — turn ON  maintenance mode\n' +
      'CipherAdmin.maintenanceStatus() — show current maintenance state\n' +
      'CipherAdmin.openPanel()      — open admin panel (bypasses email check)\n' +
      'CipherAdmin.unlockPanel()    — authenticate admin session with your PIN\n' +
      'CipherAdmin.getPin()         — show stored admin PIN hash\n' +
      'CipherAdmin.setServerUrl(url) — set remote PHP server URL\n',
      'font-size:14px;font-weight:bold;color:#00d4ff',
      'font-size:12px;color:#ccc'
    );
    /* eslint-enable no-console */
  },

  /** Disable maintenance mode immediately. */
  maintenanceOff() {
    _disableMaintenanceMode();
    showToast('🟢 Maintenance mode disabled.', 'success', 3000);
    console.log('%c[Cipher] Maintenance mode: OFF', 'color:#00d4ff');
    return 'Maintenance mode is now OFF';
  },

  /** Enable maintenance mode. */
  maintenanceOn() {
    adminState.maintenanceMode = true;
    localStorage.setItem(MAINT_KEY, '1');
    _applyMaintenanceOverlay();
    showToast('🔴 Maintenance mode enabled.', 'info', 3000);
    try { _postMaintenanceState(true, []); } catch (_) { /* best-effort */ }
    console.log('%c[Cipher] Maintenance mode: ON', 'color:#ff9900');
    return 'Maintenance mode is now ON';
  },

  /** Show the current maintenance mode state. */
  maintenanceStatus() {
    const state_ = adminState.maintenanceMode ? 'ON 🔴' : 'OFF 🟢';
    console.log(`%c[Cipher] Maintenance mode: ${state_}`, 'color:#00d4ff');
    return `Maintenance mode is ${state_}`;
  },

  /**
   * Open the admin panel.
   * If already authenticated this session it opens directly.
   * Otherwise shows the PIN modal — the correct PIN is still required.
   */
  openPanel() {
    // Bypass the email guard for the owner operating from the console
    const panel = document.getElementById('admin-panel');
    if (!panel) { console.error('[Cipher] Admin panel element not found in DOM.'); return; }

    if (adminState.isAdminSession) {
      panel.classList.add('open');
      refreshAdminPanel();
      console.log('%c[Cipher] Admin panel opened.', 'color:#00d4ff');
      return 'Admin panel opened';
    }

    // Show the PIN modal
    showAdminPinModal();
    console.log('%c[Cipher] Enter your admin PIN in the modal.', 'color:#00d4ff');
    return 'PIN modal shown — enter your PIN to authenticate';
  },

  /**
   * Authenticate the admin session programmatically.
   * Usage: CipherAdmin.unlockPanel('YOUR_PIN')
   */
  async unlockPanel(pin) {
    if (!pin) { console.error('[Cipher] Usage: CipherAdmin.unlockPanel("your_pin")'); return; }
    const expectedHash = localStorage.getItem(ADMIN_PIN_KEY) || DEFAULT_ADMIN_PIN_HASH;
    const enteredHash  = await sha256Hex(String(pin));
    if (enteredHash !== expectedHash) {
      showToast('❌ Incorrect admin PIN.', 'error', 3000);
      console.error('[Cipher] Incorrect PIN.');
      return 'Incorrect PIN';
    }
    adminState.isAdminSession = true;
    const panel = document.getElementById('admin-panel');
    panel?.classList.add('open');
    refreshAdminPanel();
    // Also close any open PIN modal
    document.getElementById('admin-pin-modal')?.classList.add('hidden');
    console.log('%c[Cipher] Admin session authenticated. Panel is open.', 'color:#00d4ff');
    return 'Authenticated — admin panel is open';
  },

  /** Show the current stored admin PIN hash (for debugging key mismatches). */
  getPin() {
    const hash = localStorage.getItem(ADMIN_PIN_KEY) || DEFAULT_ADMIN_PIN_HASH;
    console.log('%c[Cipher] Admin PIN hash: ' + hash, 'color:#888');
    return hash;
  },

  /** Set the remote PHP server URL (same as the admin panel input). */
  setServerUrl(url) {
    if (!url) { console.error('[Cipher] Usage: CipherAdmin.setServerUrl("http://localhost:8080/admin")'); return; }
    let parsed;
    try { parsed = new URL(url); } catch (_) { console.error('[Cipher] Invalid URL.'); return; }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      console.error('[Cipher] URL must start with http:// or https://');
      return;
    }
    const clean = url.trim().replace(/\/+$/, '');
    localStorage.setItem('cipher_admin_server_url', clean);
    _refreshAdminUrls();
    if (window._cipherMaintPollId) { clearInterval(window._cipherMaintPollId); window._cipherMaintPollId = null; }
    _startMaintenancePoller();
    console.log('%c[Cipher] Server URL set: ' + clean, 'color:#00d4ff');
    return 'Server URL saved: ' + clean;
  }
};

// Print a one-line hint at startup so the owner can discover the commands.
console.log(
  '%c[Cipher Music] Owner console available → type %cCipherAdmin.help()%c for commands.',
  'color:#555', 'color:#00d4ff;font-weight:bold', 'color:#555'
);


