// tests/instantPivotTest.js

// Self-sufficient test file to display historical candle data stream.

import {
    symbol,
    time as interval,
    limit
} from '../config/config.js';
import { getCandles } from '../apis/bybit.js';


const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
};

const displayCandleInfo = (candle) => {
  const formattedTime = new Date(candle.time).toLocaleString();
  const o = candle.open.toFixed(2);
  const h = candle.high.toFixed(2);
  const l = candle.low.toFixed(2);
  const c = candle.close.toFixed(2);
  const cColor = c >= o ? colors.green : colors.red;

  console.log(
    `🕯️  ${formattedTime}  | O: ${o} H: ${h} L: ${l} C: ${cColor}${c}${colors.reset}`
  );
};

console.log('Starting Historical Streamer...');

async function runStream() {
    // 1. Load all historical data to get a total count, then slice to the desired limit.
    const allLocalCandles = await getCandles(symbol, interval, null, null, true); // Get all local candles
    if (!allLocalCandles || allLocalCandles.length === 0) {
        console.error('No historical data found. Exiting.');
        return;
    }
    const localCandlesCount = allLocalCandles.length;
    const candles = allLocalCandles.slice(-limit);

    console.log(`Loaded ${candles.length} of ${localCandlesCount} available '${interval}' local candles.`);


    const startTime = new Date(candles[0].time).toLocaleString();
    const endTime = new Date(candles[candles.length - 1].time).toLocaleString();
    console.log(`Simulating from ${startTime} to ${endTime}`);

    console.log('Starting simulation...\n');

    // 2. Simulate the stream by printing each candle
    let candleNumber = 1;
    for (const candle of candles) {
        process.stdout.write(`${candleNumber}. `);
        displayCandleInfo(candle);
        candleNumber++;
    }

    console.log('\nHistorical stream simulation finished.');
}

(async () => {
    try {
        await runStream();
    } catch (err) {
        console.error('An error occurred during the simulation:', err);
    }
})();
