import { createId, query, withTransaction } from "../data/db.js";
import { badRequest, notFound } from "../utils/httpError.js";
import { getCoinById } from "./coinService.js";

export async function getUserAssets(userId) {
  const { rows } = await query(
    "SELECT * FROM assets WHERE user_id = $1",
    [userId]
  );
  return rows;
}

export async function getUserAssetByCoin(userId, coinId) {
  const { rows } = await query(
    "SELECT * FROM assets WHERE user_id = $1 AND coin_id = $2",
    [userId, coinId]
  );
  return rows[0] || null;
}

export async function placeOrder({ userId, coinId, quantity, orderType }) {
  const qty = Number(quantity);
  if (!coinId || !Number.isFinite(qty) || qty <= 0) {
    throw badRequest("coinId and positive quantity are required");
  }
  if (!["BUY", "SELL"].includes(orderType)) {
    throw badRequest("orderType must be BUY or SELL");
  }

  const coin = await getCoinById(coinId);
  const price = Number(
    coin?.market_data?.current_price?.usd || coin?.current_price || 0
  );
  if (price <= 0) throw badRequest("Unable to price coin");
  const total = price * qty;

  return withTransaction(async (client) => {
    const { rows: walletRows } = await client.query(
      "SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE",
      [userId]
    );
    const wallet = walletRows[0];
    if (!wallet) throw notFound("Wallet not found");

    const { rows: assetRows } = await client.query(
      "SELECT * FROM assets WHERE user_id = $1 AND coin_id = $2 FOR UPDATE",
      [userId, coinId]
    );
    const existingAsset = assetRows[0] || null;

    if (orderType === "BUY") {
      if (Number(wallet.balance) < total) throw badRequest("Insufficient balance");

      await client.query(
        "UPDATE wallets SET balance = balance - $1 WHERE id = $2",
        [total, wallet.id]
      );

      if (existingAsset) {
        const oldQty = Number(existingAsset.quantity);
        const newQty = oldQty + qty;
        const newBuyPrice =
          (oldQty * Number(existingAsset.buy_price) + total) / newQty;
        await client.query(
          `UPDATE assets SET quantity = $1, buy_price = $2, coin_data = $3
           WHERE user_id = $4 AND coin_id = $5`,
          [newQty, newBuyPrice.toFixed(8), JSON.stringify(coin), userId, coinId]
        );
      } else {
        await client.query(
          `INSERT INTO assets (id, user_id, coin_id, coin_data, quantity, buy_price)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [createId("ast"), userId, coinId, JSON.stringify(coin), qty, price]
        );
      }

      await client.query(
        `INSERT INTO wallet_transactions (id, wallet_id, amount, type, purpose, date)
         VALUES ($1, $2, $3, 'ORDER', 'BUY_ORDER', NOW())`,
        [createId("wtx"), wallet.id, -Number(total.toFixed(6))]
      );
    } else {
      // SELL
      if (!existingAsset || Number(existingAsset.quantity) < qty) {
        throw badRequest("Not enough asset quantity to sell");
      }

      const newQty = Number(existingAsset.quantity) - qty;
      if (newQty <= 0.0000001) {
        await client.query(
          "DELETE FROM assets WHERE user_id = $1 AND coin_id = $2",
          [userId, coinId]
        );
      } else {
        await client.query(
          "UPDATE assets SET quantity = $1 WHERE user_id = $2 AND coin_id = $3",
          [newQty, userId, coinId]
        );
      }

      await client.query(
        "UPDATE wallets SET balance = balance + $1 WHERE id = $2",
        [total, wallet.id]
      );

      await client.query(
        `INSERT INTO wallet_transactions (id, wallet_id, amount, type, purpose, date)
         VALUES ($1, $2, $3, 'ORDER', 'SELL_ORDER', NOW())`,
        [createId("wtx"), wallet.id, Number(total.toFixed(6))]
      );
    }

    const orderId = createId("ord");
    await client.query(
      `INSERT INTO orders (id, user_id, order_type, price, status, coin_id, coin_data, quantity, unit_price, timestamp)
       VALUES ($1, $2, $3, $4, 'SUCCESS', $5, $6, $7, $8, NOW())`,
      [
        orderId, userId, orderType,
        Number(total.toFixed(6)), coinId,
        JSON.stringify(coin), qty, price,
      ]
    );

    const { rows: orderRows } = await client.query(
      "SELECT * FROM orders WHERE id = $1", [orderId]
    );
    return orderRows[0];
  });
}

export async function getOrderById(userId, orderId) {
  const { rows } = await query(
    "SELECT * FROM orders WHERE id = $1 AND user_id = $2",
    [orderId, userId]
  );
  if (!rows[0]) throw notFound("Order not found");
  return rows[0];
}

export async function getUserOrders(userId, orderType, assetSymbol) {
  let sql = "SELECT * FROM orders WHERE user_id = $1";
  const params = [userId];

  if (orderType) {
    params.push(orderType);
    sql += ` AND order_type = $${params.length}`;
  }

  sql += " ORDER BY timestamp DESC";
  const { rows } = await query(sql, params);

  if (assetSymbol) {
    const norm = String(assetSymbol).toLowerCase();
    return rows.filter(
      (o) => String(o.coin_data?.symbol || "").toLowerCase() === norm
    );
  }
  return rows;
}

export async function getWatchlist(userId) {
  const { rows } = await query(
    "SELECT * FROM watchlists WHERE user_id = $1",
    [userId]
  );
  if (rows[0]) return rows[0];

  const res = await query(
    `INSERT INTO watchlists (id, user_id, coin_ids)
     VALUES ($1, $2, $3) RETURNING *`,
    [createId("wtl"), userId, ["bitcoin", "ethereum"]]
  );
  return res.rows[0];
}

export async function toggleWatchlistCoin(userId, coinId) {
  const coin = await getCoinById(coinId);
  const watchlist = await getWatchlist(userId);
  const exists = watchlist.coin_ids.includes(coinId);

  const newIds = exists
    ? watchlist.coin_ids.filter((id) => id !== coinId)
    : [coinId, ...watchlist.coin_ids];

  await query(
    "UPDATE watchlists SET coin_ids = $1 WHERE user_id = $2",
    [newIds, userId]
  );
  return coin;
}