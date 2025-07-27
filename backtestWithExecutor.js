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
  delay,
  edgeProximityEnabled,
  edgeProximityThreshold,
  edgeProximityAction
} from './config/config.js';

import { tradeConfig } from './config/tradeconfig.js';
import { fetchCandles } from './utils/candleAnalytics.js';
import { savePivotData, loadPivotData } from './utils/pivotCache.js';
import { BacktestController } from './utils/backtest/backtestController.js';
import { BacktestStats } from './utils/backtest/backtestStats.js';
import { BacktestExporter } from './utils/backtest/backtestExporter.js';
import { EdgeConsoleLogger } from './utils/backtest/edgeConsoleLogger.js';
import { colors } from './utils/formatters.js';

// Configuration for pivot detection
const pivotConfig = {
  minSwingPct,
  shortWindow,
  longWindow,
  confirmOnClose,
  minLegBars
};

(async () => {
  // Debug logging function
  const debugLog = (message) => {
    console.log(message);
    // We'll just use console.log for now since fs requires different import method in ES modules
  };
  
  // Add edge proximity settings to tradeConfig with debug function
  const enhancedTradeConfig = {
    ...tradeConfig,
    edgeProximityEnabled,
    edgeProximityThreshold,
    edgeProximityAction,
    debugLog
  };
  
  // Initialize logger
  const logger = new EdgeConsoleLogger(enhancedTradeConfig);
  
  // Log initial configuration
  logger.logInitialConfig(symbol, interval, api, enhancedTradeConfig);

  // Try to load enhanced pivot data
  const cachedData = loadPivotData(symbol, interval + '_enhanced', pivotConfig);
  console.log('[DEBUG] Loaded cachedData:', cachedData ? `Pivots: ${cachedData.pivots.length}` : 'null');

  let candles, pivots;
  if (cachedData && cachedData.pivots && cachedData.pivots.length > 0 && cachedData.pivots[0].edges) {
    logger.logCacheStatus(true);
    console.log('Found enhanced pivot data with edge analysis');
    candles = cachedData.metadata.candles || [];
    pivots = cachedData.pivots || [];

    // Pivots will be logged by the controller.
  } else {
    // If no enhanced pivot data found, log error and exit
    logger.logError('No enhanced pivot data found. Please run generateEnhancedPivotData.js first.');
    process.exit(1);
  }

  // --- Run backtest using the new controller ---
  console.log(`\n${colors.bright}▶ Starting backtest with Controller...${colors.reset}`);
  const controller = new BacktestController(enhancedTradeConfig, candles, pivots, logger);
  const results = await controller.run();

  // Configure exporter
  const exporter = new BacktestExporter({
    saveJson: enhancedTradeConfig.saveToFile,
    saveCsv: enhancedTradeConfig.saveToFile,
    config: enhancedTradeConfig
  }, { config: enhancedTradeConfig });
  
  // Calculate statistics
  const stats = new BacktestStats(results.trades, enhancedTradeConfig);
  const statistics = stats.calculate();

 
  if (results.trades.length) {
    // Trade details are now logged by the controller during the run.

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
