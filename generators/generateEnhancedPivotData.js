// generateEnhancedPivotData.js
import {
    api,
    time as interval,
    symbol,
    limit,
    minSwingPct,
    shortWindow,
    longWindow,
    confirmOnClose,
    minLegBars,
    delay
} from '../config/config.js';

import PivotTracker from '../utils/pivotTracker.js';
import { fetchCandles } from '../utils/candleAnalytics.js';
import { savePivotData } from '../utils/pivotCache.js';

// Import edge calculation functions
const timeframes = {
    daily: 24 * 60 * 60 * 1000,      // 24 hours
    weekly: 7 * 24 * 60 * 60 * 1000,  // 7 days
    biweekly: 14 * 24 * 60 * 60 * 1000, // 14 days
    monthly: 30 * 24 * 60 * 60 * 1000  // 30 days
};

// Calculate move within a specific time window
function calculateMove(candles, windowStart, windowEnd) {
    const windowCandles = candles.filter(c => c.time >= windowStart && c.time <= windowEnd);
    
    if (!windowCandles.length) return null;
    
    let highCandle = windowCandles[0];
    let lowCandle = windowCandles[0];
    
    for (const candle of windowCandles) {
        if (candle.high > highCandle.high) highCandle = candle;
        if (candle.low < lowCandle.low) lowCandle = candle;
    }
    
    const move = ((highCandle.high - lowCandle.low) / lowCandle.low) * 100;
    const currentPrice = windowCandles[windowCandles.length - 1].close;
    const currentMove = ((currentPrice - lowCandle.low) / lowCandle.low) * 100;

    return {
        high: highCandle.high,
        highTime: highCandle.time,
        low: lowCandle.low,
        lowTime: lowCandle.time,
        current: currentPrice,
        move: parseFloat(move.toFixed(2)),
        position: parseFloat(currentMove.toFixed(2))
    };
}

// Calculate average move for a timeframe
function calculateAverageMove(candles, endTime, periodMs, count) {
    const moves = [];
    for (let i = 1; i <= count; i++) {
        const periodEnd = endTime - (i - 1) * periodMs;
        const periodStart = periodEnd - periodMs;
        const result = calculateMove(candles, periodStart, periodEnd);
        if (result) {
            moves.push(result.move);
        }
    }
    return moves.length ? parseFloat((moves.reduce((a, b) => a + b, 0) / moves.length).toFixed(2)) : null;
}

// Calculate edge data for a specific timestamp
function calculateEdgeData(candles, timestamp) {
    const edgeData = {};
    
    for (const [timeframe, duration] of Object.entries(timeframes)) {
        const windowEnd = timestamp;
        const windowStart = windowEnd - duration;
        
        const move = calculateMove(candles, windowStart, windowEnd);
        if (!move) continue;

        let averageMove = null;
        if (timeframe === 'daily') {
            averageMove = {
                week: calculateAverageMove(candles, windowEnd, duration, 7),
                twoWeeks: calculateAverageMove(candles, windowEnd, duration, 14),
                month: calculateAverageMove(candles, windowEnd, duration, 30)
            };
        } else if (timeframe === 'weekly') {
            averageMove = calculateAverageMove(candles, windowEnd, duration, 4);
        } else if (timeframe === 'biweekly') {
            averageMove = calculateAverageMove(candles, windowEnd, duration, 4);
        } else if (timeframe === 'monthly') {
            averageMove = calculateAverageMove(candles, windowEnd, duration, 3);
        }

        edgeData[timeframe] = {
            ...move,
            averageMove
        };
    }

    return edgeData;
}

async function generateEnhancedPivotData() {
    console.log(`
▶ Generating Enhanced Pivot Data for ${symbol} [${interval}] using ${api}
`);

    // Configuration for pivot detection
    const pivotConfig = {
        minSwingPct,
        shortWindow,
        longWindow,
        confirmOnClose,
        minLegBars
    };

    const tracker = new PivotTracker(pivotConfig);
    const pivots = [];

    // 1. Get candles
    console.log('Reading candles from local data...');
    const candlesPerDay = 24 * 60; // 1440 candles per day
    const daysNeeded = 31; // Need a month of data for edge calculations
    const neededCandles = Math.max(limit, candlesPerDay * daysNeeded);
    
    const candles = await fetchCandles(symbol, interval, neededCandles, api, delay);
    candles.sort((a, b) => a.time - b.time);
    console.log(`Processing ${candles.length} candles from ${neededCandles} total`);

    // Show data range
    const startDate = new Date(candles[0].time).toLocaleString();
    const endDate = new Date(candles[candles.length - 1].time).toLocaleString();
    console.log('Data Range:');
    console.log(`Start: ${startDate}`);
    console.log(`End: ${endDate}
`);

    // 2. Process candles in batches
    const batchSize = 1000;
    
    for (let i = 0; i < candles.length; i += batchSize) {
        const batch = candles.slice(i, i + batchSize);
        const progress = ((i + batchSize) / candles.length * 100).toFixed(2);
        const processedCandles = Math.min(i + batchSize, candles.length);
        console.log(`Progress: ${progress}% (${processedCandles}/${candles.length} candles)...`);
        
        for (const candle of batch) {
            const pivot = tracker.update(candle);
            if (pivot) {
                // Calculate edges silently to avoid cluttering progress display
                process.stdout.write(`\rFound pivot at ${new Date(pivot.time).toLocaleString()}...                    \r`);
                
                // Calculate edge data for each timeframe
                const edgeData = {};
                for (const [timeframe, duration] of Object.entries(timeframes)) {
                    process.stdout.write(`\rCalculating ${timeframe} edges...                    `);
                    const windowEnd = pivot.time;
                    const windowStart = windowEnd - duration;
                    
                    const move = calculateMove(candles, windowStart, windowEnd);
                    if (!move) continue;

                    let averageMove = null;
                    if (timeframe === 'daily') {
                        process.stdout.write(`\rCalculating daily averages (7d, 14d, 30d)...    `);
                        averageMove = {
                            week: calculateAverageMove(candles, windowEnd, duration, 7),
                            twoWeeks: calculateAverageMove(candles, windowEnd, duration, 14),
                            month: calculateAverageMove(candles, windowEnd, duration, 30)
                        };
                    } else {
                        const periods = timeframe === 'monthly' ? 3 : 4;
                        averageMove = calculateAverageMove(candles, windowEnd, duration, periods);
                    }

                    edgeData[timeframe] = { ...move, averageMove };
                }
                // Clear the pivot message
                process.stdout.write('\r                                                                              \r');
                
                pivots.push({
                    ...pivot,
                    edges: edgeData
                });
            }
        }
        if ((i + batchSize) % 10000 === 0) {
            console.log(`
Processed ${i + batchSize} candles...`);
        }
    }

    console.log(`Total enhanced pivots found: ${pivots.length}`);

    // 3. Save enhanced pivot data
    console.log('\nSaving enhanced pivot data to cache...');
    savePivotData(symbol, interval + '_enhanced', pivots, pivotConfig, { 
        candles,
        generatedAt: Date.now(),
        lastUpdate: Date.now()
    });

    console.log('\n✅ Enhanced pivot data generation complete!');
    console.log('You can now use this data for advanced edge-aware analysis');
}

// Run the generator
generateEnhancedPivotData().catch(console.error);
