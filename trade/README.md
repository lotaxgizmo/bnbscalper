# Trade Simulator & Monitor

This folder contains a self‑contained live trade simulator and terminal monitor that streams real-time Bybit prices, opens/closes simulated trades, and shows live PnL, capital and prices.

Key scripts:
- tradeMaker.js — server: price feed + REST + local WS broadcast
- monitor_trades.js — terminal monitor with live prices, PnL, TP/SL, duration
- price_stream.js — minimal live price client
- place_trade.js — example trade placement script
- simClient.js — helper used by place_trade.js

## 1) Quick Start

Prereqs: Node 18+, internet. Optional: .env settings.

1. Install deps (if not done at repo root):
   npm i

2. Start the simulator server:
   node trade/tradeMaker.js
   You should see:
   - Trade Simulator listening on http://localhost:3100
   - [WS] Connected ...
   - [WS] Subscribed to tickers.BTCUSDT

3. Start the live monitor in another terminal:
   node trade/monitor_trades.js
   - Top line shows Prices: <symbol>=<price>
   - Table shows open trades with Margin, Lev, Duration, TP, SL, PnL, etc.

4. (Optional) Minimal price stream client:
   node trade/price_stream.js

## 2) Environment & Config

- .env (optional)
  TRADE_SIM_PORT=3100
  BYBIT_USE_TESTNET=true

- trade/tradeconfig.js
  - initialCapital: starting cash
  - enableSlippage, slippagePercent: simple entry slippage simulation
  - You can leave default leverage/TP/SL unset; per-trade parameters are taken from requests

## 3) Placing Trades

Use the example script:

node trade/place_trade.js

Edit the payload in trade/place_trade.js:
```js
const myTrade = {
  symbol: 'BTCUSDT',        // required
  side: 'LONG' | 'SHORT',   // required
  amountToRisk: 100,        // your margin (deducted from cash)
  leverage: 45,             // applied leverage
  tpPct: 1.0,               // optional, percent take profit
  slPct: 0.5,               // optional, percent stop loss
  // Advanced (optional):
  // orderType: 'limit',
  // limitPrice: 118500,
  // notional: 5000,        // overrides derived notional (subject to cap)
  // meta: { any: 'thing' },
};
```
Notes:
- TP/SL are optional. Use 0, null, or omit to run with no TP/SL.
- amountToRisk × leverage ≈ notional (position size). Example: $100 × 45 = $4,500.
- If you set `notional`, the server respects it up to your max allowable cap.

## 3a) Closing Trades Manually

You can force-close trades via the helper script `trade/close_trade.js`.

- List and close a single trade by ID:
  node trade/close_trade.js 5

- Close all open trades:
  node trade/close_trade.js all

The script will fetch open trades, display them, and then attempt the requested close(s). It calls the server's `POST /trades/:id/close` for each OPEN trade. If the server or price is unavailable, you'll see an error message.

## 4) What the Monitor Shows

- Prices: latest price per subscribed symbol at the top.
- Columns per trade:
  - ID, Symbol, Side, Margin, Lev
  - Entry, TP, SL (— if not set)
  - Duration (live from openTs)
  - PnL $, PnL % (live updates)
- Capital line updates with cash, used margin, equity, realized PnL.

## 5) REST API (served by tradeMaker.js)

Base: http://localhost:3100

- GET /status
  Returns ws status, subscribed symbols, price cache, counts

- GET /capital
  Returns current capital snapshot

- GET /trades
  Returns { open: [...], closed: [...] }

- POST /webhook
  Opens a trade immediately (market) or queues (limit/pending)
  Body JSON:
  {
    symbol: 'BTCUSDT',
    side: 'LONG' | 'SHORT',
    tpPct?: number,          // optional, <=0 means no TP
    slPct?: number,          // optional, <=0 means no SL
    leverage?: number,
    meta?: object,
    orderType?: 'market' | 'limit',
    limitPrice?: number,     // when orderType is 'limit'
    notional?: number        // optional override for position size cap
  }
  Responses:
  - 200 Trade opened
  - 202 Accepted pending (no price yet)
  - 400 Bad request

- POST /trades/:id/close
  Force-close an OPEN trade at current price

- POST /trades/:id/cancel
  Cancel a PENDING_LIMIT or PENDING_PRICE trade

## 6) Live WebSocket Broadcast (local)

The server exposes a local WS (same port as HTTP).
- URL: ws://localhost:<TRADE_SIM_PORT>
- Messages observed by monitor:
  - price_cache: [{ symbol, price, ts }]
  - price or price_update: { symbol, price }
  - trade_open: { trade }
  - trade_update: { id, pnl, pnlPct }
  - trade_close: { trade }
  - capital_update: { capital }

## 7) Common Tips

- If the monitor shows no price updates, restart the server to resubscribe.
- TP/SL optional: set 0/null/omit; monitor shows “—”.
- Limit orders: set orderType:'limit' and limitPrice; they fill when price crosses.
- Logs: JSONL files in logs/ for trades and capital snapshots.

## 8) Troubleshooting

- Error: Internal error when TP/SL = 0
  Fixed in logging; ensure server is restarted after pulling latest changes.

- No prices at start
  The server auto-subscribes to BTCUSDT. Confirm “[WS] Connected …” appears.

- Capital not updating
  Monitor listens for capital_update; ensure the monitor is connected and server running.

---
Happy trading!
