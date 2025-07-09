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
  candlesWithStats.forEach((c, index) => {
    console.log(`${(index + 1).toString().padStart(4, ' ')}. ${c.time} | H: ${c.high} L: ${c.low} | Avg: ${c.avgPrice} | Diff: ${c.percentDiff}% | C: \x1b[33m${c.close}\x1b[0m`);
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
  console.log('\nSUMMARY:');
  console.log(`Highest difference: ${highest.percentDiff}% at ${highest.time}`);
  console.log(`Lowest difference: ${lowest.percentDiff}% at ${lowest.time}`);
  console.log(`Average difference: ${avgDiff}%`);
  console.log(`Total average price: $${totalAvg}`);
  console.log(`Time period: ${durationStr}`);
};

main();
