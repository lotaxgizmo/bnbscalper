// backtestOptimizer.js
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
import { Worker } from 'worker_threads';

import { optimizerConfig } from './config/optimizerConfig.js';
import { fetchCandles } from './utils/candleAnalytics.js';
import { savePivotData, loadPivotData } from './utils/pivotCache.js';
import { BacktestEngine } from './utils/backtest/backtestEngine.js';
import { BacktestStats } from './utils/backtest/backtestStats.js';
import { ConsoleLogger } from './utils/backtest/consoleLogger.js';
import { tradeConfig } from './config/tradeconfig.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);

// Configuration for pivot detection
const pivotConfig = {
  minSwingPct,
  shortWindow,
  longWindow,
  confirmOnClose,
  minLegBars
};

// Calculate number of iterations
const getTotalIterations = () => {
  const tpSteps = optimizerConfig.takeProfitRange.start === optimizerConfig.takeProfitRange.end ? 1 :
    Math.ceil((optimizerConfig.takeProfitRange.end - optimizerConfig.takeProfitRange.start) / optimizerConfig.takeProfitRange.step) + 1;
  
  const slSteps = optimizerConfig.stopLossRange.start === optimizerConfig.stopLossRange.end ? 1 :
    Math.ceil((optimizerConfig.stopLossRange.end - optimizerConfig.stopLossRange.start) / optimizerConfig.stopLossRange.step) + 1;
  
  return tpSteps * slSteps;
};

(async () => {
    const startTime = process.hrtime();
    const logger = new ConsoleLogger(tradeConfig);
  
  // Log initial configuration
  logger.logInitialConfig(symbol, interval, api, tradeConfig);

  // Calculate and show total iterations
  const totalIterations = getTotalIterations();
  console.log(`\nThis will run ${totalIterations} iterations with:`);
  console.log(`- Take Profit: ${optimizerConfig.takeProfitRange.start.toFixed(2)}% to ${optimizerConfig.takeProfitRange.end.toFixed(2)}% (step: ${optimizerConfig.takeProfitRange.step.toFixed(2)}%)`);
  console.log(`- Stop Loss: ${optimizerConfig.stopLossRange.start.toFixed(2)}% to ${optimizerConfig.stopLossRange.end.toFixed(2)}% (step: ${optimizerConfig.stopLossRange.step.toFixed(2)}%)`);
  
  // Ask for confirmation
  process.stdout.write('\nProceed? (y/n): ');
  const response = await new Promise(resolve => {
    // Set raw mode to get immediate keypress
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    const onData = (key) => {
      // On y/n press, cleanup and resolve
      if (key === 'y' || key === 'n') {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener('data', onData);
        process.stdout.write(key + '\n'); // Echo the key pressed
        resolve(key);
      }
      // On ctrl-c
      else if (key === '\u0003') {
        process.exit();
      }
      // Ignore other keys
    };

    process.stdin.on('data', onData);
  });

  if (response !== 'y') {
    console.log('Optimization cancelled.');
    process.exit(0);
  }

  console.log('\nProceeding with optimization...\n');

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



  // Calculate iterations for each worker
  const numWorkers = 6; // Use 4 worker threads
  const iterationsPerWorker = Math.ceil(totalIterations / numWorkers);
  let completedWorkers = 0;
  const allResults = [];
  
  // Track progress for each worker
  const workerProgress = new Array(numWorkers).fill(0);
  const workerTotals = new Array(numWorkers).fill(0);
  
  // Function to display progress
  const displayProgress = () => {
    console.clear();
    console.log('Optimization Progress:\n');
    let totalProgress = 0;
    let totalWork = 0;
    
    workerProgress.forEach((progress, i) => {
      const total = workerTotals[i];
      if (total > 0) {
        const percent = ((progress / total) * 100).toFixed(1);
        console.log(`Worker ${i + 1}: ${progress}/${total} (${percent}%)`);
        totalProgress += progress;
        totalWork += total;
      }
    });
    
    if (totalWork > 0) {
      const overallPercent = ((totalProgress / totalWork) * 100).toFixed(1);
      console.log(`\nOverall Progress: ${totalProgress}/${totalWork} (${overallPercent}%)`);
    }
  };

  // Iterate through take profit values
  const tpValues = optimizerConfig.takeProfitRange.start === optimizerConfig.takeProfitRange.end ?
    [optimizerConfig.takeProfitRange.start] :
    Array.from({ length: Math.ceil((optimizerConfig.takeProfitRange.end - optimizerConfig.takeProfitRange.start) / optimizerConfig.takeProfitRange.step) + 1 },
      (_, i) => optimizerConfig.takeProfitRange.start + i * optimizerConfig.takeProfitRange.step);

  // Iterate through stop loss values
  const slValues = optimizerConfig.stopLossRange.start === optimizerConfig.stopLossRange.end ?
    [optimizerConfig.stopLossRange.start] :
    Array.from({ length: Math.ceil((optimizerConfig.stopLossRange.end - optimizerConfig.stopLossRange.start) / optimizerConfig.stopLossRange.step) + 1 },
      (_, i) => optimizerConfig.stopLossRange.start + i * optimizerConfig.stopLossRange.step);

  // Create and run workers
  const workerPromises = [];
  const totalCombinations = tpValues.length * slValues.length;

  for (let i = 0; i < numWorkers; i++) {
    const startIndex = i * iterationsPerWorker;
    const endIndex = Math.min(startIndex + iterationsPerWorker, totalCombinations);

    const workerPromise = new Promise((resolve, reject) => {
      const worker = new Worker('./utils/backtest/backtestWorker.js', { type: 'module' });

      worker.on('message', (message) => {
        if (message.type === 'progress') {
          workerProgress[i] = message.current;
          workerTotals[i] = message.total;
          displayProgress();
        } else if (message.type === 'complete') {
          allResults.push(...message.results);
          completedWorkers++;
          displayProgress();
          resolve();
        }
      });

      worker.on('error', reject);

      worker.postMessage({
        workerId: i,
        candles,
        pivotConfig,
        tradeConfig,
        tpValues,
        slValues,
        startIndex,
        endIndex
      });
    });

    workerPromises.push(workerPromise);
  }

  // Wait for all workers to complete
  await Promise.all(workerPromises);

  // Save all results to a single CSV
  const dataDir = path.join(path.dirname(__filename), 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  const csvPath = path.join(dataDir, 'optimizer_results.csv');
  const csvHeader = 'take_profit,stop_loss,total_trades,win_rate,failed_trades,total_pnl,avg_pnl,' +
                   'highest_win_pnl,lowest_win_pnl,highest_loss_pnl,lowest_loss_pnl,' +
                   'avg_favorable_excursion,highest_favorable,lowest_favorable,' +
                   'avg_adverse_excursion,highest_adverse,lowest_adverse,' +
                   'final_capital,total_return\n';

  const csvRows = allResults.map(result => 
    `${result.takeProfit.toFixed(2)},${result.stopLoss.toFixed(2)},${result.trades},${result.winRate.toFixed(2)},${result.losses},` +
    `${result.totalPnL.toFixed(2)},${result.avgPnL.toFixed(2)},${result.highestWin.toFixed(2)},${result.lowestWin.toFixed(2)},` +
    `${result.highestLoss.toFixed(2)},${result.lowestLoss.toFixed(2)},${result.avgFavorable.toFixed(2)},${result.highestFavorable.toFixed(2)},` +
    `${result.lowestFavorable.toFixed(2)},${result.avgAdverse.toFixed(2)},${result.highestAdverse.toFixed(2)},` +
    `${result.lowestAdverse.toFixed(2)},${result.finalCapital.toFixed(2)},${result.totalReturn.toFixed(2)}`
  ).join('\n');

  await fs.writeFileSync(csvPath, csvHeader + csvRows);
  
  // Calculate elapsed time
  const elapsed = process.hrtime(startTime);
  const elapsedSeconds = (elapsed[0] + elapsed[1] / 1e9).toFixed(2);
  
  console.log('\n\nOptimization complete!');
  console.log(`Total time elapsed: ${elapsedSeconds} seconds`);
  console.log('Results saved to:', csvPath);
})();
