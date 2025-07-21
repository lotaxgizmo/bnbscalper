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
import { ConsoleLogger } from './utils/backtest/consoleLogger.js';

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
  const logger = new ConsoleLogger(tradeConfig);
  
  // Log initial configuration
  logger.logInitialConfig(symbol, interval, api, tradeConfig);

  // Try to load cached pivot data first
  const cachedData = loadPivotData(symbol, interval, pivotConfig);

  let candles;
  if (cachedData) {
    logger.logCacheStatus(true);
    candles = cachedData.metadata.candles || [];
  } else {
    // If no cache, fetch and process data
    logger.logCacheStatus(false);
    candles = await fetchCandles(symbol, interval, limit, api, delay);
    logger.logFetchDetails(candles, limit, delay);

    if (!candles.length) {
      logger.logError('No candles fetched. Exiting.');
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
