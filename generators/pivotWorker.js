// pivotWorker.js
import { parentPort } from 'worker_threads';
import PivotTracker from '../utils/pivotTracker.js';

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

    const hourAgo = windowEnd - (60 * 60 * 1000);
    const recentCandles = candles.filter(c => c.time >= hourAgo && c.time <= windowEnd);
    const direction = recentCandles.length > 1 ? 
        (recentCandles[recentCandles.length-1].close > recentCandles[0].close ? 1 : -1) : 0;

    return {
        high: highCandle.high,
        highTime: highCandle.time,
        low: lowCandle.low,
        lowTime: lowCandle.time,
        current: currentPrice,
        move: parseFloat((direction * move).toFixed(2)),
        position: parseFloat((direction * currentMove).toFixed(2))
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
