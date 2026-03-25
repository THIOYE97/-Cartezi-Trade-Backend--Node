-- ─────────────────────────────────────────────────────────
-- P2P Trading Schema — Cartezi Trade
-- ─────────────────────────────────────────────────────────

-- Offres de vente/achat publiées par les users
CREATE TABLE IF NOT EXISTS p2p_offers (
  id              TEXT PRIMARY KEY,
  seller_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  offer_type      TEXT NOT NULL DEFAULT 'SELL',        -- SELL | BUY
  coin_id         TEXT NOT NULL,                        -- bitcoin, ethereum…
  quantity        NUMERIC(30,10) NOT NULL,
  price_per_unit  NUMERIC(20,8) NOT NULL,               -- prix unitaire USD fixé
  currency        TEXT NOT NULL DEFAULT 'USD',
  min_amount      NUMERIC(20,8) NOT NULL,               -- montant fiat min
  max_amount      NUMERIC(20,8) NOT NULL,               -- montant fiat max
  payment_methods TEXT[] NOT NULL DEFAULT '{}',         -- WAVE,ORANGE_MONEY,MTN,BANK,CRYPTO
  region          TEXT NOT NULL DEFAULT 'ALL',          -- AFRICA,EUROPE,ALL
  country         TEXT,                                 -- SN, CI, FR, DE…
  terms           TEXT,                                 -- conditions libres du vendeur
  commission_rate NUMERIC(5,4) NOT NULL DEFAULT 0.015,  -- 1.5% plateforme
  status          TEXT NOT NULL DEFAULT 'OPEN',         -- OPEN,PAUSED,CLOSED
  total_trades    INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Trades actifs entre deux users
CREATE TABLE IF NOT EXISTS p2p_trades (
  id               TEXT PRIMARY KEY,
  offer_id         TEXT NOT NULL REFERENCES p2p_offers(id),
  seller_id        TEXT NOT NULL REFERENCES users(id),
  buyer_id         TEXT NOT NULL REFERENCES users(id),
  coin_id          TEXT NOT NULL,
  quantity         NUMERIC(30,10) NOT NULL,
  unit_price       NUMERIC(20,8) NOT NULL,
  total_fiat       NUMERIC(20,8) NOT NULL,   -- montant que l'acheteur doit payer
  currency         TEXT NOT NULL DEFAULT 'USD',
  payment_method   TEXT NOT NULL,
  commission_rate  NUMERIC(5,4) NOT NULL,
  commission_amount NUMERIC(20,8) NOT NULL,  -- quantité crypto de commission
  -- Statuts : PENDING → ESCROW_LOCKED → PAYMENT_SENT → COMPLETED | DISPUTED | CANCELLED | EXPIRED
  status           TEXT NOT NULL DEFAULT 'PENDING',
  -- Hashes MetaMask
  escrow_tx_hash   TEXT,                     -- hash lock escrow par vendeur
  release_tx_hash  TEXT,                     -- hash release vers acheteur
  commission_tx_hash TEXT,                   -- hash envoi commission plateforme
  -- Preuve de paiement uploadée par l'acheteur
  payment_proof_url TEXT,
  payment_sent_at  TIMESTAMPTZ,
  -- Litige
  dispute_reason   TEXT,
  dispute_opened_by TEXT REFERENCES users(id),
  dispute_resolved_at TIMESTAMPTZ,
  dispute_resolution TEXT,
  -- Expiration (30 min après ESCROW_LOCKED)
  expires_at       TIMESTAMPTZ,
  completed_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Chat intégré par trade
CREATE TABLE IF NOT EXISTS p2p_messages (
  id         TEXT PRIMARY KEY,
  trade_id   TEXT NOT NULL REFERENCES p2p_trades(id) ON DELETE CASCADE,
  sender_id  TEXT NOT NULL REFERENCES users(id),
  content    TEXT NOT NULL,
  type       TEXT NOT NULL DEFAULT 'TEXT',  -- TEXT | IMAGE | SYSTEM
  read_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Notations après trade complété
CREATE TABLE IF NOT EXISTS p2p_ratings (
  id         TEXT PRIMARY KEY,
  trade_id   TEXT NOT NULL REFERENCES p2p_trades(id),
  rater_id   TEXT NOT NULL REFERENCES users(id),
  rated_id   TEXT NOT NULL REFERENCES users(id),
  score      INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
  comment    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(trade_id, rater_id)
);

-- Commissions perçues par la plateforme
CREATE TABLE IF NOT EXISTS platform_commissions (
  id           TEXT PRIMARY KEY,
  trade_id     TEXT NOT NULL REFERENCES p2p_trades(id),
  coin_id      TEXT NOT NULL,
  amount       NUMERIC(20,8) NOT NULL,
  tx_hash      TEXT,
  platform_wallet TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Index ────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_p2p_offers_status
  ON p2p_offers(status, region, coin_id);

CREATE INDEX IF NOT EXISTS idx_p2p_offers_seller
  ON p2p_offers(seller_id, status);

CREATE INDEX IF NOT EXISTS idx_p2p_trades_seller
  ON p2p_trades(seller_id, status);

CREATE INDEX IF NOT EXISTS idx_p2p_trades_buyer
  ON p2p_trades(buyer_id, status);

CREATE INDEX IF NOT EXISTS idx_p2p_trades_offer
  ON p2p_trades(offer_id);

CREATE INDEX IF NOT EXISTS idx_p2p_messages_trade
  ON p2p_messages(trade_id, created_at);

CREATE INDEX IF NOT EXISTS idx_p2p_ratings_rated
  ON p2p_ratings(rated_id);

-- ─── Trigger updated_at automatique ──────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER p2p_offers_updated_at
  BEFORE UPDATE ON p2p_offers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER p2p_trades_updated_at
  BEFORE UPDATE ON p2p_trades
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();