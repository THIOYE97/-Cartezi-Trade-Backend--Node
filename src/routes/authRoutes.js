import { Router } from "express";
import bcrypt from "bcryptjs";
import { env } from "../config/env.js";
import { createId, query, withTransaction } from "../data/db.js";
import { requireAuth } from "../middleware/requireAuth.js";
import {
  createOtpSession,
  createUserAndWallet,
  consumeOtpSession,
  sanitizeUser,
  verifyLogin,
} from "../services/coreService.js";
import { signJwt } from "../utils/auth.js";
import { badRequest, notFound } from "../utils/httpError.js";

const router = Router();

function isExpired(dateIso) {
  return new Date(dateIso).getTime() < Date.now();
}

// ── Signup ────────────────────────────────────────────────────────────────────
router.post("/auth/signup", async (req, res, next) => {
  try {
    const user = await createUserAndWallet(req.body || {});
    return res.status(201).json({
      jwt: signJwt(user),
      message: "Signup successful",
      user: sanitizeUser(user),
    });
  } catch (error) {
    return next(error);
  }
});

// ── Signin ────────────────────────────────────────────────────────────────────
router.post("/auth/signin", async (req, res, next) => {
  try {
    const user = await verifyLogin(req.body || {});
    if (user.two_factor_enabled) {
      const session = await createOtpSession("TWO_FACTOR", { userId: user.id });
      return res.json({
        message: "Two-factor OTP generated",
        twoFactorAuthEnabled: true,
        session: session.id,
      });
    }
    return res.json({
      jwt: signJwt(user),
      message: "Signin successful",
      twoFactorAuthEnabled: false,
    });
  } catch (error) {
    return next(error);
  }
});

// ── 2FA OTP verify ────────────────────────────────────────────────────────────
router.post("/auth/two-factor/otp/:otp", async (req, res, next) => {
  try {
    const { otp } = req.params;
    const sessionId = req.query.id;

    const { rows: sessionRows } = await query(
      "SELECT * FROM otp_sessions WHERE id = $1 AND type = 'TWO_FACTOR'",
      [sessionId]
    );
    const session = sessionRows[0];
    if (!session) throw badRequest("Invalid session");
    if (isExpired(session.expires_at)) throw badRequest("Session expired");
    if (session.otp !== String(otp)) throw badRequest("Invalid OTP");

    await query("DELETE FROM otp_sessions WHERE id = $1", [session.id]);

    const { rows: userRows } = await query(
      "SELECT * FROM users WHERE id = $1",
      [session.user_id]
    );
    if (!userRows[0]) throw notFound("User not found");

    return res.json({
      jwt: signJwt(userRows[0]),
      message: "Two-factor authentication successful",
    });
  } catch (error) {
    return next(error);
  }
});

// ── Envoyer OTP vérification ──────────────────────────────────────────────────
router.post(
  "/api/users/verification/:verificationType/send-otp",
  requireAuth,
  async (req, res, next) => {
    try {
      const record = await createOtpSession("VERIFICATION", {
        userId: req.user.id,
        verificationType: req.params.verificationType,
      });
      return res.json({
        message: "Verification OTP sent",
        otp: env.nodeEnv === "development" ? record.otp : undefined,
      });
    } catch (error) {
      return next(error);
    }
  }
);

// ── Vérifier OTP compte ───────────────────────────────────────────────────────
router.patch(
  "/api/users/verification/verify-otp/:otp",
  requireAuth,
  async (req, res, next) => {
    try {
      await consumeOtpSession(req.user.id, "VERIFICATION", req.params.otp);

      const { rows } = await query(
        "UPDATE users SET email_verified = true WHERE id = $1 RETURNING *",
        [req.user.id]
      );
      return res.json(sanitizeUser(rows[0]));
    } catch (error) {
      return next(error);
    }
  }
);

// ── Activer 2FA ───────────────────────────────────────────────────────────────
router.patch(
  "/api/users/enable-two-factor/verify-otp/:otp",
  requireAuth,
  async (req, res, next) => {
    try {
      await consumeOtpSession(req.user.id, "VERIFICATION", req.params.otp);

      const { rows } = await query(
        "UPDATE users SET two_factor_enabled = true, verified = true WHERE id = $1 RETURNING *",
        [req.user.id]
      );
      return res.json(sanitizeUser(rows[0]));
    } catch (error) {
      return next(error);
    }
  }
);

// ── Reset password — envoyer OTP ──────────────────────────────────────────────
router.post("/auth/users/reset-password/send-otp", async (req, res, next) => {
  try {
    const { sendTo } = req.body || {};
    if (!sendTo) throw badRequest("sendTo is required");

    const { rows } = await query(
      "SELECT * FROM users WHERE email = $1",
      [String(sendTo).toLowerCase()]
    );
    if (!rows[0]) throw notFound("User not found for provided email");

    const record = await createOtpSession("RESET_PASSWORD", {
      userId: rows[0].id,
      sendTo: rows[0].email,
    });

    return res.json({
      message: "Reset password OTP sent",
      session: record.id,
      otp: env.nodeEnv === "development" ? record.otp : undefined,
    });
  } catch (error) {
    return next(error);
  }
});

// ── Reset password — vérifier OTP + nouveau mdp ───────────────────────────────
router.patch("/auth/users/reset-password/verify-otp", async (req, res, next) => {
  try {
    const sessionId = req.query.id;
    const { otp, password } = req.body || {};
    if (!sessionId || !otp || !password) {
      throw badRequest("id, otp and password are required");
    }

    const { rows: sessionRows } = await query(
      "SELECT * FROM otp_sessions WHERE id = $1 AND type = 'RESET_PASSWORD'",
      [sessionId]
    );
    const session = sessionRows[0];
    if (!session) throw badRequest("Invalid reset session");
    if (isExpired(session.expires_at)) throw badRequest("Reset session expired");
    if (session.otp !== String(otp)) throw badRequest("Invalid OTP");

    const passwordHash = await bcrypt.hash(String(password), 10);
    await query(
      "UPDATE users SET password_hash = $1 WHERE id = $2",
      [passwordHash, session.user_id]
    );
    await query("DELETE FROM otp_sessions WHERE id = $1", [session.id]);

    return res.json({ message: "Password updated successfully" });
  } catch (error) {
    return next(error);
  }
});

// ── Google OAuth (demo) ───────────────────────────────────────────────────────
router.get("/login/google", async (_req, res, next) => {
  try {
    const { rows: existing } = await query(
      "SELECT * FROM users WHERE email = 'google-demo@cartezi.trade'"
    );

    let user = existing[0];
    if (!user) {
      await withTransaction(async (client) => {
        const userId = createId("usr");
        const { rows } = await client.query(
          `INSERT INTO users (id, full_name, email, password_hash, role, verified, status, two_factor_enabled, created_at)
           VALUES ($1, 'Google Demo User', 'google-demo@cartezi.trade', '', 'ROLE_USER', true, 'ACTIVE', false, NOW())
           RETURNING *`,
          [userId]
        );
        user = rows[0];
        await client.query(
          "INSERT INTO wallets (id, user_id, balance, created_at) VALUES ($1, $2, 5000, NOW())",
          [createId("wal"), userId]
        );
        await client.query(
          "INSERT INTO watchlists (id, user_id, coin_ids) VALUES ($1, $2, $3)",
          [createId("wtl"), userId, ["bitcoin", "ethereum", "solana"]]
        );
      });
    }

    return res.redirect(
      `${env.frontendOrigin}/auth/google/success?token=${encodeURIComponent(signJwt(user))}`
    );
  } catch (error) {
    return next(error);
  }
});

export default router;