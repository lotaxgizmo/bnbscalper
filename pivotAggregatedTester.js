// pivotAggregatedTester.js
// Simple 1m-aggregated pivot detection tester - focuses only on pivot detection

import {
    symbol,
    useLocalData,
    pivotDetectionMode
} from './config/config.js';

import { multiPivotConfig } from './config/multiPivotConfig.js';
import { CandleAggregator } from './zaggregator/candleAggregator.js';
import { getCandles } from './apis/bybit.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ===== UTILITY FUNCTIONS =====
/**
 * Parse timeframe string to minutes
 * Supports: 1m, 5m, 15m, 1h, 4h, 1d, etc.
 */
function parseTimeframeToMinutes(timeframe) {
    const tf = timeframe.toLowerCase();
    
    if (tf.endsWith('m')) {
        return parseInt(tf.replace('m', ''));
    } else if (tf.endsWith('h')) {
        return parseInt(tf.replace('h', '')) * 60;
    } else if (tf.endsWith('d')) {
        return parseInt(tf.replace('d', '')) * 60 * 24;
    } else if (tf.endsWith('w')) {
        return parseInt(tf.replace('w', '')) * 60 * 24 * 7;
    } else {
        // Default to minutes if no suffix
        return parseInt(tf);
    }
}

/**
 * Format timestamp to dual time format: MM/DD/YYYY 12:00:00AM | 12:00:00
 */
function formatDualTime(timestamp) {
    const date = new Date(timestamp);
    const dateStr = date.toLocaleDateString('en-US', {
        month: '2-digit',
        day: '2-digit', 
        year: 'numeric'
    });
    const time12 = date.toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit',
        second: '2-digit',
        hour12: true 
    });
    const time24 = date.toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit',
        second: '2-digit',
        hour12: false 
    });
    return `${dateStr} ${time12} | ${time24}`;
}

// ===== CONFIGURATION =====
const TEST_CONFIG = {
    // Data source settings
    useLiveAPI: true,       // true = Force API data (live), false = Use config.js setting
    
    // Data duration settings
    maxCandles: 1440,        // ~30 days of 1m candles (43200 = 30 * 24 * 60)
    // Alternative durations:
    // 1440 = 1 day, 10080 = 1 week, 43200 = 30 days, 525600 = 1 year
    
    // Output settings
    showEveryNthPivot: 1,    // Show every 10th pivot to reduce spam
    showFirstNPivots: 10000,      // Always show first 5 pivots per timeframe
    progressEvery: 10000      // Show progress every N candles
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const colors = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    magenta: '\x1b[35m',
    blue: '\x1b[34m'
};

// Load 1m candles
async function load1mCandles() {
    console.log(`${colors.cyan}Loading 1m candles...${colors.reset}`);
    
    // Use live API if explicitly configured, otherwise follow config.js setting
    const shouldUseAPI = TEST_CONFIG.useLiveAPI || !useLocalData;
    
    if (!shouldUseAPI) {
        const csvPath = path.join(__dirname, 'data', 'historical', symbol, '1m.csv');
        if (!fs.existsSync(csvPath)) {
            throw new Error(`Local 1m data not found: ${csvPath}`);
        }
        
        const csvData = fs.readFileSync(csvPath, 'utf8');
        const lines = csvData.trim().split('\n').slice(1); // Skip header
        
        const candles = lines.map(line => {
            const [timestamp, open, high, low, close, volume] = line.split(',');
            return {
                time: parseInt(timestamp),
                open: parseFloat(open),
                high: parseFloat(high),
                low: parseFloat(low),
                close: parseFloat(close),
                volume: parseFloat(volume)
            };
        }).sort((a, b) => a.time - b.time);
        
        // Take only the LATEST maxCandles (most recent data)
        const limitedCandles = candles.slice(-TEST_CONFIG.maxCandles);
        
        console.log(`${colors.green}Loaded ${limitedCandles.length} 1m candles from CSV (latest ${TEST_CONFIG.maxCandles} requested)${colors.reset}`);
        return limitedCandles;
    } else {
        const candles = await getCandles(symbol, '1m', TEST_CONFIG.maxCandles);
        console.log(`${colors.green}Loaded ${candles.length} 1m candles from API${colors.reset}`);
        return candles.sort((a, b) => a.time - b.time);
    }
}

// Pivot detection function
function detectPivot(candles, index, config) {
    const { pivotLookback, minSwingPct, minLegBars } = config;
    
    if (index < pivotLookback || index >= candles.length) return null;
    
    const currentCandle = candles[index];
    const currentHigh = pivotDetectionMode === 'close' ? currentCandle.close : currentCandle.high;
    const currentLow = pivotDetectionMode === 'close' ? currentCandle.close : currentCandle.low;
    
    // Check for high pivot
    let isHighPivot = true;
    for (let j = 1; j <= pivotLookback; j++) {
        if (index - j < 0) {
            isHighPivot = false;
            break;
        }
        const compareHigh = pivotDetectionMode === 'close' ? candles[index - j].close : candles[index - j].high;
        if (currentHigh <= compareHigh) {
            isHighPivot = false;
            break;
        }
    }
    
    // Check for low pivot
    let isLowPivot = true;
    for (let j = 1; j <= pivotLookback; j++) {
        if (index - j < 0) {
            isLowPivot = false;
            break;
        }
        const compareLow = pivotDetectionMode === 'close' ? candles[index - j].close : candles[index - j].low;
        if (currentLow >= compareLow) {
            isLowPivot = false;
            break;
        }
    }
    
    if (!isHighPivot && !isLowPivot) return null;
    
    const pivotType = isHighPivot ? 'high' : 'low';
    const pivotPrice = isHighPivot ? currentHigh : currentLow;
    
    // Validate minimum leg bars requirement (distance from last opposite pivot)
    if (minLegBars > 1) {
        let barsFromOpposite = 0;
        const oppositeType = pivotType === 'high' ? 'low' : 'high';
        
        // Count bars since last opposite pivot type
        for (let j = 1; j <= Math.min(pivotLookback * 3, index); j++) {
            if (index - j < 0) break;
            
            const checkCandle = candles[index - j];
            const checkHigh = pivotDetectionMode === 'close' ? checkCandle.close : checkCandle.high;
            const checkLow = pivotDetectionMode === 'close' ? checkCandle.close : checkCandle.low;
            
            // Check if this candle was an opposite pivot
            let wasOppositePivot = false;
            if (oppositeType === 'high') {
                // Check if it was higher than surrounding candles
                let isHigher = true;
                for (let k = 1; k <= Math.min(pivotLookback, j, index - j); k++) {
                    if (index - j - k >= 0 && checkHigh <= (pivotDetectionMode === 'close' ? candles[index - j - k].close : candles[index - j - k].high)) {
                        isHigher = false;
                        break;
                    }
                    if (index - j + k < candles.length && checkHigh <= (pivotDetectionMode === 'close' ? candles[index - j + k].close : candles[index - j + k].high)) {
                        isHigher = false;
                        break;
                    }
                }
                wasOppositePivot = isHigher;
            } else {
                // Check if it was lower than surrounding candles
                let isLower = true;
                for (let k = 1; k <= Math.min(pivotLookback, j, index - j); k++) {
                    if (index - j - k >= 0 && checkLow >= (pivotDetectionMode === 'close' ? candles[index - j - k].close : candles[index - j - k].low)) {
                        isLower = false;
                        break;
                    }
                    if (index - j + k < candles.length && checkLow >= (pivotDetectionMode === 'close' ? candles[index - j + k].close : candles[index - j + k].low)) {
                        isLower = false;
                        break;
                    }
                }
                wasOppositePivot = isLower;
            }
            
            if (wasOppositePivot) {
                barsFromOpposite = j;
                break;
            }
        }
        
        // Reject pivot if not enough bars from last opposite pivot
        if (barsFromOpposite > 0 && barsFromOpposite < minLegBars) {
            return null;
        }
    }
    
    // Validate minimum swing percentage requirement
    if (minSwingPct > 0) {
        let maxSwingPct = 0;
        
        for (let j = 1; j <= pivotLookback; j++) {
            if (index - j < 0) break;
            
            const compareCandle = candles[index - j];
            const comparePrice = pivotDetectionMode === 'close' ? compareCandle.close : 
                                (pivotType === 'high' ? compareCandle.low : compareCandle.high);
            
            const swingPct = Math.abs((pivotPrice - comparePrice) / comparePrice * 100);
            maxSwingPct = Math.max(maxSwingPct, swingPct);
        }
        
        // Reject pivot if swing percentage is below minimum threshold
        if (maxSwingPct < minSwingPct) {
            return null;
        }
    }
    
    return {
        type: pivotType,
        price: pivotPrice,
        time: currentCandle.time,
        index: index,
        signal: pivotType === 'high' ? 'short' : 'long' // Inverted signals per memory
    };
}

// Parse timeframe string to milliseconds
function parseTimeframeToMs(tf) {
    if (typeof tf === "number" && Number.isFinite(tf)) return tf;
    if (typeof tf !== "string") throw new Error(`Invalid timeframe: ${tf}`);
    const m = tf.trim().toLowerCase();
    const match = m.match(/^(\d+)([smhd])$/);
    if (!match) throw new Error(`Invalid timeframe string: ${tf}`);
    const value = parseInt(match[1], 10);
    const unit = match[2];
    const unitMs = unit === "s" ? 1000 : unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;
    return value * unitMs;
}

// Custom immediate aggregation - builds higher TF candles immediately when complete
function buildImmediateAggregatedCandles(oneMinCandles, timeframeMinutes) {
    const aggregatedCandles = [];
    const bucketSizeMs = timeframeMinutes * 60 * 1000;
    
    // Group 1m candles into timeframe buckets
    const buckets = new Map();
    
    for (const candle of oneMinCandles) {
        // Calculate bucket END time (e.g., for 15m: 6:15, 6:30, 6:45, etc.)
        // The 6:45 candle contains data from 6:30-6:45, so we bucket by END time
        const bucketEnd = Math.ceil(candle.time / bucketSizeMs) * bucketSizeMs;
        
        if (!buckets.has(bucketEnd)) {
            buckets.set(bucketEnd, []);
        }
        buckets.get(bucketEnd).push(candle);
    }
    
     
    
    // Build aggregated candles from complete buckets
    for (const [bucketEnd, candlesInBucket] of buckets.entries()) {
        // Only create aggregated candle if we have the expected number of 1m candles
        if (candlesInBucket.length === timeframeMinutes) {
            const sortedCandles = candlesInBucket.sort((a, b) => a.time - b.time);
            
            const aggregatedCandle = {
                time: bucketEnd, // Use bucket end time as the candle time
                open: sortedCandles[0].open,
                high: Math.max(...sortedCandles.map(c => c.high)),
                low: Math.min(...sortedCandles.map(c => c.low)),
                close: sortedCandles[sortedCandles.length - 1].close,
                volume: sortedCandles.reduce((sum, c) => sum + c.volume, 0)
            };
            
            aggregatedCandles.push(aggregatedCandle);
        }
    }
    
    return aggregatedCandles.sort((a, b) => a.time - b.time);
}

// Main pivot testing function
async function runPivotTest() {
    const currentTime = new Date().toLocaleString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });
    
    console.log(`${colors.cyan}=== 1m-Aggregated Pivot Detection Test ===${colors.reset}`);
    console.log(`${colors.magenta}Time: ${currentTime}${colors.reset}`);
    console.log(`${colors.yellow}Symbol: ${symbol}${colors.reset}`);
    
    const shouldUseAPI = TEST_CONFIG.useLiveAPI || !useLocalData;
    const dataSourceText = TEST_CONFIG.useLiveAPI ? 'Live API (forced)' : (useLocalData ? 'Local CSV' : 'API');
    console.log(`${colors.yellow}Data Source: ${dataSourceText}${colors.reset}`);
    console.log(`${colors.yellow}Detection Mode: ${pivotDetectionMode}${colors.reset}`);
    
    // Load 1m candles
    const oneMinuteCandles = await load1mCandles();
    
    // Debug: Show the latest candles to understand timing
    // console.log(`${colors.cyan}\nDEBUG - Latest 1m candles:${colors.reset}`);
    // const latest10 = oneMinuteCandles.slice(-10);
    // latest10.forEach((candle, i) => {
    //     const timeStr = formatDualTime(candle.time);
    //     const isLatest = i === latest10.length - 1;
    //     console.log(`${isLatest ? colors.red : colors.dim}${timeStr} | O:${candle.open} H:${candle.high} L:${candle.low} C:${candle.close}${colors.reset}`);
    // });
    
    // Setup aggregator with all timeframes
    const timeframes = multiPivotConfig.timeframes.map(tf => tf.interval);
    const aggregator = new CandleAggregator(timeframes, { keepSeries: true });
    
    console.log(`${colors.cyan}\nDEBUG - Processing ${oneMinuteCandles.length} 1m candles...${colors.reset}`);
    
    // Pivot counters per timeframe
    const pivotCounts = {};
    timeframes.forEach(tf => pivotCounts[tf] = 0);
    
    console.log(`${colors.cyan}\nTimeframes to test: ${timeframes.join(', ')}${colors.reset}`);
    console.log(`${colors.cyan}Starting IMMEDIATE aggregation pivot detection test...${colors.reset}\n`);
    
    // Process each timeframe with immediate aggregation
    for (const tfConfig of multiPivotConfig.timeframes) {
        const tf = tfConfig.interval;
        const timeframeMinutes = parseTimeframeToMinutes(tf);
        
        console.log(`${colors.yellow}\n=== Processing ${tf} timeframe (${timeframeMinutes} minutes) ===${colors.reset}`);
        
        // Build aggregated candles immediately when complete
        const aggregatedCandles = buildImmediateAggregatedCandles(oneMinuteCandles, timeframeMinutes);
        
        console.log(`${colors.green}Built ${aggregatedCandles.length} complete ${tf} candles from ${oneMinuteCandles.length} 1m candles${colors.reset}`);
        
        // Show latest aggregated candles for debugging
        // const latest5 = aggregatedCandles.slice(-5);
        // console.log(`${colors.cyan}Latest ${tf} candles:${colors.reset}`);
        // latest5.forEach(candle => {
        //     const timeStr = new Date(candle.time).toLocaleString();
        //     console.log(`  ${timeStr} | O:${candle.open} H:${candle.high} L:${candle.low} C:${candle.close}`);
        // });
        
        // Detect pivots on aggregated candles
        for (let i = tfConfig.lookback; i < aggregatedCandles.length; i++) {
            const pivot = detectPivot(aggregatedCandles, i, {
                pivotLookback: tfConfig.lookback,
                minSwingPct: tfConfig.minSwingPct,
                minLegBars: tfConfig.minLegBars
            });
            
            if (pivot) {
                pivotCounts[tf]++;
                
                // Only show pivots occasionally to avoid spam
                if (pivotCounts[tf] % TEST_CONFIG.showEveryNthPivot === 1 || pivotCounts[tf] <= TEST_CONFIG.showFirstNPivots) {
                    const timeStr = formatDualTime(pivot.time);
                    
                    // Calculate percentage movement from previous candle
                    let movementPct = '';
                    if (i > 0) {
                        const prevCandle = aggregatedCandles[i - 1];
                        const refPrice = pivot.type === 'high' ? prevCandle.low : prevCandle.high;
                        const pctMove = ((pivot.price - refPrice) / refPrice * 100);
                        movementPct = ` [${pctMove > 0 ? '+' : ''}${pctMove.toFixed(3)}%]`;
                    }
                    
                    console.log(`${colors.magenta}#${pivotCounts[tf]} [${timeStr}] ${tf} ${pivot.type.toUpperCase()} pivot @ $${pivot.price.toFixed(2)} (${pivot.signal.toUpperCase()}) - IMMEDIATE${movementPct}${colors.reset}`);
                }
            }
        }
    }
    
    // Final results
    console.log(`\n${colors.cyan}=== PIVOT DETECTION RESULTS ===${colors.reset}`);
    for (const tf of timeframes) {
        console.log(`${colors.yellow}${tf}: ${colors.green}${pivotCounts[tf]} pivots detected${colors.reset}`);
    }
    
    const dataSpan = (oneMinuteCandles[oneMinuteCandles.length - 1].time - oneMinuteCandles[0].time) / (1000 * 60 * 60 * 24);
    console.log(`${colors.cyan}Data Span: ${dataSpan.toFixed(1)} days${colors.reset}`);
    
    console.log(`\n${colors.cyan}--- Pivot Detection Test Complete ---${colors.reset}`);
}

// Run the tester
(async () => {
    try {
        await runPivotTest();
    } catch (err) {
        console.error('\nAn error occurred during pivot testing:', err);
        process.exit(1);
    }
})();
