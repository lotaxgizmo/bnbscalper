// enhancedPivotWorker.js
// Enhanced worker with improved pivot detection and timestamp handling
import { parentPort } from 'worker_threads';

// Enhanced PivotTracker class with proper timestamp handling and candle storage
class EnhancedPivotTracker {
    constructor(config) {
        this.minSwingPct = config.minSwingPct / 100;
        this.confirmOnClose = config.confirmOnClose || false;
        this.minLegBars = config.minLegBars || 3;
        
        this.direction = null;
        this.pivotPrice = null;
        this.pivotTime = null;
        this.extremePrice = null;
        this.extremeTime = null;
        this.extremeCandle = null; // Store the entire candle where extreme was found
        this.legBars = 0;
    }
    
    update(candle) {
        const { high, low, close, time } = candle;
        const price = close; // Use closing price for simplicity
        
        // Initialize on first candle
        if (this.direction === null) {
            this.direction = 'up'; // Assume starting direction
            this.extremePrice = low;
            this.extremeTime = time;
            this.extremeCandle = {...candle}; // Store full candle
            this.pivotPrice = low;
            this.pivotTime = time;
            this.legBars = 1;
            return null;
        }
        
        // Track leg bars
        this.legBars++;
        
        // Looking for higher highs (in uptrend)
        if (this.direction === 'up') {
            // New high found, update extreme
            if (high > this.extremePrice) {
                this.extremePrice = high;
                this.extremeTime = time;
                this.extremeCandle = {...candle}; // Store full candle where high was found
                this.legBars = 1; // Reset leg bars
                return null;
            }
            
            // When confirmOnClose is true, use closing price for confirmation
            // but still track the actual high as the pivot price
            const reference = this.confirmOnClose ? price : low;
            const retrace = (this.extremePrice - reference) / this.extremePrice;
            
            // Check for a significant retracement
            if (retrace >= this.minSwingPct && this.legBars >= this.minLegBars) {
                // Confirm pivot high
                const pivot = this._confirmPivot('high', candle);
                
                // Switch direction
                this.direction = 'down';
                this.extremePrice = low;
                this.extremeTime = time;
                this.extremeCandle = {...candle}; // Store full candle
                this.legBars = 1;
                
                return pivot;
            }
        }
        // Looking for lower lows (in downtrend)
        else if (this.direction === 'down') {
            // New low found, update extreme
            if (low < this.extremePrice) {
                this.extremePrice = low;
                this.extremeTime = time;
                this.extremeCandle = {...candle}; // Store full candle where low was found
                this.legBars = 1; // Reset leg bars
                return null;
            }
            
            // When confirmOnClose is true, use closing price for confirmation
            // but still track the actual low as the pivot price
            const reference = this.confirmOnClose ? price : high;
            const retrace = (reference - this.extremePrice) / reference;
            
            // Check for a significant retracement
            if (retrace >= this.minSwingPct && this.legBars >= this.minLegBars) {
                // Confirm pivot low
                const pivot = this._confirmPivot('low', candle);
                
                // Switch direction
                this.direction = 'up';
                this.extremePrice = high;
                this.extremeTime = time;
                this.extremeCandle = {...candle}; // Store full candle
                this.legBars = 1;
                
                return pivot;
            }
        }
        
        return null;
    }
    
    _confirmPivot(type, confirmationCandle) {
        // Calculate move percentage
        let movePct = 0;
        if (this.pivotPrice) {
            if (type === 'high') {
                movePct = ((this.extremePrice - this.pivotPrice) / this.pivotPrice) * 100;
            } else {
                movePct = ((this.pivotPrice - this.extremePrice) / this.pivotPrice) * 100;
            }
        }
        
        // Create pivot object with both extreme and confirmation data
        const pivot = {
            type,
            price: this.extremePrice,
            time: this.extremeTime,
            previousPrice: this.pivotPrice,
            previousTime: this.pivotTime,
            movePct,
            bars: this.legBars,
            confirmedOnClose: this.confirmOnClose,
            displayTime: new Date(this.extremeTime * 1000).toLocaleTimeString(),
            confirmationTime: confirmationCandle.time,
            confirmationDisplayTime: new Date(confirmationCandle.time * 1000).toLocaleTimeString(),
            // Store the original candle where the extreme price was found
            extremeCandle: this.extremeCandle,
            // Also store the confirmation candle
            confirmationCandle: {...confirmationCandle}
        };
        
        // Update pivot price/time for next pivot calculation
        this.pivotPrice = this.extremePrice;
        this.pivotTime = this.extremeTime;
        
        return pivot;
    }
}

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
    const positionPct = ((currentPrice - referencePrice) / referencePrice) * 100;
    
    // Calculate total range relative to reference
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
parentPort.on('message', ({ batch, pivotConfig, candles, timeframes, workerId, hasOverlap, overlapSize, actualStartIndex }) => {
    // Use enhanced pivot tracker instead of the standard one
    const tracker = new EnhancedPivotTracker(pivotConfig);
    const pivots = [];
    let lastProgress = 0;

    // Process all candles in a single chronological pass
    for (let i = 0; i < batch.length; i++) {
        const candle = batch[i];
        const pivot = tracker.update(candle);
        
        // Report progress every 5%
        const progress = Math.floor((i / batch.length) * 100);
        if (progress % 5 === 0 && progress !== lastProgress) {
            parentPort.postMessage({ type: 'progress', workerId, progress });
            lastProgress = progress;
        }
        
        // Only consider pivots that are within this worker's actual responsibility range
        // Skip pivots found in the overlap region (except for the first worker)
        const isInOverlapRegion = hasOverlap && i < overlapSize;
        
        if (pivot && !isInOverlapRegion) {
            // Calculate edge data for this pivot
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
            
            // Add validation data to ensure pivot matches actual candle data
            const matchingCandle = candles.find(c => c.time === pivot.time);
            if (matchingCandle) {
                // This validation data is already included in the pivot.extremeCandle
                // But we'll add it here for backward compatibility
                pivot.candleData = {
                    open: matchingCandle.open,
                    high: matchingCandle.high,
                    low: matchingCandle.low,
                    close: matchingCandle.close
                };
            }
            
            pivots.push({
                ...pivot,
                edges: edgeData,
                batchId: workerId // Add batch ID for debugging
            });
        }
    }

    parentPort.postMessage({ type: 'complete', pivots });
});
