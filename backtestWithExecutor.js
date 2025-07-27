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
import { TradeExecutor } from './utils/backtest/tradeExecutor.js';
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

  // --- NEW: Run backtest using TradeExecutor for each pivot ---
  console.log(`\n${colors.bright}▶ Starting backtest with TradeExecutor...${colors.reset}`);
  console.log(`Found ${pivots.length} pivots to test.`);

  const allTrades = [];

  for (const pivot of pivots) {
    const tradeConfigForPivot = {
      ...enhancedTradeConfig,
      symbol,
      interval,
      scheduleTime: pivot.time,
      price: pivot.price,
      side: pivot.type === 'high' ? 'SELL' : 'BUY',
      amount: 100, // Default amount
      takeProfit: enhancedTradeConfig.takeProfit, 
      stopLoss: enhancedTradeConfig.stopLoss,
      orderDistancePct: 0.0, // Exact price
      updateFrequency: 1000, // Candle updates
      simulationLength: 10000 // Max candles to wait for closure
    };

    const executor = new TradeExecutor(tradeConfigForPivot, candles, pivot, logger);
    const tradeResult = await executor.run();

    if (tradeResult && tradeResult.order.status === 'CLOSED') {
      // Adapt the executor's result to the format expected by BacktestStats
      const pnlRatio = tradeResult.order.side === 'BUY' 
        ? (tradeResult.order.exitPrice - tradeResult.order.fillPrice) / tradeResult.order.fillPrice
        : (tradeResult.order.fillPrice - tradeResult.order.exitPrice) / tradeResult.order.fillPrice;
      
      const pnlPercentage = pnlRatio * 100 * (enhancedTradeConfig.leverage || 1);

      allTrades.push({
        entryTime: tradeResult.order.fillTime,
        entryPrice: tradeResult.order.fillPrice,
        exitTime: tradeResult.order.exitTime,
        exitPrice: tradeResult.order.exitPrice,
        side: tradeResult.order.side,
        pnl: pnlPercentage,
        duration: tradeResult.duration, // ms
        maxFavorableExcursion: tradeResult.maxFavorableExcursion,
        maxAdverseExcursion: tradeResult.maxAdverseExcursion,
        edges: pivot.edges, // Carry over the edge data from the pivot
        result: pnlPercentage >= 0 ? 'WIN' : 'LOSS'
      });
    }
  }

  const results = { trades: allTrades };

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
    // Show individual trade details if enabled
    if (enhancedTradeConfig.showTradeDetails) {
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
