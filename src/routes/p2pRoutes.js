import { Router } from "express";
import { requireAdmin, requireAuth } from "../middleware/requireAuth.js";
import {
  cancelTrade,
  completeTrade,
  confirmPaymentSent,
  createOffer,
  createTrade,
  getAllTrades,
  getOfferById,
  getOffers,
  getTrade,
  getTradeMessages,
  getUserRating,
  getUserTrades,
  lockEscrow,
  openDispute,
  rateTrade,
  resolveDispute,
  sendMessage,
  updateOfferStatus,
} from "../services/p2pService.js";
import { verifyEscrowTransaction } from "../services/web3Services.js";
import { env } from "../config/env.js";


const router = Router();

// ── Offres ────────────────────────────────────────────────
router.get("/api/p2p/offers", async (req, res, next) => {
  try {
    const { coinId, region, paymentMethod, offerType, page } = req.query;
    return res.json(
      await getOffers({ coinId, region, paymentMethod, offerType, page: Number(page || 1) })
    );
  } catch (error) { return next(error); }
});

router.get("/api/p2p/offers/:id", async (req, res, next) => {
  try {
    return res.json(await getOfferById(req.params.id));
  } catch (error) { return next(error); }
});

router.post("/api/p2p/offers", requireAuth, async (req, res, next) => {
  try {
    return res.status(201).json(await createOffer(req.user.id, req.body || {}));
  } catch (error) { return next(error); }
});

router.patch("/api/p2p/offers/:id/status", requireAuth, async (req, res, next) => {
  try {
    const { status } = req.body || {};
    if (!["OPEN", "PAUSED", "CLOSED"].includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }
    return res.json(await updateOfferStatus(req.params.id, req.user.id, status));
  } catch (error) { return next(error); }
});

// ── Trades ────────────────────────────────────────────────
router.get("/api/p2p/trades/my", requireAuth, async (req, res, next) => {
  try {
    return res.json(await getUserTrades(req.user.id, req.query.status));
  } catch (error) { return next(error); }
});

router.get("/api/p2p/trades/:id", requireAuth, async (req, res, next) => {
  try {
    return res.json(await getTrade(req.params.id, req.user.id));
  } catch (error) { return next(error); }
});

router.post("/api/p2p/trades", requireAuth, async (req, res, next) => {
  try {
    return res.status(201).json(await createTrade(req.user.id, req.body || {}));
  } catch (error) { return next(error); }
});

// Vendeur lock l'escrow (envoie le tx hash MetaMask)
router.patch("/api/p2p/trades/:id/escrow", requireAuth, async (req, res, next) => {
  try {
    return res.json(
      await lockEscrow(req.params.id, req.user.id, req.body?.escrowTxHash)
    );
  } catch (error) { return next(error); }
});

// Acheteur confirme avoir payé
router.patch("/api/p2p/trades/:id/payment-sent", requireAuth, async (req, res, next) => {
  try {
    return res.json(
      await confirmPaymentSent(req.params.id, req.user.id, req.body?.paymentProofUrl)
    );
  } catch (error) { return next(error); }
});

// Vendeur confirme réception → release
router.patch("/api/p2p/trades/:id/complete", requireAuth, async (req, res, next) => {
  try {
    const { releaseTxHash, commissionTxHash } = req.body || {};
    return res.json(
      await completeTrade(req.params.id, req.user.id, releaseTxHash, commissionTxHash)
    );
  } catch (error) { return next(error); }
});

router.patch("/api/p2p/trades/:id/dispute", requireAuth, async (req, res, next) => {
  try {
    return res.json(
      await openDispute(req.params.id, req.user.id, req.body?.reason)
    );
  } catch (error) { return next(error); }
});

router.patch("/api/p2p/trades/:id/cancel", requireAuth, async (req, res, next) => {
  try {
    return res.json(await cancelTrade(req.params.id, req.user.id));
  } catch (error) { return next(error); }
});

// ── Messages ──────────────────────────────────────────────
router.get("/api/p2p/trades/:id/messages", requireAuth, async (req, res, next) => {
  try {
    return res.json(await getTradeMessages(req.params.id, req.user.id));
  } catch (error) { return next(error); }
});

router.post("/api/p2p/trades/:id/messages", requireAuth, async (req, res, next) => {
  try {
    const { content, type } = req.body || {};
    if (!content) return res.status(400).json({ message: "content is required" });
    return res.status(201).json(
      await sendMessage(req.params.id, req.user.id, content, type)
    );
  } catch (error) { return next(error); }
});

// ── Ratings ───────────────────────────────────────────────
router.post("/api/p2p/trades/:id/rate", requireAuth, async (req, res, next) => {
  try {
    const { score, comment } = req.body || {};
    return res.json(await rateTrade(req.params.id, req.user.id, score, comment));
  } catch (error) { return next(error); }
});

router.get("/api/p2p/users/:userId/rating", async (req, res, next) => {
  try {
    return res.json(await getUserRating(req.params.userId));
  } catch (error) { return next(error); }
});

// ── Admin ─────────────────────────────────────────────────
router.get("/api/admin/p2p/trades", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    return res.json(
      await getAllTrades({ status: req.query.status, page: Number(req.query.page || 1) })
    );
  } catch (error) { return next(error); }
});

router.patch("/api/admin/p2p/trades/:id/resolve", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    return res.json(
      await resolveDispute(req.params.id, req.body?.resolution, req.user.id)
    );
  } catch (error) { return next(error); }
});

router.delete("/api/p2p/offers/:id", requireAuth, async (req, res, next) => {
  try {
    return res.json(await deleteOffer(req.params.id, req.user.id));
  } catch (error) { return next(error); }
});

// Vérifier le lock escrow on-chain avant de créer l'offre
router.post("/api/p2p/offers/:id/verify-escrow", requireAuth, async (req, res, next) => {
  try {
    const { txHash, quantityEth } = req.body || {};
    if (!txHash) throw badRequest("txHash required");

    // Vérifier la transaction sur la blockchain
    const verification = await verifyEscrowTransaction(
      txHash,
      env.platformWalletAddress,
      Number(quantityEth) * 0.99 // tolérance 1%
    );

    // Mettre à jour l'offre avec le hash et marquer comme funded
    const { rows } = await query(
      `UPDATE p2p_offers
       SET escrow_tx_hash = $1, escrow_funded = true,
           escrow_amount_eth = $2, updated_at = NOW()
       WHERE id = $3 AND seller_id = $4
       RETURNING *`,
      [txHash, verification.valueEth, req.params.id, req.user.id]
    );
    if (!rows[0]) throw notFound("Offer not found");

    return res.json({ verified: true, offer: rows[0], tx: verification });
  } catch (error) { return next(error); }
});

export default router;