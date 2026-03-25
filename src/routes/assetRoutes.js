import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { getCoinById } from "../services/coinService.js";
import { getUserAssetByCoin, getUserAssets } from "../services/tradingService.js";
import { notFound } from "../utils/httpError.js";

const router = Router();

async function enrichAsset(asset) {
  const latestCoin = await getCoinById(asset.coin.id);
  return {
    ...asset,
    coin: {
      id: latestCoin.id,
      image: latestCoin.image?.large || latestCoin.image?.small || latestCoin.image,
      symbol: latestCoin.symbol,
      name: latestCoin.name,
      current_price:
        latestCoin?.market_data?.current_price?.usd || latestCoin.current_price || 0,
      price_change_percentage_24h:
        latestCoin?.market_data?.price_change_percentage_24h || 0,
    },
  };
}

router.get("/api/assets", requireAuth, async (req, res, next) => {
  try {
    const assets = await getUserAssets(req.user.id);
    const enriched = await Promise.all(assets.map(enrichAsset));
    return res.json(enriched);
  } catch (error) {
    return next(error);
  }
});

router.get("/api/assets/coin/:coinId/user", requireAuth, async (req, res, next) => {
  try {
    const asset = await getUserAssetByCoin(req.user.id, req.params.coinId);
    if (!asset) throw notFound("Asset not found");
    return res.json(await enrichAsset(asset));
  } catch (error) {
    return next(error);
  }
});

router.get("/api/assets/:assetId", requireAuth, async (req, res, next) => {
  try {
    const assets = await getUserAssets(req.user.id);
    const asset = assets.find((item) => item.id === req.params.assetId);
    if (!asset) throw notFound("Asset not found");
    return res.json(await enrichAsset(asset));
  } catch (error) {
    return next(error);
  }
});

export default router;
