export function notFoundHandler(req, res) {
  res.status(404).json({
    message: "Route not found",
    path: req.originalUrl,
  });
}

export function errorHandler(err, req, res, _next) {
  const status = err.status || err.response?.status || 500;

  // Erreur CoinGecko explicite
  if (err.code === "ECONNABORTED" || err.message?.includes("timeout")) {
    return res.status(503).json({
      message: "Market data temporarily unavailable — please retry",
    });
  }

  if (err.response?.status === 429) {
    return res.status(429).json({
      message: "Rate limit reached — please wait a moment",
    });
  }

  const payload = err.response?.data;
  if (payload) return res.status(status).json(payload);

  return res.status(status).json({
    message: err.message || "Unexpected server error",
  });
}
