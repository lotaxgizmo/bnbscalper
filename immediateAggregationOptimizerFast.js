// immediateAggregationOptimizerFast.js
// Ultra-high performance optimizer with all optimizations applied
// No workers, pre-loaded data, caching, parallel processing

// ===== OPTIMIZATION CONFIGURATION =====
const OPTIMIZATION_CONFIG = {
    takeProfitRange: { start: 0.9, end: 0.9, step: 0.1 },
    stopLossRange: { start: 0.4, end: 0.4, step: 0.1 },
    leverageRange: { start: 1, end: 1, step: 1 },
    minimumTimeframes: 1,
    tradingModes: ['pivot'],  
    maxCandles: 20160, // 14 days of 1m candles 
    tradeDirection: ['both'],
    
    timeframeCombinations: [ 
        [
            {
                interval: '4h',
                role: 'primary',
                minSwingPctRange: { start: 0.1, end: 0.1, step: 0.1 },
                lookbackRange: { start: 1, end: 1, step: 1 },
                minLegBarsRange: { start: 1, end: 1, step: 1 },               
                weight: 1,
                oppositeRange: [false]
            }
        ]
    ]
};

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const colors = {
    reset: '\x1b[0m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
    cyan: '\x1b[36m', magenta: '\x1b[35m', blue: '\x1b[34m', dim: '\x1b[2m', bold: '\x1b[1m'
};

// Global caches for maximum performance
const candleCache = new Map();
const aggregatedCandleCache = new Map();
const pivotCache = new Map();

// Import config files to mirror backtester settings
import { tradeConfig } from './config/tradeconfig.js';
import { symbol as configSymbol } from './config/config.js';
import { multiPivotConfig } from './config/multiAggConfig.js';

// Configuration variables
const symbol = configSymbol;
const maxCandles = OPTIMIZATION_CONFIG.maxCandles;

// Extract all parameter ranges from configuration
const timeframes = [...new Set(OPTIMIZATION_CONFIG.timeframeCombinations.flat().map(tf => parseTimeframeToMinutes(tf.interval)))];

// Extract parameter ranges from configuration
const allTimeframeConfigs = OPTIMIZATION_CONFIG.timeframeCombinations.flat();
const lookbacks = [...new Set(allTimeframeConfigs.flatMap(tf => {
    const range = tf.lookbackRange;
    const values = [];
    for (let i = range.start; i <= range.end; i += range.step) {
        values.push(i);
    }
    return values;
}))];

const minSwingPcts = [...new Set(allTimeframeConfigs.flatMap(tf => {
    const range = tf.minSwingPctRange;
    const values = [];
    for (let i = range.start; i <= range.end; i += range.step) {
        values.push(i);
    }
    return values;
}))];

const minLegBarsOptions = [...new Set(allTimeframeConfigs.flatMap(tf => {
    const range = tf.minLegBarsRange;
    const values = [];
    for (let i = range.start; i <= range.end; i += range.step) {
        values.push(i);
    }
    return values;
}))];

// Extract from top-level config
const takeProfits = [];
for (let i = OPTIMIZATION_CONFIG.takeProfitRange.start; i <= OPTIMIZATION_CONFIG.takeProfitRange.end; i += OPTIMIZATION_CONFIG.takeProfitRange.step) {
    takeProfits.push(i);
}

const stopLosses = [];
for (let i = OPTIMIZATION_CONFIG.stopLossRange.start; i <= OPTIMIZATION_CONFIG.stopLossRange.end; i += OPTIMIZATION_CONFIG.stopLossRange.step) {
    stopLosses.push(i);
}

const leverages = [];
for (let i = OPTIMIZATION_CONFIG.leverageRange.start; i <= OPTIMIZATION_CONFIG.leverageRange.end; i += OPTIMIZATION_CONFIG.leverageRange.step) {
    leverages.push(i);
}

// Use trade directions from optimization config
const tradeDirections = OPTIMIZATION_CONFIG.tradeDirection;

function formatNumber(num) {
    if (typeof num !== 'number') return num;
    return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Utility functions
function parseTimeframeToMinutes(timeframe) {
    const tf = timeframe.toLowerCase();
    if (tf.endsWith('m')) return parseInt(tf.replace('m', ''));
    if (tf.endsWith('h')) return parseInt(tf.replace('h', '')) * 60;
    if (tf.endsWith('d')) return parseInt(tf.replace('d', '')) * 60 * 24;
    if (tf.endsWith('w')) return parseInt(tf.replace('w', '')) * 60 * 24 * 7;
    return parseInt(tf);
}

// Load candles once and cache
async function loadCandlesOnce(symbol, maxCandles) {
    const cacheKey = `${symbol}_${maxCandles}`;
    if (candleCache.has(cacheKey)) return candleCache.get(cacheKey);
    
    const csvPath = path.join(__dirname, 'data', 'historical', symbol, '1m.csv');
    if (!fs.existsSync(csvPath)) throw new Error(`Local 1m data not found: ${csvPath}`);
    
    const csvData = fs.readFileSync(csvPath, 'utf8');
    const lines = csvData.trim().split('\n').slice(1);
    
    const candles = lines.map(line => {
        const [timestamp, open, high, low, close, volume] = line.split(',');
        return {
            time: parseInt(timestamp), open: parseFloat(open), high: parseFloat(high),
            low: parseFloat(low), close: parseFloat(close), volume: parseFloat(volume)
        };
    }).sort((a, b) => a.time - b.time).slice(-maxCandles);
    
    candleCache.set(cacheKey, candles);
    return candles;
}

// Build aggregated candles with caching
function buildAggregatedCandles(oneMinCandles, timeframeMinutes, cacheKey) {
    if (aggregatedCandleCache.has(cacheKey)) return aggregatedCandleCache.get(cacheKey);
    
    const aggregatedCandles = [];
    const bucketSizeMs = timeframeMinutes * 60 * 1000;
    const buckets = new Map();
    
    for (const candle of oneMinCandles) {
        const bucketEnd = Math.ceil(candle.time / bucketSizeMs) * bucketSizeMs;
        if (!buckets.has(bucketEnd)) buckets.set(bucketEnd, []);
        buckets.get(bucketEnd).push(candle);
    }
    
    for (const [bucketEnd, candlesInBucket] of buckets.entries()) {
        if (candlesInBucket.length === timeframeMinutes) {
            const sortedCandles = candlesInBucket.sort((a, b) => a.time - b.time);
            aggregatedCandles.push({
                time: bucketEnd,
                open: sortedCandles[0].open,
                high: Math.max(...sortedCandles.map(c => c.high)),
                low: Math.min(...sortedCandles.map(c => c.low)),
                close: sortedCandles[sortedCandles.length - 1].close,
                volume: sortedCandles.reduce((sum, c) => sum + c.volume, 0)
            });
        }
    }
    
    const result = aggregatedCandles.sort((a, b) => a.time - b.time);
    aggregatedCandleCache.set(cacheKey, result);
    return result;
}

// Load 1-minute candles from CSV
async function load1mCandles(symbol, maxCandles, useLocalData = true) {
    if (!useLocalData) {
        const { getCandles } = await import('./apis/bybit.js');
        const candles = await getCandles(symbol, '1m', maxCandles);
        return candles.sort((a, b) => a.time - b.time);
    }
    
    const csvPath = path.join(process.cwd(), 'data', 'historical', symbol, '1m.csv');
    
    if (!fs.existsSync(csvPath)) {
        throw new Error(`CSV file not found: ${csvPath}`);
    }
    
    const csvContent = fs.readFileSync(csvPath, 'utf8');
    const lines = csvContent.trim().split('\n');
    const candles = [];
    
    // Skip header if present
    const startIndex = lines[0].includes('time') ? 1 : 0;
    
    for (let i = startIndex; i < lines.length && candles.length < maxCandles; i++) {
        const parts = lines[i].split(',');
        if (parts.length >= 6) {
            candles.push({
                time: parseInt(parts[0]),
                open: parseFloat(parts[1]),
                high: parseFloat(parts[2]),
                low: parseFloat(parts[3]),
                close: parseFloat(parts[4]),
                volume: parseFloat(parts[5])
            });
        }
    }
    
    return candles.sort((a, b) => a.time - b.time).slice(-maxCandles);
}

// Optimized pivot detection with caching
function detectPivot(candles, index, config, pivotDetectionMode = 'close') {
    const { lookback, minSwingPct } = config;
    if (lookback === 0 && index === 0) return null;
    if (index < lookback || index >= candles.length) return null;
    
    const currentCandle = candles[index];
    const currentHigh = pivotDetectionMode === 'close' ? currentCandle.close : currentCandle.high;
    const currentLow = pivotDetectionMode === 'close' ? currentCandle.close : currentCandle.low;
    
    let isHighPivot = true, isLowPivot = true;
    
    if (lookback > 0) {
        for (let j = 1; j <= lookback; j++) {
            if (index - j < 0) { isHighPivot = false; isLowPivot = false; break; }
            const compareHigh = pivotDetectionMode === 'close' ? candles[index - j].close : candles[index - j].high;
            const compareLow = pivotDetectionMode === 'close' ? candles[index - j].close : candles[index - j].low;
            if (currentHigh <= compareHigh) isHighPivot = false;
            if (currentLow >= compareLow) isLowPivot = false;
        }
    } else {
        const prev = candles[index - 1];
        const prevHigh = pivotDetectionMode === 'close' ? prev.close : prev.high;
        const prevLow = pivotDetectionMode === 'close' ? prev.close : prev.low;
        isHighPivot = currentHigh > prevHigh;
        isLowPivot = currentLow < prevLow;
        
        if (isHighPivot && isLowPivot) {
            const upExcursion = Math.abs(currentHigh - prevHigh);
            const downExcursion = Math.abs(prevLow - currentLow);
            if (upExcursion >= downExcursion) isLowPivot = false;
            else isHighPivot = false;
        }
    }
    
    if (!isHighPivot && !isLowPivot) return null;
    
    const pivotType = isHighPivot ? 'high' : 'low';
    const pivotPrice = isHighPivot ? currentHigh : currentLow;
    
    // Calculate swing percentage
    let maxSwingPct = 0;
    if (minSwingPct > 0) {
        const upper = lookback === 0 ? 1 : lookback;
        for (let j = 1; j <= upper; j++) {
            if (index - j < 0) break;
            const compareCandle = candles[index - j];
            const comparePrice = pivotDetectionMode === 'close' ? compareCandle.close : 
                                (pivotType === 'high' ? compareCandle.low : compareCandle.high);
            const swingPct = Math.abs((pivotPrice - comparePrice) / comparePrice * 100);
            maxSwingPct = Math.max(maxSwingPct, swingPct);
        }
        if (maxSwingPct < minSwingPct) return null;
    }
    
    return {
        type: pivotType, price: pivotPrice, time: currentCandle.time, index: index,
        signal: pivotType === 'high' ? 'short' : 'long', swingPct: maxSwingPct
    };
}

// Detect all pivots with caching
function detectAllPivots(candles, config, pivotDetectionMode, cacheKey) {
    if (pivotCache.has(cacheKey)) return pivotCache.get(cacheKey);
    
    const pivots = [];
    let lastAcceptedPivotIndex = null;
    
    for (let i = config.lookback; i < candles.length; i++) {
        const pivot = detectPivot(candles, i, config, pivotDetectionMode);
        if (!pivot) continue;

        if (lastAcceptedPivotIndex !== null) {
            const barsSinceLast = i - lastAcceptedPivotIndex;
            if (typeof config.minLegBars === 'number' && barsSinceLast < config.minLegBars) continue;
        }

        pivots.push(pivot);
        lastAcceptedPivotIndex = i;
    }
    
    pivotCache.set(cacheKey, pivots);
    return pivots;
}

// Trade management functions
function createTrade(signal, pivot, tradeSize, currentTime, timeframe, entryPrice, tradeConfig) {
    const isLong = signal === 'long';
    const tpDistance = entryPrice * (tradeConfig.takeProfit / 100);
    const slDistance = entryPrice * (tradeConfig.stopLoss / 100);
    
    return {
        id: Date.now() + Math.random(), type: signal, timeframe, entryPrice, entryTime: currentTime,
        tradeSize, leverage: tradeConfig.leverage, status: 'open', exitPrice: null, exitTime: null,
        exitReason: '', pnl: 0, pnlPct: 0, pivot, bestPrice: entryPrice,
        takeProfitPrice: isLong ? entryPrice + tpDistance : entryPrice - tpDistance,
        stopLossPrice: isLong ? entryPrice - slDistance : entryPrice + slDistance
    };
}

function updateTrade(trade, currentCandle) {
    const currentPrice = currentCandle.close;
    const isLong = trade.type === 'long';
    
    if (isLong && currentPrice > trade.bestPrice) trade.bestPrice = currentPrice;
    else if (!isLong && currentPrice < trade.bestPrice) trade.bestPrice = currentPrice;
    
    let shouldClose = false, exitReason = '';
    
    if (isLong) {
        if (currentPrice >= trade.takeProfitPrice) { shouldClose = true; exitReason = 'TP'; }
        else if (currentPrice <= trade.stopLossPrice) { shouldClose = true; exitReason = 'SL'; }
    } else {
        if (currentPrice <= trade.takeProfitPrice) { shouldClose = true; exitReason = 'TP'; }
        else if (currentPrice >= trade.stopLossPrice) { shouldClose = true; exitReason = 'SL'; }
    }
    
    if (shouldClose) {
        trade.status = 'closed';
        trade.exitPrice = currentPrice;
        trade.exitTime = currentCandle.time;
        trade.exitReason = exitReason;
        
        const priceChange = isLong ? (trade.exitPrice - trade.entryPrice) : (trade.entryPrice - trade.exitPrice);
        trade.pnl = (priceChange / trade.entryPrice) * trade.tradeSize * trade.leverage;
        trade.pnlPct = (priceChange / trade.entryPrice) * 100 * trade.leverage;
        
        // Apply trading fees from config
        const feeRate = tradeConfig.totalMakerFee / 100; // Convert percentage to decimal
        trade.pnl -= trade.tradeSize * feeRate * 2; // Entry + exit fees
    }
    
    return shouldClose;
}

// Cascade confirmation function
function checkCascadeConfirmation(primaryPivot, allTimeframePivots, asOfTime, primaryInterval) {
    const confirmations = [];
    const proximityWindowMs = 5 * 60 * 1000; // ±5 minutes proximity
    const configuredMinutes = (multiPivotConfig.cascadeSettings?.confirmationWindow?.[primaryInterval]) ?? null;
    const configuredWindowMs = (configuredMinutes != null) ? (configuredMinutes * 60 * 1000) : null;
    const effectiveWindowMs = (configuredWindowMs != null) ? Math.min(proximityWindowMs, configuredWindowMs) : proximityWindowMs;

    for (const [timeframe, pivots] of Object.entries(allTimeframePivots)) {
        if (pivots.length === 0) continue;

        const tfConfig = multiPivotConfig.timeframes.find(tf => tf.interval === timeframe);
        if (!tfConfig) continue;

        const targetSignal = tfConfig.opposite ?
            (primaryPivot.signal === 'long' ? 'short' : 'long') :
            primaryPivot.signal;

        const recentPivots = pivots.filter(p =>
            p.signal === targetSignal &&
            Math.abs(p.time - primaryPivot.time) <= effectiveWindowMs &&
            p.time <= asOfTime
        );

        if (recentPivots.length > 0) {
            confirmations.push({
                timeframe: timeframe,
                role: tfConfig?.role || 'secondary',
                weight: tfConfig?.weight || 1,
                pivot: recentPivots[0],
                inverted: tfConfig?.opposite || false
            });
        }
    }

    return confirmations;
}

function meetsExecutionRequirements(confirmations) {
    const minRequired = multiPivotConfig.cascadeSettings?.minTimeframesRequired || 1;
    if (confirmations.length < minRequired) {
        return false;
    }
    
    const requirePrimary = multiPivotConfig.cascadeSettings?.requirePrimaryTimeframe || false;
    if (requirePrimary) {
        const hasPrimary = confirmations.some(c => c.role === 'primary');
        if (!hasPrimary) return false;
    }
    
    return true;
}

// Core backtesting function - optimized version with CASCADE mode
async function runOptimizedBacktest(params, oneMinuteCandles, aggregatedCandlesCache) {
    const { timeframeMinutes, lookback, minSwingPct, minLegBars, takeProfit, stopLoss, leverage, tradeDirection, maxCandles } = params;
    
    // Build all timeframe data for cascade confirmation
    const allTimeframePivots = {};
    
    // Get primary timeframe data
    const primaryInterval = `${timeframeMinutes}m`;
    const aggregatedCandles = aggregatedCandlesCache.get(primaryInterval);
    if (!aggregatedCandles || aggregatedCandles.length === 0) {
        return { error: 'No aggregated candles available', params };
    }
    
    // Generate pivot cache key for primary timeframe
    const pivotCacheKey = `${timeframeMinutes}m_${lookback}_${minSwingPct}_${minLegBars}`;
    
    // Detect pivots for primary timeframe
    const primaryPivots = detectAllPivots(aggregatedCandles, 
        { lookback, minSwingPct, minLegBars }, 
        'close', 
        pivotCacheKey
    );
    
    allTimeframePivots[primaryInterval] = primaryPivots;
    
    // For CASCADE mode, we need to build other timeframes from multiPivotConfig
    for (const tfConfig of multiPivotConfig.timeframes) {
        const tf = tfConfig.interval;
        if (tf === primaryInterval) continue; // Already processed
        
        const tfMinutes = parseTimeframeToMinutes(tf);
        const tfCandles = aggregatedCandlesCache.get(`${tfMinutes}m`);
        if (!tfCandles) continue;
        
        const tfPivotCacheKey = `${tfMinutes}m_${tfConfig.lookback}_${tfConfig.minSwingPct}_${tfConfig.minLegBars}`;
        const tfPivots = detectAllPivots(tfCandles,
            { lookback: tfConfig.lookback, minSwingPct: tfConfig.minSwingPct, minLegBars: tfConfig.minLegBars },
            'close',
            tfPivotCacheKey
        );
        
        allTimeframePivots[tf] = tfPivots;
    }
    
    if (primaryPivots.length === 0) {
        return { 
            totalTrades: 0, winRate: 0, totalReturn: 0, finalCapital: tradeConfig.initialCapital,
            maxDrawdown: 0, sharpeRatio: 0, params, error: 'No pivots detected'
        };
    }
    
    // Trade simulation using CASCADE mode
    const trades = [];
    let capital = tradeConfig.initialCapital;
    let confirmedSignals = 0;
    const optimizerTradeConfig = { takeProfit, stopLoss, leverage };
    
    for (const pivot of primaryPivots) {
        if (tradeDirection !== 'both' && pivot.signal !== tradeDirection) continue;
        
        // Check cascade confirmation
        const confirmations = checkCascadeConfirmation(pivot, allTimeframePivots, pivot.time, primaryInterval);
        if (!meetsExecutionRequirements(confirmations)) continue;
        
        confirmedSignals++;
        
        const entryPrice = pivot.price;
        // Use position sizing from config
        let tradeSize;
        if (tradeConfig.positionSizingMode === 'fixed') {
            tradeSize = tradeConfig.amountPerTrade;
        } else if (tradeConfig.positionSizingMode === 'minimum') {
            tradeSize = Math.max(tradeConfig.minimumTradeAmount, capital * (tradeConfig.riskPerTrade / 100));
        } else { // 'percent' mode
            tradeSize = capital * (tradeConfig.riskPerTrade / 100);
        }
        
        const trade = createTrade(pivot.signal, pivot, tradeSize, pivot.time, 
                                `${timeframeMinutes}m`, entryPrice, optimizerTradeConfig);
        
        // Find 1m candles after pivot for precise TP/SL monitoring
        const pivotIndex = oneMinuteCandles.findIndex(c => c.time >= pivot.time);
        if (pivotIndex === -1) continue;
        
        // Monitor trade until TP/SL hit (no time limit)
        for (let i = pivotIndex + 1; i < oneMinuteCandles.length; i++) {
            if (updateTrade(trade, oneMinuteCandles[i])) break;
        }
        
        if (trade.status === 'closed') {
            capital += trade.pnl;
            trades.push(trade);
            
            if (capital <= 0) break; // Blown account
        }
    }
    
    // Calculate performance metrics using config initial capital
    const winningTrades = trades.filter(t => t.pnl > 0);
    const winRate = trades.length > 0 ? (winningTrades.length / trades.length) * 100 : 0;
    const initialCapital = tradeConfig.initialCapital;
    const totalReturn = ((capital - initialCapital) / initialCapital) * 100;
    
    let maxDrawdown = 0;
    let peak = initialCapital;
    let runningCapital = initialCapital;
    
    for (const trade of trades) {
        runningCapital += trade.pnl;
        if (runningCapital > peak) peak = runningCapital;
        const drawdown = ((peak - runningCapital) / peak) * 100;
        if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    }
    
    return {
        totalTrades: trades.length, winRate: winRate.toFixed(1), totalReturn: totalReturn.toFixed(2),
        finalCapital: capital.toFixed(2), maxDrawdown: maxDrawdown.toFixed(2),
        avgTradeReturn: trades.length > 0 ? (trades.reduce((sum, t) => sum + t.pnlPct, 0) / trades.length).toFixed(2) : 0,
        params, pivotCount: primaryPivots.length, confirmedSignals
    };
}

// Parallel batch processing without workers
async function processBatch(batch, oneMinuteCandles, aggregatedCandlesCache) {
    const promises = batch.map(params => runOptimizedBacktest(params, oneMinuteCandles, aggregatedCandlesCache));
    return await Promise.all(promises);
}

// Main optimization function
async function runOptimization() {
    console.log(`${colors.cyan}🚀 Starting Ultra-Fast Immediate Aggregation Optimization${colors.reset}`);
    console.log(`${colors.yellow}📊 Loading and caching data...${colors.reset}`);
    
    const startTime = Date.now();
    
    // Load 1-minute candles once
    const oneMinuteCandles = await load1mCandles(symbol, maxCandles);
    console.log(`${colors.green}✅ Loaded ${oneMinuteCandles.length} 1-minute candles${colors.reset}`);
    
    // Pre-calculate and cache all aggregated timeframes
    const aggregatedCandlesCache = new Map();
    for (const tf of timeframes) {
        const aggregated = buildAggregatedCandles(oneMinuteCandles, tf);
        aggregatedCandlesCache.set(`${tf}m`, aggregated);
        console.log(`${colors.green}✅ Cached ${aggregated.length} ${tf}m candles${colors.reset}`);
    }
    
    console.log(`${colors.green}✅ Data loading and aggregation functions added${colors.reset}`);
    
    // Generate all parameter combinations
    const combinations = [];
    for (const timeframeMinutes of timeframes) {
        for (const lookback of lookbacks) {
            for (const minSwingPct of minSwingPcts) {
                for (const minLegBars of minLegBarsOptions) {
                    for (const takeProfit of takeProfits) {
                        for (const stopLoss of stopLosses) {
                            for (const leverage of leverages) {
                                for (const tradeDirection of tradeDirections) {
                                    combinations.push({
                                        timeframeMinutes, lookback, minSwingPct, minLegBars,
                                        takeProfit, stopLoss, leverage, tradeDirection, maxCandles
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    
    console.log(`${colors.cyan}📈 Processing ${combinations.length} parameter combinations in parallel batches...${colors.reset}`);
    
    const results = [];
    const batchSize = 3; // Small batches for progress visibility
    
    for (let i = 0; i < combinations.length; i += batchSize) {
        const batch = combinations.slice(i, i + batchSize);
        const batchResults = await processBatch(batch, oneMinuteCandles, aggregatedCandlesCache);
        results.push(...batchResults);
        
        const progress = ((i + batch.length) / combinations.length * 100).toFixed(1);
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const eta = (elapsed / (i + batch.length) * (combinations.length - i - batch.length)).toFixed(0);
        
        console.log(`${colors.blue}⏳ Progress: ${progress}% (${i + batch.length}/${combinations.length}) | Elapsed: ${elapsed}s | ETA: ${eta}s${colors.reset}`);
        
        // Show best result so far
        const validResults = results.filter(r => !r.error && r.totalTrades > 0);
        if (validResults.length > 0) {
            const best = validResults.reduce((a, b) => parseFloat(a.totalReturn) > parseFloat(b.totalReturn) ? a : b);
            console.log(`${colors.green}🏆 Current Best: ${best.totalReturn}% return, ${best.winRate}% win rate (${best.params.timeframeMinutes}m, lookback:${best.params.lookback})${colors.reset}`);
        }
    }
    
    // Final analysis and results
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`${colors.cyan}🎯 Optimization completed in ${totalTime} seconds!${colors.reset}`);
    
    const validResults = results.filter(r => !r.error && r.totalTrades > 0);
    console.log(`${colors.yellow}📊 Valid results: ${validResults.length}/${results.length}${colors.reset}`);
    
    if (validResults.length > 0) {
        // Sort by total return
        validResults.sort((a, b) => parseFloat(b.totalReturn) - parseFloat(a.totalReturn));
        
        console.log(`${colors.green}\n🏆 TOP 10 RESULTS:${colors.reset}`);
        console.log('Rank | Return% | WinRate% | Trades | Timeframe | Lookback | SwingPct | LegBars | TP% | SL% | Leverage | Direction');
        console.log('-'.repeat(120));
        
        for (let i = 0; i < Math.min(10, validResults.length); i++) {
            const r = validResults[i];
            const p = r.params;
            console.log(`${(i+1).toString().padStart(4)} | ${r.totalReturn.toString().padStart(7)} | ${r.winRate.toString().padStart(8)} | ${r.totalTrades.toString().padStart(6)} | ${(p.timeframeMinutes+'m').padStart(9)} | ${p.lookback.toString().padStart(8)} | ${p.minSwingPct.toString().padStart(8)} | ${p.minLegBars.toString().padStart(7)} | ${p.takeProfit.toString().padStart(3)} | ${p.stopLoss.toString().padStart(3)} | ${p.leverage.toString().padStart(8)} | ${p.tradeDirection.padStart(9)}`);
        }
        
        // Save results to CSV
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const csvPath = path.join(process.cwd(), 'optimization_results', `ultra_fast_optimization_${timestamp}.csv`);
        
        const csvContent = [
            'Rank,TotalReturn%,WinRate%,TotalTrades,FinalCapital,MaxDrawdown%,AvgTradeReturn%,PivotCount,TimeframeMinutes,Lookback,MinSwingPct,MinLegBars,TakeProfit%,StopLoss%,Leverage,TradeDirection',
            ...validResults.map((r, i) => {
                const p = r.params;
                return `${i+1},${r.totalReturn},${r.winRate},${r.totalTrades},${r.finalCapital},${r.maxDrawdown},${r.avgTradeReturn},${r.pivotCount},${p.timeframeMinutes},${p.lookback},${p.minSwingPct},${p.minLegBars},${p.takeProfit},${p.stopLoss},${p.leverage},${p.tradeDirection}`;
            })
        ].join('\n');
        
        fs.writeFileSync(csvPath, csvContent);
        console.log(`${colors.green}💾 Results saved to: ${csvPath}${colors.reset}`);
    }
    
    console.log(`${colors.cyan}🎉 Ultra-Fast Optimization Complete!${colors.reset}`);
}

// Execute optimization
runOptimization().catch(console.error);

console.log(`${colors.green}✅ Ultra-Fast Immediate Aggregation Optimizer completed!${colors.reset}`);
