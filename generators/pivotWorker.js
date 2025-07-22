// pivotWorker.js
import { parentPort } from 'worker_threads';
import PivotTracker from '../utils/pivotTracker.js';

// Calculate move within a specific time window
function calculateMove(candles, windowStart, windowEnd) {
    const windowCandles = candles.filter(c => c.time >= windowStart && c.time <= windowEnd);
    
    if (!windowCandles.length) return null;
    
    // Get reference price from start of period
    const referencePrice = windowCandles[0].open;
    const currentPrice = windowCandles[windowCandles.length - 1].close;
    
    // Track high and low for total range
    let highPrice = windowCandles[0].high;
    let lowPrice = windowCandles[0].low;
    let highTime = windowCandles[0].time;
    let lowTime = windowCandles[0].time;
    
    for (const candle of windowCandles) {
        if (candle.high > highPrice) {
            highPrice = candle.high;
            highTime = candle.time;
        }
        if (candle.low < lowPrice) {
            lowPrice = candle.low;
            lowTime = candle.time;
        }
    }
    
    // Calculate position relative to reference (start of period)
    // This will naturally be positive when above reference, negative when below
    const positionPct = ((currentPrice - referencePrice) / referencePrice) * 100;
    
    // Calculate total range - always positive
    const totalRange = ((highPrice - lowPrice) / referencePrice) * 100;

    return {
        high: highPrice,
        highTime: highTime,
        low: lowPrice,
        lowTime: lowTime,
        current: currentPrice,
        reference: referencePrice,
        // Total range is always positive
        move: parseFloat(totalRange.toFixed(2)),
        // Position maintains its sign to show where we are relative to reference
        position: parseFloat(positionPct.toFixed(2))
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

// Process batch of candles
parentPort.on('message', ({ batch, pivotConfig, candles, timeframes, workerId }) => {
    const tracker = new PivotTracker(pivotConfig);
    const pivots = [];
    let lastProgress = 0;

    for (let i = 0; i < batch.length; i++) {
        const candle = batch[i];
        const pivot = tracker.update(candle);
        
        // Report progress every 5%
        const progress = Math.floor((i / batch.length) * 100);
        if (progress % 5 === 0 && progress !== lastProgress) {
            parentPort.postMessage({ type: 'progress', workerId, progress });
            lastProgress = progress;
        }
        if (pivot) {
            const edgeData = {};
            for (const [timeframe, duration] of Object.entries(timeframes)) {
                const windowEnd = pivot.time;
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
                } else {
                    const periods = timeframe === 'monthly' ? 3 : 4;
                    averageMove = calculateAverageMove(candles, windowEnd, duration, periods);
                }

                edgeData[timeframe] = { ...move, averageMove };
            }
            
            pivots.push({
                ...pivot,
                edges: edgeData
            });
        }
    }

    parentPort.postMessage({ type: 'complete', pivots });
});
