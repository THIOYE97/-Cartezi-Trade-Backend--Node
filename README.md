# AuronX Node Backend (Native)

This backend is fully native Node.js.

## Run locally

1. Copy `.env.example` to `.env`.
2. Install dependencies and start:

```bash
npm install
npm run dev
```

Default port is `5454` so your React app can continue using the same local API base URL.

## Features implemented

- JWT auth (signup/signin/profile)
- Two-factor OTP flow support
- Password reset OTP flow support
- Wallet, transfer, transactions, deposit
- Orders (buy/sell), assets, watchlist
- Withdrawals (user + admin actions)
- Payment details management
- Coin market, detail, chart, search endpoints (CoinGecko-backed)

## Enhancement endpoint

`GET /api/frontend/bootstrap`

Returns user profile, wallet, and watchlist in one call to reduce frontend waterfall requests.

Example response:

```json
{
  "user": { "ok": true, "data": {} },
  "wallet": { "ok": true, "data": {} },
  "watchlist": { "ok": true, "data": {} },
  "timestamp": "2026-03-14T00:00:00.000Z"
}
```

## Notes

- Data is stored in `data/db.json` for quick local setup.
- In development, OTP values are included in responses for easier testing.
- `GET /login/google` is implemented as a local demo login redirect.
# Cartezi-Trade-backend
