import { Router } from "express";
import { query, withTransaction } from "../data/db.js";
import { requireAdmin, requireAuth } from "../middleware/requireAuth.js";
import {
  addWalletBalance,
  getUserWallet,
  transferBetweenWallets,
} from "../services/coreService.js";
import { badRequest } from "../utils/httpError.js";

const router = Router();

// Solde du wallet
router.get("/api/wallet", requireAuth, async (req, res, next) => {
  try {
    return res.json(await getUserWallet(req.user.id));
  } catch (error) {
    return next(error);
  }
});

// Historique des transactions
router.get("/api/wallet/transactions", requireAuth, async (req, res, next) => {
  try {
    const wallet = await getUserWallet(req.user.id);
    const { rows } = await query(
      "SELECT * FROM wallet_transactions WHERE wallet_id = $1 ORDER BY date DESC",
      [wallet.id]
    );
    return res.json(rows);
  } catch (error) {
    return next(error);
  }
});

// Dépôt manuel — ADMIN seulement
router.put(
  "/api/wallet/deposit/amount/:amount",
  requireAuth,
  requireAdmin,
  async (req, res, next) => {
    try {
      const amount = Number(req.params.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        throw badRequest("Invalid amount");
      }
      const wallet = await getUserWallet(req.user.id);
      return await withTransaction(async (client) => {
        const updated = await addWalletBalance(client, wallet.id, amount, "ADMIN_DEPOSIT");
        return res.json(updated);
      });
    } catch (error) {
      return next(error);
    }
  }
);

// Dépôt via Stripe — déclenché par le webhook (voir financeRoutes)
router.get("/api/wallet/deposit/status", requireAuth, async (req, res, next) => {
  try {
    const orderId = req.query.order_id;
    if (!orderId) throw badRequest("order_id is required");
    const { rows } = await query(
      "SELECT * FROM payment_orders WHERE id = $1 AND user_id = $2",
      [orderId, req.user.id]
    );
    if (!rows[0]) throw badRequest("Order not found");
    return res.json({ status: rows[0].status, amount: rows[0].amount });
  } catch (error) {
    return next(error);
  }
});

// Transfert vers un autre wallet
router.put("/api/wallet/:walletId/transfer", requireAuth, async (req, res, next) => {
  try {
    const toWalletId = req.params.walletId;
    const { amount, purpose } = req.body || {};
    const currentWallet = await getUserWallet(req.user.id);
    if (currentWallet.id === toWalletId) {
      throw badRequest("Cannot transfer to your own wallet");
    }
    return res.json(
      await transferBetweenWallets({
        fromWalletId: currentWallet.id,
        toWalletId,
        amount,
        purpose,
      })
    );
  } catch (error) {
    return next(error);
  }
});

// Consultation d'un ordre
router.put("/api/wallet/order/:orderId/pay", requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      "SELECT * FROM orders WHERE id = $1 AND user_id = $2",
      [req.params.orderId, req.user.id]
    );
    if (!rows[0]) throw badRequest("Order not found");
    return res.json(rows[0]);
  } catch (error) {
    return next(error);
  }
});

export default router;