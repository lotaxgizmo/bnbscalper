// generateEdgePivots.js
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

// Pre-calculate edges for all timeframes
function calculateAllTimeframeEdges(candles) {
    const msPerDay = 24 * 60 * 60 * 1000;
    const timeframes = {
        daily: msPerDay,
        weekly: 7 * msPerDay,
        biweekly: 14 * msPerDay,
        monthly: 30 * msPerDay
    };
    
    const edges = {};
    
    // Pre-sort candles by time for faster access
    candles.sort((a, b) => a.time - b.time);
    
    for (const [timeframe, duration] of Object.entries(timeframes)) {
        const changes = [];
        let windowStart = candles[0].time;
        const lastTime = candles[candles.length - 1].time;
        
        // Use sliding windows with fixed steps
        while (windowStart < lastTime) {
            const windowEnd = windowStart + duration;
            let high = -Infinity;
            let low = Infinity;
            
            // Find high/low in this window efficiently
            for (const candle of candles) {
                if (candle.time < windowStart) continue;
                if (candle.time > windowEnd) break;
                
                high = Math.max(high, candle.high);
                low = Math.min(low, candle.low);
            }
            
            if (high !== -Infinity && low !== Infinity) {
                const change = ((high - low) / low) * 100;
                changes.push(change);
            }
            
            windowStart += duration / 4; // Slide by quarter timeframe for better coverage
        }
        
        edges[timeframe] = {
            max: Math.max(...changes),
            min: -Math.max(...changes) // Assuming symmetrical moves
        };
    }
    
    return edges;
}

// Calculate current position relative to pre-calculated edges
function calculateEdgePosition(currentPrice, candles, timeframe, edges, timeframeDuration) {
    const windowStart = currentPrice.time - timeframeDuration;
    let startPrice = currentPrice.close;
    
    // Find start price efficiently
    for (let i = candles.length - 1; i >= 0; i--) {
        if (candles[i].time <= windowStart) {
            startPrice = candles[i].close;
            break;
        }
    }
    
    const change = ((currentPrice.close - startPrice) / startPrice) * 100;
    const position = change;
    const percentToEdge = position > 0 ? 
        (position / edges[timeframe].max) * 100 : 
        (position / edges[timeframe].min) * 100;
    

    
    return {
        max: edges[timeframe].max,
        min: edges[timeframe].min,
        position: position,
        percentToEdge: Math.abs(percentToEdge),
        direction: position > 0 ? "upper" : "lower"
    };
}

async function generateEdgePivots() {
    // Configuration for pivot detection
    const pivotConfig = {
        minSwingPct,
        shortWindow,
        longWindow,
        confirmOnClose,
        minLegBars
    };

    // 1. Fetch candles
    const candles = await fetchCandles(symbol, interval, limit, api, delay);

    if (!candles.length) {
        console.error('❌ No candles fetched. Exiting.');
        process.exit(1);
    }

    // 2. Pre-calculate edges for all timeframes
    const msPerDay = 24 * 60 * 60 * 1000;
    const timeframeDurations = {
        daily: msPerDay,
        weekly: 7 * msPerDay,
        biweekly: 14 * msPerDay,
        monthly: 30 * msPerDay
    };
    const edges = calculateAllTimeframeEdges(candles);

    // 3. Process candles and detect pivots with edge data
    const tracker = new PivotTracker(pivotConfig);
    const pivots = [];

    // Process all candles in batches
    const batchSize = 1000;
    
    for (let i = 0; i < candles.length; i += batchSize) {
        const batch = candles.slice(i, i + batchSize);
        for (const candle of batch) {
            const pivot = tracker.update(candle);
            if (pivot) {
                // Enhance pivot with edge data using pre-calculated edges
                pivot.edges = {
                    daily: calculateEdgePosition(candle, candles, 'daily', edges, timeframeDurations.daily),
                    weekly: calculateEdgePosition(candle, candles, 'weekly', edges, timeframeDurations.weekly),
                    biweekly: calculateEdgePosition(candle, candles, 'biweekly', edges, timeframeDurations.biweekly),
                    monthly: calculateEdgePosition(candle, candles, 'monthly', edges, timeframeDurations.monthly)
                };

                pivots.push(pivot);
            }
        }
        const progress = ((i + batchSize) / candles.length * 100).toFixed(2);
        console.log(`Progress: ${progress}% (${i + batchSize}/${candles.length} candles)...`);
    }

    // 3. Save pivot data
    savePivotData(symbol, interval, pivots, pivotConfig, { 
        candles,
        generatedAt: Date.now(),
        lastUpdate: Date.now(),
        edgeAnalysis: true // Flag to indicate this contains edge data
    });


}

// Run the generator
generateEdgePivots().catch(console.error);
