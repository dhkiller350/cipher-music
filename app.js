/* ═══════════════════════════════════════════════════════════
   CIPHER MUSIC — Application Logic
   ═══════════════════════════════════════════════════════════ */

// ── Configuration ─────────────────────────────────────────
const CONFIG = {
  YOUTUBE_API_KEY:     "AIzaSyAxMywGGrwQ2FoXClwrOn6LmuWPuYGCKBY",
  EMAILJS_SERVICE_ID:  "service_p32tpor",
  EMAILJS_TEMPLATE_ID: "template_vjpbh3p",
  EMAILJS_PUBLIC_KEY:  "IJSM7Zp-wxJkkxVN7"
};

const APP_VERSION = '2.2'; // bump to show changelog on next load

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
// Tracks whether music was actively playing when the screen was locked or
// the user switched apps.  Used to resume after iOS force-pauses the player.
let _wasPlayingWhenHidden = false;

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    // Record playback state NOW, before iOS has a chance to trigger PAUSED
    _wasPlayingWhenHidden = state.isPlaying;
  } else {
    // Coming back to foreground (screen unlocked / app switched back)
    requestWakeLock();
    if (_wasPlayingWhenHidden) {
      _wasPlayingWhenHidden = false; // reset so we don't re-resume on next cycle
      startBgAudioKeepAlive();
      // iOS may have force-paused the YouTube player while we were hidden.
      // If so, resume it automatically.
      if (!state.isPlaying && state.ytPlayer && state.ytReady) {
        state.ytPlayer.playVideo();
      }
    }
  }
});

// ── Page Lifecycle: pagehide / freeze ─────────────────────
// On iOS/iPadOS "pagehide" fires when the page is being navigated away or
// put into the back/forward cache.  We must NOT stop audio here or it kills
// background playback.  "freeze" fires when the browser suspends the page
// (Page Lifecycle API); we simply keep the AudioContext alive.
window.addEventListener('pagehide', (e) => {
  // e.persisted === true → page is entering the back/forward cache (bfcache).
  // Keep the audio session open so music continues in the background.
  if (e.persisted && state.isPlaying) {
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
  // seekto/seekbackward/seekforward are not supported for YT embeds
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
}

function saveUser(user) {
  state.user = user;
  localStorage.setItem('cipher_user', JSON.stringify(user));
}

function clearUser() {
  state.user = null;
  localStorage.removeItem('cipher_user');
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

  if (emailOk && findAccount(email ?? '')) {
    setErr('err-su-email', 'An account with this email already exists. Sign in instead.');
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

  const account = findAccount(emailOrUser);
  if (!account) {
    const el = $('#err-login-email');
    if (el) el.textContent = 'No account found with that email or username.';
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
  showView('player');
}

// ═══════════════════════════════════════════════════════════
// VIEW MANAGEMENT
// ═══════════════════════════════════════════════════════════
function showView(viewName) {
  state.currentView = viewName;

  $('#sidebar')?.classList.remove('sidebar-open');
  $('#sidebar-toggle')?.classList.remove('active');

  $$('.view').forEach(v => v.classList.remove('active'));
  const target = $(`#view-${viewName}`);
  if (target) target.classList.add('active');

  const sidebar = $('#sidebar');
  const noSidebar = ['login', 'signup', 'verify', 'forgot', 'reset'].includes(viewName);

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
      autoplay:      0,
      controls:      1,       // show controls (needed for iOS background)
      playsinline:   1,       // prevent iOS from going fullscreen automatically
      rel:           0,       // no related videos at end
      modestbranding: 1,      // minimal YouTube branding
      fs:            1        // allow fullscreen button
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
    startListeningTimer();
    requestWakeLock();
    startBgAudioKeepAlive(); // keep iOS audio session alive in background
    // Update media session playback state
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = 'playing';
    }
  } else {
    stopListeningTimer();
    if (event.data === YT.PlayerState.PAUSED) {
      releaseWakeLock();
      // Only stop the background keep-alive when the user explicitly paused
      // (app is in the foreground).  If the document is hidden, iOS locked the
      // screen or the user switched apps — keep the audio session alive so
      // playback can resume automatically when the screen comes back on.
      if (!document.hidden) stopBgAudioKeepAlive();
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
    } else if (settings.shuffle) {
      // Shuffle: pick random track; with repeat-all wrap around is already handled by randomness
      const next = Math.floor(Math.random() * state.searchResults.length);
      playVideo(next);
    } else {
      const autoplay = $('#toggle-autoplay');
      if (autoplay && autoplay.checked) {
        // Try queue first, then normal next
        if (!playNextWithQueue()) {
          if (repeat === 'all' && state.currentIndex >= state.searchResults.length - 1) {
            playVideo(0);
          } else {
            playNext();
          }
        }
      } else {
        // Even without autoplay, still check queue
        if (state.queue.length > 0) playNextWithQueue();
      }
    }
  }
}

function setSoundwavePlaying(playing) {
  const sw = $('#np-soundwave');
  if (sw) sw.classList.toggle('paused', !playing);
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
/**
 * Search YouTube for videos matching `query`.
 * @param {string} query  - Search terms
 * @param {string} [channelId] - Optional YouTube channel ID to restrict results.
 *   When provided, results are ordered by viewCount; otherwise by relevance.
 *   videoCategoryId is intentionally omitted so all video types are returned
 *   (music, official videos, shorts, podcasts, etc.).
 */
async function searchYouTube(query, channelId = '') {
  const url = new URL('https://www.googleapis.com/youtube/v3/search');
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('type', 'video');
  // Removed videoCategoryId restriction so ALL video types are returned
  url.searchParams.set('maxResults', '50');
  url.searchParams.set('q', query);
  url.searchParams.set('key', CONFIG.YOUTUBE_API_KEY);
  // Order by relevance for searches, viewCount for channel browsing
  if (channelId) {
    url.searchParams.set('channelId', channelId);
    url.searchParams.set('order', 'viewCount');
  } else {
    url.searchParams.set('order', 'relevance');
  }

  const response = await fetch(url.toString());
  if (!response.ok) throw new Error(`YouTube API error: ${response.status}`);
  const data = await response.json();
  return data.items || [];
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
    console.error('Search failed:', err);
    grid.innerHTML = `<div class="empty-state"><p>Search failed. Check your API key or network connection.</p></div>`;
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
function selectPlan(plan) {
  state.selectedPlan = plan;

  const section = $('#payment-form-section');
  const success = $('#payment-success');
  const form    = $('#payment-form');
  const planLabel = $('#selected-plan-label');

  if (plan === 'free') {
    section?.classList.add('hidden');
    savePlan('free');
    showToast('Switched to Free plan.', 'info', 2000);
    return;
  }

  const planNames = { pro: 'Pro Pack — $9.99/mo', premium: 'Premium — $19.99/mo' };
  if (planLabel) planLabel.textContent = planNames[plan] || plan;

  success?.classList.add('hidden');
  form?.classList.remove('hidden');
  section?.classList.remove('hidden');
  section?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function validatePayment() {
  const name  = $('#pay-name')?.value.trim();
  const email = $('#pay-email')?.value.trim();
  const conf  = $('#pay-confirm')?.checked;

  let valid = true;
  const setErr = (id, msg) => {
    const el = $(`#${id}`);
    if (el) el.textContent = msg;
    if (msg) valid = false;
  };

  setErr('err-pay-name',    (name?.length ?? 0) < 2   ? 'Please enter your name.'        : '');
  setErr('err-pay-email',   !/^[^@]+@[^@]+\.[^@]+$/.test(email ?? '') ? 'Please enter a valid email.' : '');
  setErr('err-pay-confirm', !conf ? 'Please confirm you have sent your payment.' : '');
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

function handlePayment(e) {
  e.preventDefault();
  if (!validatePayment()) return;

  savePlan(state.selectedPlan || 'pro');
  const planNames = { pro: 'Pro Pack', premium: 'Premium' };
  const planName = planNames[state.selectedPlan] || 'Pro Pack';
  const titleEl = $('#payment-success-title');
  if (titleEl) titleEl.textContent = `You're now a Cipher ${planName} member! 🎉`;
  $('#payment-form')?.classList.add('hidden');
  $('#payment-success')?.classList.remove('hidden');
  showToast('Subscribed to Cipher ' + planName + '! 🎉', 'success');
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

  ['repeat-mode', 'playback-speed', 'eq-preset', 'language-select'].forEach(id => {
    $(`#${id}`)?.addEventListener('change', saveSettings);
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

  // Register service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  bindEvents();

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
}

document.addEventListener('DOMContentLoaded', init);
