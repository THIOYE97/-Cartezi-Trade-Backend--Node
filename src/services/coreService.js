import bcrypt from "bcryptjs";
import { createId, query, withTransaction } from "../data/db.js";
import { env } from "../config/env.js";
import { badRequest, notFound } from "../utils/httpError.js";

function nowIso() {
  return new Date().toISOString();
}

// src/services/coreService.js
export function sanitizeUser(user) {
  return {
    id:             user.id,
    fullName:       user.full_name,
    email:          user.email,
    role:           user.role,
    verified:       user.verified === true || user.kyc_status === "GREEN",
    kycStatus:      user.kyc_status || "NOT_STARTED",
    emailVerified:  user.email_verified || false,
    status:         user.status,
    phone:          user.phone || null,
    phoneVerified:  user.phone_verified || false,
    dateOfBirth:    user.date_of_birth || null,
    nationality:    user.nationality || null,
    addressLine:    user.address_line || null,
    city:           user.city || null,
    country:        user.country || null,
    postcode:       user.postcode || null,
    onboardingDone: user.onboarding_done || false,
    avatarUrl:      user.avatar_url || null,
    twoFactorAuth:  { enabled: user.two_factor_enabled || false },
  };
}

export async function createUserAndWallet({ fullName, email, password }) {
  if (!fullName || !email || !password) {
    throw badRequest("fullName, email and password are required");
  }

  return withTransaction(async (client) => {
    const existing = await client.query(
      "SELECT id FROM users WHERE email = $1",
      [email.toLowerCase()]
    );
    if (existing.rows.length > 0) throw badRequest("Email is already registered");

    const countRes = await client.query("SELECT COUNT(*) FROM users");
    const isFirst = parseInt(countRes.rows[0].count, 10) === 0;

    const userId = createId("usr");
    const passwordHash = await bcrypt.hash(password, 10);

    const { rows } = await client.query(
      `INSERT INTO users (id, full_name, email, password_hash, role, verified, status, two_factor_enabled, created_at)
       VALUES ($1, $2, $3, $4, $5, false, 'ACTIVE', false, NOW())
       RETURNING *`,
      [userId, fullName, email.toLowerCase(), passwordHash, isFirst ? "ROLE_ADMIN" : "ROLE_USER"]
    );
    const user = rows[0];

    await client.query(
      `INSERT INTO wallets (id, user_id, balance, created_at) VALUES ($1, $2, 0, NOW())`,
      [createId("wal"), userId]
    );

    await client.query(
      `INSERT INTO watchlists (id, user_id, coin_ids) VALUES ($1, $2, $3)`,
      [createId("wtl"), userId, ["bitcoin", "ethereum"]]
    );

    return user;
  });
}

export async function verifyLogin({ email, password }) {
  const { rows } = await query(
    "SELECT * FROM users WHERE email = $1",
    [String(email).toLowerCase()]
  );
  if (rows.length === 0) throw badRequest("Invalid email or password");
  const user = rows[0];
  const ok = await bcrypt.compare(password || "", user.password_hash);
  if (!ok) throw badRequest("Invalid email or password");
  return user;
}

export async function createOtpSession(type, payload) {
  const id = createId(type === "TWO_FACTOR" ? "tfs" : "otp");
  const otp = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = new Date(Date.now() + env.otpTtlMinutes * 60_000).toISOString();

  await query(
    `INSERT INTO otp_sessions (id, user_id, type, otp, verification_type, send_to, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, payload.userId, type, otp, payload.verificationType || null, payload.sendTo || null, expiresAt]
  );

  return { id, otp, expiresAt, ...payload };
}

export async function consumeOtpSession(userId, type, otp) {
  const { rows } = await query(
    `SELECT * FROM otp_sessions
     WHERE user_id = $1 AND type = $2
     ORDER BY expires_at DESC LIMIT 1`,
    [userId, type]
  );
  const record = rows[0];
  if (!record) throw badRequest("No OTP session found");
  if (new Date(record.expires_at) < new Date()) throw badRequest("OTP expired");
  if (record.otp !== String(otp)) throw badRequest("Invalid OTP");

  await query("DELETE FROM otp_sessions WHERE id = $1", [record.id]);
  return record;
}

export async function getUserById(userId) {
  const { rows } = await query("SELECT * FROM users WHERE id = $1", [userId]);
  return rows[0] || null;
}

export async function getUserWallet(userId) {
  const { rows } = await query("SELECT * FROM wallets WHERE user_id = $1", [userId]);
  if (rows.length === 0) {
    const id = createId("wal");
    const res = await query(
      "INSERT INTO wallets (id, user_id, balance, created_at) VALUES ($1, $2, 0, NOW()) RETURNING *",
      [id, userId]
    );
    return res.rows[0];
  }
  return rows[0];
}

export async function addWalletBalance(client, walletId, amount, purpose, transferId = null) {
  const { rows } = await client.query(
    "UPDATE wallets SET balance = balance + $1 WHERE id = $2 RETURNING *",
    [amount, walletId]
  );
  if (rows.length === 0) throw notFound("Wallet not found");

  await client.query(
    `INSERT INTO wallet_transactions (id, wallet_id, amount, type, purpose, transfer_id, date)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [
      createId("wtx"),
      walletId,
      amount,
      amount >= 0 ? "CREDIT" : "DEBIT",
      purpose,
      transferId,
    ]
  );
  return rows[0];
}

export async function transferBetweenWallets({ fromWalletId, toWalletId, amount, purpose }) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) throw badRequest("Invalid transfer amount");

  return withTransaction(async (client) => {
    const { rows: fromRows } = await client.query(
      "SELECT * FROM wallets WHERE id = $1 FOR UPDATE",
      [fromWalletId]
    );
    const { rows: toRows } = await client.query(
      "SELECT * FROM wallets WHERE id = $1 FOR UPDATE",
      [toWalletId]
    );
    if (!fromRows[0] || !toRows[0]) throw notFound("Wallet not found");
    if (Number(fromRows[0].balance) < value) throw badRequest("Insufficient balance");

    const transferId = createId("trf");
    await addWalletBalance(client, fromWalletId, -value, purpose || "TRANSFER_OUT", transferId);
    await addWalletBalance(client, toWalletId, value, purpose || "TRANSFER_IN", transferId);

    const { rows } = await client.query("SELECT * FROM wallets WHERE id = $1", [fromWalletId]);
    return rows[0];
  });
}
