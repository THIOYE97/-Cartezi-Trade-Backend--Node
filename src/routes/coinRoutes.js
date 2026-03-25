import { Router } from "express";
import {
  getCoinById,
  getCoinChart,
  getCoinMarkets,
  getSimplePrices,
  getTop50,
  getTradingCoins,
  searchCoins,
} from "../services/coinService.js";

const router = Router();

// ── Existantes ────────────────────────────────

router.get("/coins", async (req, res, next) => {
  try {
    return res.json(await getCoinMarkets(Number(req.query.page || 1), 12));
  } catch (error) {
    return next(error);
  }
});

router.get("/coins/top50", async (_req, res, next) => {
  try {
    return res.json(await getTop50());
  } catch (error) {
    return next(error);
  }
});

router.get("/coins/trading", async (_req, res, next) => {
  try {
    return res.json(await getTradingCoins());
  } catch (error) {
    return next(error);
  }
});

router.get("/coins/search", async (req, res, next) => {
  try {
    return res.json(await searchCoins(String(req.query.q || "").trim()));
  } catch (error) {
    return next(error);
  }
});

// ── Nouvelle route simple/price ───────────────
// GET /coins/prices?ids=bitcoin,ethereum,solana
router.get("/coins/prices", async (req, res, next) => {
  try {
    const ids = String(req.query.ids || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 50); // max 50 coins par appel

    if (!ids.length) {
      return res.status(400).json({ message: "ids query param is required" });
    }

    return res.json(await getSimplePrices(ids));
  } catch (error) {
    return next(error);
  }
});

// ── Chart + Details ───────────────────────────

router.get("/coins/:coinId/chart", async (req, res, next) => {
  try {
    return res.json(
      await getCoinChart(req.params.coinId, Number(req.query.days || 7))
    );
  } catch (error) {
    return next(error);
  }
});

router.get("/coins/details/:coinId", async (req, res, next) => {
  try {
    const details = await getCoinById(req.params.coinId);
    return res.json({
      ...details,
      current_price: details?.market_data?.current_price?.usd || 0,
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/coins/:coinId", async (req, res, next) => {
  try {
    return res.json(await getCoinById(req.params.coinId));
  } catch (error) {
    return next(error);
  }
});

export default router;