// aggregationOptimizer.js
// Optimizer for immediate aggregation backtester with parameter range testing

import {
    symbol,
    useLocalData,
    pivotDetectionMode
} from './config/config.js';

import { tradeConfig } from './config/tradeconfig.js';
import { getCandles } from './apis/bybit.js';
import fs from 'fs';
import path from 'path';
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import os from 'os';
import { fileURLToPath } from 'url';
import { CandleAggregator } from './zaggregator/candleAggregator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ===== OPTIMIZER CONFIGURATION =====
const OPTIMIZER_CONFIG = {
    // Parameter ranges to test
    takeProfitRange: { start: 0.9, end: 0.9, step: 0.9 },
    stopLossRange: { start: 0.3, end: 0.3, step: 0.1 },
    leverageRange: { start: 100, end: 100, step: 1 },
    
    // Trading mode options
    tradingModes: ['pivot'], // Test pivot mode for single timeframe
    
    // Data settings
    maxCandles: 20160, // 14 days of 1m candles
    
    // Timeframe combinations to test
    timeframeCombinations: [
        [
            {
                interval: '2h',
                role: 'primary',
                minSwingPctRange: { start: 0, end: 0.4, step: 0.03 },
                lookbackRange: { start: 1, end: 3, step: 1 },
                minLegBarsRange: { start: 1, end: 3, step: 1 },
                weight: 1,
                oppositeRange: [true]
            }
        ]
    ]
};

// Ensure optimization directory exists
const OPTIMIZATION_DIR = path.join(__dirname, 'data', 'optimization');
if (!fs.existsSync(OPTIMIZATION_DIR)) {
    fs.mkdirSync(OPTIMIZATION_DIR, { recursive: true });
}

const RESULTS_CSV_FILE = path.join(OPTIMIZATION_DIR, `aggregation_optimization_${symbol}_${new Date().toISOString().replace(/:/g, '-')}.csv`);
// CSV stream (initialized in main thread only)
let csvStream = null;

const colors = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    magenta: '\x1b[35m',
    blue: '\x1b[34m'
};

// ===== UTILITY FUNCTIONS =====
function formatTimeframeConfig(timeframes) {
    return timeframes.map(tf => tf.interval).join('+');
}

function formatNumber(num) {
    if (typeof num !== 'number' || isNaN(num)) return '0';
    return num.toFixed(2);
}

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
        return parseInt(tf);
    }
}

// Generate all parameter combinations for a set of timeframes
function generateTimeframeParameterCombinations(timeframes) {
    const combinations = [];
    
    // Generate parameter combinations for each timeframe
    const timeframeParameterSets = timeframes.map(tf => {
        const paramSets = [];
        
        // Generate all combinations for this timeframe
        for (let swing = tf.minSwingPctRange.start; swing <= tf.minSwingPctRange.end; swing += tf.minSwingPctRange.step) {
            for (let lookback = tf.lookbackRange.start; lookback <= tf.lookbackRange.end; lookback += tf.lookbackRange.step) {
                for (let minLeg = tf.minLegBarsRange.start; minLeg <= tf.minLegBarsRange.end; minLeg += tf.minLegBarsRange.step) {
                    for (const opposite of tf.oppositeRange) {
                        paramSets.push({
                            interval: tf.interval,
                            role: tf.role,
                            minSwingPct: Math.round(swing * 1000) / 1000, // Round to 3 decimal places
                            lookback: lookback,
                            minLegBars: minLeg,
                            weight: tf.weight,
                            opposite: opposite
                        });
                    }
                }
            }
        }
        
        return paramSets;
    });
    
    // Generate cartesian product of all timeframe parameter sets
    function cartesianProduct(arrays) {
        if (arrays.length === 0) return [[]];
        if (arrays.length === 1) return arrays[0].map(item => [item]);
        
        const result = [];
        const firstArray = arrays[0];
        const restProduct = cartesianProduct(arrays.slice(1));
        
        for (const firstItem of firstArray) {
            for (const restItem of restProduct) {
                result.push([firstItem, ...restItem]);
            }
        }
        
        return result;
    }
    
    return cartesianProduct(timeframeParameterSets);
}

const formatNumberWithCommas = (num) => {
    if (typeof num !== 'number') return num;
    return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

// Note: formatNumber is defined earlier in the file (utility section)

// ===== BACKTESTING CORE (simplified from main backtester) =====
async function runSingleBacktest(config, aggregatedCache, oneMinuteCandlesParam) {
    // Use provided 1m candles if available (from workerData), else fallback
    const oneMinuteCandles = oneMinuteCandlesParam || config.oneMinuteCandles || globalCandles || await load1mCandles();
    
    // Build aggregated candles for all timeframes
    const timeframeData = {};
    const allTimeframePivots = {};
    
    for (const tfConfig of config.timeframes) {
        const tf = tfConfig.interval;
        const timeframeMinutes = parseTimeframeToMinutes(tf);
        
        // Use cached aggregated candles per timeframe to avoid recomputation
        let aggregatedCandles = aggregatedCache?.get(timeframeMinutes);
        if (!aggregatedCandles) {
            aggregatedCandles = buildAggregatedCandlesFast(oneMinuteCandles, timeframeMinutes);
            if (aggregatedCache) aggregatedCache.set(timeframeMinutes, aggregatedCandles);
        }
        timeframeData[tf] = { candles: aggregatedCandles, config: tfConfig };
        
        // Detect pivots
        const pivots = [];
        let lastAcceptedPivotIndex = null;
        
        for (let i = tfConfig.lookback; i < aggregatedCandles.length; i++) {
            const pivot = detectPivot(aggregatedCandles, i, {
                pivotLookback: tfConfig.lookback,
                minSwingPct: tfConfig.minSwingPct,
                minLegBars: tfConfig.minLegBars
            });

            if (!pivot) continue;

            if (lastAcceptedPivotIndex !== null) {
                const barsSinceLast = i - lastAcceptedPivotIndex;
                if (typeof tfConfig.minLegBars === 'number' && barsSinceLast < tfConfig.minLegBars) {
                    continue;
                }
            }

            pivots.push(pivot);
            lastAcceptedPivotIndex = i;
        }
        
        allTimeframePivots[tf] = pivots;
    }
    
    // Run trading simulation (simplified)
    const primaryTf = config.timeframes.find(tf => tf.role === 'primary');
    const primaryPivots = allTimeframePivots[primaryTf.interval];
    
    let capital = tradeConfig.initialCapital;
    const allTrades = [];
    let totalSignals = 0;
    let confirmedSignals = 0;
    
    // Determine trading mode
    const tradingMode = config.timeframes.length === 1 ? 'pivot' : 'cascade';
    
    for (const currentPivot of primaryPivots) {
        totalSignals++;
        
        let shouldTrade = false;
        
        if (tradingMode === 'pivot') {
            shouldTrade = true;
            confirmedSignals++;
        } else if (tradingMode === 'cascade') {
            const confirmations = checkCascadeConfirmation(
                currentPivot, 
                allTimeframePivots, 
                currentPivot.time, 
                primaryTf.interval,
                config
            );
            
            if (meetsExecutionRequirements(confirmations, config)) {
                shouldTrade = true;
                confirmedSignals++;
            }
        }
        
        if (shouldTrade && capital > 0) {
            const trade = createSimpleTrade(currentPivot, capital, config);
            if (trade) {
                allTrades.push(trade);
                capital += trade.pnl;
            }
        }
    }
    
    // Calculate results
    const winningTrades = allTrades.filter(t => t.pnl > 0);
    const losingTrades = allTrades.filter(t => t.pnl < 0);
    const winRate = allTrades.length > 0 ? (winningTrades.length / allTrades.length) * 100 : 0;
    const totalPnl = allTrades.reduce((sum, t) => sum + t.pnl, 0);
    const netGainPct = (totalPnl / tradeConfig.initialCapital) * 100;
    
    // Calculate profit factor
    const totalWins = winningTrades.reduce((sum, t) => sum + t.pnl, 0);
    const totalLosses = Math.abs(losingTrades.reduce((sum, t) => sum + t.pnl, 0));
    const profitFactor = totalLosses > 0 ? totalWins / totalLosses : (totalWins > 0 ? 999 : 0);
    
    // Calculate rates
    const tpRate = allTrades.length > 0 ? (winningTrades.length / allTrades.length) * 100 : 0;
    const slRate = allTrades.length > 0 ? (losingTrades.length / allTrades.length) * 100 : 0;
    const confirmationRate = totalSignals > 0 ? (confirmedSignals / totalSignals) * 100 : 0;
    
    // Calculate averages
    const avgWin = winningTrades.length > 0 ? totalWins / winningTrades.length : 0;
    const avgLoss = losingTrades.length > 0 ? totalLosses / losingTrades.length : 0;
    
    return {
        totalSignals,
        confirmedSignals,
        totalTrades: allTrades.length,
        winningTrades: winningTrades.length,
        winRate,
        tpRate,
        slRate,
        confirmationRate,
        profitFactor,
        netGain: totalPnl,
        netGainPct,
        initialCapital: tradeConfig.initialCapital,
        finalCapital: capital,
        avgWin,
        avgLoss,
        tradingMode
    };
}

// ===== SIMPLIFIED HELPER FUNCTIONS =====
async function load1mCandles() {
    if (!useLocalData) {
        const candles = await getCandles(symbol, '1m', OPTIMIZER_CONFIG.maxCandles);
        return candles.sort((a, b) => a.time - b.time);
    } else {
        const csvPath = path.join(__dirname, 'data', 'historical', symbol, '1m.csv');
        const csvData = fs.readFileSync(csvPath, 'utf8');
        const lines = csvData.trim().split('\n').slice(1);
        
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
        
        return candles.slice(-OPTIMIZER_CONFIG.maxCandles);
    }
}

// High-performance aggregation using CandleAggregator with O(N) pass and no per-bucket sorting
function buildAggregatedCandlesFast(oneMinCandles, timeframeMinutes) {
    const tfMs = timeframeMinutes * 60 * 1000;
    const aggr = new CandleAggregator([tfMs], { keepSeries: true, strictChronological: false });
    for (const m of oneMinCandles) aggr.update(m);
    const series = aggr.buildClosedSeries(tfMs);
    // Match previous behavior where time was the bucket end (ceil boundary)
    return series.map(c => ({
        time: (c.end ?? (c.time + tfMs - 1)) + 1, // convert inclusive end to boundary end
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume
    }));
}

function buildImmediateAggregatedCandles(oneMinCandles, timeframeMinutes) {
    const aggregatedCandles = [];
    const bucketSizeMs = timeframeMinutes * 60 * 1000;
    const buckets = new Map();
    
    for (const candle of oneMinCandles) {
        const bucketEnd = Math.ceil(candle.time / bucketSizeMs) * bucketSizeMs;
        
        if (!buckets.has(bucketEnd)) {
            buckets.set(bucketEnd, []);
        }
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
    
    return aggregatedCandles.sort((a, b) => a.time - b.time);
}

function detectPivot(candles, index, config) {
    const { pivotLookback, minSwingPct, minLegBars } = config;
    
    if (pivotLookback === 0 && index === 0) return null;
    if (index < pivotLookback || index >= candles.length) return null;
    
    const currentCandle = candles[index];
    const currentHigh = pivotDetectionMode === 'close' ? currentCandle.close : currentCandle.high;
    const currentLow = pivotDetectionMode === 'close' ? currentCandle.close : currentCandle.low;
    
    let isHighPivot = true;
    let isLowPivot = true;
    
    if (pivotLookback > 0) {
        for (let j = 1; j <= pivotLookback; j++) {
            if (index - j < 0) {
                isHighPivot = false;
                isLowPivot = false;
                break;
            }
            const compareHigh = pivotDetectionMode === 'close' ? candles[index - j].close : candles[index - j].high;
            const compareLow = pivotDetectionMode === 'close' ? candles[index - j].close : candles[index - j].low;
            
            if (currentHigh <= compareHigh) isHighPivot = false;
            if (currentLow >= compareLow) isLowPivot = false;
        }
    }
    
    if (pivotLookback === 0) {
        const prev = candles[index - 1];
        const prevHigh = pivotDetectionMode === 'close' ? prev.close : prev.high;
        const prevLow = pivotDetectionMode === 'close' ? prev.close : prev.low;
        isHighPivot = currentHigh > prevHigh;
        isLowPivot = currentLow < prevLow;
        
        if (isHighPivot && isLowPivot) {
            const upExcursion = Math.abs(currentHigh - prevHigh);
            const downExcursion = Math.abs(prevLow - currentLow);
            if (upExcursion >= downExcursion) {
                isLowPivot = false;
            } else {
                isHighPivot = false; 
            }
        }
    }
    
    if (!isHighPivot && !isLowPivot) return null;
    
    const pivotType = isHighPivot ? 'high' : 'low';
    const pivotPrice = isHighPivot ? currentHigh : currentLow;
    
    // Validate swing percentage
    let maxSwingPct = 0;
    if (minSwingPct > 0) {
        const upper = pivotLookback === 0 ? 1 : pivotLookback;
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
        type: pivotType,
        price: pivotPrice,
        time: currentCandle.time,
        index: index,
        signal: pivotType === 'high' ? 'short' : 'long',
        swingPct: maxSwingPct
    };
}

function checkCascadeConfirmation(primaryPivot, allTimeframePivots, asOfTime, primaryInterval, config) {
    const confirmations = [];
    const proximityWindowMs = 5 * 60 * 1000;
    
    for (const [timeframe, pivots] of Object.entries(allTimeframePivots)) {
        if (pivots.length === 0) continue;
        
        const tfConfig = config.timeframes.find(tf => tf.interval === timeframe);
        if (!tfConfig) continue;
        
        const targetSignal = tfConfig.opposite ?
            (primaryPivot.signal === 'long' ? 'short' : 'long') :
            primaryPivot.signal;
        
        const recentPivots = pivots.filter(p =>
            p.signal === targetSignal &&
            Math.abs(p.time - primaryPivot.time) <= proximityWindowMs &&
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

function meetsExecutionRequirements(confirmations, config) {
    const minRequired = config.minTimeframesRequired || 2;
    return confirmations.length >= minRequired;
}

function createSimpleTrade(pivot, capital, config) {
    const isLong = pivot.signal === 'long';
    const entryPrice = pivot.price;
    
    // Calculate TP and SL
    const tpDistance = entryPrice * (config.takeProfit / 100);
    const slDistance = entryPrice * (config.stopLoss / 100);
    
    const takeProfitPrice = isLong ? entryPrice + tpDistance : entryPrice - tpDistance;
    const stopLossPrice = isLong ? entryPrice - slDistance : entryPrice + slDistance;
    
    // Simplified P&L calculation (assume TP hit for winning trades, SL for losing)
    const winProbability = 0.6; // Simplified assumption
    const isWin = Math.random() < winProbability;
    
    const tradeSize = capital * 0.1; // 10% of capital per trade
    let pnl;
    
    if (isWin) {
        const priceChange = isLong ? tpDistance : -tpDistance;
        pnl = (priceChange / entryPrice) * tradeSize * config.leverage;
    } else {
        const priceChange = isLong ? -slDistance : slDistance;
        pnl = (priceChange / entryPrice) * tradeSize * config.leverage;
    }
    
    // Apply fees
    const totalFees = tradeSize * 0.001; // 0.1% total fees
    pnl -= totalFees;
    
    return {
        type: pivot.signal,
        entryPrice: entryPrice,
        pnl: pnl,
        isWin: isWin
    };
}

// Global cache for candle data
let globalCandles = null;
let candlesLoaded = false;

async function loadCandlesOnce() {
    if (candlesLoaded) return;
    
    console.log('Loading 1-minute candle data for optimization...');
    globalCandles = await load1mCandles();
    console.log(`${colors.green}Loaded ${globalCandles.length} 1-minute candles${colors.reset}`);
    candlesLoaded = true;
}

// ===== MAIN OPTIMIZER FUNCTION =====
async function runOptimizer() {
    const startTime = process.hrtime.bigint();
    
    console.log(`${colors.cyan}=== AGGREGATION OPTIMIZER ===${colors.reset}`);
    console.log(`Symbol: ${symbol}`);
    console.log(`Detection Mode: ${pivotDetectionMode}`);
    console.log(`Direction: ${tradeConfig.direction}`);
    console.log(`Initial Capital: ${tradeConfig.initialCapital} USDT`);
    console.log();
    
    // Load candle data once
    await loadCandlesOnce();
    
    // Create CSV header (streamed)
    if (!csvStream) {
        csvStream = fs.createWriteStream(RESULTS_CSV_FILE, { flags: 'w' });
    }
    const csvHeader = 'takeProfit,stopLoss,leverage,tradingMode,timeframes,totalTrades,totalSignals,confirmedSignals,confirmationRate,winRate,tpRate,slRate,profitFactor,netGain,netGainPct,initialCapital,finalCapital,avgWin,avgLoss\n';
    csvStream.write(csvHeader);
    
    const results = [];
    let totalCombinations = 0;
    
    // Generate all combinations using per-timeframe parameter ranges
    const combinations = [];
    
    for (const timeframes of OPTIMIZER_CONFIG.timeframeCombinations) {
        for (const tradingMode of OPTIMIZER_CONFIG.tradingModes) {
            // Skip cascade mode for single timeframe configurations
            if (tradingMode === 'cascade' && timeframes.length === 1) continue;
            
            // Generate all parameter combinations for this timeframe set
            const timeframeParameterCombinations = generateTimeframeParameterCombinations(timeframes);
            
            for (let tp = OPTIMIZER_CONFIG.takeProfitRange.start; tp <= OPTIMIZER_CONFIG.takeProfitRange.end; tp += OPTIMIZER_CONFIG.takeProfitRange.step) {
                for (let sl = OPTIMIZER_CONFIG.stopLossRange.start; sl <= OPTIMIZER_CONFIG.stopLossRange.end; sl += OPTIMIZER_CONFIG.stopLossRange.step) {
                    for (let lev = OPTIMIZER_CONFIG.leverageRange.start; lev <= OPTIMIZER_CONFIG.leverageRange.end; lev += OPTIMIZER_CONFIG.leverageRange.step) {
                        for (const timeframeParams of timeframeParameterCombinations) {
                            combinations.push({
                                takeProfit: tp,
                                stopLoss: sl,
                                leverage: lev,
                                tradingMode: tradingMode,
                                timeframes: timeframeParams
                            });
                            totalCombinations++;
                        }
                    }
                }
            }
        }
    }
    
    console.log(`Total combinations to test: ${totalCombinations}`);
    
    // Determine number of CPU cores
    const numCores = Math.max(1, os.cpus().length - 1);
    console.log(`Using ${numCores} CPU cores for parallel processing`);
    
    // Constrain to at most one batch per CPU core
    const batchSize = Math.ceil(combinations.length / numCores);
    const batches = [];
    for (let i = 0; i < combinations.length; i += batchSize) {
        batches.push(combinations.slice(i, i + batchSize));
    }
    
    console.log(`Split into ${batches.length} batches of ~${batchSize} each`);
    
    let completedCombinations = 0;
    let lastProgressUpdate = 0;
    
    const runAllBatches = async () => {
        const batchPromises = batches.map((batch, index) => {
            return new Promise((resolve, reject) => {
                const worker = new Worker(new URL(import.meta.url), {
                    workerData: { batch, workerId: index, oneMinuteCandles: globalCandles }
                });
                
                worker.on('message', (message) => {
                    if (message.type === 'result') {
                        const result = message.data;
                        results.push(result);
                        
                        // Save to CSV via stream with safe property access
                        const csvLine = `${result.takeProfit || 0},${result.stopLoss || 0},${result.leverage || 0},${result.tradingMode || ''},${result.timeframeConfig || ''},${result.totalTrades || 0},${result.totalSignals || 0},${result.confirmedSignals || 0},${(result.confirmationRate || 0).toFixed(2)},${(result.winRate || 0).toFixed(2)},${(result.tpRate || 0).toFixed(2)},${(result.slRate || 0).toFixed(2)},${(result.profitFactor || 0).toFixed(2)},${formatNumber(result.netGain || 0)},${(result.netGainPct || 0).toFixed(2)},${formatNumber(result.initialCapital || 0)},${formatNumber(result.finalCapital || 0)},${formatNumber(result.avgWin || 0)},${formatNumber(result.avgLoss || 0)}\n`;
                        csvStream.write(csvLine);
                    } else if (message.type === 'progress') {
                        completedCombinations++;
                        const progressPct = (completedCombinations / totalCombinations * 100);
                        
                        if (progressPct - lastProgressUpdate >= 10 || completedCombinations === totalCombinations) {
                            lastProgressUpdate = Math.floor(progressPct / 10) * 10;
                            const barWidth = 30;
                            const completedWidth = Math.floor(barWidth * (progressPct / 100));
                            const bar = `[${'='.repeat(completedWidth)}${' '.repeat(barWidth - completedWidth)}]`;
                            const progressLine = `${colors.cyan}Progress: ${bar} ${progressPct.toFixed(1)}% (${completedCombinations}/${totalCombinations})${colors.reset}`;
                            console.log(progressLine);
                            console.log(`Current: ${message.data.tradingMode.toUpperCase()} | ${message.data.timeframes} | TP ${message.data.takeProfit}% | SL ${message.data.stopLoss}% | Lev ${message.data.leverage}x`);
                        }
                    }
                });
                
                worker.on('error', reject);
                worker.on('exit', (code) => {
                    if (code !== 0) {
                        reject(new Error(`Worker stopped with exit code ${code}`));
                    } else {
                        resolve();
                    }
                });
            });
        });
        
        await Promise.all(batchPromises);
    };
    
    await runAllBatches();
    
    // Sort results by net gain percentage (with safe property access)
    results.sort((a, b) => (b.netGainPct || 0) - (a.netGainPct || 0));
    
    // Display top results
    console.log(`\\n${colors.green}=== TOP 10 COMBINATIONS ===${colors.reset}`);
    for (let i = 0; i < Math.min(10, results.length); i++) {
        const r = results[i];
        console.log(`${i+1}. ${(r.tradingMode || 'UNKNOWN').toUpperCase()} | ${r.timeframeConfig || 'N/A'} | TP: ${r.takeProfit || 0}% | SL: ${r.stopLoss || 0}% | Lev: ${r.leverage || 0}x`);
        console.log(`    Trades: ${r.totalTrades || 0} | Win Rate: ${(r.winRate || 0).toFixed(1)}% | Net Gain: ${(r.netGainPct || 0).toFixed(2)}% | PF: ${(r.profitFactor || 0).toFixed(2)}\\n`);
    }
    
    // Calculate execution time
    const endTime = process.hrtime.bigint();
    const executionTimeMs = Number(endTime - startTime) / 1_000_000;
    let timeDisplay;
    
    if (executionTimeMs < 1000) {
        timeDisplay = `${executionTimeMs.toFixed(0)} ms`;
    } else if (executionTimeMs < 60000) {
        timeDisplay = `${(executionTimeMs / 1000).toFixed(2)} seconds`;
    } else {
        const minutes = Math.floor(executionTimeMs / 60000);
        const seconds = ((executionTimeMs % 60000) / 1000).toFixed(1);
        timeDisplay = `${minutes} minute${minutes !== 1 ? 's' : ''} and ${seconds} seconds`;
    }
    
    console.log(`${colors.magenta}Execution time: ${timeDisplay}${colors.reset}`);
    console.log(`${colors.cyan}Total combinations tested: ${totalCombinations}${colors.reset}`);
    // Close CSV stream
    await new Promise(resolve => csvStream.end(resolve));
    console.log(`${colors.green}Complete optimization results saved to: ${RESULTS_CSV_FILE}${colors.reset}`);
}

// Worker thread logic
if (isMainThread) {
    // Main thread - run the optimizer
    runOptimizer().catch(console.error);
} else {
    // Worker thread - process batch
    const { batch, workerId, oneMinuteCandles } = workerData;
    
    (async () => {
        // Per-worker aggregated candle cache to avoid recomputing the same timeframe aggregates
        const aggregatedCache = new Map(); // key: timeframeMinutes, value: aggregated candles array
        for (const combination of batch) {
            try {
                const result = await runSingleBacktest(combination, aggregatedCache, oneMinuteCandles);
                
                // Send result back to main thread
                parentPort.postMessage({
                    type: 'result',
                    data: {
                        takeProfit: combination.takeProfit,
                        stopLoss: combination.stopLoss,
                        leverage: combination.leverage,
                        tradingMode: combination.tradingMode,
                        timeframeConfig: formatTimeframeConfig(combination.timeframes),
                        ...result
                    }
                });
                
                // Send progress update
                parentPort.postMessage({
                    type: 'progress',
                    data: {
                        tradingMode: combination.tradingMode,
                        timeframes: formatTimeframeConfig(combination.timeframes),
                        takeProfit: combination.takeProfit,
                        stopLoss: combination.stopLoss,
                        leverage: combination.leverage
                    }
                });
                
            } catch (error) {
                console.error(`Worker ${workerId} error:`, error.message);
            }
        }
    })();
}
