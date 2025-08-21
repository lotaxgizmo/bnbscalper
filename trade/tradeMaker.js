// tradeMaker.js - Live Trade Simulator (webhook + Bybit WS price feed)
import express from 'express';
import dotenv from 'dotenv';
import WebSocket, { WebSocketServer } from 'ws';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { tradeConfig } from './tradeconfig.js';
import fs from 'fs';
import path from 'path';

dotenv.config();

// --- Config ---
const PORT = process.env.TRADE_SIM_PORT ? Number(process.env.TRADE_SIM_PORT) : 3100;
const USE_TESTNET = (process.env.BYBIT_USE_TESTNET ?? 'false').toLowerCase() !== 'false';
const WS_ENDPOINT = USE_TESTNET
  ? 'wss://stream-testnet.bybit.com/v5/public/linear'
  : 'wss://stream.bybit.com/v5/public/linear';

const TAKER_FEE_PCT = 0.055; // Bybit's taker fee is 0.055%

function getFormattedTimestamp() {
  const now = new Date();
  const day = now.toLocaleDateString('en-US', { weekday: 'long' });
  const time12 = now.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
  const time24 = now.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  return `${day}, ${time12} (${time24})`;
}

// --- Proxy (match apis/bybit.js) ---
// Smartproxy credentials (same as apis/bybit.js)
const proxyHost = '81.29.154.198';
const proxyPort = '48323';
const proxyUser = 'esELEn9MJXGBpkz';
const proxyPass = 'mL9JZEdv2L40YuN';
const proxyUrl = `http://${proxyUser}:${proxyPass}@${proxyHost}:${proxyPort}`;
const proxyAgent = new HttpsProxyAgent(proxyUrl);

// --- State ---
const app = express();
app.use(express.json());

// Logging setup
const __dirname = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const logsDir = path.join(__dirname, 'logs');
const tradesLog = path.join(logsDir, 'sim_trades.jsonl');
const capitalLog = path.join(logsDir, 'capital.jsonl');
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

function appendJsonl(file, obj) {
  try {
    fs.appendFileSync(file, JSON.stringify(obj) + '\n');
  } catch {}
}

// Price cache per symbol
const prices = new Map(); // symbol -> { lastPrice: number, ts: number }

// Subscription tracking
const subscribed = new Set();

// Trade store
let nextId = 1;
const openTrades = new Map(); // id -> trade
const closedTrades = []; // array of trades

// Capital model
const capital = {
  initial: Number(tradeConfig.initialCapital ?? 1000),
  equity: Number(tradeConfig.initialCapital ?? 1000),
  cash: Number(tradeConfig.initialCapital ?? 1000),
  usedMargin: 0,
  realizedPnl: 0,
};



function slippagePct() {
  if (!tradeConfig.enableSlippage) return 0;
  const mode = tradeConfig.slippageMode ?? 'fixed';
  if (mode === 'fixed') return (Number(tradeConfig.slippagePercent ?? 0) / 100);
  return (Number(tradeConfig.slippagePercent ?? 0) / 100); // simple v1
}

// --- Bybit WebSocket (public) ---
let ws;
let wsConnected = false;

function connectWS() {
  ws = new WebSocket(WS_ENDPOINT, { agent: proxyAgent });

  ws.on('open', () => {
    wsConnected = true;
    console.log(`[WS] Connected to ${WS_ENDPOINT}`);
    // Re-subscribe all symbols after reconnect
    if (subscribed.size > 0) {
      const args = Array.from(subscribed).map((sym) => `tickers.${sym}`);
      const payload = { op: 'subscribe', args };
      ws.send(JSON.stringify(payload));
      console.log(`[WS] Re-subscribed: ${args.join(', ')}`);
    }
  });

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.op === 'subscribe' && msg.success) {
        // subscription ack
        return;
      }
      if (msg.topic && msg.topic.startsWith('tickers.')) {
        const data = Array.isArray(msg.data) ? msg.data[0] : msg.data;
        if (data && data.symbol && (data.lastPrice || data.lastPrice !== undefined)) {
          const priceNum = Number(data.lastPrice);
          if (!Number.isNaN(priceNum)) {
            const priceUpdate = { symbol: data.symbol, price: priceNum, ts: Date.now() };
            prices.set(data.symbol, { lastPrice: priceNum, ts: priceUpdate.ts });

            // Broadcast to local clients
            broadcast(JSON.stringify({ type: 'price', ...priceUpdate }));

            // Evaluate open trades for this symbol
            evaluateTradesForSymbol(data.symbol, priceNum);
          }
        }
      }
    } catch (e) {
      // avoid noisy logs
    }
  });

  ws.on('close', () => {
    wsConnected = false;
    console.log('[WS] Disconnected. Reconnecting in 2s...');
    setTimeout(connectWS, 2000);
  });

  ws.on('error', (err) => {
    console.error('[WS] Error:', err.message);
  });
}

connectWS();

// Default subscription for the price stream to work immediately
subscribeSymbol('BTCUSDT');

function subscribeSymbol(symbol) {
  if (subscribed.has(symbol)) return;
  subscribed.add(symbol);
  if (wsConnected) {
    const payload = { op: 'subscribe', args: [`tickers.${symbol}`] };
    ws.send(JSON.stringify(payload));
    console.log(`[WS] Subscribed to tickers.${symbol}`);
  }
}

// --- Trade evaluation ---
function evaluateTradesForSymbol(symbol, currentPrice) {
  // Broadcast latest price once per symbol tick
  try { broadcast(JSON.stringify({ type: 'price_update', symbol, price: currentPrice })); } catch {}
  for (const trade of openTrades.values()) {
    if (trade.symbol !== symbol || trade.status !== 'OPEN') continue;
    const dir = trade.side === 'LONG' ? 1 : -1;
    const pnl = (currentPrice - trade.entryPrice) * trade.qty * dir;
    const pnlPct = ((currentPrice / trade.entryPrice) - 1) * 100 * dir;
    broadcast(JSON.stringify({ type: 'trade_update', id: trade.id, pnl, pnlPct }));

    // Check TP/SL if present
    const hasTp = Number.isFinite(trade.tp);
    const hasSl = Number.isFinite(trade.sl);
    if (dir === 1) { // LONG
      if (hasTp && currentPrice >= trade.tp) closeTrade(trade.id, 'TP', trade.tp);
      else if (hasSl && currentPrice <= trade.sl) closeTrade(trade.id, 'SL', trade.sl);
    } else { // SHORT
      if (hasTp && currentPrice <= trade.tp) closeTrade(trade.id, 'TP', trade.tp);
      else if (hasSl && currentPrice >= trade.sl) closeTrade(trade.id, 'SL', trade.sl);
    }
  }
}

function closeTrade(id, reason, exitPrice) {
  const trade = openTrades.get(id);
  if (!trade) return null;

  // Update trade properties for closure
  trade.status = 'CLOSED';
  trade.closeReason = reason;
  trade.exitPrice = exitPrice;
  trade.closeTime = getFormattedTimestamp();

  const notionalExit = trade.notional;
  const grossPnl = trade.side === 'LONG'
    ? (exitPrice - trade.entryPrice) * trade.qty
    : (trade.entryPrice - exitPrice) * trade.qty;

  const fee = TAKER_FEE_PCT / 100;
  const fees = (trade.notional * fee) + (notionalExit * fee);
  const netPnl = grossPnl - fees;

  // Finalize PnL details on the trade object
  trade.pnl = netPnl;
  trade.pnlPct = (netPnl / trade.usedMargin) * 100;
  trade.fees = fees;

  // Update capital
  capital.usedMargin -= trade.usedMargin;
  capital.cash += netPnl; // Realize PnL to cash
  capital.realizedPnl += netPnl;
  capital.equity = capital.cash + capital.usedMargin;

  // Move trade from open to closed collections
  openTrades.delete(id);
  closedTrades.push(trade);

  // Log events
  appendJsonl(tradesLog, { event: 'close', ...trade });
  appendJsonl(capitalLog, { ts: Date.now(), event: 'close', ...capital });

  // Broadcast updates to clients
  broadcast(JSON.stringify({ type: 'trade_close', trade }));
  broadcastCapitalUpdate();

  console.log(`[Trade #${id}] Closed. Reason: ${reason}. PnL: $${netPnl.toFixed(2)}`);

  return trade;
}

// --- Helpers ---
function normalizeSymbol(sym) {
  return (sym || 'BTCUSDT').toUpperCase();
}

function computeTargets(side, entry, tpPct, slPct) {
  const validTp = typeof tpPct === 'number' && tpPct > 0;
  const validSl = typeof slPct === 'number' && slPct > 0;
  if (!validTp && !validSl) return { tp: null, sl: null };
  const f = (v) => Number((v).toFixed(2));
  if (side === 'LONG') {
    return {
      tp: validTp ? f(entry * (1 + tpPct / 100)) : null,
      sl: validSl ? f(entry * (1 - slPct / 100)) : null,
    };
  } else {
    return {
      tp: validTp ? f(entry * (1 - tpPct / 100)) : null,
      sl: validSl ? f(entry * (1 + slPct / 100)) : null,
    };
  }
}

// --- Routes ---
app.get('/status', (req, res) => {
  res.json({
    wsConnected,
    subscribed: Array.from(subscribed),
    priceCache: Array.from(prices.entries()).map(([symbol, v]) => ({ symbol, ...v })),
    openCount: openTrades.size,
    closedCount: closedTrades.length,
  });
});

app.get('/capital', (req, res) => {
  res.json({ ...capital });
});

app.get('/trades', (req, res) => {
  res.json({
    open: Array.from(openTrades.values()),
    closed: closedTrades,
  });
});

// Force close an OPEN trade by id at current price
app.post('/trades/:id/close', (req, res) => {
  const id = Number(req.params.id);
  const trade = openTrades.get(id);
  if (!trade) return res.status(404).json({ error: 'Trade not found' });
  if (trade.status !== 'OPEN') return res.status(409).json({ error: `Trade status is ${trade.status}, cannot force close.` });
  const last = prices.get(trade.symbol);
  if (!last) return res.status(409).json({ error: 'No live price available for symbol to close.' });
  const px = Number(last.lastPrice);
  closeTrade(id, 'FORCE', px);
  const closed = closedTrades[closedTrades.length - 1];
  return res.json({ message: 'Trade force-closed', trade: closed });
});

// Cancel a pending trade (PENDING_LIMIT or PENDING_PRICE)
app.post('/trades/:id/cancel', (req, res) => {
  const id = Number(req.params.id);
  const trade = openTrades.get(id);
  if (!trade) return res.status(404).json({ error: 'Trade not found' });
  if (trade.status === 'OPEN') return res.status(409).json({ error: 'Trade is OPEN. Use /trades/:id/close to close.' });
  if (trade.status !== 'PENDING_LIMIT' && trade.status !== 'PENDING_PRICE') {
    return res.status(409).json({ error: `Trade status is ${trade.status}, cannot cancel.` });
  }
  openTrades.delete(id);
  appendJsonl(tradesLog, { type: 'cancel', trade, ts: Date.now() });
  return res.json({ message: 'Trade canceled', trade });
});

// Webhook to open a simulated trade
// Body: { symbol, side: 'LONG'|'SHORT', tpPct, slPct, leverage?, meta?, orderType?, limitPrice?, notional? }
app.post('/webhook', async (req, res) => {
  try {
    const { symbol: rawSymbol, side: rawSide, tpPct, slPct, leverage, meta, orderType, limitPrice, notional } = req.body || {};
    const symbol = normalizeSymbol(rawSymbol);
    const side = String(rawSide || '').toUpperCase();
    if (!['LONG', 'SHORT'].includes(side)) {
      return res.status(400).json({ error: 'Invalid side. Use LONG or SHORT.' });
    }
    // tpPct and slPct are optional; if missing or <= 0, trade will run without TP/SL

    // Ensure price subscription
    subscribeSymbol(symbol);

    const last = prices.get(symbol);
    if (!last) {
      // No price yet; accept and open when first price arrives
      const pendingId = nextId++;
      const pending = {
        id: pendingId,
        symbol,
        side,
        leverage: Number(leverage ?? tradeConfig.leverage ?? 1) || 1,
        status: (orderType === 'limit') ? 'PENDING_LIMIT' : 'PENDING_PRICE',
        createdAt: Date.now(),
        meta: meta ?? null,
        orderType: (orderType === 'limit') ? 'limit' : 'market',
        limitPrice: typeof limitPrice === 'number' ? Number(limitPrice) : undefined,
        requestedNotional: typeof notional === 'number' ? Number(notional) : undefined,
      };
      openTrades.set(pendingId, pending);
      broadcast(JSON.stringify({ type: 'trade_open', trade: pending }));
      console.log(`[#${pendingId}] Accepted pending trade for ${symbol} (${side}). Waiting for first price...`);
      return res.status(202).json({ message: 'Accepted. Waiting for first price to open trade.', id: pendingId });
    }

    // Handle order type
    const ordType = (orderType === 'limit') ? 'limit' : 'market';
    if (ordType === 'limit') {
      const id = nextId++;
      const t = {
        id,
        symbol,
        side,
        leverage: Number(leverage ?? tradeConfig.leverage ?? 1) || 1,
        tpPct,
        slPct,
        status: 'PENDING_LIMIT',
        createdAt: Date.now(),
        orderType: 'limit',
        limitPrice: Number(limitPrice),
        meta: meta ?? null,
        requestedNotional: typeof notional === 'number' ? Number(notional) : undefined,
      };
      openTrades.set(id, t);
      console.log(`[#${id}] LIMIT pending ${side} ${symbol} @ ${t.limitPrice}`);
      return res.json({ message: 'Limit order queued', trade: t });
    }

    // Market open now
    const entryRef = Number(last.lastPrice);
    const opened = tryOpenTradeNow({ symbol, side, leverage, tpPct, slPct, entryRef, meta, requestedNotional: notional });
    if (opened.error) return res.status(400).json({ error: opened.error });
    broadcast(JSON.stringify({ type: 'trade_open', trade: opened.trade }));
    return res.json({ message: 'Trade opened', trade: opened.trade });
  } catch (err) {
    console.error('Webhook error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
});

// Background: convert PENDING_PRICE to OPEN when first price arrives
setInterval(() => {
  for (const trade of openTrades.values()) {
    if (trade.status !== 'PENDING_PRICE') continue;
    const last = prices.get(trade.symbol);
    if (!last) continue;
    const entryRef = Number(last.lastPrice);
    const opened = tryFinalizePendingPrice(trade, entryRef);
    if (opened) {
      broadcast(JSON.stringify({ type: 'trade_open', trade: trade }));
    }
  }
}, 250);

// Background: process limit orders and check for limit fills
setInterval(() => {
  for (const trade of openTrades.values()) {
    if (trade.status !== 'PENDING_LIMIT') continue;
    const last = prices.get(trade.symbol);
    if (!last || typeof trade.limitPrice !== 'number') continue;
    const price = Number(last.lastPrice);
    const shouldFill = trade.side === 'LONG' ? price <= trade.limitPrice : price >= trade.limitPrice;
    if (!shouldFill) continue;
    const entryRef = trade.limitPrice;
    tryFinalizePendingPrice(trade, entryRef);
  }
}, 150);

function computeNotional(equity, leverage, requestedNotional) {
  // Cap based on available free margin and leverage
  const freeMargin = capital.cash - capital.usedMargin;
  const maxNotional = Math.max(0, freeMargin) * leverage;

  // If caller provided a requestedNotional, respect it (subject to maxNotional cap)
  if (typeof requestedNotional === 'number' && requestedNotional > 0) {
    return Math.min(requestedNotional, maxNotional);
  }

  // Otherwise, derive from config sizing options
  const candidates = [];
  if (typeof tradeConfig.amountPerTrade === 'number' && tradeConfig.amountPerTrade > 0) candidates.push(Number(tradeConfig.amountPerTrade));
  if (typeof tradeConfig.riskPerTrade === 'number' && tradeConfig.riskPerTrade > 0) candidates.push(Number(tradeConfig.riskPerTrade));
  if (typeof tradeConfig.positionSizePercent === 'number' && tradeConfig.positionSizePercent > 0) {
    candidates.push(equity * (Number(tradeConfig.positionSizePercent) / 100));
  }
  let notional = candidates.length ? Math.max(...candidates) : 0;
  // Apply minimumTradeAmount only when we are using config-derived sizing
  if (typeof tradeConfig.minimumTradeAmount === 'number' && tradeConfig.minimumTradeAmount > 0) {
    notional = Math.max(notional, Number(tradeConfig.minimumTradeAmount));
  }
  return Math.min(notional, maxNotional);
}

function tryOpenTradeNow({ symbol, side, leverage, tpPct, slPct, entryRef, meta, requestedNotional }) {
  const lev = Number(leverage ?? tradeConfig.leverage ?? 1) || 1;
  const slip = slippagePct();
  const entryPriceAdj = side === 'LONG' ? entryRef * (1 + slip) : entryRef * (1 - slip);
  const notional = computeNotional(capital.equity, lev, requestedNotional);
  if (notional <= 0) return { error: 'Insufficient free margin for requested position.' };
  const usedMargin = notional / lev;
  const entryFee = notional * (TAKER_FEE_PCT / 100);
  // Reserve margin and pay entry fee from cash
  capital.usedMargin += usedMargin;
  capital.cash -= entryFee;
  capital.equity = capital.cash + capital.usedMargin;
  const qty = notional / entryPriceAdj;
  const { tp, sl } = computeTargets(side, entryPriceAdj, tpPct, slPct);
  const id = nextId++;
  const trade = {
    id,
    symbol,
    side,
    leverage: lev,
    entryPrice: Number(entryPriceAdj),
    tp,
    sl,
    tpPct,
    slPct,
    status: 'OPEN',
    openTime: getFormattedTimestamp(),
    openTs: Date.now(),
    meta: meta ?? null,
    orderType: 'market',
    notional,
    qty,
    usedMargin,
  };
  openTrades.set(id, trade);
  const tpStr = (tp === null || tp === undefined) ? '—' : tp.toFixed(2);
  const slStr = (sl === null || sl === undefined) ? '—' : sl.toFixed(2);
  console.log(`[#${id}] OPEN ${side} ${symbol} @ ${trade.entryPrice.toFixed(2)} | TP ${tpStr} | SL ${slStr} | x${trade.leverage} | notional ${notional.toFixed(2)}`);
  broadcastCapitalUpdate();
  return { trade };
}

function tryFinalizePendingPrice(pending, entryRef) {
  const lev = Number(pending.leverage ?? tradeConfig.leverage ?? 1) || 1;
  const slip = slippagePct();
  const entryPriceAdj = pending.side === 'LONG' ? entryRef * (1 + slip) : entryRef * (1 - slip);
  const notional = computeNotional(capital.equity, lev, pending.requestedNotional);
  if (notional <= 0) return false;
  const usedMargin = notional / lev;
  const entryFee = notional * (TAKER_FEE_PCT / 100);
  capital.usedMargin += usedMargin;
  capital.cash -= entryFee;
  capital.equity = capital.cash + capital.usedMargin;
  const qty = notional / entryPriceAdj;
  const { tp, sl } = computeTargets(pending.side, entryPriceAdj, pending.tpPct ?? tradeConfig.takeProfit ?? 1, pending.slPct ?? tradeConfig.stopLoss ?? 0.3);
  pending.entryPrice = Number(entryPriceAdj);
  pending.tp = tp;
  pending.sl = sl;
  pending.status = 'OPEN';
  pending.openTime = getFormattedTimestamp();
  pending.openTs = Date.now();
  pending.notional = notional;
  pending.qty = qty;
  pending.usedMargin = usedMargin;
  const tpStr2 = (tp === null || tp === undefined) ? '—' : tp.toFixed(2);
  const slStr2 = (sl === null || sl === undefined) ? '—' : sl.toFixed(2);
  console.log(`[#${pending.id}] OPEN ${pending.side} ${pending.symbol} @ ${pending.entryPrice.toFixed(2)} | TP ${tpStr2} | SL ${slStr2} | x${pending.leverage} | notional ${notional.toFixed(2)}`);
  broadcastCapitalUpdate();
  return true;
}

const server = app.listen(PORT, () => {
  console.log(`Trade Simulator listening on http://localhost:${PORT}`);
  console.log(`Bybit WS Endpoint: ${WS_ENDPOINT}`);
  console.log(`Local Price Stream available at ws://localhost:${PORT}`);
});

// --- Local WebSocket Server for Price Streaming ---
const wss = new WebSocketServer({ server });

wss.on('connection', ws => {
  console.log('[Local WS] Price stream client connected.');
  // Send current state on connect
  const priceCache = Array.from(prices.entries()).map(([symbol, v]) => ({ symbol, price: v.lastPrice, ts: v.ts }));
  ws.send(JSON.stringify({ type: 'price_cache', prices: priceCache }));

  const currentTrades = Array.from(openTrades.values());
  ws.send(JSON.stringify({ type: 'trade_cache', trades: currentTrades }));
  ws.send(JSON.stringify({ type: 'capital_update', capital }));

  ws.on('close', () => {
    console.log('[Local WS] Price stream client disconnected.');
  });
});

function broadcast(data) {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

function broadcastCapitalUpdate() {
  broadcast(JSON.stringify({ type: 'capital_update', capital }));
}

