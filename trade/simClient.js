// simClient.js - helper client to open simulated trades without curl
import axios from 'axios';

const BASE = process.env.SIM_BASE_URL || 'http://localhost:3100';

export async function openMarketTrade({ symbol = 'BTCUSDT', side = 'LONG', tpPct = 1, slPct = 0.3, leverage = 1, notional, meta }) {
  const res = await axios.post(`${BASE}/webhook`, {
    symbol,
    side,
    tpPct,
    slPct,
    leverage,
    notional,
    meta,
    orderType: 'market',
  }, { timeout: 10000 });
  return res.data;
}

export async function openLimitTrade({ symbol = 'BTCUSDT', side = 'LONG', tpPct = 1, slPct = 0.3, leverage = 1, limitPrice, notional, meta }) {
  if (typeof limitPrice !== 'number') throw new Error('limitPrice is required for limit orders');
  const res = await axios.post(`${BASE}/webhook`, {
    symbol,
    side,
    tpPct,
    slPct,
    leverage,
    limitPrice,
    notional,
    meta,
    orderType: 'limit',
  }, { timeout: 10000 });
  return res.data;
}

export async function getCapital() {
  const res = await axios.get(`${BASE}/capital`, { timeout: 10000 });
  return res.data;
}

export async function getStatus() {
  const res = await axios.get(`${BASE}/status`, { timeout: 10000 });
  return res.data;
}

export async function getTrades() {
  const res = await axios.get(`${BASE}/trades`, { timeout: 10000 });
  return res.data;
}

export async function closeTrade(id) {
  const res = await axios.post(`${BASE}/trades/${id}/close`, {}, { timeout: 10000 });
  return res.data;
}

export async function cancelTrade(id) {
  const res = await axios.post(`${BASE}/trades/${id}/cancel`, {}, { timeout: 10000 });
  return res.data;
}

// If run directly: small demo
if (import.meta.main) {
  (async () => {
    try {
      console.log('Opening market LONG...');
      const r1 = await openMarketTrade({ symbol: 'BTCUSDT', side: 'LONG', tpPct: 1, slPct: 0.3, leverage: 5, notional: 100 });
      console.log('Result:', r1);

      setTimeout(async () => {
        const cap = await getCapital();
        const t = await getTrades();
        console.log('Capital:', cap);
        console.log('Trades:', t);
        // If there's an OPEN trade, demonstrate force close
        const open = t.open?.[0];
        if (open?.id) {
          console.log('Force closing id', open.id);
          const closed = await closeTrade(open.id);
          console.log('Closed:', closed);
        }
      }, 2000);
    } catch (e) {
      console.error('simClient demo error:', e.message);
    }
  })();
}
