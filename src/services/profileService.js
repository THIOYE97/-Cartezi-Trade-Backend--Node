import { createId, query, withTransaction } from "../data/db.js";
import { badRequest, notFound } from "../utils/httpError.js";
import { sendOtpEmail } from "./emailService.js";
import { sendWhatsAppOtp } from "./whatsappService.js";
import { env } from "../config/env.js";

export async function updateProfile(userId, payload) {
  const allowed = [
    "full_name", "date_of_birth", "nationality",
    "address_line", "city", "country", "postcode", "avatar_url",
  ];

  const fields = [];
  const values = [];

  for (const key of allowed) {
    const camel = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    const val = payload[key] || payload[camel];
    if (val !== undefined) {
      fields.push(`${key} = $${fields.length + 2}`);
      values.push(val);
    }
  }

  if (!fields.length) throw badRequest("No fields to update");

  // ← Pas de updated_at ici
  const { rows } = await query(
    `UPDATE users SET ${fields.join(", ")} WHERE id = $1 RETURNING *`,
    [userId, ...values]
  );
  if (!rows[0]) throw notFound("User not found");
  return rows[0];
}

export async function completeOnboarding(userId, payload) {
  const { fullName, dateOfBirth, nationality, addressLine, city, country, postcode } = payload;
  if (!fullName || !dateOfBirth || !nationality || !country) {
    throw badRequest("fullName, dateOfBirth, nationality and country are required");
  }

  const { rows } = await query(
    `UPDATE users
     SET full_name = $2, date_of_birth = $3, nationality = $4,
         address_line = $5, city = $6, country = $7, postcode = $8,
         onboarding_done = true
     WHERE id = $1 RETURNING *`,
    [userId, fullName, dateOfBirth, nationality,
     addressLine || null, city || null, country, postcode || null]
  );
  return rows[0];
}

export async function sendPhoneOtp(userId, phone) {
  if (!phone || !/^\+[1-9]\d{7,14}$/.test(phone)) {
    throw badRequest("Invalid phone number (format: +221771234567)");
  }

  const { rows: userRows } = await query("SELECT * FROM users WHERE id = $1", [userId]);
  const user = userRows[0];
  if (!user) throw notFound("User not found");

  const otp = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = new Date(Date.now() + env.otpTtlMinutes * 60_000).toISOString();

  // Supprimer les anciens OTP phone du user
  await query(
    "DELETE FROM otp_sessions WHERE user_id = $1 AND type = 'PHONE_VERIFICATION'",
    [userId]
  );

  const sessionId = createId("otp");
  await query(
    `INSERT INTO otp_sessions (id, user_id, type, otp, send_to, expires_at)
     VALUES ($1,$2,'PHONE_VERIFICATION',$3,$4,$5)`,
    [sessionId, userId, otp, phone, expiresAt]
  );

  await sendWhatsAppOtp(phone, otp, user.full_name);

  return {
    session: sessionId,
    otp: env.nodeEnv === "development" ? otp : undefined,
  };
}

export async function verifyPhoneOtp(userId, sessionId, otp) {
  const { rows } = await query(
    "SELECT * FROM otp_sessions WHERE id = $1 AND user_id = $2 AND type = 'PHONE_VERIFICATION'",
    [sessionId, userId]
  );
  const session = rows[0];
  if (!session) throw badRequest("Invalid OTP session");
  if (new Date(session.expires_at) < new Date()) throw badRequest("OTP expired");
  if (session.otp !== String(otp)) throw badRequest("Invalid OTP");

  await query(
    "UPDATE users SET phone = $1, phone_verified = true WHERE id = $2",
    [session.send_to, userId]
  );
  await query("DELETE FROM otp_sessions WHERE id = $1", [session.id]);

  const { rows: userRows } = await query("SELECT * FROM users WHERE id = $1", [userId]);
  return userRows[0];
}

export async function getUserActivity(userId, limit = 50) {
  const { rows } = await query(
    `SELECT * FROM user_activity
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, limit]
  );
  return rows;
}

export async function logActivity(userId, type, title, description, metadata = null) {
  await query(
    `INSERT INTO user_activity (id, user_id, type, title, description, metadata)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [createId("act"), userId, type, title, description, metadata ? JSON.stringify(metadata) : null]
  );
}
