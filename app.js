/* ═══════════════════════════════════════════════════════════
   CIPHER MUSIC — Application Logic
   ═══════════════════════════════════════════════════════════ */

// ── Configuration ─────────────────────────────────────────
const CONFIG = {
  YOUTUBE_API_KEY: "AIzaSyAxMywGGrwQ2FoXClwrOn6LmuWPuYGCKBY"
};

// ── State ──────────────────────────────────────────────────
const state = {
  user: null,          // { username, email, memberSince }
  currentView: 'login',
  searchResults: [],
  currentIndex: -1,
  ytPlayer: null,
  ytReady: false,
  isPlaying: false,
  selectedPlan: null
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
// AUTH
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

// ── Login form validation ──────────────────────────────────
function validateLogin() {
  const username = $('#login-username').value.trim();
  const email    = $('#login-email').value.trim();
  const password = $('#login-password').value;

  let valid = true;

  const setErr = (id, msg) => {
    const el = $(`#${id}`);
    if (el) el.textContent = msg;
    if (msg) valid = false;
  };

  setErr('err-username', username.length < 2 ? 'Username must be at least 2 characters.' : '');
  setErr('err-email',    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? 'Please enter a valid email address.' : '');
  setErr('err-password', password.length < 6 ? 'Password must be at least 6 characters.' : '');

  return valid;
}

function handleLogin(e) {
  e.preventDefault();
  if (!validateLogin()) return;

  const user = {
    username:    $('#login-username').value.trim(),
    email:       $('#login-email').value.trim(),
    memberSince: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
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

  // Toggle views
  $$('.view').forEach(v => v.classList.remove('active'));
  const target = $(`#view-${viewName}`);
  if (target) target.classList.add('active');

  // Sidebar visibility
  const sidebar = $('#sidebar');
  if (viewName === 'login') {
    sidebar.classList.add('hidden');
  } else {
    sidebar.classList.remove('hidden');
    $$('.nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.view === viewName);
    });
  }

  // Populate profile on switch
  if (viewName === 'profile') populateProfile();
}

// ═══════════════════════════════════════════════════════════
// YOUTUBE IFrame API
// ═══════════════════════════════════════════════════════════

// Called by YouTube IFrame API when ready
window.onYouTubeIframeAPIReady = function () {
  state.ytReady = true;
  state.ytPlayer = new YT.Player('yt-player', {
    height: '1',
    width: '1',
    playerVars: { autoplay: 0, controls: 0 },
    events: {
      onStateChange: onPlayerStateChange
    }
  });
};

function onPlayerStateChange(event) {
  const playing = event.data === YT.PlayerState.PLAYING;
  state.isPlaying = playing;
  $('#play-icon')?.classList.toggle('hidden', playing);
  $('#pause-icon')?.classList.toggle('hidden', !playing);

  // Auto-next when video ends
  if (event.data === YT.PlayerState.ENDED) {
    const autoplay = $('#toggle-autoplay');
    if (autoplay && autoplay.checked) {
      playNext();
    }
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

  // Update UI
  updateNowPlaying(item);
  showPlayerBar();
  highlightCard(index);

  // Set volume
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
  $$('.result-card').forEach((c, i) => {
    c.classList.toggle('playing', i === index);
  });
}

function playNext() {
  const next = state.currentIndex + 1;
  if (next < state.searchResults.length) {
    playVideo(next);
  }
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
  url.searchParams.set('videoCategoryId', '10'); // Music
  url.searchParams.set('maxResults', '16');
  url.searchParams.set('q', query);
  url.searchParams.set('key', CONFIG.YOUTUBE_API_KEY);

  const response = await fetch(url.toString());
  if (!response.ok) throw new Error(`YouTube API error: ${response.status}`);
  const data = await response.json();
  return data.items || [];
}

function renderResults(items) {
  const grid    = $('#search-results');
  const noRes   = $('#no-results');
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

  // Attach play button listeners
  $$('.result-play-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      playVideo(parseInt(btn.dataset.index, 10));
    });
  });

  // Also allow clicking anywhere on the card
  $$('.result-card').forEach(card => {
    card.addEventListener('click', () => {
      playVideo(parseInt(card.dataset.index, 10));
    });
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

async function handleSearch() {
  const query = $('#search-input')?.value.trim();
  if (!query) return;

  const grid = $('#search-results');
  grid.innerHTML = '<div class="loading-spinner"><div class="spinner"></div></div>';
  $('#no-results')?.classList.add('hidden');
  $('#search-placeholder')?.classList.add('hidden');

  try {
    const items = await searchYouTube(query);
    state.searchResults = items;
    renderResults(items);
  } catch (err) {
    console.error('Search failed:', err);
    grid.innerHTML = `<div class="empty-state"><p>Search failed. Check your API key or network connection.</p></div>`;
  }
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

  // ── Password toggle ──
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

  // ── Sign-up link ──
  $('#signup-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    $('#signup-modal')?.classList.remove('hidden');
  });

  $('#modal-close')?.addEventListener('click', () => {
    $('#signup-modal')?.classList.add('hidden');
  });

  $('#signup-modal .modal-overlay')?.addEventListener('click', () => {
    $('#signup-modal')?.classList.add('hidden');
  });

  // ── Sidebar navigation ──
  $$('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      if (state.user) showView(item.dataset.view);
    });
  });

  // ── Search ──
  $('#search-btn')?.addEventListener('click', handleSearch);
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
    showView('login');
  });

  // ── Delete account ──
  $('#btn-delete-account')?.addEventListener('click', () => {
    if (window.confirm('Are you sure you want to delete your account? This cannot be undone.')) {
      clearUser();
      localStorage.removeItem('cipher_settings');
      updateHeaderUser();
      showView('login');
    }
  });

  // ── Profile edit placeholder ──
  $('#edit-profile-btn')?.addEventListener('click', () => {
    alert('Profile editing coming soon!');
  });

  // ── Keyboard: close modal on Escape ──
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      $('#signup-modal')?.classList.add('hidden');
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
