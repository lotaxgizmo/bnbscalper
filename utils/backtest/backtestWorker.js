// backtestWorker.js
import { parentPort } from 'worker_threads';
import { BacktestEngine } from './backtestEngine.js';
import { BacktestStats } from './backtestStats.js';

parentPort.on('message', async ({ candles, pivotConfig, tradeConfig, tpValues, slValues, startIndex, endIndex, workerId }) => {
  const results = [];

  // Process assigned iterations
  for (let i = startIndex; i < endIndex; i++) {
    // Report progress every iteration
    parentPort.postMessage({ type: 'progress', workerId, current: i - startIndex + 1, total: endIndex - startIndex });
    const tpIndex = Math.floor(i / slValues.length);
    const slIndex = i % slValues.length;
    
    const tp = tpValues[tpIndex];
    const sl = slValues[slIndex];

    // Configure trade parameters for this iteration
    const iterationConfig = {
      ...tradeConfig,
      takeProfit: tp,
      stopLoss: sl
    };

    // Initialize components and run backtest
    const engine = new BacktestEngine(pivotConfig, iterationConfig);
    const backtestResults = await engine.runBacktest(candles);
    const stats = new BacktestStats(backtestResults.trades, iterationConfig);
    const statistics = stats.calculate();

    // Store results for this iteration
    results.push({
      takeProfit: tp,
      stopLoss: sl,
      trades: backtestResults.trades.length,
      winRate: statistics.basic.winRate,
      losses: statistics.basic.losses,
      totalPnL: statistics.basic.totalPnL,
      avgPnL: statistics.basic.avgPnL,
      highestWin: statistics.basic.highestWinPnL,
      lowestWin: statistics.basic.lowestWinPnL,
      highestLoss: statistics.basic.highestLossPnL,
      lowestLoss: statistics.basic.lowestLossPnL,
      avgFavorable: statistics.excursions.avgFavorable,
      highestFavorable: statistics.excursions.highestFavorable,
      lowestFavorable: statistics.excursions.lowestFavorable,
      avgAdverse: statistics.excursions.avgAdverse,
      highestAdverse: statistics.excursions.highestAdverse,
      lowestAdverse: statistics.excursions.lowestAdverse,
      finalCapital: statistics.capital.finalCapital,
      totalReturn: statistics.capital.totalReturn
    });
  }

  // Send results back to main thread
  parentPort.postMessage({ type: 'complete', results });
});
