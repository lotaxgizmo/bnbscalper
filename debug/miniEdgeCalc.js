// miniEdgeCalc.js
import {
    api,
    symbol,
    limit
} from '../config/config.js';

const interval = '15';  // Use 15m candles instead of 1m

// Make sure we use local data
process.env.USE_LOCAL_DATA = 'true';

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
    
    return {
        high: highCandle.high,
        highTime: new Date(highCandle.time).toLocaleString(),
        low: lowCandle.low,
        lowTime: new Date(lowCandle.time).toLocaleString(),
        move: move.toFixed(2)
    };
}

async function calculateSimpleEdges() {
    console.log(`\n▶ Calculating simple edges for ${symbol} [${interval}] using ${api}\n`);

    // Calculate needed candles for a full month of 15m data
    const candlesPerDay = 24 * 4; // 96 candles per day (15m intervals)
    const daysNeeded = 31;
    const neededCandles = candlesPerDay * daysNeeded; // ~2976 candles
    
    console.log(`Fetching ${neededCandles} candles from local data...`);
    const allCandles = await fetchCandles(symbol, interval, neededCandles, api);
    console.log(`Fetched ${allCandles.length} candles.`);
    
    // Sort candles by time to ensure chronological order
    allCandles.sort((a, b) => a.time - b.time);
    
    // Check first and last candle times
    const firstCandle = allCandles[0];
    const lastCandle = allCandles[allCandles.length - 1];
    const currentTime = Date.now();
    
    console.log('\nTimestamp Analysis:');
    console.log(`First Candle: ${new Date(firstCandle.time).toLocaleString()}`);
    console.log(`Last Candle: ${new Date(lastCandle.time).toLocaleString()}`);
    console.log(`Current Time: ${new Date(currentTime).toLocaleString()}`);
    console.log(`Time since last candle: ${((currentTime - lastCandle.time) / 1000 / 60).toFixed(2)} minutes\n`);

    if (!allCandles.length) {
        console.error('❌ No candles fetched. Exiting.');
        process.exit(1);
    }

    // Sort candles by time
    allCandles.sort((a, b) => a.time - b.time);
    
    // Get timeframes
    // For 15m candles:
    // 1 day = 96 candles (24 hours * 4 candles per hour)
    // 1 week = 672 candles (96 * 7)
    // 1 month = 2880 candles (96 * 30)
    const candleDuration = 15 * 60 * 1000; // 15 minutes in ms
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
        const windowStart = lastCandle.time - duration;
        const windowCandles = allCandles.filter(c => c.time >= windowStart);
        const result = calculateMove(windowCandles);
        
        console.log(`\n${timeframe.toUpperCase()}:`);
        console.log(`High: ${result.high} (${result.highTime})`);
        console.log(`Low: ${result.low} (${result.lowTime})`);
        console.log(`Move: ${result.move}%`);
    }
}

// Run the calculator
calculateSimpleEdges().catch(console.error);
