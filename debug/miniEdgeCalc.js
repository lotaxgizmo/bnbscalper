// miniEdgeCalc.js
import {
    api,
    symbol,
    limit
} from '../config/config.js';

const interval = '1';  // Use 1m candles for more precision

// Data is already in UTC+1, no offset needed
const utcOffset = 0;

// Force local data - this calculator never uses API
process.env.USE_LOCAL_DATA = 'true';
const forceLocalData = true;  // Extra safety to ensure we never use API

import { fetchCandles } from '../utils/candleAnalytics.js';

// Simple function to calculate percentage move
function calculateMove(candles) {
    if (!candles.length) return 0;
    
    let highCandle = candles[0];
    let lowCandle = candles[0];
    
    for (const candle of candles) {
        if (candle.high > highCandle.high) highCandle = candle;
        if (candle.low < lowCandle.low) lowCandle = candle;
    }
    
    const move = ((highCandle.high - lowCandle.low) / lowCandle.low) * 100;
    
    // Account for UTC+1 timezone
    const now = new Date(Date.now() + utcOffset);
    
    return {
        high: highCandle.high,
        highTime: new Date(highCandle.time).toLocaleString(),
        low: lowCandle.low,
        lowTime: new Date(lowCandle.time).toLocaleString(),
        move: move.toFixed(2)
    };
}

async function calculateSimpleEdges() {
    console.log(`\n▶ Calculating simple edges for ${symbol} [${interval}] from local data\n`);

    // Calculate needed candles for a full month of 1m data
    const candlesPerDay = 24 * 60; // 1440 candles per day (1m intervals)
    const daysNeeded = 31;
    const neededCandles = candlesPerDay * daysNeeded; // ~44,640 candles
    
    const allCandles = await fetchCandles(symbol, interval, neededCandles, api, 0, undefined, true);
    
    // Sort candles by time to ensure chronological order
    allCandles.sort((a, b) => a.time - b.time);
    
    // Check first and last candle times
    const firstCandle = allCandles[0];
    const lastCandle = allCandles[allCandles.length - 1];
    const currentTime = Date.now();
    
    console.log('\nTimestamp Analysis:');
    console.log(`First Candle: ${new Date(allCandles[0].time).toLocaleString()}`);
    console.log(`Last Candle: ${new Date(allCandles[allCandles.length-1].time).toLocaleString()}`);
    console.log(`Current Time: ${new Date().toLocaleString()}`);
    console.log(`Time since last candle: ${((currentTime - lastCandle.time) / 1000 / 60).toFixed(2)} minutes\n`);

    if (!allCandles.length) {
        console.error('❌ No candles fetched. Exiting.');
        process.exit(1);
    }

    // Sort candles by time
    allCandles.sort((a, b) => a.time - b.time);
    
    // Get timeframes
    // For 1m candles:
    // 1 day = 1440 candles (24 hours * 60 candles per hour)
    // 1 week = 10080 candles (1440 * 7)
    // 1 month = 43200 candles (1440 * 30)
    const candleDuration = 60 * 1000; // 1 minute in ms
    const timeframes = {
        daily: 24 * 60 * 60 * 1000,      // 1 day in ms
        weekly: 7 * 24 * 60 * 60 * 1000,  // 1 week in ms
        monthly: 30 * 24 * 60 * 60 * 1000 // 1 month in ms
    };
    


    // Print results
    console.log('\nEdge Calculations:');
    console.log('=================');
    
    // Calculate and display moves for each timeframe
    for (const [timeframe, duration] of Object.entries(timeframes)) {
        const windowEnd = lastCandle.time;
        const windowStart = windowEnd - duration;
        const windowCandles = allCandles.filter(c => c.time >= windowStart && c.time <= windowEnd);
        console.log(`
${timeframe.toUpperCase()}:`);
        console.log(`Window: ${new Date(windowStart).toLocaleString()} to ${new Date(windowEnd).toLocaleString()}`);
        const result = calculateMove(windowCandles);
        console.log(`High: ${result.high} (${result.highTime})`);
        console.log(`Low: ${result.low} (${result.lowTime})`);
        console.log(`Move: ${result.move}%`);
    }
}

// Run the calculator
calculateSimpleEdges().catch(console.error);
