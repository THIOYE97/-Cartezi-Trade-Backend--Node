import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { env } from "./config/env.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import {
  otpLimiter,
  resetPasswordLimiter,
  signinLimiter,
  signupLimiter,
} from "./middleware/rateLimiter.js";
import assetRoutes from "./routes/assetRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import coinRoutes from "./routes/coinRoutes.js";
import enhancedRoutes from "./routes/enhancedRoutes.js";
import financeRoutes from "./routes/financeRoutes.js";
import orderRoutes from "./routes/orderRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import walletRoutes from "./routes/walletRoutes.js";
import watchlistRoutes from "./routes/watchlistRoutes.js";
import p2pRoutes from "./routes/p2pRoutes.js";
import profileRoutes from "./routes/profileRoutes.js";
import { query } from "./data/db.js";
import { startArchiveJob } from "./services/p2pService.js";



const app = express();

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      scriptSrc:   ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      styleSrc:    ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc:     ["'self'", "https://fonts.gstatic.com"],
      imgSrc: [
        "'self'",
        "data:",
        "blob:",
        "https:",                              // ← toutes les images HTTPS
        "https://assets.coingecko.com",
        "https://static.coingecko.com",
        "https://coin-images.coingecko.com",
        "https://*.stripe.com",
        "https://js.stripe.com",
      ],
      connectSrc: [
        "'self'",
        "https://api.coingecko.com",
        "https://api.sumsub.com",
        "https://*.sumsub.com",
        "https://*.stripe.com",
        "https://api.callmebot.com",
        "wss:",
      ],
      frameSrc: [
        "'self'",
        "https://*.sumsub.com",
        "https://*.stripe.com",
      ],
    },
  },
  crossOriginEmbedderPolicy: false, // ← important pour Sumsub/Stripe
}));

app.use(
  cors({
    origin: env.frontendOrigin,
    credentials: true,
  })
);

// Webhook Stripe — raw body AVANT express.json
app.use((req, _res, next) => {
  if (req.originalUrl === "/api/webhooks/stripe") return next();
  express.json({ limit: "1mb" })(req, _res, next);
});

app.use(morgan("dev"));

// Rate limiting
app.use("/auth/signup", signupLimiter);
app.use("/auth/signin", signinLimiter);
app.use("/auth/two-factor/otp", otpLimiter);
app.use("/api/users/verification", otpLimiter);
app.use("/api/users/enable-two-factor", otpLimiter);
app.use("/auth/users/reset-password", resetPasswordLimiter);

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "cartezi-trade-backend" });
});

app.get("/", (_req, res) => {
  res.json({ message: "Cartezi Trade backend is running" });
});
app.get("/", (_req, res) => {
  res.json({ message: "Cartezi Trade backend is running" });
});

// ← Ajouter ce handler POST pour Sumsub webhook
app.post("/", express.json(), async (req, res) => {
  try {
    console.log("🔔 Sumsub webhook:", JSON.stringify(req.body, null, 2));

    const { type, applicantId, reviewResult } = req.body || {};

    if (type === "applicantReviewed") {
      const approved = reviewResult?.reviewAnswer === "GREEN";
      console.log(`KYC ${approved ? "✅ GREEN" : "❌ REJECTED"} — ${applicantId}`);

      const { rowCount } = await query(
        `UPDATE users SET verified = $1, kyc_status = $2
         WHERE sumsub_applicant_id = $3`,
        [approved, reviewResult?.reviewAnswer || "PENDING", applicantId]
      );
      console.log(`✅ Updated ${rowCount} user(s)`);
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error("Sumsub webhook error:", err.message);
    return res.status(200).json({ ok: true }); // Toujours 200 pour Sumsub
  }
});
app.use(enhancedRoutes);
app.use(authRoutes);
app.use(userRoutes);
app.use(coinRoutes);
app.use(walletRoutes);
app.use(orderRoutes);
app.use(assetRoutes);
app.use(watchlistRoutes);
app.use(financeRoutes);
app.use(p2pRoutes);
app.use(profileRoutes);
startArchiveJob();

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
