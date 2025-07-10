// index.js
// Choose which API to use
import { getCandles as getBinanceCandles } from './binance.js';
import { getCandles as getBybitCandles } from './bybit.js';

// Set to 'binance' or 'bybit'
const API = 'bybit';
const getCandles = API === 'binance' ? getBinanceCandles : getBybitCandles;
import { time, symbol, limit, mediumPercentile, highPercentile, lowPercentile, showFullTimePeriod } from './config.js';

const main = async () => {
  const candles = await getCandles(symbol, time, limit);

  // Calculate all percentage differences and averages
  const candlesWithStats = candles.map(c => ({
    ...c,
    time: new Date(c.time).toLocaleTimeString(),
    percentDiff: ((c.high - c.low) / c.low * 100).toFixed(2),
    avgPrice: ((parseFloat(c.high) + parseFloat(c.low)) / 2).toFixed(2)
  }));

  // Find highest and lowest diff
  const highest = candlesWithStats.reduce((max, curr) => 
    parseFloat(curr.percentDiff) > parseFloat(max.percentDiff) ? curr : max
  );
  const lowest = candlesWithStats.reduce((min, curr) => 
    parseFloat(curr.percentDiff) < parseFloat(min.percentDiff) ? curr : min
  );

  // Calculate total average price and average difference
  const totalAvg = (candlesWithStats.reduce((sum, c) => sum + parseFloat(c.avgPrice), 0) / candlesWithStats.length).toFixed(2);
  const avgDiff = (candlesWithStats.reduce((sum, c) => sum + parseFloat(c.percentDiff), 0) / candlesWithStats.length).toFixed(2);

  // Sort differences to calculate medians
  const sortedDiffs = candlesWithStats.map(c => parseFloat(c.percentDiff)).sort((a, b) => a - b);
  const normalAvg = avgDiff;
  const lowAvg = (sortedDiffs[Math.floor(sortedDiffs.length * lowPercentile)]).toFixed(2);      // 5th percentile
  const mediumAvg = (sortedDiffs[Math.floor(sortedDiffs.length * mediumPercentile)]).toFixed(2); // 75th percentile
  const highAvg = (sortedDiffs[Math.floor(sortedDiffs.length * highPercentile)]).toFixed(2);    // 90th percentile

  // Track corrections from high to normal average
  let highDiffCount = 0;
  let correctionToNormalCount = 0;
  let inHighDiff = false;
  let lastHighDiffTime = null;

  // Track corrections from high to low average
  let highDiffCountLow = 0;
  let correctionToLowCount = 0;
  let inHighDiffLow = false;
  let lastHighDiffTimeLow = null;

  candlesWithStats.forEach((candle, i) => {
    const diff = parseFloat(candle.percentDiff);
    
    // Check for high volatility start
    if (diff >= parseFloat(highAvg)) {
      // For normal average tracking
      if (!inHighDiff) {
        highDiffCount++;
        inHighDiff = true;
        lastHighDiffTime = candle.time;
      }
      // For low average tracking
      if (!inHighDiffLow) {
        highDiffCountLow++;
        inHighDiffLow = true;
        lastHighDiffTimeLow = candle.time;
      }
    } else {
      // Check correction to normal average
      if (diff <= parseFloat(normalAvg) && inHighDiff) {
        correctionToNormalCount++;
        inHighDiff = false;
      }
      // Check correction to low average
      if (diff <= parseFloat(lowAvg) && inHighDiffLow) {
        correctionToLowCount++;
        inHighDiffLow = false;
      }
    }
  });

  const correctionToNormalRate = ((correctionToNormalCount / highDiffCount) * 100).toFixed(1);
  const correctionToLowRate = ((correctionToLowCount / highDiffCountLow) * 100).toFixed(1);
  const averageDiffSpread = (parseFloat(highAvg) - parseFloat(normalAvg)).toFixed(2);
  const highLowSpread = (parseFloat(highAvg) - parseFloat(lowAvg)).toFixed(2);

  console.log('Recent BNB ' + time + ' candles:\n');

  candlesWithStats.forEach((c, index) => {
    const diff = parseFloat(c.percentDiff);
    let diffColor = '\x1b[0m';  // default
    if (diff >= parseFloat(highAvg)) {
      diffColor = '\x1b[31m';   // red for high
    } else if (diff >= parseFloat(mediumAvg)) {
      diffColor = '\x1b[33m';   // yellow for medium
    } else if (diff <= parseFloat(normalAvg)) {
      diffColor = '\x1b[32m';   // green for normal or below
    }
    console.log(`${(index + 1).toString().padStart(4, ' ')}. ${c.time} | H: ${c.high.toFixed(2)} L: ${c.low.toFixed(2)} | Avg: ${c.avgPrice} | Diff: ${diffColor}${c.percentDiff}%\x1b[0m | C: \x1b[36m${c.close.toFixed(2)}\x1b[0m`);
    // console.log(`${time} | O: ${c.open} H: ${c.high} L: ${c.low} C: ${c.close}`);
  });

  // Calculate and format duration
  const getTimeInMinutes = (interval) => {
    const value = parseInt(interval);
    const unit = interval.slice(-1);
    switch(unit) {
      case 's': return value / 60; // seconds to minutes
      case 'm': return value; // minutes
      case 'h': return value * 60; // hours to minutes
      case 'd': return value * 24 * 60; // days to minutes
      case 'w': return value * 7 * 24 * 60; // weeks to minutes
      default: return value; // assume minutes
    }
  };

  const minutesPerCandle = getTimeInMinutes(time);
  const totalMinutes = candles.length * minutesPerCandle;
  const totalHours = Math.floor(totalMinutes / 60);
  const months = Math.floor(totalHours / (30 * 24));
  const days = Math.floor((totalHours % (30 * 24)) / 24);
  const hours = Math.floor(totalHours % 24);
  const minutes = Math.floor(totalMinutes % 60);
  
  const s = n => n === 1 ? '' : 's';  // Format duration string
  let parts = [];
  if (showFullTimePeriod) {
    if (months > 0) parts.push(`${months} month${s(months)}`);
    if (days > 0) parts.push(`${days} day${s(days)}`);
    if (hours > 0) parts.push(`${hours} hour${s(hours)}`);
    if (minutes > 0) parts.push(`${minutes} minute${s(minutes)}`);
  } else {
    // In simplified mode, convert everything to hours and always show minutes
    const remainingMinutes = Math.floor(totalMinutes % 60);
    parts.push(`${totalHours} hour${s(totalHours)}`);
    parts.push(`${remainingMinutes} minute${s(remainingMinutes)}`);
  }
  const durationStr = parts.join(', ') || '0 minutes';

  // Show summary at the bottom
  console.log('\n\nSUMMARY:\n');
  console.log(`Highest difference: ${highest.percentDiff}% at ${highest.time}`);
  console.log(`Lowest difference: ${lowest.percentDiff}% at ${lowest.time}`);
  console.log(`Low average diff: ${lowAvg}% (${(lowPercentile * 100).toFixed(0)}th percentile)`);
  console.log(`Normal average diff: ${normalAvg}% (baseline)`);
  console.log(`Medium average diff: ${mediumAvg}% (${(mediumPercentile * 100).toFixed(0)}th percentile)`);
  console.log(`High average diff: ${highAvg}% (${(highPercentile * 100).toFixed(0)}rd percentile)`);

  console.log()
  
  console.log(`Difference between high and normal average: ${(parseFloat(highAvg) - parseFloat(normalAvg)).toFixed(2)}%`); 
  console.log(`Successfully corrected to normal average: ${correctionToNormalCount}`);
  
  console.log()
  
  console.log(`Difference between high and low average: ${(parseFloat(highAvg) - parseFloat(lowAvg)).toFixed(2)}%`);  
  console.log(`Successfully corrected to low average: ${correctionToLowCount}`);
 
  
  console.log()

  console.log(`Total average price: $${totalAvg}`);
  console.log(`Time period: ${durationStr}`);
};

main();
