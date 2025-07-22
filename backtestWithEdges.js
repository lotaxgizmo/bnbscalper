// backtestWithEdges.js - Enhanced version that uses edge-aware pivot data
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
import { fetchCandles } from './utils/candleAnalytics.js';
import { savePivotData, loadPivotData } from './utils/pivotCache.js';
import { BacktestEngine } from './utils/backtest/backtestEngine.js';
import { BacktestStats } from './utils/backtest/backtestStats.js';
import { BacktestExporter } from './utils/backtest/backtestExporter.js';
import { EdgeConsoleLogger } from './utils/backtest/edgeConsoleLogger.js';

// Configuration for pivot detection
const pivotConfig = {
  minSwingPct,
  shortWindow,
  longWindow,
  confirmOnClose,
  minLegBars
};

(async () => {
  // Initialize logger
  const logger = new EdgeConsoleLogger(tradeConfig);
  
  // Log initial configuration
  logger.logInitialConfig(symbol, interval, api, tradeConfig);

  // Try to load enhanced pivot data
  const cachedData = loadPivotData(symbol, interval + '_enhanced', pivotConfig);

  let candles, pivots;
  if (cachedData && cachedData.pivots && cachedData.pivots.length > 0 && cachedData.pivots[0].edges) {
    logger.logCacheStatus(true);
    console.log('Found enhanced pivot data with edge analysis');
    candles = cachedData.metadata.candles || [];
    pivots = cachedData.pivots || [];
    
    // Log edge analysis summary
    const lastPivot = pivots[pivots.length - 1];
    console.log('\nLatest Edge Analysis:');
    for (const [timeframe, data] of Object.entries(lastPivot.edges)) {
      console.log(`\n${timeframe.toUpperCase()}:`);
      console.log(`Current Move: ${data.move}% | Position: ${data.position}%`);
      if (timeframe === 'daily' && data.averageMove) {
        console.log('Average Moves:');
        console.log(`• Past Week: ${data.averageMove.week}%`);
        console.log(`• Past 2 Weeks: ${data.averageMove.twoWeeks}%`);
        console.log(`• Past Month: ${data.averageMove.month}%`);
      } else if (data.averageMove) {
        console.log(`Average Move: ${data.averageMove}%`);
      }
    }
    console.log('\n');
  } else {
    // If no enhanced pivot data found, log error and exit
    logger.logError('No enhanced pivot data found. Please run generateEnhancedPivotData.js first.');
    process.exit(1);
  }

  // Initialize components
  const engine = new BacktestEngine(pivotConfig, tradeConfig, logger);
  
  // Pre-load the enhanced pivots with edge data
  engine.pivotTracker.loadPivots(pivots);
  
  // Configure exporter with edge analysis enabled
  const exporter = new BacktestExporter({
    saveJson: tradeConfig.saveToFile,
    saveCsv: tradeConfig.saveToFile,
    config: tradeConfig
  }, { config: tradeConfig });

  // Run backtest
  const results = await engine.runBacktest(candles);
  
  // Calculate statistics
  const stats = new BacktestStats(results.trades, tradeConfig);
  const statistics = stats.calculate();

 
  if (results.trades.length) {
    // Show individual trade details if enabled
    if (tradeConfig.showTradeDetails) {
      console.log('\n— Trade Details —');
      results.trades.forEach((trade, i) => logger.logTradeDetails(trade, i));
      console.log('\n');
    }

    // Display final summary
    logger.logFinalSummary(results.trades, statistics);

    // Export results if enabled
    if (tradeConfig.saveToFile) {
      await exporter.saveBacktestData(results, statistics);
      logger.logExportStatus();
    }
  } else {
    logger.logNoTrades();
  }
})();
