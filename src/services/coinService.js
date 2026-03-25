import axios from "axios";
import { env } from "../config/env.js";

console.log("CoinGecko key loaded:", env.coingeckoApiKey ? "✅" : "❌ MISSING");

const api = axios.create({
  baseURL: env.coingeckoApiBase,
  timeout: 30_000,
  headers: {
    "Accept": "application/json",
    "x-cg-demo-api-key": env.coingeckoApiKey,
  },
});

const cache = new Map();

function getCached(key) {
  const record = cache.get(key);
  if (!record) return null;
  if (Date.now() > record.expiresAt) {
    cache.delete(key);
    return null;
  }
  return record.data;
}

function setCached(key, data, ttlMs = 60_000) {
  cache.set(key, { data, expiresAt: Date.now() + ttlMs });
  return data;
}

async function fetchWithRetry(fn, retries = 3, baseDelay = 1500) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      const status = err.response?.status;
      const isRetryable = status === 429 || status >= 500;
      if (isRetryable && i < retries - 1) {
        const delay = baseDelay * Math.pow(2, i);
        console.warn(`CoinGecko ${status} — retry ${i + 1}/${retries} in ${delay}ms`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
}

const FALLBACK_COINS = [
  {
    id: "bitcoin", symbol: "btc", name: "Bitcoin",
    image: "https://assets.coingecko.com/coins/images/1/large/bitcoin.png",
    current_price: 0, market_cap: 0,
    market_cap_change_percentage_24h: 0,
    total_volume: 0, price_change_percentage_24h: 0,
  },
  {
    id: "ethereum", symbol: "eth", name: "Ethereum",
    image: "https://assets.coingecko.com/coins/images/279/large/ethereum.png",
    current_price: 0, market_cap: 0,
    market_cap_change_percentage_24h: 0,
    total_volume: 0, price_change_percentage_24h: 0,
  },
];

// ── Simple price — endpoint léger ──────────────
export async function getSimplePrices(coinIds = []) {
  if (!coinIds.length) return {};
  const key = `simple:${coinIds.sort().join(",")}`;
  const cached = getCached(key);
  if (cached) return cached;

  return fetchWithRetry(async () => {
    const response = await api.get("/simple/price", {
      params: {
        ids: coinIds.join(","),
        vs_currencies: "usd",
        include_24hr_change: true,
        include_market_cap: true,
      },
    });
    return setCached(key, response.data, 30_000);
  });
}

// ── Markets ────────────────────────────────────
export async function getCoinMarkets(page = 1, perPage = 12) {
  const key = `markets:${page}:${perPage}`;
  const cached = getCached(key);
  if (cached) return cached;

  try {
    return await fetchWithRetry(async () => {
      const response = await api.get("/coins/markets", {
        params: {
          vs_currency: "usd",
          order: "market_cap_desc",
          per_page: perPage,
          page,
          sparkline: false,
          price_change_percentage: "24h",
        },
      });
      return setCached(key, response.data, 60_000);
    });
  } catch (err) {
    console.error("getCoinMarkets failed:", err.message);
    return FALLBACK_COINS;
  }
}

export async function getTop50() {
  return getCoinMarkets(1, 50);
}

export async function getTradingCoins() {
  const markets = await getCoinMarkets(1, 30);
  return markets
    .slice()
    .sort(
      (a, b) =>
        Math.abs(b.price_change_percentage_24h || 0) -
        Math.abs(a.price_change_percentage_24h || 0)
    )
    .slice(0, 15);
}

// ── Coin details ───────────────────────────────
export async function getCoinById(coinId) {
  const key = `coin:${coinId}`;
  const cached = getCached(key);
  if (cached) return cached;

  try {
    return await fetchWithRetry(async () => {
      const response = await api.get(`/coins/${coinId}`, {
        params: {
          localization: false,
          tickers: false,
          market_data: true,
          community_data: false,
          developer_data: false,
          sparkline: false,
        },
      });
      return setCached(key, response.data, 90_000);
    });
  } catch (err) {
    console.error(`getCoinById(${coinId}) failed:`, err.message);
    throw err;
  }
}

// ── Chart ──────────────────────────────────────
export async function getCoinChart(coinId, days = 7) {
  const key = `chart:${coinId}:${days}`;
  const cached = getCached(key);
  if (cached) return cached;

  return fetchWithRetry(async () => {
    const response = await api.get(`/coins/${coinId}/market_chart`, {
      params: { vs_currency: "usd", days },
    });
    return setCached(key, response.data, 300_000);
  });
}

// ── Search ─────────────────────────────────────
export async function searchCoins(query) {
  if (!query || query.trim().length < 2) return { coins: [] };
  const key = `search:${query.toLowerCase()}`;
  const cached = getCached(key);
  if (cached) return cached;

  return fetchWithRetry(async () => {
    const response = await api.get("/search", { params: { query } });
    return setCached(key, response.data, 120_000);
  });
}
