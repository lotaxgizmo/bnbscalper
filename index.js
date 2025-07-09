// index.js
import { getCandles } from './binance.js';
import { time, symbol, limit } from './config.js';

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

  console.log('Recent BNB ' + time + ' candles:\n');
  // Show in chronological order (oldest first)
  // Sort differences to calculate medians
  const sortedDiffs = candlesWithStats.map(c => parseFloat(c.percentDiff)).sort((a, b) => a - b);
  const normalAvg = avgDiff;
  const mediumAvg = (sortedDiffs[Math.floor(sortedDiffs.length * 0.75)]).toFixed(2); // 75th percentile
  const highAvg = (sortedDiffs[Math.floor(sortedDiffs.length * 0.9)]).toFixed(2);    // 90th percentile

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

  // Calculate duration
  const firstTime = new Date(candles[0].time);
  const lastTime = new Date(candles[candles.length - 1].time);
  const durationMs = lastTime - firstTime;
  const days = Math.floor(durationMs / (24 * 60 * 60 * 1000));
  const hours = Math.floor((durationMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  const minutes = Math.floor((durationMs % (60 * 60 * 1000)) / (60 * 1000));
  const seconds = Math.floor((durationMs % (60 * 1000)) / 1000);

  // Format duration string
  const durationParts = [];
  if (days > 0) durationParts.push(`${days} day${days !== 1 ? 's' : ''}`);
  if (hours > 0) durationParts.push(`${hours} hour${hours !== 1 ? 's' : ''}`);
  if (minutes > 0) durationParts.push(`${minutes} minute${minutes !== 1 ? 's' : ''}`);
  if (seconds > 0) durationParts.push(`${seconds} second${seconds !== 1 ? 's' : ''}`);
  const durationStr = durationParts.join(', ');

  // Show summary at the bottom
  console.log('\nSUMMARY:\n');
  console.log(`Highest difference: ${highest.percentDiff}% at ${highest.time}`);
  console.log(`Lowest difference: ${lowest.percentDiff}% at ${lowest.time}`);
  console.log(`Normal average diff: ${normalAvg}% (baseline)`);
  console.log(`Medium average diff: ${mediumAvg}% (75th percentile)`);
  console.log(`High average diff: ${highAvg}% (90th percentile)`);
  console.log(`Total average price: $${totalAvg}`);
  console.log(`Time period: ${durationParts.join(', ')}\n`);
};

main();
