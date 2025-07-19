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
  minLegBars,
  delay,
  averageSwingThresholdPct,
  showThresholdTrades
} from '../config/config.js';

import PivotTracker from '../utils/pivotTracker.js';
import { colors, formatDuration } from '../utils/formatters.js';
import { fetchCandles, formatDateTime, parseIntervalMs } from '../utils/candleAnalytics.js';



// Use imported color constants
const { reset: COLOR_RESET, red: COLOR_RED, green: COLOR_GREEN } = colors;





(async () => {
  console.log(`\n▶ Backtesting Pivot Detection on ${symbol} [${interval}] using ${api}\n`);

  // 1. Fetch exactly `limit` candles, back to the correct earliest time
  const candles = await fetchCandles(symbol, interval, limit, api, delay);
  console.log(`Using delay of ${delay} intervals for historical data`);
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
  console.log(`Elapsed Time: ${formatDuration(elapsedMs / (1000 * 60))}\n`);

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
  console.log(`Total Duration: ${formatDuration(elapsedMs / (1000 * 60))}`);
  console.log(`Total Pivots: ${pivots.length}`);

  // Calculate total pivot duration if we have pivots
  // if (pivots.length >= 2) {
  //   const firstPivotTime = new Date(pivots[0].time);
  //   const lastPivotTime = new Date(pivots[pivots.length - 1].time);
  //   const totalPivotDuration = lastPivotTime - firstPivotTime;
  //   console.log(`Total Analysis Duration: ${formatDuration(totalPivotDuration / (1000 * 60))}`);
  // }

  if (pivots.length) {
    const avgMovePct = pivots.reduce((sum, p) => sum + p.movePct * 100, 0) / pivots.length;
    const avgBars    = pivots.reduce((sum, p) => sum + p.bars, 0) / pivots.length;
    const avgTime    = formatDuration((avgBars * parseIntervalMs(interval)) / (1000 * 60));
    
    // Calculate longest time between swings
    let longestSwingTime = 0;
    for (let i = 1; i < pivots.length; i++) {
      const timeBetween = new Date(pivots[i].time) - new Date(pivots[i-1].time);
      longestSwingTime = Math.max(longestSwingTime, timeBetween);
    }
    const barsArr    = pivots.map(p => p.bars);
    const highestBars= Math.max(...barsArr);
    const lowestBars = Math.min(...barsArr);
    const thresholdPct = (avgMovePct * averageSwingThresholdPct) / 100;
    const pivotsAboveThreshold = pivots.filter(p => p.movePct * 100 >= thresholdPct);
    const countAtOrAbove = pivotsAboveThreshold.length;
    
    if (showThresholdTrades && pivotsAboveThreshold.length > 0) {
      console.log('\n— Trades Above Threshold —');
      for (let i = 0; i < pivotsAboveThreshold.length; i++) {
        const p = pivotsAboveThreshold[i];
        const startTime = i > 0 ? pivotsAboveThreshold[i-1].time : candles[0].time;
        const startPrice = i > 0 ? pivotsAboveThreshold[i-1].price : candles[0].close;
        const endTime = formatDateTime(new Date(p.time));
        const startTimeStr = formatDateTime(new Date(startTime));
        const movePct = (p.movePct * 100).toFixed(2);
        const direction = p.type === 'high' ? 'UP' : 'DOWN';
        
        const durationMs = new Date(p.time) - new Date(startTime);
        console.log((p.type === 'high' ? COLOR_GREEN : COLOR_RED) +
          `[PIVOT ${p.number}] ${direction} MOVE` +
          `\n  Start: ${startTimeStr} @ ${startPrice.toFixed(2)}` +
          `\n  End:   ${endTime} @ ${p.price.toFixed(2)}` +
          `\n  Swing: ${movePct}% over ${p.bars} bars` +
          `\n  Duration: ${formatDuration(durationMs)}` +
          COLOR_RESET
        );
      }
      console.log();  // Empty line for spacing
    }
    const highestPct     = Math.max(...pivots.map(p => p.movePct * 100));
    const lowestPct      = Math.min(...pivots.map(p => p.movePct * 100));

    console.log(`Average Swing Size: ${avgMovePct.toFixed(2)}%`);
    console.log(`Average Bars per Swing: ${avgBars.toFixed(2)}`);
    console.log(`Average Time Between Swings: ${avgTime}`);
    console.log(`Longest Time Between Swings: ${formatDuration(longestSwingTime / (1000 * 60))}`);

    console.log(`Highest Bars in a Swing: ${highestBars}`);
    console.log(`Lowest Bars in a Swing: ${lowestBars}`);
    
console.log()
    console.log(`Swings ≥ ${averageSwingThresholdPct}% of Average (${thresholdPct.toFixed(2)}%): ${countAtOrAbove}`);
    const avgPctRate = (countAtOrAbove / pivots.length) * 100;
    console.log(`% above threshold (${thresholdPct.toFixed(2)}%): ${avgPctRate.toFixed(2)}%`);
    
console.log()
    console.log(`Highest Swing Size: ${highestPct.toFixed(2)}%`);
    console.log(`Lowest Swing Size: ${lowestPct.toFixed(2)}%`);
  }

  console.log('\n✅ Done.\n');
})();
