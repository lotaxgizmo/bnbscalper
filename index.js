// index.js
// Choose which API to use
import { getCandles as getBinanceCandles } from './apis/binance.js';
import { getCandles as getBybitCandles } from './apis/bybit.js';
import { api, symbol, time as interval, limit, mediumPercentile, highPercentile, lowPercentile, showFullTimePeriod } from './config/config.js';

// Import modular components
import { processCandleData, calculatePercentiles, trackCorrections } from './utils/candleProcessor.js';
import { formatDuration, getTimeInMinutes } from './utils/formatters.js';
import { printCandleData, printSummary } from './utils/consoleOutput.js';

// Set to 'binance' or 'bybit'
const API = api;
const getCandles = API === 'binance' ? getBinanceCandles : getBybitCandles;

const main = async () => {
  const candles = await getCandles(symbol, interval, limit);

  // Process candle data
  const { candlesWithStats, highest, lowest, totalAvg } = processCandleData(candles);

  // Calculate percentile-based averages
  const { normalAvg, lowAvg, mediumAvg, highAvg } = calculatePercentiles(
    candlesWithStats,
    lowPercentile,
    mediumPercentile,
    highPercentile
  );

  // Track corrections
  const { correctionToNormalCount, correctionToLowCount } = trackCorrections(
    candlesWithStats,
    highAvg,
    normalAvg,
    lowAvg
  );

  // Calculate duration
  const minutesPerCandle = getTimeInMinutes(interval);
  const totalMinutes = candles.length * minutesPerCandle;
  const durationStr = formatDuration(totalMinutes, showFullTimePeriod);

  // Print candle data
  printCandleData(candlesWithStats, highAvg, mediumAvg, normalAvg, interval);

  // Print summary
  printSummary({
    highest,
    lowest,
    normalAvg,
    lowAvg,
    mediumAvg,
    highAvg,
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
