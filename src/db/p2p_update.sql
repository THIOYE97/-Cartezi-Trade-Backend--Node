-- Archivage automatique des offres sans trade après 1h
-- (appelé par un job toutes les minutes)
CREATE OR REPLACE FUNCTION archive_stale_offers()
RETURNS void AS $$
BEGIN
  UPDATE p2p_offers
  SET status = 'CLOSED', updated_at = NOW()
  WHERE status = 'OPEN'
    AND created_at < NOW() - INTERVAL '1 hour'
    AND total_trades = 0
    AND id NOT IN (
      SELECT DISTINCT offer_id FROM p2p_trades
      WHERE status NOT IN ('CANCELLED', 'EXPIRED')
    );
END;
$$ LANGUAGE plpgsql;