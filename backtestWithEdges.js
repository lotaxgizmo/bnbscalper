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

  // Try to load cached pivot data first
  const cachedData = loadPivotData(symbol, interval, pivotConfig);

  let candles, pivots;
  if (cachedData && cachedData.metadata.edgeAnalysis) {
    logger.logCacheStatus(true);
    candles = cachedData.metadata.candles || [];
    pivots = cachedData.pivots || [];
  } else {
    // If no edge-enhanced cache, log error and exit
    logger.logError('No edge-enhanced pivot data found. Please run generateEdgePivots.js first.');
    process.exit(1);
  }

  // Initialize components
  const engine = new BacktestEngine(pivotConfig, tradeConfig, logger);
  
  // Pre-load the edge-enhanced pivots
  engine.pivotTracker.loadPivots(pivots);
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
