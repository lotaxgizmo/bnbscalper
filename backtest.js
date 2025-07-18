// backtest.js
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
  delay
} from './config.js';

import { tradeConfig } from './tradeconfig.js';
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
const COLOR_YELLOW = '\x1b[33m';
const COLOR_CYAN = '\x1b[36m';

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

// Calculate P&L with leverage and fees
function calculatePnL(entryPrice, exitPrice, isLong) {
  const { leverage, totalMakerFee } = tradeConfig;
  const rawPnL = isLong 
    ? (exitPrice - entryPrice) / entryPrice * 100
    : (entryPrice - exitPrice) / entryPrice * 100;
  
  // Subtract fees from raw P&L before applying leverage
  const pnlAfterFees = rawPnL - totalMakerFee;
  return pnlAfterFees * leverage;
}

// Paginated fetch to respect API limits and ensure we get exactly `limit` candles
async function fetchCandles(symbol, interval, limit) {
  const maxPerBatch = 500; // common API cap
  let all = [];
  let fetchSince = null;
  
  // Apply delay if configured
  if (delay > 0) {
    const intervalMs = parseIntervalMs(interval);
    fetchSince = Date.now() - (delay * intervalMs);
  }

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
  console.log(`\n▶ Backtesting ${tradeConfig.direction.toUpperCase()} Strategy on ${symbol} [${interval}] using ${api}\n`);
  let currentCapital = tradeConfig.initialCapital;

  console.log('Trade Settings:');
  console.log(`- Direction: ${tradeConfig.direction}`);
  console.log(`- Take Profit: ${tradeConfig.takeProfit}%`);
  console.log(`- Stop Loss: ${tradeConfig.stopLoss}%`);
  console.log(`- Leverage: ${tradeConfig.leverage}x`);
  console.log(`- Maker Fee: ${tradeConfig.totalMakerFee}%`);
  console.log(`- Initial Capital: $${tradeConfig.initialCapital}`);
  console.log(`- Risk Per Trade: ${tradeConfig.riskPerTrade}%`);

  // 1. Fetch exactly `limit` candles
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
  const trades = [];
  let activeOrder = null;
  let activeTrade = null;
  let pivotCounter = 1;

  for (const candle of candles) {
    const pivot = tracker.update(candle);
    
    // Handle active trade if exists
    if (activeTrade) {
      const { entry, isLong } = activeTrade;
      const hitTakeProfit = isLong 
        ? candle.high >= entry * (1 + tradeConfig.takeProfit/100)
        : candle.low <= entry * (1 - tradeConfig.takeProfit/100);
      const hitStopLoss = isLong
        ? candle.low <= entry * (1 - tradeConfig.stopLoss/100)
        : candle.high >= entry * (1 + tradeConfig.stopLoss/100);

      if (hitTakeProfit || hitStopLoss) {
        const exitPrice = hitTakeProfit
          ? entry * (1 + (isLong ? 1 : -1) * tradeConfig.takeProfit/100)
          : entry * (1 + (isLong ? -1 : 1) * tradeConfig.stopLoss/100);
        const pnl = calculatePnL(entry, exitPrice, isLong);
        
        // Calculate capital change
        const capitalChange = currentCapital * (pnl / 100);
        currentCapital += capitalChange;

        trades.push({
          ...activeTrade,
          exit: exitPrice,
          exitTime: candle.time,
          pnl,
          capitalBefore: currentCapital - capitalChange,
          capitalAfter: currentCapital,
          result: hitTakeProfit ? 'WIN' : 'LOSS'
        });

        activeTrade = null;
        activeOrder = null;  // Reset order flag too
      }
    }

    // Handle limit order if exists
    if (activeOrder && !activeTrade) {
      // Cancel order if price moves too far in opposite direction
      const avgSwing = tracker.getAverageSwing();
      const cancelThreshold = avgSwing * (tradeConfig.cancelThresholdPct / 100);
      
      if (avgSwing === 0) continue; // Skip if no average swing data yet
      
      if (activeOrder.isLong) {
        // For buy orders, cancel if price moves up too much
        if (candle.close > activeOrder.price * (1 + cancelThreshold/100)) {
          console.log(`[ORDER] CANCEL BUY LIMIT @ ${activeOrder.price.toFixed(2)} | Current: ${candle.close.toFixed(2)} | Move: ${((candle.close/activeOrder.price - 1)*100).toFixed(2)}%`);
          activeOrder = null;
          continue;
        }
      } else {
        // For sell orders, cancel if price moves down too much
        if (candle.close < activeOrder.price * (1 - cancelThreshold/100)) {
          console.log(`[ORDER] CANCEL SELL LIMIT @ ${activeOrder.price.toFixed(2)} | Current: ${candle.close.toFixed(2)} | Move: ${((1 - candle.close/activeOrder.price)*100).toFixed(2)}%`);
          activeOrder = null;
          continue;
        }
      }

      const { price, isLong } = activeOrder;
      const filled = isLong 
        ? candle.low <= price
        : candle.high >= price;

      if (filled) {
        activeTrade = {
          entry: price,
          entryTime: candle.time,
          isLong,
          orderTime: activeOrder.time
        };
        activeOrder = null;
      }
    }

    if (!pivot) continue;

    const movePct = (pivot.movePct * 100).toFixed(2);
    const timeStr = formatDateTime(new Date(pivot.time));
    const line    = `[PIVOT ${pivotCounter}] ${pivot.type.toUpperCase()} @ ${timeStr} | Price: ${pivot.price.toFixed(2)} | ` +
                    `Swing: ${movePct}% | Bars: ${pivot.bars}`;
    console.log((pivot.type === 'high' ? COLOR_GREEN : COLOR_RED) + line + COLOR_RESET);

    // Place new limit order if conditions met
    if (!activeOrder && !activeTrade) {
      // For buy strategy: look for high pivot to place limit below for pullback
      // For sell strategy: look for low pivot to place limit above for pullback
      const isBuySetup = tradeConfig.direction === 'buy' && pivot.type === 'high';
      const isSellSetup = tradeConfig.direction === 'sell' && pivot.type === 'low';
      
      if (isBuySetup || isSellSetup) {
        const avgMove = tracker.avgShort;
        
        if (avgMove > 0) {
          const isLong = tradeConfig.direction === 'buy';
          const limitPrice = isLong
            ? pivot.price * (1 - avgMove * tradeConfig.orderDistancePct/100)  // Place buy orders at configured distance
            : pivot.price * (1 + avgMove * tradeConfig.orderDistancePct/100); // Place sell orders at configured distance
            
          activeOrder = {
            price: limitPrice,
            time: pivot.time,
            isLong,
            pivotPrice: pivot.price
          };

          console.log(COLOR_YELLOW + 
            `[ORDER] ${isLong ? 'BUY' : 'SELL'} LIMIT @ ${limitPrice.toFixed(2)} | ` +
            `Reference: ${pivot.price.toFixed(2)} | Move: ${(avgMove * 100).toFixed(2)}%` +
            COLOR_RESET
          );
        }
      }
    }

    pivots.push({...pivot, number: pivotCounter});
    pivotCounter++;
  }

  // 5. Summary
  console.log(`\n— Trade Summary —`);
  console.log(`Total Trades: ${trades.length}`);
  
  // Calculate total trade duration
  const totalDuration = trades.reduce((sum, t) => {
    const duration = new Date(t.exitTime) - new Date(t.entryTime);
    return sum + duration;
  }, 0);
  console.log(`Total Trade Duration: ${formatDuration(totalDuration)}`);
  
  if (trades.length) {
    const wins = trades.filter(t => t.result === 'WIN').length;
    const winRate = (wins / trades.length * 100).toFixed(2);
    const totalPnL = trades.reduce((sum, t) => sum + t.pnl, 0).toFixed(2);
    const avgPnL = (totalPnL / trades.length).toFixed(2);

    console.log(`Win Rate: ${winRate}% (${wins}/${trades.length})`);
    console.log(`Total P&L: ${totalPnL}%`);
    console.log(`Average P&L per Trade: ${avgPnL}%`);
    console.log(`Starting Capital: $${tradeConfig.initialCapital}`);
    console.log(`Final Capital: $${currentCapital.toFixed(2)}`);
    console.log(`Total Return: ${((currentCapital / tradeConfig.initialCapital - 1) * 100).toFixed(2)}%`);

    console.log('\n— Trade Details —');
    trades.forEach((trade, i) => {
      const color = trade.result === 'WIN' ? COLOR_GREEN : COLOR_RED;
      console.log(color +
        `[TRADE ${i+1}] ${trade.isLong ? 'LONG' : 'SHORT'} | ` +
        `Entry: ${trade.entry.toFixed(2)} | ` +
        `Exit: ${trade.exit.toFixed(2)} | ` +
        `P&L: ${trade.pnl.toFixed(2)}% | ` +
        `Capital: $${trade.capitalBefore.toFixed(2)} → $${trade.capitalAfter.toFixed(2)} | ` +
        `${trade.result}` +
        COLOR_RESET
      );
      console.log(COLOR_CYAN +
        `  Order Time: ${formatDateTime(new Date(trade.orderTime))}` +
        `\n  Entry Time: ${formatDateTime(new Date(trade.entryTime))}` +
        `\n  Exit Time:  ${formatDateTime(new Date(trade.exitTime))}` +
        `\n  Duration:   ${formatDuration(trade.exitTime - trade.entryTime)}` +
        COLOR_RESET
      );
    });
  }

  console.log('\n✅ Done.\n');
})();
