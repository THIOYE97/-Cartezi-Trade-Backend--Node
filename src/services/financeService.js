import { createId, query, withTransaction } from "../data/db.js";
import { badRequest, notFound } from "../utils/httpError.js";

export async function getPaymentDetailsForUser(userId) {
  const { rows } = await query(
    "SELECT * FROM payment_details WHERE user_id = $1",
    [userId]
  );
  return rows[0] || null;
}

export async function upsertPaymentDetails(userId, payload) {
  const { accountHolderName, accountNumber, bankName } = payload;
  const ifsc = payload.ifsc || payload.ifscCode;
  if (!accountHolderName || !accountNumber || !bankName || !ifsc) {
    throw badRequest("Incomplete payment details");
  }

  const { rows } = await query(
    `INSERT INTO payment_details (id, user_id, account_holder_name, account_number, bank_name, ifsc)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id) DO UPDATE
       SET account_holder_name = $3,
           account_number = $4,
           bank_name = $5,
           ifsc = $6
     RETURNING *`,
    [createId("pdt"), userId, accountHolderName, accountNumber, bankName, ifsc]
  );
  return rows[0];
}

export async function createWithdrawal(userId, amount) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) {
    throw badRequest("Invalid withdrawal amount");
  }

  return withTransaction(async (client) => {
    const { rows: walletRows } = await client.query(
      "SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE",
      [userId]
    );
    const wallet = walletRows[0];
    if (!wallet) throw notFound("Wallet not found");
    if (Number(wallet.balance) < value) throw badRequest("Insufficient balance");

    await client.query(
      "UPDATE wallets SET balance = balance - $1 WHERE id = $2",
      [value, wallet.id]
    );

    const wdrId = createId("wdr");
    const { rows } = await client.query(
      `INSERT INTO withdrawals (id, user_id, amount, status, date)
       VALUES ($1, $2, $3, 'PENDING', NOW()) RETURNING *`,
      [wdrId, userId, value]
    );

    await client.query(
      `INSERT INTO wallet_transactions (id, wallet_id, amount, type, purpose, transfer_id, date)
       VALUES ($1, $2, $3, 'WITHDRAWAL', 'WITHDRAWAL_REQUEST', $4, NOW())`,
      [createId("wtx"), wallet.id, -value, wdrId]
    );

    return rows[0];
  });
}

export async function getUserWithdrawals(userId) {
  const { rows } = await query(
    "SELECT * FROM withdrawals WHERE user_id = $1 ORDER BY date DESC",
    [userId]
  );
  return rows;
}

export async function getAllWithdrawals() {
  const { rows } = await query(
    `SELECT w.*, u.id as u_id, u.full_name, u.email
     FROM withdrawals w
     LEFT JOIN users u ON u.id = w.user_id
     ORDER BY w.date DESC`
  );
  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    amount: row.amount,
    status: row.status,
    date: row.date,
    user: row.u_id
      ? { id: row.u_id, fullName: row.full_name, email: row.email }
      : null,
  }));
}

export async function proceedWithdrawal(withdrawalId, accept) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      "SELECT * FROM withdrawals WHERE id = $1 FOR UPDATE",
      [withdrawalId]
    );
    const item = rows[0];
    if (!item) throw notFound("Withdrawal not found");
    if (item.status !== "PENDING") return item;

    const approved = String(accept) === "true";
    await client.query(
      "UPDATE withdrawals SET status = $1 WHERE id = $2",
      [approved ? "SUCCESS" : "DECLINED", withdrawalId]
    );

    if (!approved) {
      const { rows: walletRows } = await client.query(
        "SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE",
        [item.user_id]
      );
      const wallet = walletRows[0];
      if (!wallet) throw notFound("Wallet not found");

      await client.query(
        "UPDATE wallets SET balance = balance + $1 WHERE id = $2",
        [item.amount, wallet.id]
      );
      await client.query(
        `INSERT INTO wallet_transactions (id, wallet_id, amount, type, purpose, transfer_id, date)
         VALUES ($1, $2, $3, 'WITHDRAWAL', 'WITHDRAWAL_REFUND', $4, NOW())`,
        [createId("wtx"), wallet.id, item.amount, withdrawalId]
      );
    }

    const { rows: userRows } = await client.query(
      "SELECT id, full_name, email FROM users WHERE id = $1",
      [item.user_id]
    );
    const user = userRows[0];
    return {
      ...item,
      status: approved ? "SUCCESS" : "DECLINED",
      user: user
        ? { id: user.id, fullName: user.full_name, email: user.email }
        : null,
    };
  });
}