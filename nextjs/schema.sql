-- Users / Accounts
CREATE TABLE IF NOT EXISTS accounts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username     TEXT NOT NULL,
  email        TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  member_since TIMESTAMPTZ NOT NULL DEFAULT now(),
  plan         TEXT NOT NULL DEFAULT 'free',  -- 'free' | 'premium'
  role         TEXT NOT NULL DEFAULT 'user',  -- 'user' | 'admin'
  banned       BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Recently played songs
CREATE TABLE IF NOT EXISTS recent_songs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email TEXT NOT NULL,
  video_id   TEXT NOT NULL,
  title      TEXT NOT NULL,
  channel    TEXT NOT NULL DEFAULT '',
  thumb      TEXT NOT NULL DEFAULT '',
  played_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_email, video_id)
);

-- Liked songs
CREATE TABLE IF NOT EXISTS liked_songs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email TEXT NOT NULL,
  video_id   TEXT NOT NULL,
  title      TEXT NOT NULL,
  channel    TEXT NOT NULL DEFAULT '',
  thumb      TEXT NOT NULL DEFAULT '',
  liked_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_email, video_id)
);

-- Playlists
CREATE TABLE IF NOT EXISTS playlists (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email TEXT NOT NULL,
  name       TEXT NOT NULL,
  items      JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_email, name)
);

-- Payments
CREATE TABLE IF NOT EXISTS payments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ref              TEXT NOT NULL UNIQUE,
  user_email       TEXT NOT NULL,
  plan             TEXT NOT NULL,
  amount_cents     INTEGER NOT NULL,
  currency         TEXT NOT NULL DEFAULT 'usd',
  status           TEXT NOT NULL DEFAULT 'pending',
  stripe_payment_intent_id TEXT,
  stripe_event_id  TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Access log
CREATE TABLE IF NOT EXISTS access_log (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email TEXT NOT NULL,
  event      TEXT NOT NULL,
  metadata   JSONB NOT NULL DEFAULT '{}',
  ip         TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Stripe events (for idempotency)
CREATE TABLE IF NOT EXISTS stripe_events (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL,
  api_version  TEXT,
  livemode     BOOLEAN NOT NULL DEFAULT false,
  created      INTEGER,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sessions (encrypted refresh tokens — only hash stored)
CREATE TABLE IF NOT EXISTS sessions (
  id                  UUID PRIMARY KEY,
  user_id             UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_email          TEXT NOT NULL,
  refresh_token_hash  TEXT NOT NULL,         -- SHA-256 of raw refresh token
  user_agent          TEXT NOT NULL DEFAULT '',
  ip                  TEXT NOT NULL DEFAULT '',
  region              TEXT,
  expires_at          TIMESTAMPTZ NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);

-- Device fingerprints (soft security)
CREATE TABLE IF NOT EXISTS device_fingerprints (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email TEXT NOT NULL,
  user_agent TEXT NOT NULL,
  ip         TEXT NOT NULL DEFAULT '',
  region     TEXT,
  last_seen  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_email, user_agent)
);

-- Unified tracks (provider-agnostic internal IDs)
CREATE TABLE IF NOT EXISTS tracks (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider         TEXT NOT NULL,              -- 'youtube' | 'spotify' ...
  provider_track_id TEXT NOT NULL,
  title            TEXT NOT NULL,
  artist           TEXT NOT NULL DEFAULT '',
  duration         INTEGER NOT NULL DEFAULT 0, -- seconds
  artwork          TEXT NOT NULL DEFAULT '',
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(provider, provider_track_id)
);

-- Playback sessions (cross-device sync)
CREATE TABLE IF NOT EXISTS playback_sessions (
  user_id          UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  current_track_id UUID REFERENCES tracks(id) ON DELETE SET NULL,
  position         FLOAT NOT NULL DEFAULT 0,
  is_playing       BOOLEAN NOT NULL DEFAULT false,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Platform configuration (maintenance lock etc.)
CREATE TABLE IF NOT EXISTS platform_config (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Seed default platform status
INSERT INTO platform_config (key, value) VALUES ('platform_status', 'active')
  ON CONFLICT (key) DO NOTHING;

-- Feature flags (remote feature enabling without redeploy)
CREATE TABLE IF NOT EXISTS feature_flags (
  name        TEXT PRIMARY KEY,
  enabled     BOOLEAN NOT NULL DEFAULT false,
  description TEXT NOT NULL DEFAULT '',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Abuse records (fraud detection)
CREATE TABLE IF NOT EXISTS abuse_records (
  user_email         TEXT PRIMARY KEY,
  failed_logins      INTEGER NOT NULL DEFAULT 0,
  failed_payments    INTEGER NOT NULL DEFAULT 0,
  card_count         INTEGER NOT NULL DEFAULT 0,
  flagged            BOOLEAN NOT NULL DEFAULT false,
  flagged_reason     TEXT,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

