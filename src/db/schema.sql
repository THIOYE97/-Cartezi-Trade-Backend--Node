CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
  id                    TEXT PRIMARY KEY,
  full_name             TEXT NOT NULL,
  email                 TEXT NOT NULL UNIQUE,
  password_hash         TEXT NOT NULL DEFAULT '',
  role                  TEXT NOT NULL DEFAULT 'ROLE_USER',
  verified              BOOLEAN NOT NULL DEFAULT FALSE,
  status                TEXT NOT NULL DEFAULT 'ACTIVE',
  two_factor_enabled    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wallets (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  balance     NUMERIC(20, 8) NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id           TEXT PRIMARY KEY,
  wallet_id    TEXT NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  amount       NUMERIC(20, 8) NOT NULL,
  type         TEXT NOT NULL,   -- CREDIT, DEBIT, DEPOSIT, WITHDRAWAL, ORDER, TRANSFER
  purpose      TEXT NOT NULL,
  transfer_id  TEXT,
  date         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS assets (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  coin_id     TEXT NOT NULL,
  coin_data   JSONB NOT NULL,
  quantity    NUMERIC(30, 10) NOT NULL DEFAULT 0,
  buy_price   NUMERIC(20, 8) NOT NULL DEFAULT 0,
  UNIQUE(user_id, coin_id)
);

CREATE TABLE IF NOT EXISTS orders (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_type  TEXT NOT NULL,   -- BUY, SELL
  price       NUMERIC(20, 8) NOT NULL,
  status      TEXT NOT NULL DEFAULT 'SUCCESS',
  coin_id     TEXT NOT NULL,
  coin_data   JSONB NOT NULL,
  quantity    NUMERIC(30, 10) NOT NULL,
  unit_price  NUMERIC(20, 8) NOT NULL,
  timestamp   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS watchlists (
  id       TEXT PRIMARY KEY,
  user_id  TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  coin_ids TEXT[] NOT NULL DEFAULT '{bitcoin,ethereum}'
);

CREATE TABLE IF NOT EXISTS payment_orders (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount          NUMERIC(20, 8) NOT NULL,
  currency        TEXT NOT NULL DEFAULT 'usd',
  status          TEXT NOT NULL DEFAULT 'PENDING',  -- PENDING, SUCCESS, FAILED
  stripe_session_id TEXT UNIQUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS withdrawals (
  id        TEXT PRIMARY KEY,
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount    NUMERIC(20, 8) NOT NULL,
  status    TEXT NOT NULL DEFAULT 'PENDING',  -- PENDING, SUCCESS, DECLINED
  date      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payment_details (
  id                   TEXT PRIMARY KEY,
  user_id              TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  account_holder_name  TEXT NOT NULL,
  account_number       TEXT NOT NULL,
  bank_name            TEXT NOT NULL,
  ifsc                 TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS otp_sessions (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type              TEXT NOT NULL,  -- TWO_FACTOR, VERIFICATION, RESET_PASSWORD
  otp               TEXT NOT NULL,
  verification_type TEXT,
  send_to           TEXT,
  expires_at        TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_wallet_transactions_wallet_id ON wallet_transactions(wallet_id);
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_assets_user_id ON assets(user_id);
CREATE INDEX IF NOT EXISTS idx_otp_sessions_user_id ON otp_sessions(user_id);