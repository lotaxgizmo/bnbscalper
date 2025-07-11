// index2.js - Close-to-Close price movement analysis
import { getCandles as getBinanceCandles } from './binance.js';
import { getCandles as getBybitCandles } from './bybit.js';
import { api, time, symbol, limit, mediumPercentile, highPercentile, lowPercentile, showFullTimePeriod, delay } from './config.js';
import { processCandleData, calculatePercentiles, trackCorrections } from './utils/candleProcessor2.js';
import { formatDuration, getTimeInMinutes } from './utils/formatters.js';
import { printCandleData, printSummary } from './utils/consoleOutput2.js';

// Set to 'binance' or 'bybit'
const API = api;
const getCandles = API === 'binance' ? getBinanceCandles : getBybitCandles;

const main = async () => {
  // Fetch enough candles to account for the delay
  const adjustedLimit = limit + delay;
  const candles = await getCandles(symbol, time, adjustedLimit);

  // Apply delay by removing the most recent candles
  const delayedCandles = delay > 0 ? candles.slice(0, limit) : candles;

  // Process candle data
  const { candlesWithStats, highest, lowest, totalAvg } = processCandleData(delayedCandles);

  // Calculate percentile-based averages
  const { normalAvg, lowAvg, mediumAvg, highAvg } = calculatePercentiles(
    candlesWithStats,
    lowPercentile,
    mediumPercentile,
    highPercentile
  );

  // Track corrections and reversals
  const { 
    correctionToNormalCount, 
    correctionToLowCount,
    fullReversalsUp,
    fullReversalsDown,
    upMoves,
    downMoves,
    totalReversals,
    totalExtremeMoves,
    fullReversalRate,
    avgUpProfit,
    avgDownProfit,
    bestReversal
  } = trackCorrections(
    candlesWithStats,
    highAvg,
    normalAvg,
    lowAvg
  );

  // Calculate duration
  const minutesPerCandle = getTimeInMinutes(time);
  const totalMinutes = candles.length * minutesPerCandle;
  const durationStr = formatDuration(totalMinutes, showFullTimePeriod);

  // Print candle data
  printCandleData(candlesWithStats, highAvg, mediumAvg, normalAvg, time);

  // Print summary
  printSummary({
    candlesWithStats,
    highest,
    lowest,
    normalAvg,
    lowAvg,
    mediumAvg,
    highAvg,
    fullReversalsUp,
    fullReversalsDown,
    upMoves,
    downMoves,
    totalReversals,
    totalExtremeMoves,
    fullReversalRate,
    avgUpProfit,
    avgDownProfit,
    bestReversal,
    lowPercentile,
    mediumPercentile,
    highPercentile,
    correctionToNormalCount,
    correctionToLowCount,
    totalAvg,
    durationStr
  });
};

main();
