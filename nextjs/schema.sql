-- Users / Accounts
CREATE TABLE IF NOT EXISTS accounts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username     TEXT NOT NULL,
  email        TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  member_since TIMESTAMPTZ NOT NULL DEFAULT now(),
  plan         TEXT NOT NULL DEFAULT 'free',
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
