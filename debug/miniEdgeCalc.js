// miniEdgeCalc.js
import { api, symbol } from '../config/config.js';

const interval = '1';  // Use 1m candles for more precision

// Force local data - this calculator never uses API
process.env.USE_LOCAL_DATA = 'true';

import { fetchCandles } from '../utils/candleAnalytics.js';

// Calculate percentage move within a specific time window
function calculateMove(candles, windowStart, windowEnd) {
    // Get candles within window using timestamps directly
    const windowCandles = candles.filter(c => c.time >= windowStart && c.time <= windowEnd);
    
    if (!windowCandles.length) return null;
    
    let highCandle = windowCandles[0];
    let lowCandle = windowCandles[0];
    
    for (const candle of windowCandles) {
        if (candle.high > highCandle.high) highCandle = candle;
        if (candle.low < lowCandle.low) lowCandle = candle;
    }
    
    const move = ((highCandle.high - lowCandle.low) / lowCandle.low) * 100;
    
    // Get current price (last candle in window)
    const currentPrice = windowCandles[windowCandles.length - 1].close;
    
    // Calculate current percentage move from the low
    const currentMove = ((currentPrice - lowCandle.low) / lowCandle.low) * 100;

    return {
        high: highCandle.high,
        highTime: new Date(highCandle.time).toLocaleString(),
        low: lowCandle.low,
        lowTime: new Date(lowCandle.time).toLocaleString(),
        current: currentPrice,
        move: move.toFixed(2),
        position: currentMove.toFixed(2),
        candleCount: windowCandles.length
    };
}

async function calculateSimpleEdges() {
    console.log(`\n▶ Calculating simple edges for ${symbol} [${interval}] from local data\n`);

    // Get enough candles for a month
    const candlesPerDay = 24 * 60; // 1440 candles per day
    const daysNeeded = 31;
    const neededCandles = candlesPerDay * daysNeeded;
    
    const allCandles = await fetchCandles(symbol, interval, neededCandles, api, 0, undefined, true);
    allCandles.sort((a, b) => a.time - b.time);
    
    // Show basic timestamp info
    const lastCandle = allCandles[allCandles.length - 1];
    const currentTime = Date.now();
    
    console.log('Timestamp Analysis:');
    console.log(`Last Candle: ${new Date(lastCandle.time).toLocaleString()}`);
    console.log(`Current Time: ${new Date(currentTime).toLocaleString()}`);
    console.log(`Time since last candle: ${((currentTime - lastCandle.time) / 1000 / 60).toFixed(2)} minutes\n`);

    // Define exact time windows from the last candle
    const timeframes = {
        daily: 24 * 60 * 60 * 1000,      // Exactly 24 hours
        weekly: 7 * 24 * 60 * 60 * 1000,  // Exactly 7 days
        monthly: 30 * 24 * 60 * 60 * 1000 // Exactly 30 days
    };
    
    console.log('Edge Calculations:');
    console.log('=================');
    
    // Calculate moves for each timeframe
    for (const [timeframe, duration] of Object.entries(timeframes)) {
        const windowEnd = lastCandle.time;
        const windowStart = windowEnd - duration;
        
        const result = calculateMove(allCandles, windowStart, windowEnd);
        if (!result) continue;
        
        // Calculate time difference
        const timeDiff = windowEnd - windowStart;
        const hours = Math.floor(timeDiff / (1000 * 60 * 60));
        const days = Math.floor(hours / 24);
        
        console.log(`\n${timeframe.toUpperCase()}:`);
        console.log(`Window: ${new Date(windowStart).toLocaleString()} to ${new Date(windowEnd).toLocaleString()}`);
        if (timeframe === 'daily') {
            console.log(`Time Frame: ${hours} hours`);
        } else {
            console.log(`Time Frame: ${days} days`);
        }
        console.log(`Candles: ${result.candleCount}`);
        console.log(`High: ${result.high} (${result.highTime})`);
        console.log(`Low: ${result.low} (${result.lowTime})`);
        console.log(`Current: ${result.current}`);
        console.log(`Move: ${result.move}% | Current: ${result.position}%`);
    }
}

// Run the calculator
calculateSimpleEdges().catch(console.error);
