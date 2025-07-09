// index.js
import { getCandles } from './binance.js';

const time = '1h';

const main = async () => {
  const candles = await getCandles('BNBUSDT', time, 24); // last 10 1-minute candles

  console.log('Recent BNB ' + time + ' candles:');
  candles.forEach(c => {
    const time = new Date(c.time).toLocaleTimeString();
    const percentDiff = ((c.high - c.low) / c.low * 100).toFixed(2);
    console.log(`${time} | H: ${c.high} L: ${c.low} | Diff: ${percentDiff}%`);
    // console.log(`${time} | O: ${c.open} H: ${c.high} L: ${c.low} C: ${c.close}`);
  });
};

main();
