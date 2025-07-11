// index2.js - Close-to-Close price movement analysis
import { getCandles as getBinanceCandles } from './binance.js';
import { getCandles as getBybitCandles } from './bybit.js';
import { api, time, symbol, limit, mediumPercentile, highPercentile, lowPercentile, topPercentile, showFullTimePeriod, delay } from './config.js';
import { processCandleData, calculatePercentiles, trackCorrections } from './utils/candleProcessor2.js';
import { formatDuration, getTimeInMinutes } from './utils/formatters.js';
import { printCandleData, printSummary } from './utils/consoleOutput2.js';

// Set to 'binance' or 'bybit'
const API = api;
const getCandles = API === 'binance' ? getBinanceCandles : getBybitCandles;

const main = async () => {
  // Fetch enough candles to account for the delay
  // Calculate end time by subtracting delay minutes from current time
  const endTime = Date.now() - (delay * 60 * 1000); // delay is in minutes
  const candles = await getCandles(symbol, time, limit, endTime);

  // Process candle data
  const { candlesWithStats, highest, lowest, totalAvg } = processCandleData(candles);

  // Calculate percentile-based averages
  const { normalAvg, lowAvg, mediumAvg, highAvg, topAvg } = calculatePercentiles(
    candlesWithStats,
    lowPercentile,
    mediumPercentile,
    highPercentile,
    topPercentile
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
    topPercentile,
    correctionToNormalCount,
    correctionToLowCount,
    totalAvg,
    durationStr,
    topAvg
  });
};

main();
