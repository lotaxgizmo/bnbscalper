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
} from './config/config.js';

import { tradeConfig } from './config/tradeconfig.js';
import PivotTracker from './utils/pivotTracker.js';
import { colors, formatDuration } from './utils/formatters.js';
import { fetchCandles, formatDateTime, parseIntervalMs } from './utils/candleAnalytics.js';
import { savePivotData, loadPivotData, clearPivotCache } from './utils/pivotCache.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Use imported color constants
const { reset: COLOR_RESET, red: COLOR_RED, green: COLOR_GREEN, yellow: COLOR_YELLOW, cyan: COLOR_CYAN } = colors;

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

// Configuration for pivot detection
const pivotConfig = {
  minSwingPct,
  shortWindow,
  longWindow,
  confirmOnClose,
  minLegBars
};

(async () => {
  let currentCapital = tradeConfig.initialCapital;

  if (!tradeConfig.performanceMode) {
    console.log(`\n▶ Backtesting ${tradeConfig.direction.toUpperCase()} Strategy on ${symbol} [${interval}] using ${api}\n`);
    console.log('Trade Settings:');
    console.log(`- Direction: ${tradeConfig.direction}`);
    console.log(`- Take Profit: ${tradeConfig.takeProfit}%`);
    console.log(`- Stop Loss: ${tradeConfig.stopLoss}%`);
    console.log(`- Leverage: ${tradeConfig.leverage}x`);
    console.log(`- Maker Fee: ${tradeConfig.totalMakerFee}%`);
    console.log(`- Initial Capital: $${tradeConfig.initialCapital}`);
    console.log(`- Risk Per Trade: ${tradeConfig.riskPerTrade}%`);
    console.log('');
  }

  // Try to load cached pivot data first
  const cachedData = loadPivotData(symbol, interval, pivotConfig);

  let candles, pivots;

  if (cachedData) {
    if (!tradeConfig.performanceMode) console.log('Using cached pivot data...');
    pivots = cachedData.pivots;
    candles = cachedData.metadata.candles || [];
  } else {
    // If no cache, fetch and process data
    if (!tradeConfig.performanceMode) console.log('No cache found, fetching fresh data...');
    candles = await fetchCandles(symbol, interval, limit, api, delay);
    if (!tradeConfig.performanceMode) {
      console.log(`Using delay of ${delay} intervals for historical data`);
      console.log(`Fetched ${candles.length} candles (limit=${limit}).`);
    }

    if (!candles.length) {
      console.error('❌ No candles fetched. Exiting.');
      process.exit(1);
    }

    // Process candles and collect pivots
    const tracker = new PivotTracker(pivotConfig);

    pivots = [];
    for (const candle of candles) {
      const pivot = tracker.update(candle);
      if (pivot) pivots.push(pivot);
    }

    // Save the pivot data for future use
    savePivotData(symbol, interval, pivots, pivotConfig, { candles });
  }

  // 2. Compute overall range & elapsed time
  const startTime = new Date(candles[0].time);
  const endTime   = new Date(candles[candles.length - 1].time);
  const elapsedMs = endTime - startTime;

  
  // 3. Instantiate the pivot tracker
  const tracker = new PivotTracker({
    minSwingPct,
    shortWindow,
    longWindow,
    confirmOnClose,
    minLegBars
  });

  // 4. Process trades using pivot data
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

      // Track max favorable and adverse excursions
      const currentFavorableExcursion = isLong
        ? (candle.high - entry) / entry * 100
        : (entry - candle.low) / entry * 100;
      const currentAdverseExcursion = isLong
        ? (entry - candle.low) / entry * 100
        : (candle.high - entry) / entry * 100;

      activeTrade.maxFavorableExcursion = Math.max(
        activeTrade.maxFavorableExcursion || 0,
        currentFavorableExcursion
      );
      activeTrade.maxAdverseExcursion = Math.max(
        activeTrade.maxAdverseExcursion || 0,
        currentAdverseExcursion
      );

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
          maxFavorableExcursion: activeTrade.maxFavorableExcursion || 0,
          maxAdverseExcursion: activeTrade.maxAdverseExcursion || 0,
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
          if (tradeConfig.showLimits) {
            console.log(`[ORDER] CANCEL BUY LIMIT @ ${activeOrder.price.toFixed(2)} | Current: ${candle.close.toFixed(2)} | Move: ${((candle.close/activeOrder.price - 1)*100).toFixed(2)}%`);
          }
          activeOrder = null;
          continue;
        }
      } else {
        // For sell orders, cancel if price moves down too much
        if (candle.close < activeOrder.price * (1 - cancelThreshold/100)) {
          if (tradeConfig.showLimits) {
            console.log(`[ORDER] CANCEL SELL LIMIT @ ${activeOrder.price.toFixed(2)} | Current: ${candle.close.toFixed(2)} | Move: ${((1 - candle.close/activeOrder.price)*100).toFixed(2)}%`);
          }
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

    // Only show pivot info if showPivot is true
    if (tradeConfig.showPivot) {
      const movePct = (pivot.movePct * 100).toFixed(2);
      const timeStr = formatDateTime(new Date(pivot.time));
      const line    = `[PIVOT ${pivotCounter}] ${pivot.type.toUpperCase()} @ ${timeStr} | Price: ${pivot.price.toFixed(2)} | ` +
                      `Swing: ${movePct}% | Bars: ${pivot.bars}`;
      console.log((pivot.type === 'high' ? COLOR_GREEN : COLOR_RED) + line + COLOR_RESET);
      
      // Only add to pivots array if we're showing pivots
      pivots.push({...pivot, number: pivotCounter});
      pivotCounter++;
    }

    // Place new limit order if conditions met
    // When enterAll is true, we ignore activeOrder and activeTrade checks
    if (tradeConfig.enterAll || (!activeOrder && !activeTrade)) {
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

          if (tradeConfig.showLimits) {
            console.log(COLOR_YELLOW + 
              `[ORDER] ${isLong ? 'BUY' : 'SELL'} LIMIT @ ${limitPrice.toFixed(2)} | ` +
              `Reference: ${pivot.price.toFixed(2)} | Move: ${(avgMove * 100).toFixed(2)}%` +
              COLOR_RESET
            );
          }
        }
      }
    }
  }

 
  if (trades.length) {
    // Show individual trade details if enabled
    if (tradeConfig.showTradeDetails) {
        console.log('\n— Trade Details —');

        trades.forEach((trade, i) => {
          const color = trade.result === 'WIN' ? COLOR_GREEN : COLOR_RED;
          // Calculate raw price movement percentage
          const rawPriceMove = trade.isLong
            ? ((trade.exit - trade.entry) / trade.entry * 100)
            : ((trade.entry - trade.exit) / trade.entry * 100);

          console.log(color +
            `[TRADE ${i+1}] ${trade.isLong ? 'LONG' : 'SHORT'} | ` +
            `Entry: ${trade.entry.toFixed(2)} | ` +
            `Exit: ${trade.exit.toFixed(2)} | ` +
            `Move: ${rawPriceMove.toFixed(2)}% | ` +
            `P&L: ${trade.pnl.toFixed(2)}% | ` +
            `Capital: $${trade.capitalBefore.toFixed(2)} → $${trade.capitalAfter.toFixed(2)} | ` +
            `${trade.result}` +
            COLOR_RESET
          );
          console.log(COLOR_YELLOW +
            `  Max Favorable Excursion: +${trade.maxFavorableExcursion.toFixed(2)}%` +
            `\n  Max Adverse Excursion: -${trade.maxAdverseExcursion.toFixed(2)}%` +
            COLOR_RESET
          );
          console.log(COLOR_CYAN +
            `  Order Time: ${formatDateTime(new Date(trade.orderTime))}` +
            `\n  Entry Time: ${formatDateTime(new Date(trade.entryTime))}` +
            `\n  Exit Time:  ${formatDateTime(new Date(trade.exitTime))}` +
            `\n  Duration:   ${formatDuration((trade.exitTime - trade.entryTime) / (1000 * 60))}` +
            COLOR_RESET
          );
        });

        console.log('\n');
    }

    // Calculate all statistics regardless of display mode
    const wins = trades.filter(t => t.result === 'WIN').length;
    const winRate = (wins / trades.length * 100).toFixed(2);
    const totalPnL = trades.reduce((sum, t) => sum + t.pnl, 0).toFixed(2);
    const avgPnL = (totalPnL / trades.length).toFixed(2);
    const capitalReturn = ((currentCapital/tradeConfig.initialCapital - 1)*100).toFixed(2);

    if (!tradeConfig.performanceMode) {
      console.log(COLOR_YELLOW + '\n— Final Summary —' + COLOR_RESET);
      
      console.log(`Date Range: ${formatDateTime(startTime)} → ${formatDateTime(endTime)}`);
      console.log(`Elapsed Time: ${formatDuration(elapsedMs / (1000 * 60))}`);
      
      console.log('');

      // Calculate total pivot duration if we have pivots
      if (pivots.length >= 2) {
        const firstPivotTime = new Date(pivots[0].time);
        const lastPivotTime = new Date(pivots[pivots.length - 1].time);
        const totalPivotDuration = lastPivotTime - firstPivotTime;
        console.log(`Total Analysis Duration: ${formatDuration(totalPivotDuration / (1000 * 60))}`);
      }
      
      // Calculate total trade duration
      const totalDuration = trades.reduce((sum, t) => {
        const duration = new Date(t.exitTime) - new Date(t.entryTime);
        return sum + duration;
      }, 0);
      console.log(`Total Trade Duration: ${formatDuration(totalDuration / (1000 * 60))}`);
      
      console.log(COLOR_CYAN + `Total Trades: ${trades.length}` + COLOR_RESET);
      console.log('');

      console.log(COLOR_GREEN + `Win Rate: ${winRate}% (${wins}/${trades.length})` + COLOR_RESET);
      console.log(COLOR_RED + `Failed Trades: ${trades.length - wins}` + COLOR_RESET);
      console.log(`Total P&L: ${totalPnL}%`);
      console.log(`Average P&L per Trade: ${avgPnL}%`);

      // Calculate favorable and adverse excursion statistics
      const avgFavorable = trades.reduce((sum, t) => sum + t.maxFavorableExcursion, 0) / trades.length;
      const avgAdverse = trades.reduce((sum, t) => sum + t.maxAdverseExcursion, 0) / trades.length;
      const highestFavorable = Math.max(...trades.map(t => t.maxFavorableExcursion));
      const lowestFavorable = Math.min(...trades.map(t => t.maxFavorableExcursion));
      const highestAdverse = Math.max(...trades.map(t => t.maxAdverseExcursion));
      const lowestAdverse = Math.min(...trades.map(t => t.maxAdverseExcursion));

      console.log(COLOR_GREEN + '\nFavorable Excursion Analysis (Price Movement in Our Favor):' + COLOR_RESET);
      console.log(`  Average Movement: +${avgFavorable.toFixed(2)}%`);
      console.log(`  Highest Movement: +${highestFavorable.toFixed(2)}%`);
      console.log(`  Lowest Movement: +${lowestFavorable.toFixed(2)}%`);

      console.log(COLOR_RED + '\nAdverse Excursion Analysis (Price Movement Against Us):' + COLOR_RESET);
      console.log(`  Average Movement: -${avgAdverse.toFixed(2)}%`);
      console.log(`  Highest Movement: -${highestAdverse.toFixed(2)}%`);
      console.log(`  Lowest Movement: -${lowestAdverse.toFixed(2)}%`);

      console.log('');

      console.log(COLOR_CYAN + `Starting Capital: $${tradeConfig.initialCapital}` + COLOR_RESET);
      console.log(COLOR_CYAN + `Final Capital: $${currentCapital.toFixed(2)}` + COLOR_RESET);
      console.log((capitalReturn >= 0 ? COLOR_GREEN : COLOR_RED) + `Total Return: ${capitalReturn}%` + COLOR_RESET);
    }

    // Calculate additional statistics
    const winningTrades = trades.filter(t => t.result === 'WIN');
    const avgDuration = Math.round(trades.reduce((sum, t) => sum + (t.exitTime - t.entryTime)/(1000*60), 0) / trades.length);
    const bestTrade = Math.max(...trades.map(t => t.pnl));
    const worstTrade = Math.min(...trades.map(t => t.pnl));

    // Calculate Sharpe Ratio (simplified)
    const returns = trades.map(t => t.pnl);
    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const stdDev = Math.sqrt(returns.map(r => Math.pow(r - avgReturn, 2)).reduce((a, b) => a + b, 0) / returns.length);
    const sharpeRatio = (avgReturn / stdDev).toFixed(2);

    // Calculate max drawdown
    let peak = tradeConfig.initialCapital;
    let maxDrawdown = 0;
    trades.forEach(trade => {
        if (trade.capitalAfter > peak) peak = trade.capitalAfter;
        const drawdown = (peak - trade.capitalAfter) / peak * 100;
        if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    });

    // Prepare chart data
    const chartData = {
        trades: trades.map(t => ({
            entry: t.entry,
            exit: t.exit,
            entryTime: t.entryTime,
            exitTime: t.exitTime,
            pnl: t.pnl,
            isLong: t.isLong,
            result: t.result
        })),
        candles: candles.map(c => ({
            time: c.time,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close
        })),
        capital: trades.map(t => ({
            time: t.exitTime,
            value: t.capitalAfter
        })),
        stats: {
            takeProfit: tradeConfig.takeProfit,
            stopLoss: tradeConfig.stopLoss,
            totalTrades: trades.length,
            winRate: (winningTrades.length / trades.length * 100).toFixed(2),
            avgDuration: `${avgDuration} minutes`,
            bestTrade: bestTrade.toFixed(2),
            worstTrade: worstTrade.toFixed(2),
            startingCapital: tradeConfig.initialCapital.toFixed(2),
            finalCapital: currentCapital.toFixed(2),
            totalReturn: ((currentCapital/tradeConfig.initialCapital - 1)*100).toFixed(2),
            maxDrawdown: maxDrawdown.toFixed(2),
            sharpeRatio
        }
    };

    // Only save files if enabled in config
    if (tradeConfig.saveToFile) {
        // Create charts directory if it doesn't exist
        const dataDir = path.join(__dirname, 'data');
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        // Calculate excursion statistics
        const avgFavorable = trades.reduce((sum, t) => sum + t.maxFavorableExcursion, 0) / trades.length;
        const highestFavorable = Math.max(...trades.map(t => t.maxFavorableExcursion));
        const lowestFavorable = Math.min(...trades.map(t => t.maxFavorableExcursion));
        
        const avgAdverse = trades.reduce((sum, t) => sum + t.maxAdverseExcursion, 0) / trades.length;
        const highestAdverse = Math.max(...trades.map(t => t.maxAdverseExcursion));
        const lowestAdverse = Math.min(...trades.map(t => t.maxAdverseExcursion));

        // Write chart data to JSON file
        const jsonPath = path.join(dataDir, 'backtest_data.json');
        fs.writeFileSync(jsonPath, JSON.stringify(chartData, null, 2));
        console.log('\nBacktest data saved to: data/backtest_data.json');

        // Write summary to CSV
        const csvPath = path.join(dataDir, 'backtest_summary.csv');
        const csvHeader = 'take_profit,stop_loss,total_trades,win_rate,failed_trades,total_pnl,avg_pnl,avg_favorable_excursion,highest_favorable,lowest_favorable,avg_adverse_excursion,highest_adverse,lowest_adverse,final_capital,total_return\n';
        const csvData = `${tradeConfig.takeProfit},${tradeConfig.stopLoss},${trades.length},${winRate},${trades.length - wins},${totalPnL},${avgPnL},${avgFavorable.toFixed(2)},${highestFavorable.toFixed(2)},${lowestFavorable.toFixed(2)},${avgAdverse.toFixed(2)},${highestAdverse.toFixed(2)},${lowestAdverse.toFixed(2)},${currentCapital.toFixed(2)},${capitalReturn}\n`;
        
        fs.writeFileSync(csvPath, csvHeader + csvData);
        console.log('Summary data saved to: data/backtest_summary.csv');
    }

    console.log('');
    if (tradeConfig.performanceMode) {
      console.log('Done');
    } else {
      console.log('✅ Done.');
    }
  }
})();
