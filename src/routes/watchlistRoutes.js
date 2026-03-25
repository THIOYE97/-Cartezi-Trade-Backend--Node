import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { getCoinById } from "../services/coinService.js";
import { getWatchlist, toggleWatchlistCoin } from "../services/tradingService.js";

const router = Router();

async function enrichCoin(coinId) {
  const coin = await getCoinById(coinId);
  return {
    id: coin.id,
    image: coin.image?.large || coin.image?.small || coin.image,
    name: coin.name,
    symbol: coin.symbol,
    current_price: coin?.market_data?.current_price?.usd || coin.current_price || 0,
    market_cap_change_percentage_24h:
      coin?.market_data?.market_cap_change_percentage_24h ||
      coin?.market_data?.price_change_percentage_24h ||
      0,
    market_cap: coin?.market_data?.market_cap?.usd || coin.market_cap || 0,
    total_volume: coin?.market_data?.total_volume?.usd || coin.total_volume || 0,
  };
}

router.get("/api/watchlist/user", requireAuth, async (req, res, next) => {
  try {
    const watchlist = await getWatchlist(req.user.id);
    const coins = await Promise.all((watchlist.coinIds || []).map(enrichCoin));
    return res.json({
      id: watchlist.id,
      userId: watchlist.userId,
      coins,
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/api/watchlist/create", requireAuth, async (req, res, next) => {
  try {
    const watchlist = await getWatchlist(req.user.id);
    return res.json(watchlist);
  } catch (error) {
    return next(error);
  }
});

router.get("/api/watchlist/:watchlistId", requireAuth, async (req, res, next) => {
  try {
    const watchlist = await getWatchlist(req.user.id);
    if (watchlist.id !== req.params.watchlistId) {
      return res.status(404).json({ message: "Watchlist not found" });
    }
    const coins = await Promise.all((watchlist.coinIds || []).map(enrichCoin));
    return res.json({ ...watchlist, coins });
  } catch (error) {
    return next(error);
  }
});

router.patch("/api/watchlist/add/coin/:coinId", requireAuth, async (req, res, next) => {
  try {
    const coin = await toggleWatchlistCoin(req.user.id, req.params.coinId);
    return res.json({
      id: coin.id,
      image: coin.image?.large || coin.image?.small || coin.image,
      name: coin.name,
      symbol: coin.symbol,
      current_price: coin?.market_data?.current_price?.usd || coin.current_price || 0,
      market_cap_change_percentage_24h:
        coin?.market_data?.market_cap_change_percentage_24h ||
        coin?.market_data?.price_change_percentage_24h ||
        0,
      market_cap: coin?.market_data?.market_cap?.usd || coin.market_cap || 0,
      total_volume: coin?.market_data?.total_volume?.usd || coin.total_volume || 0,
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
