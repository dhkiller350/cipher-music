/* ═══════════════════════════════════════════════════════════
   CIPHER MUSIC — Application Logic
   ═══════════════════════════════════════════════════════════ */

// ── Configuration ─────────────────────────────────────────
const CONFIG = {
  YOUTUBE_API_KEY:     "AIzaSyAxMywGGrwQ2FoXClwrOn6LmuWPuYGCKBY",
  // EmailJS credentials — replace with your own from https://emailjs.com
  EMAILJS_SERVICE_ID:  "YOUR_SERVICE_ID",
  EMAILJS_TEMPLATE_ID: "YOUR_TEMPLATE_ID",
  EMAILJS_PUBLIC_KEY:  "YOUR_PUBLIC_KEY"
};

// ── State ──────────────────────────────────────────────────
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
  featuredLoaded: false,    // whether trending music is already loaded
  activeChip: 'trending music 2025'
};

// ── DOM helpers ────────────────────────────────────────────
const $  = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

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
  return String(Math.floor(100000 + Math.random() * 900000));
}

function isEmailJSConfigured() {
  return CONFIG.EMAILJS_SERVICE_ID !== 'YOUR_SERVICE_ID' &&
         CONFIG.EMAILJS_PUBLIC_KEY  !== 'YOUR_PUBLIC_KEY';
}

async function sendVerificationEmail(toEmail, toName, code) {
  if (!isEmailJSConfigured()) {
    // Show demo hint instead of sending
    const hint = $('#demo-code-hint');
    const val  = $('#demo-code-value');
    if (hint) hint.classList.remove('hidden');
    if (val)  val.textContent = code;
    return;
  }

  try {
    if (typeof emailjs === 'undefined') throw new Error('EmailJS not loaded');
    emailjs.init(CONFIG.EMAILJS_PUBLIC_KEY);
    await emailjs.send(CONFIG.EMAILJS_SERVICE_ID, CONFIG.EMAILJS_TEMPLATE_ID, {
      to_email:          toEmail,
      to_name:           toName,
      verification_code: code
    });
    showToast('Verification code sent to ' + toEmail, 'success');
  } catch (err) {
    console.warn('EmailJS failed:', err);
    // Fallback to demo hint
    const hint = $('#demo-code-hint');
    const val  = $('#demo-code-value');
    if (hint) hint.classList.remove('hidden');
    if (val)  val.textContent = code;
    showToast('Email sending failed — demo code shown on screen', 'info');
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

  // Create the account
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
  if (!state.pendingSignup || !state.pendingCode) return;
  showToast('Resending code…', 'info');
  await sendVerificationEmail(state.pendingSignup.email, state.pendingSignup.username, state.pendingCode);
}

// ═══════════════════════════════════════════════════════════
// LOGIN
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

  $$('.view').forEach(v => v.classList.remove('active'));
  const target = $(`#view-${viewName}`);
  if (target) target.classList.add('active');

  const sidebar = $('#sidebar');
  const noSidebar = ['login', 'signup', 'verify'].includes(viewName);

  if (noSidebar) {
    sidebar.classList.add('hidden');
  } else {
    sidebar.classList.remove('hidden');
    $$('.nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.view === viewName);
    });
  }

  if (viewName === 'profile') populateProfile();
  if (viewName === 'player' && !state.featuredLoaded) loadFeaturedMusic();
}

// ═══════════════════════════════════════════════════════════
// YOUTUBE IFrame API
// ═══════════════════════════════════════════════════════════
window.onYouTubeIframeAPIReady = function () {
  state.ytReady = true;
  state.ytPlayer = new YT.Player('yt-player', {
    height: '1',
    width: '1',
    playerVars: { autoplay: 0, controls: 0 },
    events: { onStateChange: onPlayerStateChange }
  });
};

function onPlayerStateChange(event) {
  const playing = event.data === YT.PlayerState.PLAYING;
  state.isPlaying = playing;
  $('#play-icon')?.classList.toggle('hidden', playing);
  $('#pause-icon')?.classList.toggle('hidden', !playing);

  if (event.data === YT.PlayerState.ENDED) {
    const autoplay = $('#toggle-autoplay');
    if (autoplay && autoplay.checked) playNext();
  }
}

function playVideo(index) {
  if (!state.ytReady || !state.ytPlayer || index < 0 || index >= state.searchResults.length) return;

  state.currentIndex = index;
  const item = state.searchResults[index];
  const videoId = item.id?.videoId;
  if (!videoId) return;

  state.ytPlayer.loadVideoById(videoId);
  state.isPlaying = true;

  updateNowPlaying(item);
  showPlayerBar();
  highlightCard(index);

  const vol = parseInt($('#volume-slider')?.value ?? 80, 10);
  state.ytPlayer.setVolume(vol);
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

function playNext() {
  const next = state.currentIndex + 1;
  if (next < state.searchResults.length) playVideo(next);
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
async function searchYouTube(query) {
  const url = new URL('https://www.googleapis.com/youtube/v3/search');
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('type', 'video');
  url.searchParams.set('videoCategoryId', '10');
  url.searchParams.set('maxResults', '16');
  url.searchParams.set('q', query);
  url.searchParams.set('key', CONFIG.YOUTUBE_API_KEY);

  const response = await fetch(url.toString());
  if (!response.ok) throw new Error(`YouTube API error: ${response.status}`);
  const data = await response.json();
  return data.items || [];
}

function renderResults(items) {
  const grid        = $('#search-results');
  const noRes       = $('#no-results');
  const placeholder = $('#search-placeholder');

  if (placeholder) placeholder.classList.add('hidden');

  if (!items.length) {
    grid.innerHTML = '';
    noRes?.classList.remove('hidden');
    return;
  }

  noRes?.classList.add('hidden');

  grid.innerHTML = items.map((item, idx) => {
    const thumb   = item.snippet?.thumbnails?.medium?.url || '';
    const title   = decodeHTMLEntities(item.snippet?.title || '');
    const channel = item.snippet?.channelTitle || '';
    return `
      <div class="result-card" data-index="${idx}" role="article">
        <img class="result-thumb" src="${thumb}" alt="${escapeAttr(title)}" loading="lazy" />
        <div class="result-info">
          <p class="result-title" title="${escapeAttr(title)}">${title}</p>
          <p class="result-channel">${escapeHTML(channel)}</p>
          <button class="btn-primary result-play-btn" data-index="${idx}" aria-label="Play ${escapeAttr(title)}">▶ Play</button>
        </div>
      </div>
    `;
  }).join('');

  $$('.result-play-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      playVideo(parseInt(btn.dataset.index, 10));
    });
  });

  $$('.result-card').forEach(card => {
    card.addEventListener('click', () => playVideo(parseInt(card.dataset.index, 10)));
  });
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

async function handleSearch(query) {
  const q = query || $('#search-input')?.value.trim();
  if (!q) return;

  const grid = $('#search-results');
  grid.innerHTML = '<div class="loading-spinner"><div class="spinner"></div></div>';
  $('#no-results')?.classList.add('hidden');
  $('#search-placeholder')?.classList.add('hidden');

  try {
    const items = await searchYouTube(q);
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
}

// ═══════════════════════════════════════════════════════════
// PAYMENT / UPGRADE
// ═══════════════════════════════════════════════════════════
function selectPlan(plan) {
  state.selectedPlan = plan;

  const section = $('#payment-form-section');
  const success = $('#payment-success');
  const form    = $('#payment-form');

  if (plan === 'free') {
    section?.classList.add('hidden');
    return;
  }

  success?.classList.add('hidden');
  form?.classList.remove('hidden');
  section?.classList.remove('hidden');
  section?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function formatCardNumber(input) {
  let value = input.value.replace(/\D/g, '').substring(0, 16);
  value = value.replace(/(.{4})/g, '$1 ').trim();
  input.value = value;
}

function formatExpiry(input) {
  let value = input.value.replace(/\D/g, '').substring(0, 4);
  if (value.length >= 3) value = value.substring(0, 2) + '/' + value.substring(2);
  input.value = value;
}

function validatePayment() {
  const name   = $('#card-name')?.value.trim();
  const number = $('#card-number')?.value.replace(/\s/g, '');
  const expiry = $('#card-expiry')?.value;
  const cvv    = $('#card-cvv')?.value;

  let valid = true;

  const setErr = (id, msg) => {
    const el = $(`#${id}`);
    if (el) el.textContent = msg;
    if (msg) valid = false;
  };

  setErr('err-card-name',   (name?.length ?? 0) < 2 ? 'Please enter the cardholder name.' : '');
  setErr('err-card-number', (number?.length ?? 0) !== 16 ? 'Please enter a valid 16-digit card number.' : '');
  setErr('err-card-expiry', !/^\d{2}\/\d{2}$/.test(expiry ?? '') ? 'Please use MM/YY format.' : '');
  setErr('err-card-cvv',    !/^\d{3,4}$/.test(cvv ?? '') ? 'CVV must be 3 or 4 digits.' : '');

  return valid;
}

function handlePayment(e) {
  e.preventDefault();
  if (!validatePayment()) return;

  $('#payment-form')?.classList.add('hidden');
  $('#payment-success')?.classList.remove('hidden');
  showToast('Subscribed to Cipher ' + (state.selectedPlan || 'Pro') + '! 🎉', 'success');
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
  const toggleNotifications = $('#toggle-notifications');
  const toggleDark          = $('#toggle-dark-mode');
  const langSelect          = $('#language-select');

  if (toggleAutoplay)      toggleAutoplay.checked      = settings.autoplay      ?? true;
  if (toggleHq)            toggleHq.checked            = settings.hq            ?? false;
  if (toggleNotifications) toggleNotifications.checked = settings.notifications ?? true;
  if (toggleDark) {
    const dark = settings.darkMode ?? true;
    toggleDark.checked = dark;
    applyDarkMode(dark);
  }
  if (langSelect) langSelect.value = settings.language ?? 'en';
}

function saveSettings() {
  const settings = {
    autoplay:      $('#toggle-autoplay')?.checked      ?? true,
    hq:            $('#toggle-hq')?.checked            ?? false,
    notifications: $('#toggle-notifications')?.checked ?? true,
    darkMode:      $('#toggle-dark-mode')?.checked     ?? true,
    language:      $('#language-select')?.value        ?? 'en'
  };
  localStorage.setItem('cipher_settings', JSON.stringify(settings));
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

  // ── Back to sign-up from verify ──
  $('#back-to-signup')?.addEventListener('click', (e) => {
    e.preventDefault();
    showView('signup');
  });

  // ── Sidebar navigation ──
  $$('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      if (state.user) showView(item.dataset.view);
    });
  });

  // ── Genre chips ──
  $$('.genre-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      $$('.genre-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      state.activeChip = chip.dataset.query;
      handleSearch(chip.dataset.query);
    });
  });

  // ── Search ──
  $('#search-btn')?.addEventListener('click', () => handleSearch());
  $('#search-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleSearch();
  });

  // ── Player controls ──
  $('#btn-play-pause')?.addEventListener('click', togglePlayPause);
  $('#btn-next')?.addEventListener('click', playNext);

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
  $('#card-number')?.addEventListener('input', function () { formatCardNumber(this); });
  $('#card-expiry')?.addEventListener('input', function () { formatExpiry(this); });

  // ── Settings toggles ──
  $('#toggle-dark-mode')?.addEventListener('change', function () {
    applyDarkMode(this.checked);
    saveSettings();
  });

  ['toggle-autoplay', 'toggle-hq', 'toggle-notifications'].forEach(id => {
    $(`#${id}`)?.addEventListener('change', saveSettings);
  });

  $('#language-select')?.addEventListener('change', saveSettings);

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

  // ── Profile edit placeholder ──
  $('#edit-profile-btn')?.addEventListener('click', () => {
    showToast('Profile editing coming soon!', 'info');
  });

  // ── Keyboard: Escape closes verify/signup ──
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.currentView === 'verify') {
      showView('signup');
    }
  });
}

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════
function init() {
  loadUser();
  loadSettings();
  updateHeaderUser();
  updateClock();
  setInterval(updateClock, 1000);
  bindEvents();

  if (state.user) {
    showView('player');
  } else {
    showView('login');
  }
}

document.addEventListener('DOMContentLoaded', init);
