import { Router } from "express";
import express from "express";
import { requireAdmin, requireAuth } from "../middleware/requireAuth.js";
import { createDepositSession, handleStripeWebhook } from "../services/stripeService.js";
import {
  createWithdrawal,
  getAllWithdrawals,
  getPaymentDetailsForUser,
  getUserWithdrawals,
  proceedWithdrawal,
  upsertPaymentDetails,
} from "../services/financeService.js";

const router = Router();

// Webhook Stripe — raw body obligatoire pour la vérification de signature
router.post(
  "/api/webhooks/stripe",
  express.raw({ type: "application/json" }),
  async (req, res, next) => {
    try {
      const sig = req.headers["stripe-signature"];
      const result = await handleStripeWebhook(req.body, sig);
      return res.json(result);
    } catch (error) {
      return next(error);
    }
  }
);

// Création d'une session de dépôt Stripe
router.post("/api/payment/stripe/amount/:amount", requireAuth, async (req, res, next) => {
  try {
    return res.json(await createDepositSession(req.user.id, req.params.amount));
  } catch (error) {
    return next(error);
  }
});

// Retraits
router.post("/api/withdrawal/:amount", requireAuth, async (req, res, next) => {
  try {
    return res.json(await createWithdrawal(req.user.id, req.params.amount));
  } catch (error) {
    return next(error);
  }
});

router.get("/api/withdrawal", requireAuth, async (req, res, next) => {
  try {
    return res.json(await getUserWithdrawals(req.user.id));
  } catch (error) {
    return next(error);
  }
});

router.get("/api/admin/withdrawal", requireAuth, requireAdmin, async (_req, res, next) => {
  try {
    return res.json(await getAllWithdrawals());
  } catch (error) {
    return next(error);
  }
});

router.patch(
  "/api/admin/withdrawal/:id/proceed/:accept",
  requireAuth,
  requireAdmin,
  async (req, res, next) => {
    try {
      return res.json(await proceedWithdrawal(req.params.id, req.params.accept));
    } catch (error) {
      return next(error);
    }
  }
);

// Détails bancaires (pour les retraits)
router.post("/api/payment-details", requireAuth, async (req, res, next) => {
  try {
    return res.json(await upsertPaymentDetails(req.user.id, req.body || {}));
  } catch (error) {
    return next(error);
  }
});

router.get("/api/payment-details", requireAuth, async (req, res, next) => {
  try {
    return res.json(await getPaymentDetailsForUser(req.user.id));
  } catch (error) {
    return next(error);
  }
});

export default router;