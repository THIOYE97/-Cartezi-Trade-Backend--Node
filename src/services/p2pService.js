import { createId, query, withTransaction } from "../data/db.js";
import { env } from "../config/env.js";
import { badRequest, notFound, forbidden } from "../utils/httpError.js";
import { getCoinById } from "./coinService.js";
import {
  notifyTradeCreated,
  notifyEscrowLocked,
  notifyPaymentSent,
  notifyTradeCompleted,
  notifyDispute,
} from "./notificationService.js";

function nowIso() {
  return new Date().toISOString();
}

// ─────────────────────────────────────────────────────────
// OFFRES
// ─────────────────────────────────────────────────────────

export async function createOffer(sellerId, payload) {
  const {
    offerType = "SELL",
    coinId,
    quantity,
    pricePerUnit,
    currency = "USD",
    minAmount,
    maxAmount,
    paymentMethods,
    region = "ALL",
    country,
    terms,
  } = payload;

  if (!coinId || !quantity || !pricePerUnit || !minAmount || !maxAmount) {
    throw badRequest("coinId, quantity, pricePerUnit, minAmount, maxAmount are required");
  }
  if (!paymentMethods?.length) {
    throw badRequest("At least one payment method is required");
  }
  if (Number(minAmount) > Number(maxAmount)) {
    throw badRequest("minAmount must be <= maxAmount");
  }
  if (!["SELL", "BUY"].includes(offerType)) {
    throw badRequest("offerType must be SELL or BUY");
  }

  // Vérifier que le coin existe
  await getCoinById(coinId);

  const id = createId("p2o");
  const { rows } = await query(
    `INSERT INTO p2p_offers
      (id, seller_id, offer_type, coin_id, quantity, price_per_unit, currency,
       min_amount, max_amount, payment_methods, region, country, terms, commission_rate)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING *`,
    [
      id, sellerId, offerType, coinId,
      Number(quantity), Number(pricePerUnit), currency,
      Number(minAmount), Number(maxAmount),
      paymentMethods, region, country || null, terms || null,
      env.p2pCommissionRate,
    ]
  );
  return rows[0];
}

export async function getOffers({ coinId, region, paymentMethod, offerType, page = 1, limit = 20 } = {}) {
  let sql = `
    SELECT o.*,
      u.full_name AS seller_name,
      u.email AS seller_email,
      COALESCE(AVG(r.score), 0) AS seller_rating,
      COUNT(r.id) AS seller_ratings_count
    FROM p2p_offers o
    JOIN users u ON u.id = o.seller_id
    LEFT JOIN p2p_ratings r ON r.rated_id = o.seller_id
    WHERE o.status = 'OPEN'
  `;
  const params = [];

  if (coinId) {
    params.push(coinId);
    sql += ` AND o.coin_id = $${params.length}`;
  }
  if (region && region !== "ALL") {
    params.push(region);
    sql += ` AND (o.region = $${params.length} OR o.region = 'ALL')`;
  }
  if (offerType) {
    params.push(offerType);
    sql += ` AND o.offer_type = $${params.length}`;
  }
  if (paymentMethod) {
    params.push(paymentMethod);
    sql += ` AND $${params.length} = ANY(o.payment_methods)`;
  }

  sql += ` GROUP BY o.id, u.full_name, u.email`;
  sql += ` ORDER BY o.created_at DESC`;

  const offset = (page - 1) * limit;
  params.push(limit, offset);
  sql += ` LIMIT $${params.length - 1} OFFSET $${params.length}`;

  const { rows } = await query(sql, params);
  return rows;
}

export async function getOfferById(offerId) {
  const { rows } = await query(
    `SELECT o.*,
      u.full_name AS seller_name,
      COALESCE(AVG(r.score), 0) AS seller_rating,
      COUNT(r.id) AS seller_ratings_count
     FROM p2p_offers o
     JOIN users u ON u.id = o.seller_id
     LEFT JOIN p2p_ratings r ON r.rated_id = o.seller_id
     WHERE o.id = $1
     GROUP BY o.id, u.full_name`,
    [offerId]
  );
  if (!rows[0]) throw notFound("Offer not found");
  return rows[0];
}

export async function updateOfferStatus(offerId, sellerId, status) {
  const { rows } = await query(
    `UPDATE p2p_offers
     SET status = $1, updated_at = NOW()
     WHERE id = $2 AND seller_id = $3
     RETURNING *`,
    [status, offerId, sellerId]
  );
  if (!rows[0]) throw notFound("Offer not found or not yours");
  return rows[0];
}

// ─────────────────────────────────────────────────────────
// TRADES
// ─────────────────────────────────────────────────────────

export async function createTrade(buyerId, payload) {
  const { offerId, quantity, paymentMethod } = payload;
  if (!offerId || !quantity || !paymentMethod) {
    throw badRequest("offerId, quantity and paymentMethod are required");
  }

  return withTransaction(async (client) => {
    const { rows: offerRows } = await client.query(
      "SELECT * FROM p2p_offers WHERE id = $1 FOR UPDATE",
      [offerId]
    );
    const offer = offerRows[0];
    if (!offer) throw notFound("Offer not found");
    if (offer.status !== "OPEN") throw badRequest("Offer is not available");
    if (offer.seller_id === buyerId) throw badRequest("Cannot trade with yourself");
    if (!offer.payment_methods.includes(paymentMethod)) {
      throw badRequest("Payment method not accepted for this offer");
    }

    const qty = Number(quantity);
    if (qty > Number(offer.quantity)) throw badRequest("Quantity exceeds offer availability");

    const totalFiat = qty * Number(offer.price_per_unit);
    if (totalFiat < Number(offer.min_amount) || totalFiat > Number(offer.max_amount)) {
      throw badRequest(`Amount must be between ${offer.min_amount} and ${offer.max_amount} ${offer.currency}`);
    }

    const commissionAmount = qty * Number(offer.commission_rate);
    const expiresAt = new Date(Date.now() + env.p2pTradeTimeoutMinutes * 60_000).toISOString();

    const tradeId = createId("p2t");
    const { rows } = await client.query(
      `INSERT INTO p2p_trades
        (id, offer_id, seller_id, buyer_id, coin_id, quantity, unit_price,
         total_fiat, currency, payment_method, commission_rate, commission_amount,
         expires_at, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'PENDING')
       RETURNING *`,
      [
        tradeId, offerId, offer.seller_id, buyerId,
        offer.coin_id, qty, offer.price_per_unit,
        totalFiat, offer.currency, paymentMethod,
        offer.commission_rate, commissionAmount, expiresAt,
      ]
    );

    // Message système de création
    await client.query(
      `INSERT INTO p2p_messages (id, trade_id, sender_id, content, type)
       VALUES ($1, $2, $3, $4, 'SYSTEM')`,
      [
        createId("msg"), tradeId, offer.seller_id,
        `Trade started — ${qty} ${offer.coin_id} @ $${offer.price_per_unit}`,
      ]
    );
    const tradeData = rows[0];
// Notifier en arrière-plan (non bloquant)
notifyTradeCreated(tradeData).catch(console.error);
return tradeData;
  });
}

export async function getTrade(tradeId, userId) {
  const { rows } = await query(
    `SELECT t.*,
      s.full_name AS seller_name, s.email AS seller_email,
      b.full_name AS buyer_name,  b.email AS buyer_email,
      COALESCE(sr.avg_score, 0) AS seller_rating,
      COALESCE(br.avg_score, 0) AS buyer_rating
     FROM p2p_trades t
     JOIN users s ON s.id = t.seller_id
     JOIN users b ON b.id = t.buyer_id
     LEFT JOIN (SELECT rated_id, AVG(score) AS avg_score FROM p2p_ratings GROUP BY rated_id) sr
       ON sr.rated_id = t.seller_id
     LEFT JOIN (SELECT rated_id, AVG(score) AS avg_score FROM p2p_ratings GROUP BY rated_id) br
       ON br.rated_id = t.buyer_id
     WHERE t.id = $1 AND (t.seller_id = $2 OR t.buyer_id = $2)`,
    [tradeId, userId]
  );
  if (!rows[0]) throw notFound("Trade not found");
  return rows[0];
}

export async function getUserTrades(userId, status) {
  let sql = `
    SELECT t.*,
      s.full_name AS seller_name,
      b.full_name AS buyer_name
    FROM p2p_trades t
    JOIN users s ON s.id = t.seller_id
    JOIN users b ON b.id = t.buyer_id
    WHERE (t.seller_id = $1 OR t.buyer_id = $1)
  `;
  const params = [userId];
  if (status) {
    params.push(status);
    sql += ` AND t.status = $2`;
  }
  sql += ` ORDER BY t.created_at DESC`;
  const { rows } = await query(sql, params);
  return rows;
}

// Vendeur lock la crypto en escrow (envoie le hash MetaMask)
export async function lockEscrow(tradeId, sellerId, escrowTxHash) {
  if (!escrowTxHash) throw badRequest("escrowTxHash is required");

  return withTransaction(async (client) => {
    const { rows } = await client.query(
      "SELECT * FROM p2p_trades WHERE id = $1 FOR UPDATE",
      [tradeId]
    );
    const trade = rows[0];
    if (!trade) throw notFound("Trade not found");
    if (trade.seller_id !== sellerId) throw forbidden("Not your trade");
    if (trade.status !== "PENDING") throw badRequest("Trade is not in PENDING status");

    const expiresAt = new Date(
      Date.now() + env.p2pTradeTimeoutMinutes * 60_000
    ).toISOString();

    const { rows: updated } = await client.query(
      `UPDATE p2p_trades
       SET status = 'ESCROW_LOCKED', escrow_tx_hash = $1,
           expires_at = $2, updated_at = NOW()
       WHERE id = $3 RETURNING *`,
      [escrowTxHash, expiresAt, tradeId]
    );

    await client.query(
      `INSERT INTO p2p_messages (id, trade_id, sender_id, content, type)
       VALUES ($1,$2,$3,$4,'SYSTEM')`,
      [
        createId("msg"), tradeId, sellerId,
        `Crypto locked in escrow — tx: ${escrowTxHash.slice(0, 16)}...`,
      ]
    );
    notifyEscrowLocked(updated[0]).catch(console.error);
    return updated[0];
  });
}

// Acheteur confirme avoir envoyé le paiement
export async function confirmPaymentSent(tradeId, buyerId, paymentProofUrl) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      "SELECT * FROM p2p_trades WHERE id = $1 FOR UPDATE",
      [tradeId]
    );
    const trade = rows[0];
    if (!trade) throw notFound("Trade not found");
    if (trade.buyer_id !== buyerId) throw forbidden("Not your trade");
    if (trade.status !== "ESCROW_LOCKED") {
      throw badRequest("Crypto must be locked before confirming payment");
    }
    if (new Date(trade.expires_at) < new Date()) {
      throw badRequest("Trade has expired");
    }

    const { rows: updated } = await client.query(
      `UPDATE p2p_trades
       SET status = 'PAYMENT_SENT', payment_proof_url = $1,
           payment_sent_at = NOW(), updated_at = NOW()
       WHERE id = $2 RETURNING *`,
      [paymentProofUrl || null, tradeId]
    );

    await client.query(
      `INSERT INTO p2p_messages (id, trade_id, sender_id, content, type)
       VALUES ($1,$2,$3,'Payment sent — awaiting seller confirmation','SYSTEM')`,
      [createId("msg"), tradeId, buyerId]
    );
    notifyPaymentSent(updated[0]).catch(console.error);

    return updated[0];
  });
}

// Vendeur confirme réception du paiement → release crypto
export async function completeTrade(tradeId, sellerId, releaseTxHash, commissionTxHash) {
  if (!releaseTxHash) throw badRequest("releaseTxHash is required");

  return withTransaction(async (client) => {
    const { rows } = await client.query(
      "SELECT * FROM p2p_trades WHERE id = $1 FOR UPDATE",
      [tradeId]
    );
    const trade = rows[0];
    if (!trade) throw notFound("Trade not found");
    if (trade.seller_id !== sellerId) throw forbidden("Not your trade");
    if (trade.status !== "PAYMENT_SENT") {
      throw badRequest("Buyer must confirm payment first");
    }

    const { rows: updated } = await client.query(
      `UPDATE p2p_trades
       SET status = 'COMPLETED', release_tx_hash = $1,
           commission_tx_hash = $2, completed_at = NOW(), updated_at = NOW()
       WHERE id = $3 RETURNING *`,
      [releaseTxHash, commissionTxHash || null, tradeId]
    );

    // Incrémenter le compteur de trades de l'offre
    await client.query(
      "UPDATE p2p_offers SET total_trades = total_trades + 1 WHERE id = $1",
      [trade.offer_id]
    );

    // Enregistrer la commission
    await client.query(
      `INSERT INTO platform_commissions
        (id, trade_id, coin_id, amount, tx_hash, platform_wallet)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        createId("com"), tradeId, trade.coin_id,
        trade.commission_amount, commissionTxHash || null,
        env.platformWalletAddress,
      ]
    );

    await client.query(
      `INSERT INTO p2p_messages (id, trade_id, sender_id, content, type)
       VALUES ($1,$2,$3,'Trade completed successfully','SYSTEM')`,
      [createId("msg"), tradeId, sellerId]
    );
    notifyTradeCompleted(updated[0]).catch(console.error);
    return updated[0];
  });
}

export async function openDispute(tradeId, userId, reason) {
  if (!reason) throw badRequest("Dispute reason is required");

  const { rows } = await query(
    `UPDATE p2p_trades
     SET status = 'DISPUTED', dispute_reason = $1,
         dispute_opened_by = $2, updated_at = NOW()
     WHERE id = $3
       AND (seller_id = $2 OR buyer_id = $2)
       AND status IN ('ESCROW_LOCKED', 'PAYMENT_SENT')
     RETURNING *`,
    [reason, userId, tradeId]
  );
  if (!rows[0]) throw badRequest("Cannot open dispute for this trade");

  await query(
    `INSERT INTO p2p_messages (id, trade_id, sender_id, content, type)
     VALUES ($1,$2,$3,$4,'SYSTEM')`,
    [createId("msg"), tradeId, userId, `Dispute opened: ${reason}`]
  );
  notifyDispute(rows[0]).catch(console.error);
  return rows[0];
}

export async function cancelTrade(tradeId, userId) {
  const { rows } = await query(
    `UPDATE p2p_trades
     SET status = 'CANCELLED', updated_at = NOW()
     WHERE id = $1
       AND (seller_id = $2 OR buyer_id = $2)
       AND status = 'PENDING'
     RETURNING *`,
    [tradeId, userId]
  );
  if (!rows[0]) throw badRequest("Cannot cancel this trade (only PENDING trades can be cancelled)");
  return rows[0];
}

// Ajouter dans p2pService.js

export async function deleteOffer(offerId, sellerId) {
  return withTransaction(async (client) => {
    // Vérifier qu'aucun trade actif n'existe
    const { rows: activeTrades } = await client.query(
      `SELECT id FROM p2p_trades
       WHERE offer_id = $1
       AND status NOT IN ('CANCELLED', 'EXPIRED')`,
      [offerId]
    );
    if (activeTrades.length > 0) {
      throw badRequest("Cannot delete offer with active trades");
    }

    const { rows } = await client.query(
      `DELETE FROM p2p_offers
       WHERE id = $1 AND seller_id = $2
       RETURNING *`,
      [offerId, sellerId]
    );
    if (!rows[0]) throw notFound("Offer not found or not yours");
    return rows[0];
  });
}

// Job d'archivage — appelé au démarrage serveur
export function startArchiveJob() {
  // MVP — pas d'archivage automatique
  console.log("P2P archive job disabled for MVP");
}
// ─────────────────────────────────────────────────────────
// MESSAGES
// ─────────────────────────────────────────────────────────

export async function getTradeMessages(tradeId, userId) {
  // Vérifier que l'user fait partie du trade
  const { rows: tradeRows } = await query(
    "SELECT id FROM p2p_trades WHERE id = $1 AND (seller_id = $2 OR buyer_id = $2)",
    [tradeId, userId]
  );
  if (!tradeRows[0]) throw forbidden("Access denied");

  const { rows } = await query(
    `SELECT m.*, u.full_name AS sender_name
     FROM p2p_messages m
     JOIN users u ON u.id = m.sender_id
     WHERE m.trade_id = $1
     ORDER BY m.created_at ASC`,
    [tradeId]
  );
  return rows;
}

export async function sendMessage(tradeId, senderId, content, type = "TEXT") {
  const { rows: tradeRows } = await query(
    "SELECT id FROM p2p_trades WHERE id = $1 AND (seller_id = $2 OR buyer_id = $2) AND status NOT IN ('COMPLETED','CANCELLED','EXPIRED')",
    [tradeId, senderId]
  );
  if (!tradeRows[0]) throw forbidden("Cannot send message to this trade");

  const { rows } = await query(
    `INSERT INTO p2p_messages (id, trade_id, sender_id, content, type)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [createId("msg"), tradeId, senderId, content, type]
  );
  return rows[0];
}

// ─────────────────────────────────────────────────────────
// RATINGS
// ─────────────────────────────────────────────────────────

export async function rateTrade(tradeId, raterId, score, comment) {
  if (score < 1 || score > 5) throw badRequest("Score must be between 1 and 5");

  const { rows: tradeRows } = await query(
    "SELECT * FROM p2p_trades WHERE id = $1 AND status = 'COMPLETED' AND (seller_id = $2 OR buyer_id = $2)",
    [tradeId, raterId]
  );
  const trade = tradeRows[0];
  if (!trade) throw badRequest("Trade not found or not completed");

  const ratedId = trade.seller_id === raterId ? trade.buyer_id : trade.seller_id;

  const { rows } = await query(
    `INSERT INTO p2p_ratings (id, trade_id, rater_id, rated_id, score, comment)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (trade_id, rater_id) DO UPDATE SET score=$5, comment=$6
     RETURNING *`,
    [createId("rat"), tradeId, raterId, ratedId, score, comment || null]
  );
  return rows[0];
}

export async function getUserRating(userId) {
  const { rows } = await query(
    `SELECT
       COALESCE(AVG(score), 0) AS average_score,
       COUNT(*) AS total_ratings,
       COUNT(CASE WHEN score = 5 THEN 1 END) AS five_stars,
       COUNT(CASE WHEN score >= 4 THEN 1 END) AS positive
     FROM p2p_ratings
     WHERE rated_id = $1`,
    [userId]
  );
  return rows[0];
}

// ─────────────────────────────────────────────────────────
// ADMIN
// ─────────────────────────────────────────────────────────

export async function getAllTrades({ status, page = 1, limit = 50 } = {}) {
  let sql = `
    SELECT t.*,
      s.full_name AS seller_name, s.email AS seller_email,
      b.full_name AS buyer_name,  b.email AS buyer_email
    FROM p2p_trades t
    JOIN users s ON s.id = t.seller_id
    JOIN users b ON b.id = t.buyer_id
    WHERE 1=1
  `;
  const params = [];
  if (status) {
    params.push(status);
    sql += ` AND t.status = $${params.length}`;
  }
  sql += ` ORDER BY t.created_at DESC`;
  const offset = (page - 1) * limit;
  params.push(limit, offset);
  sql += ` LIMIT $${params.length - 1} OFFSET $${params.length}`;

  const { rows } = await query(sql, params);
  return rows;
}

export async function resolveDispute(tradeId, resolution, adminId) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE p2p_trades
       SET status = 'COMPLETED', dispute_resolution = $1,
           dispute_resolved_at = NOW(), updated_at = NOW()
       WHERE id = $2 AND status = 'DISPUTED'
       RETURNING *`,
      [resolution, tradeId]
    );
    if (!rows[0]) throw notFound("Disputed trade not found");

    await client.query(
      `INSERT INTO p2p_messages (id, trade_id, sender_id, content, type)
       VALUES ($1,$2,$3,$4,'SYSTEM')`,
      [
        createId("msg"), tradeId, adminId,
        `Admin resolved dispute: ${resolution}`,
      ]
    );
    return rows[0];
  });
}