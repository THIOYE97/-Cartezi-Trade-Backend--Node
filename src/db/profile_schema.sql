-- db/profile_schema.sql

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS phone            TEXT,
  ADD COLUMN IF NOT EXISTS phone_verified   BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS date_of_birth    DATE,
  ADD COLUMN IF NOT EXISTS nationality      TEXT,
  ADD COLUMN IF NOT EXISTS address_line     TEXT,
  ADD COLUMN IF NOT EXISTS city             TEXT,
  ADD COLUMN IF NOT EXISTS country          TEXT,
  ADD COLUMN IF NOT EXISTS postcode         TEXT,
  ADD COLUMN IF NOT EXISTS onboarding_done  BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS avatar_url       TEXT;

-- Historique des actions user
CREATE TABLE IF NOT EXISTS user_activity (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  -- WATCHLIST_ADD, WATCHLIST_REMOVE, ORDER_BUY, ORDER_SELL,
  -- P2P_TRADE_CREATED, P2P_TRADE_COMPLETED, DEPOSIT, WITHDRAWAL
  title       TEXT NOT NULL,
  description TEXT,
  metadata    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_activity_user
  ON user_activity(user_id, created_at DESC);
