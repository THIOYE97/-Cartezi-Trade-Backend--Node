import dotenv from "dotenv";
dotenv.config();

export const env = {
  port: Number(process.env.PORT || 5454),
  nodeEnv: process.env.NODE_ENV || "development",
  frontendOrigin: process.env.FRONTEND_ORIGIN || "http://localhost:5173",
  jwtSecret: process.env.JWT_SECRET,
  otpTtlMinutes: Number(process.env.OTP_TTL_MINUTES || 10),
  databaseUrl: process.env.DATABASE_URL,
  stripeSecretKey: process.env.STRIPE_SECRET_KEY,
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  coingeckoApiBase: process.env.COINGECKO_API_BASE || "https://api.coingecko.com/api/v3",
  coingeckoApiKey: process.env.COINGECKO_API_KEY,
  // P2P
  platformWalletAddress: process.env.PLATFORM_WALLET_ADDRESS,
  p2pCommissionRate: Number(process.env.P2P_COMMISSION_RATE || 0.015),
  p2pTradeTimeoutMinutes: Number(process.env.P2P_TRADE_TIMEOUT_MINUTES || 30),
  resendApiKey:     process.env.RESEND_API_KEY,
  emailFrom:        process.env.EMAIL_FROM || "Cartezi Trade <onboarding@resend.dev>",
  
};

const required = [
  "JWT_SECRET", "DATABASE_URL",
  "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET",
  "COINGECKO_API_KEY", "PLATFORM_WALLET_ADDRESS",
];
for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required env variable: ${key}`);
  }
}
