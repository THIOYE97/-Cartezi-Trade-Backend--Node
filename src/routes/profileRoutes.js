import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { sanitizeUser } from "../services/coreService.js";
import {
  completeOnboarding,
  getUserActivity,
  sendPhoneOtp,
  updateProfile,
  verifyPhoneOtp,
} from "../services/profileService.js";

import { createApplicant, generateAccessToken, getApplicantData} from "../services/sumsubService.js";
import { query } from "../data/db.js";
import express from "express";

const router = Router();

// Mise à jour profil
router.patch("/api/users/profile", requireAuth, async (req, res, next) => {
  try {
    const updated = await updateProfile(req.user.id, req.body || {});
    return res.json(sanitizeUser(updated));
  } catch (error) { return next(error); }
});

// Onboarding
router.post("/api/users/onboarding", requireAuth, async (req, res, next) => {
  try {
    const updated = await completeOnboarding(req.user.id, req.body || {});
    return res.json(sanitizeUser(updated));
  } catch (error) { return next(error); }
});

// Phone OTP — envoyer
router.post("/api/users/phone/send-otp", requireAuth, async (req, res, next) => {
  try {
    return res.json(await sendPhoneOtp(req.user.id, req.body?.phone));
  } catch (error) { return next(error); }
});

// Phone OTP — vérifier
router.patch("/api/users/phone/verify-otp", requireAuth, async (req, res, next) => {
  try {
    const { sessionId, otp } = req.body || {};
    const updated = await verifyPhoneOtp(req.user.id, sessionId, otp);
    return res.json(sanitizeUser(updated));
  } catch (error) { return next(error); }
});

// Historique activité
router.get("/api/users/activity", requireAuth, async (req, res, next) => {
  try {
    return res.json(await getUserActivity(req.user.id, Number(req.query.limit || 50)));
  } catch (error) { return next(error); }
});


// Générer le token SDK pour l'onboarding
router.post("/api/users/kyc/token", requireAuth, async (req, res, next) => {
  try {
    // Créer l'applicant si pas encore fait
    const { rows } = await query(
      "SELECT * FROM users WHERE id = $1",
      [req.user.id]
    );
    const user = rows[0];

    if (!user.sumsub_applicant_id) {
      const applicant = await createApplicant(user.id, user.email);
      await query(
        "UPDATE users SET sumsub_applicant_id = $1 WHERE id = $2",
        [applicant.id, user.id]
      );
    }

    const token = await generateAccessToken(req.user.id);
    return res.json({ token });
  } catch (error) { return next(error); }
});

// Webhook Sumsub
router.post("/api/webhooks/sumsub",
  express.json({ type: "application/json" }), // Parse JSON brut pour vérifier la signature
  async (req, res, next) => {
    try {
      const { type, applicantId, reviewResult } = req.body;

      if (type === "applicantReviewed") {
        const approved = reviewResult?.reviewAnswer === "GREEN";
        await query(
          `UPDATE users
           SET verified = $1, kyc_status = $2
           WHERE sumsub_applicant_id = $3`,
          [approved, reviewResult?.reviewAnswer || "PENDING", applicantId]
        );
        console.log(`KYC ${approved ? "approved" : "rejected"} for applicant ${applicantId}`);
      }
      
      return res.json({ ok: true });
    } catch (error) { return next(error); }
  }
);
router.get("/api/users/kyc/status", requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query("SELECT * FROM users WHERE id = $1", [req.user.id]);
    const user = rows[0];
    if (!user.sumsub_applicant_id) {
      return res.json({ kycStatus: "NOT_STARTED", applicant: null });
    }
    const applicant = await getApplicantData(user.sumsub_applicant_id);
    return res.json({
      kycStatus: user.kyc_status || "PENDING",
      applicantId: user.sumsub_applicant_id,
      reviewStatus: applicant?.review?.reviewStatus,
      reviewAnswer: applicant?.review?.reviewResult?.reviewAnswer,
      fixedInfo: applicant?.fixedInfo || {},
      info: applicant?.info || {},
    });
  } catch (error) { return next(error); }
});

export default router;

