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

  console.log('');

  // Try to load cached pivot data first
  const cachedData = loadPivotData(symbol, interval, pivotConfig);

  let candles, pivots;

  if (cachedData) {
    console.log('Using cached pivot data...');
    pivots = cachedData.pivots;
    candles = cachedData.metadata.candles || [];
  } else {
    // If no cache, fetch and process data
    console.log('No cache found, fetching fresh data...');
    candles = await fetchCandles(symbol, interval, limit, api, delay);
    console.log(`Using delay of ${delay} intervals for historical data`);
    console.log(`Fetched ${candles.length} candles (limit=${limit}).`);

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

 
  console.log('\n— Trade Details —');

  if (trades.length) {
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
    
    // 5. Summary 

    console.log('\n— Final Summary —');
    
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
  console.log(`Total Trades: ${trades.length}`);
  
    
    // Calculate total trade duration
    const totalDuration = trades.reduce((sum, t) => {
      const duration = new Date(t.exitTime) - new Date(t.entryTime);
      return sum + duration;
    }, 0);
    console.log(`Total Trade Duration: ${formatDuration(totalDuration / (1000 * 60))}`);

    const wins = trades.filter(t => t.result === 'WIN').length;
    const winRate = (wins / trades.length * 100).toFixed(2);
    const totalPnL = trades.reduce((sum, t) => sum + t.pnl, 0).toFixed(2);
    const avgPnL = (totalPnL / trades.length).toFixed(2);

    console.log('');

    console.log(`Win Rate: ${winRate}% (${wins}/${trades.length})`);
    console.log(`Failed Trades: ${trades.length - wins}`);
    console.log(`Total P&L: ${totalPnL}%`);
    console.log(`Average P&L per Trade: ${avgPnL}%`);

    // Calculate favorable and adverse excursion statistics
    const avgFavorable = trades.reduce((sum, t) => sum + t.maxFavorableExcursion, 0) / trades.length;
    const avgAdverse = trades.reduce((sum, t) => sum + t.maxAdverseExcursion, 0) / trades.length;
    const highestFavorable = Math.max(...trades.map(t => t.maxFavorableExcursion));
    const lowestFavorable = Math.min(...trades.map(t => t.maxFavorableExcursion));
    const highestAdverse = Math.max(...trades.map(t => t.maxAdverseExcursion));
    const lowestAdverse = Math.min(...trades.map(t => t.maxAdverseExcursion));

    console.log('\nFavorable Excursion Analysis (Price Movement in Our Favor):');
    console.log(`  Average Movement: +${avgFavorable.toFixed(2)}%`);
    console.log(`  Highest Movement: +${highestFavorable.toFixed(2)}%`);
    console.log(`  Lowest Movement: +${lowestFavorable.toFixed(2)}%`);

    console.log('\nAdverse Excursion Analysis (Price Movement Against Us):');
    console.log(`  Average Movement: -${avgAdverse.toFixed(2)}%`);
    console.log(`  Highest Movement: -${highestAdverse.toFixed(2)}%`);
    console.log(`  Lowest Movement: -${lowestAdverse.toFixed(2)}%`);

    console.log('');

    console.log(`Starting Capital: $${tradeConfig.initialCapital}`);
    console.log(`Final Capital: $${currentCapital.toFixed(2)}`);
    console.log(`Total Return: ${((currentCapital/tradeConfig.initialCapital - 1)*100).toFixed(2)}%`);

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

    // Write chart data to file
    const chartDir = path.join(__dirname, 'charts');
    const chartPath = path.join(chartDir, 'backtest_chart.html');

    const chartHtml = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>Backtest Results Chart</title>
        <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
        <script src="https://cdn.jsdelivr.net/npm/chartjs-plugin-annotation"></script>
    </head>
    <body style="background-color: #1a1a1a; color: #ffffff;">
        <div style="width: 90%; margin: 20px auto; background-color: #2d2d2d; padding: 20px; border-radius: 10px;">
            <canvas id="priceChart"></canvas>
        </div>
        <div style="width: 90%; margin: 20px auto; background-color: #2d2d2d; padding: 20px; border-radius: 10px;">
            <canvas id="capitalChart"></canvas>
        </div>
        <div style="display: flex; flex-wrap: wrap; gap: 20px; margin: 20px auto; width: 90%;">
            <div style="background-color: #2d2d2d; padding: 15px; border-radius: 5px; flex: 1; min-width: 200px;">
                <h3>Trade Statistics</h3>
                <div id="tradeStats"></div>
            </div>
            <div style="background-color: #2d2d2d; padding: 15px; border-radius: 5px; flex: 1; min-width: 200px;">
                <h3>Performance Metrics</h3>
                <div id="performanceStats"></div>
            </div>
        </div>

        <script>
            const trades = ${JSON.stringify(chartData.trades)};
            const candles = ${JSON.stringify(chartData.candles)};
            const capital = ${JSON.stringify(chartData.capital)};
            const stats = ${JSON.stringify(chartData.stats)};

            // Price chart with trades
            const priceCtx = document.getElementById('priceChart').getContext('2d');
            new Chart(priceCtx, {
                type: 'line',
                data: {
                    labels: candles.map(c => new Date(c.time).toLocaleString()),
                    datasets: [{
                        label: 'Price',
                        data: candles.map(c => c.close),
                        borderColor: '#4CAF50',
                        borderWidth: 1,
                        fill: false
                    }, {
                        label: 'Entry Points',
                        data: trades.map(t => ({
                            x: new Date(t.entryTime).toLocaleString(),
                            y: t.entry
                        })),
                        backgroundColor: trades.map(t => t.isLong ? '#4CAF50' : '#f44336'),
                        pointRadius: 5,
                        type: 'scatter'
                    }]
                },
                options: {
                    responsive: true,
                    plugins: {
                        title: {
                            display: true,
                            text: 'Price Action & Trade Entries',
                            color: '#ffffff'
                        },
                        legend: {
                            labels: {
                                color: '#ffffff'
                            }
                        }
                    },
                    scales: {
                        x: {
                            ticks: { color: '#ffffff' },
                            grid: { color: '#404040' }
                        },
                        y: {
                            ticks: { color: '#ffffff' },
                            grid: { color: '#404040' }
                        }
                    }
                }
            });

            // Capital chart
            const capitalCtx = document.getElementById('capitalChart').getContext('2d');
            new Chart(capitalCtx, {
                type: 'line',
                data: {
                    labels: capital.map(c => new Date(c.time).toLocaleString()),
                    datasets: [{
                        label: 'Account Balance',
                        data: capital.map(c => c.value),
                        borderColor: '#2196F3',
                        borderWidth: 2,
                        fill: false
                    }]
                },
                options: {
                    responsive: true,
                    plugins: {
                        title: {
                            display: true,
                            text: 'Capital Growth',
                            color: '#ffffff'
                        },
                        legend: {
                            labels: {
                                color: '#ffffff'
                            }
                        }
                    },
                    scales: {
                        x: {
                            ticks: { color: '#ffffff' },
                            grid: { color: '#404040' }
                        },
                        y: {
                            ticks: { color: '#ffffff' },
                            grid: { color: '#404040' }
                        }
                    }
                }
            });

            // Update statistics
            const tradeStats = document.getElementById('tradeStats');
            const performanceStats = document.getElementById('performanceStats');
            
            tradeStats.innerHTML = 
                '<p>Total Trades: ' + stats.totalTrades + '</p>' +
                '<p>Win Rate: <span style="color: #4CAF50">' + stats.winRate + '%</span></p>' +
                '<p>Average Trade Duration: ' + stats.avgDuration + '</p>' +
                '<p>Best Trade: <span style="color: #4CAF50">+' + stats.bestTrade + '%</span></p>' +
                '<p>Worst Trade: <span style="color: #f44336">' + stats.worstTrade + '%</span></p>';

            performanceStats.innerHTML = 
                '<p>Starting Capital: $' + stats.startingCapital + '</p>' +
                '<p>Final Capital: $' + stats.finalCapital + '</p>' +
                '<p>Total Return: ' + stats.totalReturn + '%</p>' +
                '<p>Max Drawdown: ' + stats.maxDrawdown + '%</p>' +
                '<p>Sharpe Ratio: ' + stats.sharpeRatio + '</p>';
        </script>
    </body>
    </html>`;

    fs.writeFileSync(chartPath, chartHtml);
    console.log('\nChart generated at: charts/backtest_chart.html');

    console.log('');
    console.log('✅ Done.');
  }
})();
