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
import { colors, formatDuration } from './utils/formatters.js';
import { fetchCandles, formatDateTime } from './utils/candleAnalytics.js';
import { savePivotData, loadPivotData } from './utils/pivotCache.js';
import { BacktestEngine } from './utils/backtestEngine.js';
import { BacktestStats } from './utils/backtestStats.js';
import { BacktestExporter } from './utils/backtestExporter.js';

// Use imported color constants
const { reset: COLOR_RESET, red: COLOR_RED, green: COLOR_GREEN, yellow: COLOR_YELLOW, cyan: COLOR_CYAN } = colors;

// Configuration for pivot detection
const pivotConfig = {
  minSwingPct,
  shortWindow,
  longWindow,
  confirmOnClose,
  minLegBars
};

(async () => {
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

  let candles;
  if (cachedData) {
    if (!tradeConfig.performanceMode) console.log('Using cached pivot data...');
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

    // Save the candle data for future use
    savePivotData(symbol, interval, [], pivotConfig, { candles });
  }

  // Initialize components
  const engine = new BacktestEngine(pivotConfig, tradeConfig);
  const exporter = new BacktestExporter({
    saveJson: tradeConfig.saveToFile,
    saveCsv: tradeConfig.saveToFile
  });

  // Run backtest
  const results = await engine.runBacktest(candles);
  
  // Calculate statistics
  const stats = new BacktestStats(results.trades, tradeConfig);
  const statistics = stats.calculate();

 
  if (results.trades.length) {
    // Show individual trade details if enabled
    if (tradeConfig.showTradeDetails) {
      console.log('\n— Trade Details —');

      // Display individual trades
      results.trades.forEach((trade, i) => {
        // Add spacing before each trade
        console.log('\n' + '-'.repeat(80));

        const color = trade.result === 'WIN' ? COLOR_GREEN : COLOR_RED;
        const rawPriceMove = trade.isLong
          ? ((trade.exit - trade.entry) / trade.entry * 100)
          : ((trade.entry - trade.exit) / trade.entry * 100);

        // Trade header with direction and result
        console.log(color + `[TRADE ${i+1}] ${trade.isLong ? 'LONG' : 'SHORT'} | ` +
          `Entry: ${trade.entry.toFixed(2)} | ` +
          `Exit: ${trade.exit.toFixed(2)} | ` +
          `Move: ${rawPriceMove.toFixed(2)}% | ` +
          `P&L: ${trade.pnl.toFixed(2)}% | ` +
          `Capital: $${trade.capitalBefore.toFixed(2)} → $${trade.capitalAfter.toFixed(2)} | ` +
          `${trade.result}` + COLOR_RESET
        );

        // Excursion analysis
        console.log(COLOR_YELLOW +
          `  Max Favorable: +${trade.maxFavorableExcursion.toFixed(2)}%\n` +
          `  Max Adverse:   -${trade.maxAdverseExcursion.toFixed(2)}%` +
          COLOR_RESET
        );

        // Timing details
        console.log(COLOR_CYAN +
          `  Order Time: ${formatDateTime(trade.orderTime)}\n` +
          `  Entry Time: ${formatDateTime(trade.entryTime)}\n` +
          `  Exit Time:  ${formatDateTime(trade.exitTime)}\n` +
          `  Duration:   ${formatDuration(Math.floor((trade.exitTime - trade.entryTime) / (60 * 1000)))}` +
          COLOR_RESET
        );
        console.log('-'.repeat(80));
      });

      console.log('\n');
    }

    // Display results if not in performance mode
    if (!tradeConfig.performanceMode) {
      console.log('\n' + '-'.repeat(42));
      console.log(COLOR_YELLOW + '— Final Summary —' + COLOR_RESET);
      
      // Calculate date range
      const firstTrade = results.trades[0];
      const lastTrade = results.trades[results.trades.length - 1];
      
      // Calculate elapsed minutes from milliseconds
      const elapsedMinutes = Math.floor((lastTrade.exitTime - firstTrade.orderTime) / (60 * 1000));
      
      // Create Date objects from timestamps (already in milliseconds)
      const startTime = new Date(firstTrade.orderTime);
      const endTime = new Date(lastTrade.exitTime);
      
      console.log(`
Date Range:
${formatDateTime(startTime)} → ${formatDateTime(endTime)}`);
      console.log(`
Elapsed Time: ${formatDuration(elapsedMinutes)}`);
      console.log('');
      console.log('-'.repeat(80));
      console.log('');
      console.log(COLOR_CYAN + `Total Trades: ${results.trades.length}` + COLOR_RESET);
      console.log('');

      // Win/Loss Statistics
      console.log(COLOR_GREEN + `Win Rate: ${statistics.basic.winRate.toFixed(1)}% (${statistics.basic.wins}/${results.trades.length})` + COLOR_RESET);
      console.log( `Failed Trades: ${statistics.basic.losses}` );
      
      // Overall P&L
      const pnlColor = statistics.basic.totalPnL >= 0 ? COLOR_GREEN : COLOR_RED;
      console.log(`${pnlColor}Total P&L: ${statistics.basic.totalPnL.toFixed(2)}%${COLOR_RESET}`);
      console.log(`${pnlColor}Average P&L per Trade: ${statistics.basic.avgPnL.toFixed(2)}%${COLOR_RESET}`);
      console.log('-'.repeat(80));
      // Winning Trades Analysis
      console.log(COLOR_GREEN + '\nWinning Trades P&L Analysis:' + COLOR_RESET);
      console.log(`  Highest Win: +${statistics.basic.highestWinPnL.toFixed(2)}%`);
      console.log(`  Lowest Win: +${statistics.basic.lowestWinPnL.toFixed(2)}%`);
      
      // Losing Trades Analysis
      
      console.log(COLOR_RED + '\nLosing Trades P&L Analysis:' + COLOR_RESET);
      console.log(`  Highest Loss: ${statistics.basic.highestLossPnL.toFixed(2)}%`);
      console.log(`  Lowest Loss: ${statistics.basic.lowestLossPnL.toFixed(2)}%`);
       console.log('-'.repeat(80));
       // Favorable Excursion Analysis
      console.log(COLOR_GREEN + 'Favorable Excursion Analysis (Price Movement in Our Favor):' + COLOR_RESET);
      console.log(`  Average Movement: +${statistics.excursions.avgMFE.toFixed(2)}%`);
      console.log(`  Highest Movement: +${statistics.excursions.maxMFE.toFixed(2)}%`);

      console.log(COLOR_RED + '\nAdverse Excursion Analysis (Price Movement Against Us):' + COLOR_RESET);
      console.log(`  Average Movement: -${statistics.excursions.avgMAE.toFixed(2)}%`);
      console.log(`  Highest Movement: -${statistics.excursions.maxMAE.toFixed(2)}%`);
 
      console.log('-'.repeat(80));
      console.log('');
      console.log(COLOR_CYAN + `Starting Capital: $${statistics.capital.initialCapital.toFixed(2)}` + COLOR_RESET);
      console.log(COLOR_CYAN + `Final Capital: $${statistics.capital.finalCapital.toFixed(2)}` + COLOR_RESET);
      const growthColor = statistics.capital.totalReturn >= 0 ? COLOR_GREEN : COLOR_RED;
      console.log(growthColor + `Total Return: ${statistics.capital.totalReturn.toFixed(2)}%` + COLOR_RESET);
    }

    // Export results if enabled
    if (tradeConfig.saveToFile) {
      await exporter.saveBacktestData(results, statistics);
      if (!tradeConfig.performanceMode) {
        console.log('\nResults saved successfully');
      }
    }
  } else {
    console.log('No trades executed.');
  }
})();
