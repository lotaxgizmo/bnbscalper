// immediateAggregationOptimizerWorker.js
// Worker script for parallel optimization of immediate aggregation backtester
// Each worker handles individual parameter combination testing

import { parentPort, workerData } from 'worker_threads';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import required modules
import { getCandles } from './apis/bybit.js';

// Worker-specific data cache
let WORKER_CACHE = {
    oneMinuteCandles: null,
    aggregatedCandles: new Map(),
    initialized: false
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

const formatNumberWithCommas = (num) => {
    if (typeof num !== 'number') return num;
    return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

// ===== DATA LOADING =====
async function loadWorkerData(config) {
    if (WORKER_CACHE.initialized) {
        return;
    }
    
    const shouldUseAPI = config.useLiveAPI || !config.useLocalData;
    
    if (!shouldUseAPI) {
        const csvPath = path.join(__dirname, 'data', 'historical', config.symbol, '1m.csv');
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
        
        // Apply time travel offset if configured
        let finalCandles;
        if (config.delayReverseTime && config.delayReverseTime > 0) {
            const timeOffset = config.delayReverseTime;
            const totalAvailable = candles.length;
            const startIndex = Math.max(0, totalAvailable - config.maxCandles - timeOffset);
            const endIndex = Math.max(config.maxCandles, totalAvailable - timeOffset);
            finalCandles = candles.slice(startIndex, endIndex);
        } else {
            finalCandles = candles.slice(-config.maxCandles);
        }
        
        WORKER_CACHE.oneMinuteCandles = finalCandles;
    } else {
        const candlesToFetch = config.delayReverseTime ? 
            config.maxCandles + config.delayReverseTime : 
            config.maxCandles;
            
        const candles = await getCandles(config.symbol, '1m', candlesToFetch);
        const sortedCandles = candles.sort((a, b) => a.time - b.time);
        
        let finalCandles;
        if (config.delayReverseTime && config.delayReverseTime > 0) {
            const timeOffset = config.delayReverseTime;
            const totalAvailable = sortedCandles.length;
            const startIndex = Math.max(0, totalAvailable - config.maxCandles - timeOffset);
            const endIndex = Math.max(config.maxCandles, totalAvailable - timeOffset);
            finalCandles = sortedCandles.slice(startIndex, endIndex);
        } else {
            finalCandles = sortedCandles.slice(-config.maxCandles);
        }

        WORKER_CACHE.oneMinuteCandles = finalCandles;
    }
    
    // Pre-build required timeframes
    const allTimeframes = new Set();
    for (const tf of config.timeframes) {
        allTimeframes.add(tf.interval);
    }
    
    for (const timeframe of allTimeframes) {
        const timeframeMinutes = parseTimeframeToMinutes(timeframe);
        const aggregatedCandles = buildImmediateAggregatedCandles(WORKER_CACHE.oneMinuteCandles, timeframeMinutes);
        WORKER_CACHE.aggregatedCandles.set(timeframe, aggregatedCandles);
    }
    
    WORKER_CACHE.initialized = true;
}

// ===== IMMEDIATE AGGREGATION =====
function buildImmediateAggregatedCandles(oneMinCandles, timeframeMinutes) {
    const aggregatedCandles = [];
    const bucketSizeMs = timeframeMinutes * 60 * 1000;
    
    const buckets = new Map();
    
    for (const candle of oneMinCandles) {
        const date = new Date(candle.time);
        const utcMidnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
        const msSinceMidnight = candle.time - utcMidnight;
        const intervalsSinceMidnight = Math.ceil(msSinceMidnight / bucketSizeMs);
        const bucketEnd = utcMidnight + (intervalsSinceMidnight * bucketSizeMs);
        
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

// ===== VECTORIZED PIVOT DETECTION =====
function detectPivotsVectorized(candles, config) {
    const { pivotLookback, minSwingPct, minLegBars } = config;
    const pivots = [];
    
    if (candles.length < 2) return pivots;
    
    const highs = candles.map(c => config.pivotDetectionMode === 'close' ? c.close : c.high);
    const lows = candles.map(c => config.pivotDetectionMode === 'close' ? c.close : c.low);
    const times = candles.map(c => c.time);
    
    const startIdx = Math.max(1, pivotLookback);
    
    for (let i = startIdx; i < candles.length; i++) {
        let isHighPivot = true;
        let isLowPivot = true;
        
        if (pivotLookback === 0) {
            isHighPivot = highs[i] > highs[i - 1];
            isLowPivot = lows[i] < lows[i - 1];
            
            if (isHighPivot && isLowPivot) {
                const upExcursion = Math.abs(highs[i] - highs[i - 1]);
                const downExcursion = Math.abs(lows[i - 1] - lows[i]);
                if (upExcursion >= downExcursion) {
                    isLowPivot = false;
                } else {
                    isHighPivot = false;
                }
            }
        } else {
            const lookbackStart = Math.max(0, i - pivotLookback);
            
            const highSlice = highs.slice(lookbackStart, i);
            isHighPivot = highSlice.every(h => highs[i] > h);
            
            const lowSlice = lows.slice(lookbackStart, i);
            isLowPivot = lowSlice.every(l => lows[i] < l);
        }
        
        if (!isHighPivot && !isLowPivot) continue;
        
        const pivotType = isHighPivot ? 'high' : 'low';
        const pivotPrice = isHighPivot ? highs[i] : lows[i];
        
        let maxSwingPct = 0;
        if (minSwingPct > 0) {
            const upper = pivotLookback === 0 ? 1 : pivotLookback;
            const compareStart = Math.max(0, i - upper);
            
            if (pivotType === 'high') {
                const comparePrices = lows.slice(compareStart, i);
                const swingPcts = comparePrices.map(price => Math.abs((pivotPrice - price) / price * 100));
                maxSwingPct = Math.max(...swingPcts);
            } else {
                const comparePrices = highs.slice(compareStart, i);
                const swingPcts = comparePrices.map(price => Math.abs((pivotPrice - price) / price * 100));
                maxSwingPct = Math.max(...swingPcts);
            }
            
            if (maxSwingPct < minSwingPct) continue;
        }
        
        pivots.push({
            type: pivotType,
            price: pivotPrice,
            time: times[i],
            index: i,
            signal: pivotType === 'high' ? 'short' : 'long',
            swingPct: maxSwingPct
        });
    }
    
    return pivots;
}

// ===== TRADE MANAGEMENT =====
function createTrade(signal, pivot, tradeSize, currentTime, timeframe, entryPriceOverride, tradeConfig) {
    const originalEntryPrice = (entryPriceOverride != null ? entryPriceOverride : pivot.price);
    const isLong = signal === 'long';
    
    const entrySlippage = calculateSlippage(tradeSize, tradeConfig);
    const entryPrice = applySlippageToPrice(originalEntryPrice, entrySlippage, true, isLong, tradeConfig);
    
    const tpDistance = entryPrice * (tradeConfig.takeProfit / 100);
    const slDistance = entryPrice * (tradeConfig.stopLoss / 100);
    
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
        leverage: tradeConfig.leverage,
        status: 'open',
        exitPrice: null,
        exitTime: null,
        exitReason: '',
        pnl: 0,
        pnlPct: 0,
        pivot: pivot,
        originalEntryPrice: originalEntryPrice,
        entrySlippage: entrySlippage,
        exitSlippage: null,
        originalExitPrice: null,
        bestPrice: entryPrice,
        trailingTakeProfitActive: false,
        trailingTakeProfitPrice: null,
        originalTakeProfitPrice: takeProfitPrice,
        trailingStopLossActive: false,
        trailingStopLossPrice: null,
        originalStopLossPrice: stopLossPrice
    };
}

function calculateSlippage(tradeSize, tradeConfig) {
    if (!tradeConfig.enableSlippage) return 0;
    
    if (tradeConfig.slippageMode === 'variable') {
        const min = tradeConfig.variableSlippageMin ?? 0.01;
        const max = tradeConfig.variableSlippageMax ?? 0.05;
        return min + Math.random() * (max - min);
    } else if (tradeConfig.slippageMode === 'market_impact') {
        const impactFactor = tradeConfig.marketImpactFactor ?? 0.001;
        const baseSlippage = tradeConfig.slippagePercent ?? 0.05;
        const sizeImpact = (tradeSize / 1000) * impactFactor;
        return baseSlippage + sizeImpact;
    } else {
        return tradeConfig.slippagePercent ?? 0.05;
    }
}

function applySlippageToPrice(originalPrice, slippagePercent, isEntry, isLong, tradeConfig) {
    if (!tradeConfig.enableSlippage || slippagePercent === 0) return originalPrice;
    
    const slippageAmount = originalPrice * (slippagePercent / 100);
    
    if (isEntry) {
        return isLong ? originalPrice + slippageAmount : originalPrice - slippageAmount;
    } else {
        return isLong ? originalPrice - slippageAmount : originalPrice + slippageAmount;
    }
}

function updateTrade(trade, currentCandle, tradeConfig) {
    const currentPrice = currentCandle.close;
    const isLong = trade.type === 'long';
    
    if (isLong) {
        if (currentPrice > trade.bestPrice) {
            trade.bestPrice = currentPrice;
        }
    } else {
        if (currentPrice < trade.bestPrice) {
            trade.bestPrice = currentPrice;
        }
    }
    
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
        
        const exitSlippage = calculateSlippage(trade.tradeSize, tradeConfig) * 0.5;
        trade.originalExitPrice = currentPrice;
        trade.exitSlippage = exitSlippage;
        trade.exitPrice = applySlippageToPrice(currentPrice, exitSlippage, false, isLong, tradeConfig);
        
        trade.exitTime = currentCandle.time;
        trade.exitReason = exitReason;
        
        const priceChange = isLong ? (trade.exitPrice - trade.entryPrice) : (trade.entryPrice - trade.exitPrice);
        trade.pnl = (priceChange / trade.entryPrice) * trade.tradeSize * trade.leverage;
        trade.pnlPct = (priceChange / trade.entryPrice) * 100 * trade.leverage;
        
        const totalFees = trade.tradeSize * (tradeConfig.totalMakerFee / 100) * 2;
        trade.pnl -= totalFees;
    }
    
    return shouldClose;
}

// ===== CASCADE CONFIRMATION =====
function checkCascadeConfirmation(primaryPivot, allTimeframePivots, asOfTime, primaryInterval, multiPivotConfig) {
    const confirmations = [];
    const proximityWindowMs = 5 * 60 * 1000;
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

function meetsExecutionRequirements(confirmations, multiPivotConfig) {
    const minRequired = multiPivotConfig.cascadeSettings?.minTimeframesRequired || 2;
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

// ===== MAIN BACKTEST FUNCTION =====
async function runWorkerBacktest(params, config) {
    // Load data for this worker
    await loadWorkerData(config);
    
    const oneMinuteCandles = WORKER_CACHE.oneMinuteCandles;
    
    // Build timeframe data and pivots
    const timeframeData = {};
    const allTimeframePivots = {};
    
    for (const tfConfig of params.multiPivotConfig.timeframes) {
        const tf = tfConfig.interval;
        
        const aggregatedCandles = WORKER_CACHE.aggregatedCandles.get(tf);
        timeframeData[tf] = {
            candles: aggregatedCandles,
            config: tfConfig
        };
        
        const allPivots = detectPivotsVectorized(aggregatedCandles, {
            pivotLookback: tfConfig.lookback,
            minSwingPct: tfConfig.minSwingPct,
            minLegBars: tfConfig.minLegBars,
            pivotDetectionMode: config.pivotDetectionMode
        });
        
        const pivots = [];
        let lastAcceptedPivotIndex = null;
        
        for (const pivot of allPivots) {
            if (lastAcceptedPivotIndex !== null) {
                const barsSinceLast = pivot.index - lastAcceptedPivotIndex;
                if (typeof tfConfig.minLegBars === 'number' && barsSinceLast < tfConfig.minLegBars) {
                    continue;
                }
            }
            
            pivots.push(pivot);
            lastAcceptedPivotIndex = pivot.index;
        }
        
        allTimeframePivots[tf] = pivots;
    }
    
    // Get primary timeframe
    const primaryTf = params.multiPivotConfig.timeframes.find(tf => tf.role === 'primary');
    if (!primaryTf) {
        throw new Error('No primary timeframe configured');
    }
    
    const primaryCandles = timeframeData[primaryTf.interval].candles;
    const primaryPivots = allTimeframePivots[primaryTf.interval];
    
    // Trading simulation
    let capital = params.tradeConfig.initialCapital;
    let openTrades = [];
    let allTrades = [];
    let confirmedSignals = 0;
    let executedTrades = 0;
    let totalSignals = 0;
    
    const oneMinuteTimeMap = new Map();
    oneMinuteCandles.forEach((candle, index) => {
        oneMinuteTimeMap.set(candle.time, index);
    });
    
    // Process each primary timeframe candle
    for (let i = 0; i < primaryCandles.length; i++) {
        const currentCandle = primaryCandles[i];
        const currentTime = currentCandle.time;
        
        const primaryTfMinutes = parseTimeframeToMinutes(primaryTf.interval);
        const startTime = currentTime - (primaryTfMinutes * 60 * 1000);
        
        const minuteCandlesInRange = [];
        for (let j = 0; j < oneMinuteCandles.length; j++) {
            const minuteCandle = oneMinuteCandles[j];
            if (minuteCandle.time > startTime && minuteCandle.time <= currentTime) {
                minuteCandlesInRange.push(minuteCandle);
            }
        }
        
        // Update existing trades
        for (const minuteCandle of minuteCandlesInRange) {
            for (let j = openTrades.length - 1; j >= 0; j--) {
                const trade = openTrades[j];
                
                if (minuteCandle.time >= trade.entryTime) {
                    const shouldClose = updateTrade(trade, minuteCandle, params.tradeConfig);
                    
                    if (shouldClose) {
                        capital += trade.pnl;
                        openTrades.splice(j, 1);
                    }
                }
            }
        }
        
        // Check for new pivot signals
        const currentPivot = primaryPivots.find(p => p.time === currentTime);
        if (currentPivot) {
            totalSignals++;
            
            if (config.tradingMode === 'cascade') {
                const confs = checkCascadeConfirmation(currentPivot, allTimeframePivots, currentTime, primaryTf.interval, params.multiPivotConfig);
                if (meetsExecutionRequirements(confs, params.multiPivotConfig)) {
                    confirmedSignals++;
                    
                    // Apply direction filtering
                    let shouldOpenTrade = false;
                    let candidateTradeType = null;
                    
                    if (currentPivot.signal === 'long') {
                        if (params.tradeConfig.direction === 'buy' || params.tradeConfig.direction === 'both') {
                            shouldOpenTrade = true;
                            candidateTradeType = 'long';
                        } else if (params.tradeConfig.direction === 'alternate') {
                            shouldOpenTrade = true;
                            candidateTradeType = 'short';
                        }
                    } else if (currentPivot.signal === 'short') {
                        if (params.tradeConfig.direction === 'sell' || params.tradeConfig.direction === 'both') {
                            shouldOpenTrade = true;
                            candidateTradeType = 'short';
                        } else if (params.tradeConfig.direction === 'alternate') {
                            shouldOpenTrade = true;
                            candidateTradeType = 'long';
                        }
                    }
                    
                    if (shouldOpenTrade) {
                        const maxTrades = params.tradeConfig.singleTradeMode ? 1 : (params.tradeConfig.maxConcurrentTrades || 1);
                        if (openTrades.length < maxTrades) {
                            executedTrades++;
                            
                            let tradeSize;
                            switch (params.tradeConfig.positionSizingMode) {
                                case 'fixed':
                                    tradeSize = params.tradeConfig.amountPerTrade;
                                    break;
                                case 'percent':
                                    tradeSize = capital * (params.tradeConfig.riskPerTrade / 100);
                                    break;
                                case 'minimum':
                                    tradeSize = Math.max(capital * (params.tradeConfig.riskPerTrade / 100), params.tradeConfig.minimumTradeAmount || 0);
                                    break;
                                default:
                                    tradeSize = params.tradeConfig.amountPerTrade;
                            }
                            
                            const trade = createTrade(candidateTradeType, currentPivot, tradeSize, currentTime, primaryTf.interval, null, params.tradeConfig);
                            openTrades.push(trade);
                            allTrades.push(trade);
                        }
                    }
                }
            }
        }
    }
    
    // Close any remaining open trades
    for (const trade of openTrades) {
        const lastCandle = primaryCandles[primaryCandles.length - 1];
        updateTrade(trade, lastCandle, params.tradeConfig);
        capital += trade.pnl;
    }
    
    return {
        totalSignals,
        confirmedSignals,
        executedTrades,
        allTrades,
        finalCapital: capital,
        initialCapital: params.tradeConfig.initialCapital
    };
}

// ===== WORKER MESSAGE HANDLER =====
parentPort.on('message', async (message) => {
    try {
        const { params, config, workerId } = message;
        
        // Run the backtest
        const result = await runWorkerBacktest(params, config);
        
        // Send result back to main thread
        parentPort.postMessage({
            success: true,
            workerId,
            result,
            params
        });
    } catch (error) {
        // Send error back to main thread
        parentPort.postMessage({
            success: false,
            workerId: message.workerId,
            error: error.message,
            params: message.params
        });
    }
});
