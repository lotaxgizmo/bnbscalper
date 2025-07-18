// index3.js
import {
  api,
  time as interval,
  symbol,
  limit,
  minSwingPct,
  shortWindow,
  longWindow,
  confirmOnClose,
  minLegBars
} from './config.js';

import { getCandles as getBinanceCandles } from './binance.js';
import { getCandles as getBybitCandles } from './bybit.js';
import PivotTracker from './utils/pivotTracker.js';

const rawGetCandles = api === 'binance'
  ? getBinanceCandles
  : getBybitCandles;

// ANSI color codes
const COLOR_RESET = '\x1b[0m';
const COLOR_RED   = '\x1b[31m';
const COLOR_GREEN = '\x1b[32m';

// Parse interval (e.g. "1m","1h","1d") to ms
function parseIntervalMs(interval) {
  const m = interval.match(/(\d+)([mhd])/);
  if (!m) return 60_000;
  const v = +m[1], u = m[2];
  if (u === 'm') return v * 60_000;
  if (u === 'h') return v * 3_600_000;
  if (u === 'd') return v * 86_400_000;
  return 60_000;
}

// Pretty‐print ms durations
function formatDuration(ms) {
  const s = Math.floor(ms/1000);
  const d = Math.floor(s/86400), h = Math.floor((s%86400)/3600),
        m = Math.floor((s%3600)/60), sec = s%60;
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (sec || !parts.length) parts.push(`${sec}s`);
  return parts.join(' ');
}

// Format Date to "Day YYYY-MM-DD hh:mm:ss AM/PM"
function formatDateTime(dt) {
  const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const pad = n=>n.toString().padStart(2,'0');
  const dayName = days[dt.getDay()];
  let h = dt.getHours(), ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${dayName} ${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())} ` +
         `${pad(h)}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())} ${ampm}`;
}

// Paginated fetch to respect API limits and ensure we get exactly `limit` candles
async function fetchCandles(symbol, interval, limit) {
  const maxPerBatch = 500; // common API cap
  let all = [];
  let fetchSince = null;

  while (all.length < limit) {
    const batchLimit = Math.min(maxPerBatch, limit - all.length);
    const batch = await rawGetCandles(symbol, interval, batchLimit, fetchSince);
    if (!batch.length) break;

    // ensure ascending
    if (batch[0].time > batch[batch.length-1].time) batch.reverse();

    if (!all.length) {
      all = batch;
    } else {
      // avoid overlap at edges
      const oldestTime = all[0].time;
      const newCandles = batch.filter(c => c.time < oldestTime);
      all = newCandles.concat(all);
    }

    fetchSince = all[0].time - 1; // get earlier candles next
  }

  // trim to exactly `limit`
  return all.slice(-limit);
}

(async () => {
  console.log(`\n▶ Backtesting Pivot Detection on ${symbol} [${interval}] using ${api}\n`);

  // 1. Fetch exactly `limit` candles, back to the correct earliest time
  const candles = await fetchCandles(symbol, interval, limit);
  console.log(`Fetched ${candles.length} candles (limit=${limit}).`);

  if (!candles.length) {
    console.error('❌ No candles fetched. Exiting.');
    process.exit(1);
  }

  // 2. Compute overall range & elapsed time
  const startTime = new Date(candles[0].time);
  const endTime   = new Date(candles[candles.length - 1].time);
  const elapsedMs = endTime - startTime;

  console.log(`Date Range: ${formatDateTime(startTime)} → ${formatDateTime(endTime)}`);
  console.log(`Elapsed Time: ${formatDuration(elapsedMs)}\n`);

  // 3. Instantiate the pivot tracker
  const tracker = new PivotTracker({
    minSwingPct,
    shortWindow,
    longWindow,
    confirmOnClose,
    minLegBars
  });

  // 4. Process candles and collect pivots
  const pivots = [];
  let pivotCounter = 1;
  for (const candle of candles) {
    const pivot = tracker.update(candle);
    if (!pivot) continue;

    const movePct = (pivot.movePct * 100).toFixed(2);
    const timeStr = formatDateTime(new Date(pivot.time));
    const line    = `[PIVOT ${pivotCounter}] ${pivot.type.toUpperCase()} @ ${timeStr} | Price: ${pivot.price.toFixed(2)} | ` +
                    `Swing: ${movePct}% | Bars: ${pivot.bars}`;
    console.log((pivot.type === 'high' ? COLOR_GREEN : COLOR_RED) + line + COLOR_RESET);

    pivots.push({...pivot, number: pivotCounter});
    pivotCounter++;
  }

  // 5. Summary
  console.log(`\n— Summary —`);
  console.log(`Date Range: ${formatDateTime(startTime)} → ${formatDateTime(endTime)}`);
  console.log(`Total Duration: ${formatDuration(elapsedMs)}`);
  console.log(`Total Pivots: ${pivots.length}`);

  if (pivots.length) {
    const avgMovePct = pivots.reduce((sum, p) => sum + p.movePct * 100, 0) / pivots.length;
    const avgBars    = pivots.reduce((sum, p) => sum + p.bars, 0) / pivots.length;
    const avgTime    = formatDuration(avgBars * parseIntervalMs(interval));
    const barsArr    = pivots.map(p => p.bars);
    const highestBars= Math.max(...barsArr);
    const lowestBars = Math.min(...barsArr);
    const countAtOrAbove = pivots.filter(p => p.movePct * 100 >= avgMovePct).length;
    const highestPct     = Math.max(...pivots.map(p => p.movePct * 100));

    console.log(`Average Swing Size: ${avgMovePct.toFixed(2)}%`);
    console.log(`Average Bars per Swing: ${avgBars.toFixed(2)}`);
    console.log(`Average Time Between Swings: ${avgTime}`);
    console.log(`Highest Bars in a Swing: ${highestBars}`);
    console.log(`Lowest Bars in a Swing: ${lowestBars}`);
    console.log(`Swings ≥ Average (${avgMovePct.toFixed(2)}%): ${countAtOrAbove}`);
    console.log(`Highest Swing Size: ${highestPct.toFixed(2)}%`);
  }

  console.log('\n✅ Done.\n');
})();
