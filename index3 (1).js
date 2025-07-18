
// index3.js
import {
  api,
  time as interval,
  symbol,
  minSwingPct,
  shortWindow,
  longWindow,
  confirmOnClose
} from './config.js';

import { getCandles as getBinanceCandles } from './binance.js';
import { getCandles as getBybitCandles } from './bybit.js';
import PivotTracker from './utils/pivotTracker.js';

const getCandles = api === 'binance'
  ? getBinanceCandles
  : getBybitCandles;

// ANSI color codes
const COLOR_RESET = '\x1b[0m';
const COLOR_RED = '\x1b[31m';
const COLOR_GREEN = '\x1b[32m';

// Parse interval string (e.g., "1m", "1h", "1d") to milliseconds
function parseIntervalMs(interval) {
  const match = interval.match(/(\d+)([mhd])/);
  if (!match) return 60000;
  const value = parseInt(match[1], 10);
  const unit = match[2];
  if (unit === 'm') return value * 60 * 1000;
  if (unit === 'h') return value * 60 * 60 * 1000;
  if (unit === 'd') return value * 24 * 60 * 60 * 1000;
  return 60000;
}

// Format milliseconds duration into human-readable string
function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  let parts = [];
  if (days) parts.push(\`\${days}d\`);
  if (hours) parts.push(\`\${hours}h\`);
  if (minutes) parts.push(\`\${minutes}m\`);
  if (seconds || parts.length === 0) parts.push(\`\${seconds}s\`);
  return parts.join(' ');
}

(async () => {
  console.log(`\n▶ Backtesting Pivot Detection on \${symbol} [\${interval}] using \${api}\n`);

  // Fetch historical candles
  const limit = 1000;
  const candles = await getCandles(symbol, interval, limit);
  if (!candles.length) {
    console.error('❌ No candles fetched. Exiting.');
    process.exit(1);
  }

  // Calculate date range and elapsed time
  const startTime = candles[0].time;
  const endTime = candles[candles.length - 1].time;
  const elapsedMs = endTime - startTime;
  const intervalMs = parseIntervalMs(interval);

  console.log(\`Date Range: \${new Date(startTime).toISOString()} → \${new Date(endTime).toISOString()}\`);
  console.log(\`Elapsed Time: \${formatDuration(elapsedMs)}\n\`);

  // Instantiate the pivot tracker
  const tracker = new PivotTracker({ minSwingPct, shortWindow, longWindow, confirmOnClose });

  // Process each candle
  const pivots = [];
  for (const candle of candles) {
    const pivot = tracker.update(candle);
    if (pivot) {
      const movePct = (pivot.movePct * 100).toFixed(2);
      const timeStr = new Date(pivot.time).toISOString();
      const line = \`[PIVOT] \${pivot.type.toUpperCase()} @ \${timeStr} | Price: \${pivot.price.toFixed(2)} | Swing: \${movePct}% | Bars: \${pivot.bars}\`;
      const color = pivot.type === 'high' ? COLOR_GREEN : COLOR_RED;
      console.log(color + line + COLOR_RESET);
      pivots.push(pivot);
    }
  }

  // Print summary stats
  console.log(`\n— Summary —`);
  console.log(`Total Pivots: \${pivots.length}`);
  if (pivots.length) {
    const avgMovePct = pivots.reduce((sum, p) => sum + p.movePct * 100, 0) / pivots.length;
    const avgBars = pivots.reduce((sum, p) => sum + p.bars, 0) / pivots.length;
    const avgTimeMs = avgBars * intervalMs;
    console.log(`Average Swing Size: \${avgMovePct.toFixed(2)}%`);
    console.log(`Average Bars per Swing: \${avgBars.toFixed(2)}`);
    console.log(`Average Time Between Swings: \${formatDuration(avgTimeMs)}`);
  }
  console.log('\n✅ Done.\n');
})();
