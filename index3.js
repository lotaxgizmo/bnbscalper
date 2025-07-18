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

const getCandles = api === 'binance'
  ? getBinanceCandles
  : getBybitCandles;

// ANSI color codes
const COLOR_RESET = '\x1b[0m';
const COLOR_RED   = '\x1b[31m';
const COLOR_GREEN = '\x1b[32m';

// Parse interval string (e.g., "1m", "1h", "1d") to milliseconds
function parseIntervalMs(interval) {
  const match = interval.match(/(\d+)([mhd])/);
  if (!match) return 60 * 1000;
  const [_, val, unit] = match;
  const v = parseInt(val, 10);
  if (unit === 'm') return v * 60 * 1000;
  if (unit === 'h') return v * 60 * 60 * 1000;
  if (unit === 'd') return v * 24 * 60 * 60 * 1000;
  return 60 * 1000;
}

// Format milliseconds duration into human-readable string
function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const days    = Math.floor(seconds / 86400);
  const hours   = Math.floor((seconds % 86400) / 3600);
  const mins    = Math.floor((seconds % 3600) / 60);
  const secs    = seconds % 60;
  const parts = [];
  if (days)   parts.push(`${days}d`);
  if (hours)  parts.push(`${hours}h`);
  if (mins)   parts.push(`${mins}m`);
  if (secs || parts.length === 0) parts.push(`${secs}s`);
  return parts.join(' ');
}

// Format a Date into "Day YYYY-MM-DD hh:mm:ss AM/PM"
function formatDateTime(date) {
  const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const pad  = n => n.toString().padStart(2,'0');
  const dayName = days[date.getDay()];
  const year  = date.getFullYear();
  const month = pad(date.getMonth()+1);
  const day   = pad(date.getDate());
  let   hour  = date.getHours();
  const minute = pad(date.getMinutes());
  const second = pad(date.getSeconds());
  const ampm   = hour >= 12 ? 'PM' : 'AM';
  hour = hour % 12 || 12;
  const hourStr = pad(hour);
  return `${dayName} ${year}-${month}-${day} ${hourStr}:${minute}:${second} ${ampm}`;
}

(async () => {
  console.log(`\n▶ Backtesting Pivot Detection on ${symbol} [${interval}] using ${api}\n`);

  // 1. Fetch historical candles using config.limit
  const candles = await getCandles(symbol, interval, limit);
  if (!candles.length) {
    console.error('❌ No candles fetched. Exiting.');
    process.exit(1);
  }

  // 2. Compute range & elapsed time
  const startTime = new Date(candles[0].time);
  const endTime   = new Date(candles[candles.length - 1].time);
  const elapsedMs = endTime - startTime;
  const intervalMs = parseIntervalMs(interval);

  console.log(`Date Range: ${formatDateTime(startTime)} → ${formatDateTime(endTime)}`);
  console.log(`Elapsed Time: ${formatDuration(elapsedMs)}\n`);

  // 3. Instantiate tracker
  const tracker = new PivotTracker({
    minSwingPct,
    shortWindow,
    longWindow,
    confirmOnClose,
    minLegBars
  });

  // 4. Process candles and collect pivots
  const pivots = [];
  for (const candle of candles) {
    const pivot = tracker.update(candle);
    if (pivot) {
      const movePct = (pivot.movePct * 100).toFixed(2);
      const timeStr = formatDateTime(new Date(pivot.time));
      const line = `[PIVOT] ${pivot.type.toUpperCase()} @ ${timeStr} | Price: ${pivot.price.toFixed(2)} | Swing: ${movePct}% | Bars: ${pivot.bars}`;
      console.log((pivot.type === 'high' ? COLOR_GREEN : COLOR_RED) + line + COLOR_RESET);
      pivots.push(pivot);
    }
  }

  // 5. Summary with highest/lowest bars and additional stats
  console.log(`\n— Summary —`);
  console.log(`Date Range: ${formatDateTime(startTime)} → ${formatDateTime(endTime)}`);
  console.log(`Total Duration: ${formatDuration(elapsedMs)}`);
  console.log(`Total Pivots: ${pivots.length}`);

  if (pivots.length) {
    const avgMovePct = pivots.reduce((s, p) => s + p.movePct * 100, 0) / pivots.length;
    const avgBars    = pivots.reduce((s, p) => s + p.bars, 0) / pivots.length;
    const avgTime    = formatDuration(avgBars * intervalMs);
    const barsArr    = pivots.map(p => p.bars);
    const highestBars = Math.max(...barsArr);
    const lowestBars  = Math.min(...barsArr);

    // Count how many swings hit or exceeded the average swing size
    const countAtOrAboveAvg = pivots.filter(p => p.movePct * 100 >= avgMovePct).length;
    // Highest percentage swing
    const highestPct = Math.max(...pivots.map(p => p.movePct * 100));

    console.log(`Average Swing Size: ${avgMovePct.toFixed(2)}%`);
    console.log(`Average Bars per Swing: ${avgBars.toFixed(2)}`);
    console.log(`Average Time Between Swings: ${avgTime}`);
    console.log(`Highest Bars in a Swing: ${highestBars}`);
    console.log(`Lowest Bars in a Swing: ${lowestBars}`);
    console.log(`Swings ≥ Average (${avgMovePct.toFixed(2)}%): ${countAtOrAboveAvg}`);
    console.log(`Highest Swing Size: ${highestPct.toFixed(2)}%`);
  }

  console.log('\n✅ Done.\n');
})();
