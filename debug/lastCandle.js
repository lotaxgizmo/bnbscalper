// lastCandle.js - Just shows last candle info
import fs from 'fs';
import path from 'path';
import { historicalDataConfig } from '../config/historicalDataConfig.js';

const symbol = 'BTCUSDT';
const interval = '1m';

// Get file path
const filePath = path.join(historicalDataConfig.dataPath, symbol, `${interval}.csv`);

// Read last line of file
const content = fs.readFileSync(filePath, 'utf8');
const lines = content.split('\n').filter(line => line.trim());
const lastLine = lines[lines.length - 1];

// Parse last candle
const [time, open, high, low, close, volume] = lastLine.split(',').map(parseFloat);
const lastCandleTime = new Date(time);
const now = new Date();

console.log('\nLast Candle Analysis:');
console.log('===================');
console.log(`Last Candle Time: ${lastCandleTime.toLocaleString()}`);
console.log(`Current Time:     ${now.toLocaleString()}`);
console.log(`Minutes Ago:      ${((now - lastCandleTime) / 1000 / 60).toFixed(2)}`);
console.log(`\nCandle Data:`);
console.log(`Open:   ${open}`);
console.log(`High:   ${high}`);
console.log(`Low:    ${low}`);
console.log(`Close:  ${close}`);
console.log(`Volume: ${volume}\n`);
