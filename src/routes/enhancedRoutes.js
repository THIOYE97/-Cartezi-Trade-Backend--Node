import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { getUserWallet, sanitizeUser } from "../services/coreService.js";
import { getWatchlist } from "../services/tradingService.js";
import { getCoinById } from "../services/coinService.js";

const router = Router();

router.get("/api/frontend/bootstrap", requireAuth, async (req, res, next) => {
  try {
    const [profileResult, walletResult, watchlistResult] = await Promise.allSettled([
      Promise.resolve(sanitizeUser(req.user)),
      getUserWallet(req.user.id),
      (async () => {
        const watchlist = await getWatchlist(req.user.id);
        const coins = await Promise.all(
          (watchlist.coinIds || []).map(async (coinId) => {
            const coin = await getCoinById(coinId);
            return {
              id: coin.id,
              image: coin.image?.large || coin.image?.small || coin.image,
              name: coin.name,
              symbol: coin.symbol,
              current_price:
                coin?.market_data?.current_price?.usd || coin.current_price || 0,
              market_cap_change_percentage_24h:
                coin?.market_data?.market_cap_change_percentage_24h ||
                coin?.market_data?.price_change_percentage_24h ||
                0,
              market_cap: coin?.market_data?.market_cap?.usd || coin.market_cap || 0,
              total_volume:
                coin?.market_data?.total_volume?.usd || coin.total_volume || 0,
            };
          })
        );
        return { id: watchlist.id, userId: watchlist.userId, coins };
      })(),
    ]);

    const buildData = (result) =>
      result.status === "fulfilled"
        ? { ok: true, data: result.value }
        : {
            ok: false,
            error: result.reason?.message || "Request failed",
          };

    return res.json({
      user: buildData(profileResult),
      wallet: buildData(walletResult),
      watchlist: buildData(watchlistResult),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
