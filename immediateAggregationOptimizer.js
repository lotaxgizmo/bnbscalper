// immediateAggregationOptimizer.js
// Optimizer for immediate aggregation backtester
// Tests different parameter combinations across single or multiple timeframes
// Supports both pivot and cascade trading modes

import {
    symbol,
    useLocalData,
    pivotDetectionMode
} from './config/config.js';
import { tradeConfig } from './config/tradeconfig.js';
import { multiPivotConfig } from './config/multiPivotConfig.js';
import { getCandles } from './apis/bybit.js';
import { formatNumber } from './utils/formatters.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ===== OPTIMIZATION CONFIGURATION =====
const OPTIMIZATION_CONFIG = {
    // Parameter ranges to test
    takeProfitRange: { start: 0.3, end: 1, step: 0.2  },
    stopLossRange: { start: 0.2, end: 0.3, step: 0.1 },
    leverageRange: { start: 1, end: 1, step: 1 },
    
    // Pivot detection parameter ranges
    minSwingPctRange: { start: 0.1, end: 0.3, step: 0.1 },
    lookbackRange: { start: 1, end: 9, step: 1 },
    minLegBarsRange: { start: 1, end: 9, step: 1 },
    
    // Trading mode options
    tradingModes: [ 'pivot'], // Test both modes
    
    // Data settings
    maxCandles: 43200, // 30 days of 1m candles
    
    // Timeframe combinations to test (you can modify these)
    timeframeCombinations: [
        // Single timeframes
        [{ interval: '1h', role: 'primary', weight: 1 }]
    ]
};

// Ensure optimization directory exists
const OPTIMIZATION_DIR = path.join(__dirname, 'data', 'optimization');
if (!fs.existsSync(OPTIMIZATION_DIR)) {
    fs.mkdirSync(OPTIMIZATION_DIR, { recursive: true });
}

const RESULTS_CSV_FILE = path.join(OPTIMIZATION_DIR, `immediate_aggregation_optimization_${symbol}_${new Date().toISOString().replace(/:/g, '-')}.csv`);

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

const formatNumberWithCommas = (num) => {
    if (typeof num !== 'number') return num;
    return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

// ===== DATA LOADING =====
async function load1mCandles() {
    const shouldUseAPI = !useLocalData;
    
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
        
        const limitedCandles = candles.slice(-OPTIMIZATION_CONFIG.maxCandles);
        return limitedCandles;
    } else {
        const candles = await getCandles(symbol, '1m', OPTIMIZATION_CONFIG.maxCandles);
        return candles.sort((a, b) => a.time - b.time);
    }
}

// Import core functions from the backtester
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
    
    // Calculate swing percentage
    let maxSwingPct = 0;
    
    if (minSwingPct > 0) {
        for (let j = 1; j <= pivotLookback; j++) {
            if (index - j < 0) break;
            
            const compareCandle = candles[index - j];
            const comparePrice = pivotDetectionMode === 'close' ? compareCandle.close : 
                                (pivotType === 'high' ? compareCandle.low : compareCandle.high);
            
            const swingPct = Math.abs((pivotPrice - comparePrice) / comparePrice * 100);
            maxSwingPct = Math.max(maxSwingPct, swingPct);
        }
        
        if (maxSwingPct < minSwingPct) {
            return null;
        }
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
            
            const aggregatedCandle = {
                time: bucketEnd,
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

// ===== TRADE MANAGEMENT =====
function createTrade(signal, pivot, tradeSize, currentTime, timeframe, testConfig) {
    const entryPrice = pivot.price;
    const isLong = signal === 'long';
    
    const tpDistance = entryPrice * (testConfig.takeProfit / 100);
    const slDistance = entryPrice * (testConfig.stopLoss / 100);
    
    const takeProfitPrice = isLong ? entryPrice + tpDistance : entryPrice - tpDistance;
    const stopLossPrice = isLong ? entryPrice - slDistance : entryPrice + slDistance;
    
    return {
        id: Date.now() + Math.random(),
        type: signal,
        timeframe: timeframe,
        entryPrice: entryPrice,
        entryTime: currentTime,
        tradeSize: tradeSize,
        takeProfitPrice: takeProfitPrice,
        stopLossPrice: stopLossPrice,
        leverage: testConfig.leverage,
        status: 'open',
        exitPrice: null,
        exitTime: null,
        pnl: 0,
        pnlPct: 0,
        pivot: pivot
    };
}

function updateTrade(trade, currentCandle) {
    const currentPrice = currentCandle.close;
    const isLong = trade.type === 'long';
    
    let shouldClose = false;
    let exitReason = '';
    
    if (isLong) {
        if (currentPrice >= trade.takeProfitPrice) {
            shouldClose = true;
            exitReason = 'TP';
        } else if (currentPrice <= trade.stopLossPrice) {
            shouldClose = true;
            exitReason = 'SL';
        }
    } else {
        if (currentPrice <= trade.takeProfitPrice) {
            shouldClose = true;
            exitReason = 'TP';
        } else if (currentPrice >= trade.stopLossPrice) {
            shouldClose = true;
            exitReason = 'SL';
        }
    }
    
    if (shouldClose) {
        trade.status = 'closed';
        trade.exitPrice = currentPrice;
        trade.exitTime = currentCandle.time;
        trade.exitReason = exitReason;
        
        const priceChange = isLong ? (currentPrice - trade.entryPrice) : (trade.entryPrice - currentPrice);
        trade.pnl = (priceChange / trade.entryPrice) * trade.tradeSize * trade.leverage;
        trade.pnlPct = (priceChange / trade.entryPrice) * 100 * trade.leverage;
        
        const totalFees = trade.tradeSize * (tradeConfig.totalMakerFee / 100) * 2;
        trade.pnl -= totalFees;
    }
    
    return shouldClose;
}

// ===== CASCADE CONFIRMATION =====
function checkCascadeConfirmation(primaryPivot, allTimeframePivots, currentTime) {
    const confirmations = [];
    const timeWindow = 5 * 60 * 1000; // 5 minutes window
    
    for (const [timeframe, pivots] of Object.entries(allTimeframePivots)) {
        if (pivots.length === 0) continue;
        
        const recentPivots = pivots.filter(p => 
            p.signal === primaryPivot.signal &&
            Math.abs(p.time - currentTime) <= timeWindow
        );
        
        if (recentPivots.length > 0) {
            confirmations.push({
                timeframe: timeframe,
                pivot: recentPivots[0]
            });
        }
    }
    
    return confirmations;
}

// ===== MAIN BACKTESTING FUNCTION =====
async function runOptimizationBacktest(params) {
    const {
        takeProfit,
        stopLoss,
        leverage,
        minSwingPct,
        lookback,
        minLegBars,
        tradingMode,
        timeframes,
        oneMinuteCandles
    } = params;
    
    const testConfig = {
        ...tradeConfig,
        takeProfit,
        stopLoss,
        leverage
    };
    
    // Build aggregated candles for all timeframes
    const timeframeData = {};
    const allTimeframePivots = {};
    
    for (const tfConfig of timeframes) {
        const tf = tfConfig.interval;
        const timeframeMinutes = parseTimeframeToMinutes(tf);
        
        const aggregatedCandles = buildImmediateAggregatedCandles(oneMinuteCandles, timeframeMinutes);
        timeframeData[tf] = {
            candles: aggregatedCandles,
            config: { ...tfConfig, lookback, minSwingPct, minLegBars }
        };
        
        // Detect all pivots for this timeframe (enforce minLegBars between accepted pivots)
        const pivots = [];
        let lastAcceptedPivotIndex = null;
        for (let i = lookback; i < aggregatedCandles.length; i++) {
            const pivot = detectPivot(aggregatedCandles, i, {
                pivotLookback: lookback,
                minSwingPct: minSwingPct,
                minLegBars: minLegBars
            });

            if (!pivot) continue;

            if (lastAcceptedPivotIndex !== null) {
                const barsSinceLast = i - lastAcceptedPivotIndex;
                if (typeof minLegBars === 'number' && barsSinceLast < minLegBars) {
                    continue; // skip: not enough bars since previous accepted pivot
                }
            }

            pivots.push(pivot);
            lastAcceptedPivotIndex = i;
        }
        
        allTimeframePivots[tf] = pivots;
    }
    
    // Get primary timeframe
    const primaryTf = timeframes.find(tf => tf.role === 'primary');
    if (!primaryTf) {
        throw new Error('No primary timeframe configured');
    }
    
    const primaryCandles = timeframeData[primaryTf.interval].candles;
    const primaryPivots = allTimeframePivots[primaryTf.interval];
    
    // Trading simulation
    let capital = testConfig.initialCapital;
    const openTrades = [];
    const allTrades = [];
    let totalSignals = 0;
    let confirmedSignals = 0;
    
    // Prepare 1-minute tracking pointers for efficiency
    const primaryTfMinutes = parseTimeframeToMinutes(primaryTf.interval);
    let minuteStartIdx = -1; // index of last minute candle <= startTime
    let minuteEndIdx = -1;   // index of last minute candle <= currentTime
    
    // Process each primary timeframe candle
    for (let i = 0; i < primaryCandles.length; i++) {
        const currentCandle = primaryCandles[i];
        const currentTime = currentCandle.time;
        const startTime = currentTime - (primaryTfMinutes * 60 * 1000);
        
        // Advance pointers into oneMinuteCandles to bound the [startTime, currentTime] window
        while (minuteStartIdx + 1 < oneMinuteCandles.length && oneMinuteCandles[minuteStartIdx + 1].time <= startTime) {
            minuteStartIdx++;
        }
        while (minuteEndIdx + 1 < oneMinuteCandles.length && oneMinuteCandles[minuteEndIdx + 1].time <= currentTime) {
            minuteEndIdx++;
        }
        
        // Update existing trades over each 1-minute candle in range: (startTime, currentTime]
        for (let mi = minuteStartIdx + 1; mi <= minuteEndIdx; mi++) {
            const minuteCandle = oneMinuteCandles[mi];
            for (let j = openTrades.length - 1; j >= 0; j--) {
                const trade = openTrades[j];
                const shouldClose = updateTrade(trade, minuteCandle);
                if (shouldClose) {
                    capital += trade.pnl;
                    openTrades.splice(j, 1);
                }
            }
        }
        
        // Check for new pivot signals
        const currentPivot = primaryPivots.find(p => p.time === currentTime);
        if (currentPivot) {
            totalSignals++;
            
            let shouldTrade = false;
            let confirmations = [];
            
            if (tradingMode === 'pivot') {
                shouldTrade = true;
            } else if (tradingMode === 'cascade') {
                confirmations = checkCascadeConfirmation(currentPivot, allTimeframePivots, currentTime);
                shouldTrade = confirmations.length >= 1; // At least 1 confirmation
            }
            
            if (shouldTrade && (!testConfig.singleTradeMode || openTrades.length === 0)) {
                // Check direction configuration
                let shouldOpenTrade = false;
                let tradeType = null;
                
                if (currentPivot.signal === 'long') {
                    if (testConfig.direction === 'buy' || testConfig.direction === 'both') {
                        shouldOpenTrade = true;
                        tradeType = 'long';
                    } else if (testConfig.direction === 'alternate') {
                        shouldOpenTrade = true;
                        tradeType = 'short';
                    }
                } else if (currentPivot.signal === 'short') {
                    if (testConfig.direction === 'sell' || testConfig.direction === 'both') {
                        shouldOpenTrade = true;
                        tradeType = 'short';
                    } else if (testConfig.direction === 'alternate') {
                        shouldOpenTrade = true;
                        tradeType = 'long';
                    }
                }
                
                if (shouldOpenTrade && capital > 0) {
                    confirmedSignals++;
                    
                    let tradeSize;
                    switch (testConfig.positionSizingMode) {
                        case 'fixed':
                            tradeSize = testConfig.amountPerTrade;
                            break;
                        case 'percent':
                            tradeSize = capital * (testConfig.riskPerTrade / 100);
                            break;
                        default:
                            tradeSize = testConfig.amountPerTrade;
                    }
                    
                    const trade = createTrade(tradeType, currentPivot, tradeSize, currentTime, primaryTf.interval, testConfig);
                    openTrades.push(trade);
                    allTrades.push(trade);
                }
            }
        }
    }
    
    // Close any remaining open trades
    for (const trade of openTrades) {
        const lastCandle = primaryCandles[primaryCandles.length - 1];
        updateTrade(trade, lastCandle);
        capital += trade.pnl;
    }
    
    // Calculate results
    const closedTrades = allTrades.filter(t => t.status === 'closed');
    const winningTrades = closedTrades.filter(t => t.pnl > 0);
    const losingTrades = closedTrades.filter(t => t.pnl <= 0);
    const tpTrades = closedTrades.filter(t => t.exitReason === 'TP');
    const slTrades = closedTrades.filter(t => t.exitReason === 'SL');
    
    const winRate = closedTrades.length > 0 ? (winningTrades.length / closedTrades.length) * 100 : 0;
    const tpRate = closedTrades.length > 0 ? (tpTrades.length / closedTrades.length) * 100 : 0;
    const slRate = closedTrades.length > 0 ? (slTrades.length / closedTrades.length) * 100 : 0;
    
    const totalPnl = closedTrades.reduce((sum, t) => sum + t.pnl, 0);
    const totalProfit = winningTrades.reduce((sum, t) => sum + t.pnl, 0);
    const totalLoss = losingTrades.reduce((sum, t) => sum + t.pnl, 0);
    
    const profitFactor = Math.abs(totalLoss) > 0 ? Math.abs(totalProfit / totalLoss) : Infinity;
    const netGain = capital - testConfig.initialCapital;
    const netGainPct = (netGain / testConfig.initialCapital) * 100;
    
    const avgWin = winningTrades.length > 0 ? totalProfit / winningTrades.length : 0;
    const avgLoss = losingTrades.length > 0 ? totalLoss / losingTrades.length : 0;
    
    const confirmationRate = totalSignals > 0 ? (confirmedSignals / totalSignals) * 100 : 0;
    
    return {
        takeProfit,
        stopLoss,
        leverage,
        minSwingPct,
        lookback,
        minLegBars,
        tradingMode,
        timeframeConfig: timeframes.map(tf => tf.interval).join('+'),
        totalTrades: closedTrades.length,
        totalSignals,
        confirmedSignals,
        confirmationRate,
        winRate,
        tpRate,
        slRate,
        profitFactor,
        netGain,
        netGainPct,
        initialCapital: testConfig.initialCapital,
        finalCapital: capital,
        avgWin,
        avgLoss
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
    
    console.log(`${colors.cyan}=== IMMEDIATE AGGREGATION OPTIMIZER ===${colors.reset}`);
    console.log(`Symbol: ${symbol}`);
    console.log(`Detection Mode: ${pivotDetectionMode}`);
    console.log(`Direction: ${tradeConfig.direction}`);
    console.log(`Initial Capital: ${tradeConfig.initialCapital} USDT`);
    console.log();
    
    // Load candle data once
    await loadCandlesOnce();
    
    // Create CSV header
    const csvHeader = 'takeProfit,stopLoss,leverage,minSwingPct,lookback,minLegBars,tradingMode,timeframes,totalTrades,totalSignals,confirmedSignals,confirmationRate,winRate,tpRate,slRate,profitFactor,netGain,netGainPct,initialCapital,finalCapital,avgWin,avgLoss\n';
    fs.writeFileSync(RESULTS_CSV_FILE, csvHeader);
    
    const results = [];
    let totalCombinations = 0;
    
    // Generate all combinations
    const combinations = [];
    
    for (const timeframes of OPTIMIZATION_CONFIG.timeframeCombinations) {
        for (const tradingMode of OPTIMIZATION_CONFIG.tradingModes) {
            // Skip cascade mode for single timeframe configurations
            if (tradingMode === 'cascade' && timeframes.length === 1) continue;
            
            for (let tp = OPTIMIZATION_CONFIG.takeProfitRange.start; tp <= OPTIMIZATION_CONFIG.takeProfitRange.end; tp += OPTIMIZATION_CONFIG.takeProfitRange.step) {
                for (let sl = OPTIMIZATION_CONFIG.stopLossRange.start; sl <= OPTIMIZATION_CONFIG.stopLossRange.end; sl += OPTIMIZATION_CONFIG.stopLossRange.step) {
                    for (let lev = OPTIMIZATION_CONFIG.leverageRange.start; lev <= OPTIMIZATION_CONFIG.leverageRange.end; lev += OPTIMIZATION_CONFIG.leverageRange.step) {
                        for (let swing = OPTIMIZATION_CONFIG.minSwingPctRange.start; swing <= OPTIMIZATION_CONFIG.minSwingPctRange.end; swing += OPTIMIZATION_CONFIG.minSwingPctRange.step) {
                            for (let lookback = OPTIMIZATION_CONFIG.lookbackRange.start; lookback <= OPTIMIZATION_CONFIG.lookbackRange.end; lookback += OPTIMIZATION_CONFIG.lookbackRange.step) {
                                for (let minLeg = OPTIMIZATION_CONFIG.minLegBarsRange.start; minLeg <= OPTIMIZATION_CONFIG.minLegBarsRange.end; minLeg += OPTIMIZATION_CONFIG.minLegBarsRange.step) {
                                    combinations.push({
                                        takeProfit: tp,
                                        stopLoss: sl,
                                        leverage: lev,
                                        minSwingPct: swing,
                                        lookback: lookback,
                                        minLegBars: minLeg,
                                        tradingMode: tradingMode,
                                        timeframes: timeframes,
                                        oneMinuteCandles: globalCandles
                                    });
                                    totalCombinations++;
                                }
                            }
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
    
    const batchSize = Math.max(10, Math.ceil(combinations.length / (numCores * 2)));
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
                    workerData: { batch, workerId: index }
                });
                
                worker.on('message', (message) => {
                    if (message.type === 'result') {
                        const result = message.data;
                        results.push(result);
                        
                        // Save to CSV
                        const csvLine = `${result.takeProfit},${result.stopLoss},${result.leverage},${result.minSwingPct},${result.lookback},${result.minLegBars},${result.tradingMode},${result.timeframeConfig},${result.totalTrades},${result.totalSignals},${result.confirmedSignals},${result.confirmationRate.toFixed(2)},${result.winRate.toFixed(2)},${result.tpRate.toFixed(2)},${result.slRate.toFixed(2)},${result.profitFactor.toFixed(2)},${formatNumber(result.netGain)},${result.netGainPct.toFixed(2)},${formatNumber(result.initialCapital)},${formatNumber(result.finalCapital)},${formatNumber(result.avgWin)},${formatNumber(result.avgLoss)}\n`;
                        fs.appendFileSync(RESULTS_CSV_FILE, csvLine);
                    } else if (message.type === 'progress') {
                        completedCombinations++;
                        const progressPct = (completedCombinations / totalCombinations * 100);
                        
                        if (progressPct - lastProgressUpdate >= 1 || completedCombinations === totalCombinations) {
                            lastProgressUpdate = Math.floor(progressPct);
                            const barWidth = 30;
                            const completedWidth = Math.floor(barWidth * (progressPct / 100));
                            const bar = `[${'='.repeat(completedWidth)}${' '.repeat(barWidth - completedWidth)}]`;
                            const progressLine = `\r${colors.cyan}Progress: ${bar} ${progressPct.toFixed(1)}% (${completedCombinations}/${totalCombinations})${colors.reset}`;
                            process.stdout.write(progressLine);
                            
                            if (progressPct % 10 < 1 || completedCombinations === totalCombinations) {
                                process.stdout.write('\n');
                                console.log(`Current: ${message.data.tradingMode.toUpperCase()} | ${message.data.timeframes} | TP ${message.data.takeProfit}% | SL ${message.data.stopLoss}% | Lev ${message.data.leverage}x`);
                            }
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
    
    // Sort results by net gain percentage
    results.sort((a, b) => b.netGainPct - a.netGainPct);
    
    // Display top results
    console.log(`\n${colors.green}=== TOP 10 COMBINATIONS ===${colors.reset}`);
    for (let i = 0; i < Math.min(10, results.length); i++) {
        const r = results[i];
        console.log(`${i+1}. ${r.tradingMode.toUpperCase()} | ${r.timeframeConfig} | TP: ${r.takeProfit}% | SL: ${r.stopLoss}% | Lev: ${r.leverage}x`);
        console.log(`    Swing: ${r.minSwingPct}% | Lookback: ${r.lookback} | MinLeg: ${r.minLegBars}`);
        console.log(`    Trades: ${r.totalTrades} | Win Rate: ${r.winRate.toFixed(1)}% | Net Gain: ${r.netGainPct.toFixed(2)}% | PF: ${r.profitFactor.toFixed(2)}\n`);
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
    console.log(`${colors.green}Complete optimization results saved to: ${RESULTS_CSV_FILE}${colors.reset}`);
}

// Worker thread code
if (!isMainThread) {
    const { batch, workerId } = workerData;
    
    (async () => {
        for (const combo of batch) {
            // Send progress update to main thread
            parentPort.postMessage({
                type: 'progress',
                data: { 
                    takeProfit: combo.takeProfit, 
                    stopLoss: combo.stopLoss, 
                    leverage: combo.leverage,
                    tradingMode: combo.tradingMode,
                    timeframes: combo.timeframes.map(tf => tf.interval).join('+')
                }
            });
            
            // Run the backtest
            const result = await runOptimizationBacktest(combo);
            
            // Send result to main thread
            if (result) {
                parentPort.postMessage({
                    type: 'result',
                    data: result
                });
            }
        }
    })().catch(err => {
        console.error(`Worker ${workerId} error:`, err);
        process.exit(1);
    });
} else {
    runOptimizer();
}
