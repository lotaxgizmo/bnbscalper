// immediateAggregationOptimizer.js
// Automated parameter optimization for immediate aggregation backtester
// Systematically tests different configurations to find optimal settings

// ===== OPTIMIZATION CONFIGURATION =====

const daysamount = 2;
const days = 1440 * daysamount;

const OPTIMIZATION_CONFIG = {
    takeProfitRange: { start: 0.6, end: 0.6, step: 0.1 },
    stopLossRange: { start: 0.4, end: 0.4, step: 0.1 },
    leverageRange: { start: 80, end: 80, step: 1 },
    tradingModes: ['cascade'],  
    // maxCandles: 86400, // 14 days of 1m candles 
    // maxCandles: 43200, // 14 days of 1m candles 
    // maxCandles: 30240, // 14 days of 1m candles 
    // maxCandles: 20160, // 14 days of 1m candles 
    // maxCandles: 15840, // 14 days of 1m candles 
    // maxCandles: 11520, // 14 days of 1m candles 
    maxCandles: 10080, // 7 days of 1m candles 
    // maxCandles: 5760, // 4 days of 1m candles 
    // maxCandles: 4320, // 3 days of 1m candles 
    // maxCandles: 2880, // 2 days of 1m candles 
    // maxCandles: 1440, // 1 days of 1m candles 
    tradeDirection: ['both'],
    // tradeDirection: ['both', 'alternate'],
    // delayReverseTime: 4320,
    delayReverseTime: 0,
    
    minimumTimeframes: 2,

    // 🎯 RECENT TRADE PERFORMANCE FILTER
    recentTradeFilter: {
        enabled: false,                    // Enable/disable recent trade filtering
        lookbackTrades: 5,               // Number of recent trades to examine
        minProfitableTrades: 3,          // Minimum profitable trades required in lookback window
        requireConsecutiveProfits: true, // If true, requires consecutive profits (not just total count)
        minRecentWinRate: 0,            // Alternative: minimum win rate % in recent trades (0-100, 0 = disabled)
        excludeIfInsufficientTrades: true // If true, exclude configs with fewer than lookbackTrades total trades
    },
    
    timeframeCombinations: [ 
        [

            
  
            {
                interval: '2h',
                role: 'primary',
                minSwingPctRange: { start: 0.1, end: 0.1, step: 0.1 },
                lookbackRange: { start: 2, end: 2, step: 1 },
                minLegBarsRange: { start: 2, end: 2, step: 1 },               
                weight: 1,
                oppositeRange: [false]
            },

            {
                interval: '1h',
                role: 'secondary',
                minSwingPctRange: { start: 0.1, end: 0.7, step: 0.1 },
                lookbackRange: { start: 1, end: 5, step: 1 },
                minLegBarsRange: { start: 1, end: 5, step: 1 },               
                weight: 1,
                oppositeRange: [false]
            },
            
            {
                interval: '1m',
                role: 'secondary',
                minSwingPctRange: { start: 0.2, end: 0.2, step: 0.1 },
                lookbackRange: { start: 3, end: 3, step: 1 },
                minLegBarsRange: { start: 1, end: 1, step: 1 },               
                weight: 1,
                oppositeRange: [false]
            },
             
           
        ]
    ],
    
    // Output settings
    showProgress: true,
    showBestResults: 10,
    exportResults: true,
    exportPath: './optimization_results/',
    silentMode: true  // Suppress individual backtest output
};

function createTradeConfig(params) {
    return {
        direction: params.direction,
        entryDelayMinutes: 0,
        takeProfit: params.takeProfit,
        stopLoss: params.stopLoss,
        leverage: params.leverage,
        switchOnOppositeSignal: false,
        numberOfOppositeSignal: 3,
        switchPolicy: 'flip',
        noTradeDays: [],
        enableTrailingStopLoss: false,
        enableTrailingTakeProfit: false,
        showCandle: false,
        showLimits: false,
        showPivot: false,
        showTradeDetails: false,
        hideCascades: true,
        singleTradeMode: true,
        maxConcurrentTrades: baseTradeConfig.maxConcurrentTrades,
        positionSizingMode: baseTradeConfig.positionSizingMode,
        amountPerTrade: baseTradeConfig.amountPerTrade,
        minimumTradeAmount: baseTradeConfig.minimumTradeAmount,
        initialCapital: baseTradeConfig.initialCapital,
        riskPerTrade: baseTradeConfig.riskPerTrade,
        maxTradeTimeMinutes: 0,
        orderDistancePct: 50,
        cancelThresholdPct: 100,
        totalMakerFee: baseTradeConfig.totalMakerFee,
        enableFundingRate: baseTradeConfig.enableFundingRate,
        enableSlippage: baseTradeConfig.enableSlippage,
        performanceMode: true,
        enterAll: false,
        saveToFile: false
    };
}

// ===== DYNAMIC BACKTEST CONFIGURATION =====
let BACKTEST_CONFIG = {
    tradingMode: 'cascade',
    useLiveAPI: false,
    maxCandles: OPTIMIZATION_CONFIG.maxCandles,
    showEveryNthTrade: 1,
    showFirstNTrades: 0,
    progressEvery: 50000,
    showInitializationLogs: false,
};

import {
    symbol,
    useLocalData,
    pivotDetectionMode
} from './config/config.js';

import { tradeConfig as baseTradeConfig } from './config/tradeconfig.js';

// Dynamic configurations - will be overridden during optimization
let tradeConfig = {};
let multiPivotConfig = {};

// ===== GLOBAL DATA CACHE =====
let GLOBAL_CACHE = {
    oneMinuteCandles: null,
    aggregatedCandles: new Map(), // timeframe -> candles
    pivotCache: new Map(), // timeframe -> pivots
    initialized: false
};
import { getCandles } from './apis/bybit.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

const formatNumberWithCommas = (num) => {
    if (typeof num !== 'number') return num;
    return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};



const colors = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    magenta: '\x1b[35m',
    blue: '\x1b[34m',
    dim: '\x1b[2m',
    bold: '\x1b[1m'
};

// ===== DATA LOADING =====
async function load1mCandles() {
    if (!OPTIMIZATION_CONFIG.silentMode) {
        console.log(`${colors.cyan}Loading 1m candles...${colors.reset}`);
    }
    
    const shouldUseAPI = BACKTEST_CONFIG.useLiveAPI || !useLocalData;
    
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
        
        // Apply time travel offset if configured
        let finalCandles;
        if (OPTIMIZATION_CONFIG.delayReverseTime && OPTIMIZATION_CONFIG.delayReverseTime > 0) {
            const timeOffset = OPTIMIZATION_CONFIG.delayReverseTime;
            const totalAvailable = candles.length;
            const startIndex = Math.max(0, totalAvailable - BACKTEST_CONFIG.maxCandles - timeOffset);
            const endIndex = Math.max(BACKTEST_CONFIG.maxCandles, totalAvailable - timeOffset);
            finalCandles = candles.slice(startIndex, endIndex);
            
            if (!OPTIMIZATION_CONFIG.silentMode) {
                console.log(`${colors.magenta}⏰ TIME TRAVEL ACTIVE: Going back ${timeOffset} candles (${Math.round(timeOffset/1440)} days)${colors.reset}`);
            }
        } else {
            finalCandles = candles.slice(-BACKTEST_CONFIG.maxCandles);
        }
        
        const firstCandle = finalCandles[0];
        const lastCandle = finalCandles[finalCandles.length - 1];
        if (!OPTIMIZATION_CONFIG.silentMode) {
            console.log(`${colors.green}Loaded ${finalCandles.length} 1m candles from CSV${colors.reset}`);
            console.log(`${colors.cyan}Data Range: ${formatDualTime(firstCandle.time)} → ${formatDualTime(lastCandle.time)}${colors.reset}`);
        }
        return finalCandles;
    } else {
        // For API, we need to fetch extra candles if time travel is enabled
        const candlesToFetch = OPTIMIZATION_CONFIG.delayReverseTime ? 
            BACKTEST_CONFIG.maxCandles + OPTIMIZATION_CONFIG.delayReverseTime : 
            BACKTEST_CONFIG.maxCandles;
            
        const candles = await getCandles(symbol, '1m', candlesToFetch);
        const sortedCandles = candles.sort((a, b) => a.time - b.time);
        
        // Apply time travel offset if configured
        let finalCandles;
        if (OPTIMIZATION_CONFIG.delayReverseTime && OPTIMIZATION_CONFIG.delayReverseTime > 0) {
            const timeOffset = OPTIMIZATION_CONFIG.delayReverseTime;
            const totalAvailable = sortedCandles.length;
            const startIndex = Math.max(0, totalAvailable - BACKTEST_CONFIG.maxCandles - timeOffset);
            const endIndex = Math.max(BACKTEST_CONFIG.maxCandles, totalAvailable - timeOffset);
            finalCandles = sortedCandles.slice(startIndex, endIndex);
            
            if (!OPTIMIZATION_CONFIG.silentMode) {
                console.log(`${colors.magenta}⏰ TIME TRAVEL ACTIVE: Going back ${timeOffset} candles (${Math.round(timeOffset/1440)} days)${colors.reset}`);
            }
        } else {
            finalCandles = sortedCandles.slice(-BACKTEST_CONFIG.maxCandles);
        }

        const firstCandle = finalCandles[0];
        const lastCandle = finalCandles[finalCandles.length - 1];
        if (!OPTIMIZATION_CONFIG.silentMode) {
            console.log(`${colors.green}Loaded ${finalCandles.length} 1m candles from API${colors.reset}`);
            console.log(`${colors.cyan}Data Range: ${formatDualTime(firstCandle.time)} → ${formatDualTime(lastCandle.time)}${colors.reset}`);
        }
        return finalCandles;
    }
}

// ===== VECTORIZED PIVOT DETECTION =====
function detectPivotsVectorized(candles, config) {
    const { pivotLookback, minSwingPct, minLegBars } = config;
    const pivots = [];
    
    if (candles.length < 2) return pivots;
    
    // Pre-extract price arrays for vectorized operations
    const highs = candles.map(c => pivotDetectionMode === 'close' ? c.close : c.high);
    const lows = candles.map(c => pivotDetectionMode === 'close' ? c.close : c.low);
    const times = candles.map(c => c.time);
    
    // Vectorized pivot detection
    const startIdx = Math.max(1, pivotLookback);
    
    for (let i = startIdx; i < candles.length; i++) {
        let isHighPivot = true;
        let isLowPivot = true;
        
        if (pivotLookback === 0) {
            // Special case: compare only to previous candle
            isHighPivot = highs[i] > highs[i - 1];
            isLowPivot = lows[i] < lows[i - 1];
            
            // Resolve conflicts by dominant excursion
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
            // Vectorized lookback comparison
            const lookbackStart = Math.max(0, i - pivotLookback);
            
            // Check high pivot using array slice and every()
            const highSlice = highs.slice(lookbackStart, i);
            isHighPivot = highSlice.every(h => highs[i] > h);
            
            // Check low pivot using array slice and every()
            const lowSlice = lows.slice(lookbackStart, i);
            isLowPivot = lowSlice.every(l => lows[i] < l);
        }
        
        if (!isHighPivot && !isLowPivot) continue;
        
        const pivotType = isHighPivot ? 'high' : 'low';
        const pivotPrice = isHighPivot ? highs[i] : lows[i];
        
        // Vectorized swing percentage calculation
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

// Legacy single pivot detection for compatibility
function detectPivot(candles, index, config) {
    const singleResult = detectPivotsVectorized(candles.slice(0, index + 1), config);
    return singleResult.find(p => p.index === index) || null;
}

// ===== IMMEDIATE AGGREGATION =====
function buildImmediateAggregatedCandles(oneMinCandles, timeframeMinutes) {
    const aggregatedCandles = [];
    const bucketSizeMs = timeframeMinutes * 60 * 1000;
    
    // Group 1m candles into timeframe buckets
    const buckets = new Map();
    
    for (const candle of oneMinCandles) {
        // Calculate bucket END time using UTC midnight alignment
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
    
    // Build aggregated candles from complete buckets only
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

// ===== DAY OF WEEK FILTERING =====
function isNoTradeDay(timestamp) {
    if (!tradeConfig.noTradeDays || tradeConfig.noTradeDays.length === 0) {
        return false; // No restrictions if not configured
    }
    
    const date = new Date(timestamp);
    const dayNames = ['Su', 'M', 'T', 'W', 'Th', 'F', 'Sa'];
    const currentDay = dayNames[date.getDay()];
    
    return tradeConfig.noTradeDays.includes(currentDay);
}

function calculateFundingRate() {
    if (!tradeConfig.enableFundingRate) return 0;
    
    if (tradeConfig.fundingRateMode === 'variable') {
        // Generate random funding rate between min and max
        const min = tradeConfig.variableFundingMin || -0.05;
        const max = tradeConfig.variableFundingMax || 0.05;
        return min + Math.random() * (max - min);
    } else {
        // Fixed funding rate
        return tradeConfig.fundingRatePercent || 0.01;
    }
}

function applyFundingRates(currentTime, openTrades, capital, appliedFundingRates) {
    if (!tradeConfig.enableFundingRate || openTrades.length === 0) return capital;
    
    const fundingHours = tradeConfig.fundingRateHours || 8;
    const fundingIntervalMs = fundingHours * 60 * 60 * 1000;
    
    // Check if it's time for funding (every X hours)
    const currentHour = new Date(currentTime).getUTCHours();
    if (currentHour % fundingHours !== 0) return capital;
    
    // Check if we already applied funding for this hour
    const fundingKey = `${currentTime}_${currentHour}`;
    if (appliedFundingRates.has(fundingKey)) return capital;
    appliedFundingRates.add(fundingKey);
    
    const fundingRate = calculateFundingRate();
    let totalFundingCost = 0;
    
    for (const trade of openTrades) {
        // Funding cost = position size * funding rate
        const fundingCost = trade.tradeSize * (fundingRate / 100);
        
        // Long positions pay positive funding, short positions receive it
        // But we always deduct the absolute cost from capital
        const actualCost = trade.type === 'long' ? fundingCost : -fundingCost;
        
        // Apply funding cost to capital (always deduct the absolute amount)
        capital -= Math.abs(actualCost);
        totalFundingCost += Math.abs(actualCost);
        
        // Track funding in trade
        if (!trade.fundingCosts) trade.fundingCosts = [];
        trade.fundingCosts.push({
            time: currentTime,
            rate: fundingRate,
            cost: actualCost
        });
    }
    
    if (tradeConfig.showTradeDetails && totalFundingCost !== 0) {
        console.log(`${colors.red}💰 FUNDING: ${fundingRate.toFixed(4)}% rate → -$${formatNumberWithCommas(totalFundingCost)} (${openTrades.length} positions)${colors.reset}`);
    }
    
    return capital;
}

function calculateSlippage(tradeSize) {
    if (!tradeConfig.enableSlippage) return 0;
    
    if (tradeConfig.slippageMode === 'variable') {
        // Generate random slippage between min and max
        const min = tradeConfig.variableSlippageMin ?? 0.01;
        const max = tradeConfig.variableSlippageMax ?? 0.05;
        return min + Math.random() * (max - min);
    } else if (tradeConfig.slippageMode === 'market_impact') {
        // Market impact based on trade size
        const impactFactor = tradeConfig.marketImpactFactor ?? 0.001;
        const baseSlippage = tradeConfig.slippagePercent ?? 0.05;
        const sizeImpact = (tradeSize / 1000) * impactFactor;
        return baseSlippage + sizeImpact;
    } else {
        // Fixed slippage
        return tradeConfig.slippagePercent ?? 0.05;
    }
}

function applySlippageToPrice(originalPrice, slippagePercent, isEntry, isLong) {
    if (!tradeConfig.enableSlippage || slippagePercent === 0) return originalPrice;
    
    // Slippage always works against the trader
    // Entry: Long buys higher, Short sells lower
    // Exit: Long sells lower, Short buys higher
    const slippageAmount = originalPrice * (slippagePercent / 100);
    
    if (isEntry) {
        return isLong ? originalPrice + slippageAmount : originalPrice - slippageAmount;
    } else {
        return isLong ? originalPrice - slippageAmount : originalPrice + slippageAmount;
    }
}

// ===== TRADE MANAGEMENT =====
function createTrade(signal, pivot, tradeSize, currentTime, timeframe, entryPriceOverride = null) {
    const originalEntryPrice = (entryPriceOverride != null ? entryPriceOverride : pivot.price);
    const isLong = signal === 'long';
    
    // Apply entry slippage
    const entrySlippage = calculateSlippage(tradeSize);
    const entryPrice = applySlippageToPrice(originalEntryPrice, entrySlippage, true, isLong);
    
    // Calculate TP and SL based on slippage-adjusted entry price
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
        // Slippage tracking
        originalEntryPrice: originalEntryPrice,
        entrySlippage: entrySlippage,
        exitSlippage: null,
        originalExitPrice: null,
        // Trailing fields
        bestPrice: entryPrice,
        trailingTakeProfitActive: false,
        trailingTakeProfitPrice: null,
        originalTakeProfitPrice: takeProfitPrice,
        trailingStopLossActive: false,
        trailingStopLossPrice: null,
        originalStopLossPrice: stopLossPrice
    };
}

function updateTrade(trade, currentCandle) {
    const currentPrice = currentCandle.close;
    const isLong = trade.type === 'long';
    
    // Update best price achieved
    if (isLong) {
        if (currentPrice > trade.bestPrice) {
            trade.bestPrice = currentPrice;
        }
    } else {
        if (currentPrice < trade.bestPrice) {
            trade.bestPrice = currentPrice;
        }
    }
    
    // Check if trailing stop loss should be activated
    if (tradeConfig.enableTrailingStopLoss && !trade.trailingStopLossActive) {
        const currentProfitPct = isLong ? 
            ((currentPrice - trade.entryPrice) / trade.entryPrice) * 100 :
            ((trade.entryPrice - currentPrice) / trade.entryPrice) * 100;
            
        if (currentProfitPct >= tradeConfig.trailingStopLossTrigger) {
            trade.trailingStopLossActive = true;
            // Calculate initial trailing SL price
            const trailingDistance = trade.bestPrice * (tradeConfig.trailingStopLossDistance / 100);
            trade.trailingStopLossPrice = isLong ? 
                trade.bestPrice - trailingDistance :
                trade.bestPrice + trailingDistance;
        }
    }
    
    // Check if trailing take profit should be activated
    if (tradeConfig.enableTrailingTakeProfit && !trade.trailingTakeProfitActive) {
        const currentProfitPct = isLong ? 
            ((currentPrice - trade.entryPrice) / trade.entryPrice) * 100 :
            ((trade.entryPrice - currentPrice) / trade.entryPrice) * 100;
            
        if (currentProfitPct >= tradeConfig.trailingTakeProfitTrigger) {
            trade.trailingTakeProfitActive = true;
            // Calculate initial trailing TP price
            const trailingDistance = trade.bestPrice * (tradeConfig.trailingTakeProfitDistance / 100);
            trade.trailingTakeProfitPrice = isLong ? 
                trade.bestPrice - trailingDistance :
                trade.bestPrice + trailingDistance;
        }
    }
    
    // Update trailing stop loss price if active
    if (trade.trailingStopLossActive) {
        const trailingDistance = trade.bestPrice * (tradeConfig.trailingStopLossDistance / 100);
        const newTrailingPrice = isLong ? 
            trade.bestPrice - trailingDistance :
            trade.bestPrice + trailingDistance;
            
        // Only update if new trailing price is more favorable (closer to current price)
        if (isLong) {
            if (newTrailingPrice > trade.trailingStopLossPrice) {
                trade.trailingStopLossPrice = newTrailingPrice;
            }
        } else {
            if (newTrailingPrice < trade.trailingStopLossPrice) {
                trade.trailingStopLossPrice = newTrailingPrice;
            }
        }
    }
    
    // Update trailing take profit price if active
    if (trade.trailingTakeProfitActive) {
        const trailingDistance = trade.bestPrice * (tradeConfig.trailingTakeProfitDistance / 100);
        const newTrailingPrice = isLong ? 
            trade.bestPrice - trailingDistance :
            trade.bestPrice + trailingDistance;
            
        // Only update if new trailing price is more favorable
        if (isLong) {
            if (newTrailingPrice > trade.trailingTakeProfitPrice) {
                trade.trailingTakeProfitPrice = newTrailingPrice;
            }
        } else {
            if (newTrailingPrice < trade.trailingTakeProfitPrice) {
                trade.trailingTakeProfitPrice = newTrailingPrice;
            }
        }
    }
    
    // Check for exit conditions
    let shouldClose = false;
    let exitReason = '';
    
    // Priority 1: Check trailing take profit first (if active)
    if (trade.trailingTakeProfitActive) {
        if (isLong) {
            if (currentPrice <= trade.trailingTakeProfitPrice) {
                shouldClose = true;
                exitReason = 'TRAILING_TP';
            }
        } else {
            if (currentPrice >= trade.trailingTakeProfitPrice) {
                shouldClose = true;
                exitReason = 'TRAILING_TP';
            }
        }
    }
    
    // Priority 2: Check trailing stop loss (if active and no TP triggered)
    if (!shouldClose && trade.trailingStopLossActive) {
        if (isLong) {
            if (currentPrice <= trade.trailingStopLossPrice) {
                shouldClose = true;
                exitReason = 'TRAILING_SL';
            }
        } else {
            if (currentPrice >= trade.trailingStopLossPrice) {
                shouldClose = true;
                exitReason = 'TRAILING_SL';
            }
        }
    }
    
    // Priority 3: Check regular TP/SL if no trailing exits triggered
    if (!shouldClose) {
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
    }
    
    if (shouldClose) {
        trade.status = 'closed';
        
        // Apply exit slippage (half of entry slippage for more realistic simulation)
        const exitSlippage = calculateSlippage(trade.tradeSize) * 0.5;
        trade.originalExitPrice = currentPrice;
        trade.exitSlippage = exitSlippage;
        trade.exitPrice = applySlippageToPrice(currentPrice, exitSlippage, false, isLong);
        
        trade.exitTime = currentCandle.time;
        trade.exitReason = exitReason;
        
        // Calculate P&L using slippage-adjusted exit price
        const priceChange = isLong ? (trade.exitPrice - trade.entryPrice) : (trade.entryPrice - trade.exitPrice);
        trade.pnl = (priceChange / trade.entryPrice) * trade.tradeSize * trade.leverage;
        trade.pnlPct = (priceChange / trade.entryPrice) * 100 * trade.leverage;
        
        // Apply fees
        const totalFees = trade.tradeSize * (tradeConfig.totalMakerFee / 100) * 2; // Entry + exit
        trade.pnl -= totalFees;
    }
    
    return shouldClose;
}

// ===== CASCADE CONFIRMATION =====
function checkCascadeConfirmation(primaryPivot, allTimeframePivots, asOfTime, primaryInterval) {
    const confirmations = [];
    // Combine ±5m proximity with configured confirmation window by capping proximity
    const proximityWindowMs = 5 * 60 * 1000; // ±5 minutes proximity
    const configuredMinutes = (multiPivotConfig.cascadeSettings?.confirmationWindow?.[primaryInterval]) ?? null;
    const configuredWindowMs = (configuredMinutes != null) ? (configuredMinutes * 60 * 1000) : null;
    const effectiveWindowMs = (configuredWindowMs != null) ? Math.min(proximityWindowMs, configuredWindowMs) : proximityWindowMs;

    for (const [timeframe, pivots] of Object.entries(allTimeframePivots)) {
        if (pivots.length === 0) continue;

        const tfConfig = multiPivotConfig.timeframes.find(tf => tf.interval === timeframe);
        if (!tfConfig) continue;

        // Determine target signal type for confirmations
        const targetSignal = tfConfig.opposite ?
            (primaryPivot.signal === 'long' ? 'short' : 'long') :
            primaryPivot.signal;

        // Find pivots of the target signal type within ±effectiveWindow of PRIMARY time
        // and only include those that have actually occurred by asOfTime (no lookahead)
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



// ===== OPTIMIZATION UTILITIES =====
function generateParameterCombinations() {
    const combinations = [];
    
    // Generate TP/SL/Leverage combinations
    const tpValues = generateRange(OPTIMIZATION_CONFIG.takeProfitRange);
    const slValues = generateRange(OPTIMIZATION_CONFIG.stopLossRange);
    const leverageValues = generateRange(OPTIMIZATION_CONFIG.leverageRange);
    
    for (const tradingMode of OPTIMIZATION_CONFIG.tradingModes) {
        for (const direction of OPTIMIZATION_CONFIG.tradeDirection) {
            for (const tp of tpValues) {
                for (const sl of slValues) {
                    for (const leverage of leverageValues) {
                        for (const tfCombination of OPTIMIZATION_CONFIG.timeframeCombinations) {
                            // Generate all timeframe parameter combinations
                            const tfCombos = generateTimeframeCombinations(tfCombination);
                            
                            for (const tfCombo of tfCombos) {
                                combinations.push({
                                    tradingMode,
                                    direction,
                                    takeProfit: tp,
                                    stopLoss: sl,
                                    leverage,
                                    timeframes: tfCombo
                                });
                            }
                        }
                    }
                }
            }
        }
    }
    
    return combinations;
}

function generateRange(range) {
    const values = [];
    for (let i = range.start; i <= range.end; i += range.step) {
        values.push(Math.round(i * 1000) / 1000); // Round to avoid floating point issues
    }
    return values;
}

function generateTimeframeCombinations(tfTemplate) {
    const combinations = [];
    
    function generateCombos(index, currentCombo) {
        if (index >= tfTemplate.length) {
            combinations.push([...currentCombo]);
            return;
        }
        
        const tf = tfTemplate[index];
        const minSwingPcts = generateRange(tf.minSwingPctRange);
        const lookbacks = generateRange(tf.lookbackRange);
        const minLegBars = generateRange(tf.minLegBarsRange);
        
        for (const minSwingPct of minSwingPcts) {
            for (const lookback of lookbacks) {
                for (const minLegBar of minLegBars) {
                    for (const opposite of tf.oppositeRange) {
                        const tfConfig = {
                            interval: tf.interval,
                            role: tf.role,
                            minSwingPct,
                            lookback,
                            minLegBars: minLegBar,
                            weight: tf.weight,
                            opposite
                        };
                        
                        currentCombo[index] = tfConfig;
                        generateCombos(index + 1, currentCombo);
                    }
                }
            }
        }
    }
    
    generateCombos(0, new Array(tfTemplate.length));
    return combinations;
}



function createMultiPivotConfig(params) {
    return {
        enabled: true,
        timeframes: params.timeframes,
        cascadeSettings: {
            minTimeframesRequired: OPTIMIZATION_CONFIG.minimumTimeframes,
            confirmationWindow: {
                '4h': 230,
                '2h': 120,
                '1h': 60,
                '15m': 60,
                '5m': 15,
                '1m': 30
            },
            requireAllTimeframes: false,
            requirePrimaryTimeframe: true,
            requireHierarchicalValidation: false
        },
        signalSettings: {
            minSignalStrength: 0.5,
            maxSignalAge: {
                '4h': 240,
                '2h': 120,
                '1h': 60,
                '15m': 60,
                '5m': 30,
                '1m': 1
            },
            requireTrendAlignment: true
        },
        debug: {
            showCascadeProcess: false,
            showTimeframeAnalysis: false,
            showSignalStrength: false,
            showConfirmationTiming: false,
            logFailedCascades: false,
            cascadeLogging: {
                enabled: false
            }
        }
    };
}

function calculatePerformanceMetrics(results) {
    if (!results.allTrades || results.allTrades.length === 0) {
        return {
            totalTrades: 0,
            winRate: 0,
            totalPnL: 0,
            avgPnL: 0,
            maxDrawdown: 0,
            profitFactor: 0,
            sharpeRatio: 0,
            finalCapital: results.finalCapital || 100,
            recentTradeAnalysis: {
                passesFilter: false,
                recentTrades: 0,
                recentProfitable: 0,
                recentWinRate: 0,
                reason: 'No trades executed'
            }
        };
    }
    
    const trades = results.allTrades;
    const wins = trades.filter(t => t.pnl > 0);
    const losses = trades.filter(t => t.pnl < 0);
    
    const totalPnL = trades.reduce((sum, t) => sum + t.pnl, 0);
    const winRate = (wins.length / trades.length) * 100;
    const avgPnL = totalPnL / trades.length;
    
    const grossProfit = wins.reduce((sum, t) => sum + t.pnl, 0);
    const grossLoss = Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 999 : 0;
    
    // Calculate max drawdown
    let runningCapital = results.initialCapital || 100;
    let peak = runningCapital;
    let maxDrawdown = 0;
    
    for (const trade of trades) {
        runningCapital += trade.pnl;
        if (runningCapital > peak) {
            peak = runningCapital;
        }
        const drawdown = ((peak - runningCapital) / peak) * 100;
        maxDrawdown = Math.max(maxDrawdown, drawdown);
    }
    
    // Simple Sharpe ratio approximation
    const returns = trades.map(t => (t.pnl / (results.initialCapital || 100)) * 100);
    const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const stdDev = Math.sqrt(returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length);
    const sharpeRatio = stdDev > 0 ? avgReturn / stdDev : 0;
    
    // 🎯 RECENT TRADE PERFORMANCE ANALYSIS
    const recentTradeAnalysis = analyzeRecentTradePerformance(trades);
    
    return {
        totalTrades: trades.length,
        winRate: winRate,
        totalPnL: totalPnL,
        avgPnL: avgPnL,
        maxDrawdown: maxDrawdown,
        profitFactor: profitFactor,
        sharpeRatio: sharpeRatio,
        finalCapital: results.finalCapital || (results.initialCapital || 100) + totalPnL,
        recentTradeAnalysis: recentTradeAnalysis
    };
}

// 🎯 RECENT TRADE PERFORMANCE ANALYZER
function analyzeRecentTradePerformance(allTrades) {
    const filter = OPTIMIZATION_CONFIG.recentTradeFilter;
    
    if (!filter.enabled) {
        return {
            passesFilter: true,
            recentTrades: allTrades.length,
            recentProfitable: allTrades.filter(t => t.pnl > 0).length,
            recentWinRate: allTrades.length > 0 ? (allTrades.filter(t => t.pnl > 0).length / allTrades.length) * 100 : 0,
            reason: 'Filter disabled'
        };
    }
    
    // Check if we have enough trades
    if (filter.excludeIfInsufficientTrades && allTrades.length < filter.lookbackTrades) {
        return {
            passesFilter: false,
            recentTrades: allTrades.length,
            recentProfitable: 0,
            recentWinRate: 0,
            reason: `Insufficient trades: ${allTrades.length} < ${filter.lookbackTrades} required`
        };
    }
    
    // Get the most recent trades (sorted by exit time, then entry time)
    const sortedTrades = [...allTrades].sort((a, b) => {
        // Sort by exit time if both have exit times, otherwise by entry time
        const aTime = a.exitTime || a.entryTime;
        const bTime = b.exitTime || b.entryTime;
        return bTime - aTime; // Most recent first
    });
    
    const recentTrades = sortedTrades.slice(0, filter.lookbackTrades);
    const recentProfitable = recentTrades.filter(t => t.pnl > 0);
    const recentWinRate = recentTrades.length > 0 ? (recentProfitable.length / recentTrades.length) * 100 : 0;
    
    let passesFilter = true;
    let reason = 'Passes all filters';
    
    // Check minimum profitable trades requirement
    if (recentProfitable.length < filter.minProfitableTrades) {
        passesFilter = false;
        reason = `Recent profitable trades: ${recentProfitable.length} < ${filter.minProfitableTrades} required`;
    }
    
    // Check consecutive profits requirement
    if (passesFilter && filter.requireConsecutiveProfits) {
        let consecutiveProfits = 0;
        for (const trade of recentTrades) {
            if (trade.pnl > 0) {
                consecutiveProfits++;
            } else {
                break; // Stop at first loss
            }
        }
        
        if (consecutiveProfits < filter.minProfitableTrades) {
            passesFilter = false;
            reason = `Consecutive profits: ${consecutiveProfits} < ${filter.minProfitableTrades} required`;
        }
    }
    
    // Check minimum recent win rate requirement
    if (passesFilter && filter.minRecentWinRate > 0 && recentWinRate < filter.minRecentWinRate) {
        passesFilter = false;
        reason = `Recent win rate: ${recentWinRate.toFixed(1)}% < ${filter.minRecentWinRate}% required`;
    }
    
    return {
        passesFilter: passesFilter,
        recentTrades: recentTrades.length,
        recentProfitable: recentProfitable.length,
        recentWinRate: recentWinRate,
        reason: reason,
        tradeDetails: recentTrades.map(t => ({
            pnl: t.pnl,
            profitable: t.pnl > 0,
            exitTime: t.exitTime || t.entryTime
        }))
    };
}

function formatOptimizationResult(params, metrics, index, total) {
    const tfStr = params.timeframes.map(tf => `${tf.interval}(${tf.minSwingPct}%,L${tf.lookback},B${tf.minLegBars},O${tf.opposite ? 'T' : 'F'})`).join('+');
    const detailedTfStr = params.timeframes.map(tf => `${tf.interval}: swing=${tf.minSwingPct}%, lookback=${tf.lookback}, minLegBars=${tf.minLegBars}, opposite=${tf.opposite}`).join(' | ');
    
    return {
        index: index + 1,
        total: total,
        tradingMode: params.tradingMode,
        direction: params.direction,
        takeProfit: params.takeProfit,
        stopLoss: params.stopLoss,
        leverage: params.leverage,
        timeframes: tfStr,
        detailedTimeframes: detailedTfStr,
        totalTrades: metrics.totalTrades,
        winRate: metrics.winRate.toFixed(1),
        totalPnL: metrics.totalPnL.toFixed(2),
        avgPnL: metrics.avgPnL.toFixed(2),
        maxDrawdown: metrics.maxDrawdown.toFixed(1),
        profitFactor: metrics.profitFactor.toFixed(2),
        sharpeRatio: metrics.sharpeRatio.toFixed(2),
        finalCapital: metrics.finalCapital.toFixed(2),
        score: calculateScore(metrics),
        // 🎯 RECENT TRADE PERFORMANCE DATA
        recentTrades: metrics.recentTradeAnalysis.recentTrades,
        recentProfitable: metrics.recentTradeAnalysis.recentProfitable,
        recentWinRate: metrics.recentTradeAnalysis.recentWinRate.toFixed(1),
        recentTradeStatus: metrics.recentTradeAnalysis.reason
    };
}

function calculateScore(metrics) {
    // Weighted scoring system
    const pnlWeight = 0.4;
    const winRateWeight = 0.2;
    const profitFactorWeight = 0.2;
    const drawdownWeight = 0.1;
    const sharpeWeight = 0.1;
    
    const pnlScore = Math.max(0, metrics.totalPnL / 10); // Normalize PnL
    const winRateScore = metrics.winRate / 100;
    const profitFactorScore = Math.min(metrics.profitFactor / 3, 1); // Cap at 3
    const drawdownScore = Math.max(0, 1 - (metrics.maxDrawdown / 50)); // Penalize high drawdown
    const sharpeScore = Math.max(0, Math.min(metrics.sharpeRatio / 2, 1)); // Cap at 2
    
    return (pnlScore * pnlWeight + 
            winRateScore * winRateWeight + 
            profitFactorScore * profitFactorWeight + 
            drawdownScore * drawdownWeight + 
            sharpeScore * sharpeWeight) * 100;
}

async function exportResults(results) {
    if (!OPTIMIZATION_CONFIG.exportResults) return;
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `immediate_aggregation_optimization_${timestamp}.csv`;
    const filepath = path.join(__dirname, OPTIMIZATION_CONFIG.exportPath, filename);
    
    // Ensure directory exists
    const dir = path.dirname(filepath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    
    // Create CSV content
    const headers = [
        'Rank', 'Score', 'Trading Mode', 'Direction', 'Take Profit', 'Stop Loss', 'Leverage',
        'Timeframes', 'Detailed Timeframes', 'Total Trades', 'Win Rate %', 'Total PnL', 'Avg PnL', 'Max Drawdown %',
        'Profit Factor', 'Sharpe Ratio', 'Final Capital', 'Recent Trades', 'Recent Profitable', 'Recent Win Rate %', 'Recent Status'
    ];
    
    const csvContent = [headers.join(',')];
    
    results.forEach((result, index) => {
        const row = [
            index + 1,
            result.score.toFixed(2),
            result.tradingMode,
            result.direction,
            result.takeProfit,
            result.stopLoss,
            result.leverage,
            `"${result.timeframes}"`,
            `"${result.detailedTimeframes}"`,
            result.totalTrades,
            result.winRate,
            result.totalPnL,
            result.avgPnL,
            result.maxDrawdown,
            result.profitFactor,
            result.sharpeRatio,
            result.finalCapital,
            result.recentTrades,
            result.recentProfitable,
            result.recentWinRate,
            `"${result.recentTradeStatus}"`
        ];
        csvContent.push(row.join(','));
    });
    
    fs.writeFileSync(filepath, csvContent.join('\n'));
    console.log(`${colors.green}Results exported to: ${filepath}${colors.reset}`);
}

// ===== GLOBAL DATA CACHE FUNCTIONS =====
async function preloadAndCacheData() {
    if (GLOBAL_CACHE.initialized) {
        console.log(`${colors.green}Using cached data (already loaded)${colors.reset}`);
        return;
    }
    
    console.log(`${colors.cyan}=== PRELOADING AND CACHING DATA ===${colors.reset}`);
    
    // Load 1m candles once
    GLOBAL_CACHE.oneMinuteCandles = await load1mCandles();
    console.log(`${colors.green}✓ Cached 1m candles: ${GLOBAL_CACHE.oneMinuteCandles.length} candles${colors.reset}`);
    
    // Pre-build all required timeframes
    const allTimeframes = new Set();
    for (const tfCombination of OPTIMIZATION_CONFIG.timeframeCombinations) {
        for (const tf of tfCombination) {
            allTimeframes.add(tf.interval);
        }
    }
    
    for (const timeframe of allTimeframes) {
        const timeframeMinutes = parseTimeframeToMinutes(timeframe);
        const aggregatedCandles = buildImmediateAggregatedCandles(GLOBAL_CACHE.oneMinuteCandles, timeframeMinutes);
        GLOBAL_CACHE.aggregatedCandles.set(timeframe, aggregatedCandles);
        console.log(`${colors.green}✓ Cached ${timeframe} candles: ${aggregatedCandles.length} candles${colors.reset}`);
    }
    
    GLOBAL_CACHE.initialized = true;
    console.log(`${colors.green}✅ Global data cache initialized successfully${colors.reset}`);
}

function getCachedAggregatedCandles(timeframe) {
    if (!GLOBAL_CACHE.initialized) {
        throw new Error('Global cache not initialized. Call preloadAndCacheData() first.');
    }
    return GLOBAL_CACHE.aggregatedCandles.get(timeframe);
}

function getCachedOneMinuteCandles() {
    if (!GLOBAL_CACHE.initialized) {
        throw new Error('Global cache not initialized. Call preloadAndCacheData() first.');
    }
    return GLOBAL_CACHE.oneMinuteCandles;
}

// ===== OPTIMIZED BACKTESTING FUNCTION =====
async function runOptimizedBacktest(params) {
    const startTime = Date.now();
    
    // Use cached data instead of loading fresh
    const oneMinuteCandles = getCachedOneMinuteCandles();
    
    // Use cached aggregated candles and build pivot data
    const timeframeData = {};
    const allTimeframePivots = {};
    
    for (const tfConfig of multiPivotConfig.timeframes) {
        const tf = tfConfig.interval;
        
        // Get cached aggregated candles
        const aggregatedCandles = getCachedAggregatedCandles(tf);
        timeframeData[tf] = {
            candles: aggregatedCandles,
            config: tfConfig
        };
        
        // Vectorized pivot detection for entire timeframe
        const allPivots = detectPivotsVectorized(aggregatedCandles, {
            pivotLookback: tfConfig.lookback,
            minSwingPct: tfConfig.minSwingPct,
            minLegBars: tfConfig.minLegBars
        });
        
        // Enforce minimum bars between consecutive pivots
        const pivots = [];
        let lastAcceptedPivotIndex = null;
        
        for (const pivot of allPivots) {
            if (lastAcceptedPivotIndex !== null) {
                const barsSinceLast = pivot.index - lastAcceptedPivotIndex;
                if (typeof tfConfig.minLegBars === 'number' && barsSinceLast < tfConfig.minLegBars) {
                    continue; // skip pivot: not enough bars since previous accepted pivot
                }
            }
            
            pivots.push(pivot);
            lastAcceptedPivotIndex = pivot.index;
        }
        
        allTimeframePivots[tf] = pivots;
    }
    
    
    const totalPivots = Object.values(allTimeframePivots).reduce((sum, pivots) => sum + pivots.length, 0);
    if (!OPTIMIZATION_CONFIG.silentMode) {
        console.log(`${colors.cyan}Total pivots detected across all timeframes: ${colors.yellow}${totalPivots}${colors.reset}`);
        
        multiPivotConfig.timeframes.forEach(tfConfig => {
            const pivots = allTimeframePivots[tfConfig.interval] || [];
            console.log(`  ${colors.yellow}${tfConfig.interval.padEnd(4)}${colors.reset}: ${colors.green}${pivots.length.toString().padStart(4)}${colors.reset} pivots`);
        });
    }
    
    // Get primary timeframe for main loop
    const primaryTf = multiPivotConfig.timeframes.find(tf => tf.role === 'primary');
    if (!primaryTf) {
        throw new Error('No primary timeframe configured');
    }
    
    const primaryCandles = timeframeData[primaryTf.interval].candles;
    const primaryPivots = allTimeframePivots[primaryTf.interval];
    
    // Trading simulation
    let capital = tradeConfig.initialCapital;
    let openTrades = [];
    let allTrades = [];
    let confirmedSignals = 0;
    let executedTrades = 0;
    let totalSignals = 0;
    let appliedFundingRates = new Set(); // Track applied funding to avoid duplicates
    
    // Track consecutive opposite signals for flip logic
    const oppositeSignalCounts = { long: 0, short: 0 };
    // Pending cascade windows awaiting confirmations (execute at last-confirm time)
    const pendingWindows = [];
    
    if (!OPTIMIZATION_CONFIG.silentMode) {
        console.log(`${colors.cyan}\n=== STARTING IMMEDIATE AGGREGATION BACKTESTING WITH TRADES ===${colors.reset}`);
        console.log(`${colors.yellow}Initial Capital: $${formatNumberWithCommas(capital)}${colors.reset}`);
        console.log(`${colors.yellow}Processing ${primaryPivots.length} primary signals from ${primaryTf.interval} timeframe${colors.reset}`);
        console.log(`${colors.yellow}Trade monitoring using 1-minute precision${colors.reset}`);
    }
    
    // Create a map of 1-minute candle times for quick lookup
    const oneMinuteTimeMap = new Map();
    oneMinuteCandles.forEach((candle, index) => {
        oneMinuteTimeMap.set(candle.time, index);
    });
    
    // Process each primary timeframe candle
    for (let i = 0; i < primaryCandles.length; i++) {
        const currentCandle = primaryCandles[i];
        const currentTime = currentCandle.time;
        
        // Find the corresponding 1-minute candle range for this primary candle
        const primaryTfMinutes = parseTimeframeToMinutes(primaryTf.interval);
        const startTime = currentTime - (primaryTfMinutes * 60 * 1000);
        
        // Find all 1-minute candles that fall within this primary candle's time range
        const minuteCandlesInRange = [];
        for (let j = 0; j < oneMinuteCandles.length; j++) {
            const minuteCandle = oneMinuteCandles[j];
            if (minuteCandle.time > startTime && minuteCandle.time <= currentTime) {
                minuteCandlesInRange.push(minuteCandle);
            }
        }
        
        // Store closed trades for this candle to display them in chronological order
        const closedTradesThisCandle = [];
        
        // Apply funding rates (every X hours)
        capital = applyFundingRates(currentTime, openTrades, capital, appliedFundingRates);
        
        // Update existing trades with each 1-minute candle in the range
        for (const minuteCandle of minuteCandlesInRange) {
            for (let j = openTrades.length - 1; j >= 0; j--) {
                const trade = openTrades[j];
                
                // Only monitor trades that have actually started (entry time has passed)
                if (minuteCandle.time >= trade.entryTime) {
                    const shouldClose = updateTrade(trade, minuteCandle);
                    
                    if (shouldClose) {
                        capital += trade.pnl;
                        const closedTrade = openTrades.splice(j, 1)[0];
                        closedTradesThisCandle.push(closedTrade);
                    }
                }
            }

            // Evaluate pending cascade windows at this minute for execution
            if (BACKTEST_CONFIG.tradingMode === 'cascade' && pendingWindows.length > 0) {
                for (let w = pendingWindows.length - 1; w >= 0; w--) {
                    const win = pendingWindows[w];
                    const primaryInterval = primaryTf.interval;
                    const proximityWindowMs = 5 * 60 * 1000;
                    const configuredMinutes = (multiPivotConfig.cascadeSettings?.confirmationWindow?.[primaryInterval]) ?? null;
                    const configuredWindowMs = (configuredMinutes != null) ? (configuredMinutes * 60 * 1000) : null;
                    const effectiveWindowMs = (configuredWindowMs != null) ? Math.min(proximityWindowMs, configuredWindowMs) : proximityWindowMs;
                    const windowEnd = win.primaryPivot.time + effectiveWindowMs;

                    if (minuteCandle.time > windowEnd) {
                        // Expire window
                        pendingWindows.splice(w, 1);
                        continue;
                    }

                    const confs = checkCascadeConfirmation(win.primaryPivot, allTimeframePivots, minuteCandle.time, primaryInterval);
                    if (meetsExecutionRequirements(confs)) {
                        // Determine execution time: max(primary, last confirmation)
                        const lastConfTime = Math.max(...confs.map(c => c.pivot.time));
                        const executionTime = Math.max(win.primaryPivot.time, lastConfTime);

                        // Apply entry delay from config
                        const delayMs = tradeConfig.entryDelayMinutes * 60 * 1000;
                        const actualEntryTime = executionTime + delayMs;

                        // Entry price: 1m close at delayed entry time
                        let entryPriceOverride = null;
                        const delayedEntryIdx = oneMinuteTimeMap.get(actualEntryTime);
                        if (typeof delayedEntryIdx === 'number') {
                            entryPriceOverride = oneMinuteCandles[delayedEntryIdx].close;
                        } else {
                            // Find nearest 1m candle to delayed entry time
                            const thirtySec = 30 * 1000;
                            let nearest = null;
                            for (const c of oneMinuteCandles) {
                                if (Math.abs(c.time - actualEntryTime) <= thirtySec) {
                                    if (!nearest || Math.abs(c.time - actualEntryTime) < Math.abs(nearest.time - actualEntryTime)) {
                                        nearest = c;
                                    }
                                }
                            }
                            if (nearest) entryPriceOverride = nearest.close;
                        }

                        if (!entryPriceOverride) {
                            continue; // cannot execute without price
                        }

                        // Check if current day is a no-trade day
                        if (isNoTradeDay(actualEntryTime)) {
                            if (tradeConfig.showTradeDetails) {
                                const date = new Date(actualEntryTime);
                                const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
                                const currentDayName = dayNames[date.getDay()];
                                console.log(`  ${colors.yellow}└─> [NO TRADE DAY] ${win.primaryPivot.signal.toUpperCase()} cascade signal skipped - ${currentDayName} is in noTradeDays${colors.reset}`);
                            }
                            // Remove executed window
                            pendingWindows.splice(w, 1);
                            continue;
                        }

                        // Apply direction filtering logic
                        let candidateTradeType = null;
                        let shouldOpenTrade = false;
                        
                        if (win.primaryPivot.signal === 'long') {
                            if (tradeConfig.direction === 'buy' || tradeConfig.direction === 'both') {
                                shouldOpenTrade = true;
                                candidateTradeType = 'long';
                            } else if (tradeConfig.direction === 'alternate') {
                                shouldOpenTrade = true;
                                candidateTradeType = 'short'; // Alternate mode: invert
                            }
                        } else if (win.primaryPivot.signal === 'short') {
                            if (tradeConfig.direction === 'sell' || tradeConfig.direction === 'both') {
                                shouldOpenTrade = true;
                                candidateTradeType = 'short';
                            } else if (tradeConfig.direction === 'alternate') {
                                shouldOpenTrade = true;
                                candidateTradeType = 'long'; // Alternate mode: invert
                            }
                        }
                        
                        // Skip if direction filtering blocks this trade
                        if (!shouldOpenTrade) {
                            if (tradeConfig.showTradeDetails) {
                                console.log(`  ${colors.yellow}└─> [DIRECTION FILTER] ${win.primaryPivot.signal.toUpperCase()} cascade signal skipped - direction: ${tradeConfig.direction}${colors.reset}`);
                            }
                            // Remove executed window and continue
                            pendingWindows.splice(w, 1);
                            continue;
                        }
                        
                        const tradeType = candidateTradeType;
                        const oppositeType = (tradeType === 'long') ? 'short' : 'long';
                        const flipThreshold = Math.max(1, tradeConfig.numberOfOppositeSignal || 1);

                        // Check for opposite direction trades and flip logic
                        const hasOppositeOpen = openTrades.some(t => t.type === oppositeType);
                        
                        // Update opposite signal counters
                        if (hasOppositeOpen) {
                            oppositeSignalCounts[tradeType] = (oppositeSignalCounts[tradeType] || 0) + 1;
                            oppositeSignalCounts[oppositeType] = 0;
                        } else {
                            oppositeSignalCounts.long = 0;
                            oppositeSignalCounts.short = 0;
                        }

                        // Handle flip logic if enabled
                        if (hasOppositeOpen && tradeConfig.switchOnOppositeSignal) {
                            if (oppositeSignalCounts[tradeType] >= flipThreshold) {
                                // Close opposite trades at current 1m close price
                                const oppositeTradesIdx = oneMinuteTimeMap.get(minuteCandle.time);
                                let switchExitPrice = null;
                                if (typeof oppositeTradesIdx === 'number') {
                                    switchExitPrice = oneMinuteCandles[oppositeTradesIdx].close;
                                } else {
                                    switchExitPrice = minuteCandle.close;
                                }

                                if (switchExitPrice != null) {
                                    const oppositeTrades = openTrades.filter(t => t.type === oppositeType);
                                    for (let k = oppositeTrades.length - 1; k >= 0; k--) {
                                        const t = oppositeTrades[k];
                                        const isLong = t.type === 'long';
                                        
                                        // Apply exit slippage to flip price
                                        const exitSlippage = calculateSlippage(t.tradeSize) * 0.5;
                                        t.originalExitPrice = switchExitPrice;
                                        t.exitSlippage = exitSlippage;
                                        const slippageAdjustedExitPrice = applySlippageToPrice(switchExitPrice, exitSlippage, false, isLong);
                                        
                                        const priceChange = isLong ? (slippageAdjustedExitPrice - t.entryPrice) : (t.entryPrice - slippageAdjustedExitPrice);
                                        let pnl = (priceChange / t.entryPrice) * t.tradeSize * t.leverage;
                                        const fees = t.tradeSize * (tradeConfig.totalMakerFee / 100) * 2;
                                        pnl -= fees;

                                        t.status = 'closed';
                                        t.exitPrice = slippageAdjustedExitPrice;
                                        t.exitTime = minuteCandle.time;
                                        t.exitReason = 'FLIP';
                                        t.pnl = pnl;
                                        t.pnlPct = (priceChange / t.entryPrice) * 100 * t.leverage;

                                        capital += pnl;
                                        const idxOpen = openTrades.findIndex(x => x.id === t.id);
                                        if (idxOpen !== -1) openTrades.splice(idxOpen, 1);

                                        if (tradeConfig.showTradeDetails) {
                                            const timeStr = formatDualTime(t.exitTime);
                                            const pnlColor = t.pnl >= 0 ? colors.green : colors.red;
                                            const pnlText = `${pnlColor}${t.pnl >= 0 ? '+' : ''}${formatNumberWithCommas(t.pnl)}${colors.reset}`;
                                            const actionText = tradeConfig.switchPolicy === 'flip' ? 'FLIP' : 'CLOSE';
                                            console.log(`  \x1b[35;1m└─> [CASCADE ${actionText} ${oppositeSignalCounts[oppositeType]}/${flipThreshold}] ${t.type.toUpperCase()} trade closed @ ${timeStr} | ${t.exitPrice}. PnL: ${pnlText}${colors.reset}`);
                                            console.log('--------------------------------------------------------------------------------');
                                        }
                                    }
                                    oppositeSignalCounts[tradeType] = 0;
                                }
                            } else {
                                // Not enough opposite signals yet - skip opening new trade
                                if (tradeConfig.showTradeDetails) {
                                    const actionText = tradeConfig.switchPolicy === 'flip' ? 'flip' : 'close opposite';
                                    console.log(`  ${colors.yellow}└─> [CASCADE WAITING] ${tradeType.toUpperCase()} signal ${oppositeSignalCounts[oppositeType]}/${flipThreshold} - need ${flipThreshold - oppositeSignalCounts[oppositeType]} more opposite signals to ${actionText}${colors.reset}`);
                                }
                                // Remove executed window and continue
                                pendingWindows.splice(w, 1);
                                continue;
                            }
                        }

                        // Count confirmed cascade signal regardless of trade execution
                        confirmedSignals++;

                        // Respect maxConcurrentTrades limit
                        const maxTrades = tradeConfig.singleTradeMode ? 1 : (tradeConfig.maxConcurrentTrades || 1);
                        if (openTrades.length >= maxTrades) {
                            if (tradeConfig.showTradeDetails) {
                                console.log(`  ${colors.yellow}└─> [MAX CONCURRENT TRADES] ${tradeType.toUpperCase()} cascade signal skipped - ${openTrades.length}/${maxTrades} trades open${colors.reset}`);
                            }
                            // Remove executed window and continue
                            pendingWindows.splice(w, 1);
                            continue;
                        }

                        executedTrades++;
                        const trade = createTrade(tradeType, win.primaryPivot, (function(){
                            switch (tradeConfig.positionSizingMode) {
                                case 'fixed': return tradeConfig.amountPerTrade;
                                case 'percent': return capital * (tradeConfig.riskPerTrade / 100);
                                case 'minimum': return Math.max(capital * (tradeConfig.riskPerTrade / 100), tradeConfig.minimumTradeAmount || 0);
                                default: return tradeConfig.amountPerTrade;
                            }
                        })(), actualEntryTime, primaryInterval, entryPriceOverride);
                        openTrades.push(trade);
                        allTrades.push(trade);

                        if (!tradeConfig.hideCascades) {
                            const primaryTime12 = formatDualTime(win.primaryPivot.time);
                            const confirmingTFs = confs.map(c => c.timeframe).join(', ');
                            console.log(`${colors.green}🎯 CASCADE #${confirmedSignals} CONFIRMED: ${tradeType.toUpperCase()}${colors.reset}`);
                            console.log(`${colors.cyan}   Primary: ${primaryTime12} | Strength: ${(win.primaryPivot.swingPct || 0).toFixed(1)}% | Confirming TFs: ${confirmingTFs}${colors.reset}`);
                            console.log(`${colors.dim}   Confirmation Details:${colors.reset}`);
                            console.log(`${colors.dim}     • Primary TF: ${primaryInterval} @ ${formatDualTime(win.primaryPivot.time)}${colors.reset}`);
                            confs.forEach(conf => {
                                const confTime = formatDualTime(conf.pivot.time);
                                const timeDiff = Math.round((conf.pivot.time - win.primaryPivot.time) / (60 * 1000));
                                const timeDiffStr = timeDiff === 0 ? 'same time' : (timeDiff > 0 ? `+${timeDiff}m` : `${timeDiff}m`);
                                console.log(`${colors.dim}     • ${conf.timeframe}: @ ${confTime} (${timeDiffStr})${colors.reset}`);
                            });
                            const execDelayMin = Math.round((executionTime - win.primaryPivot.time) / (60 * 1000));
                            const executionTimeStr = formatDualTime(executionTime);
                            console.log(`${colors.yellow}   Execution: ${confs.length}/${multiPivotConfig.cascadeSettings?.minTimeframesRequired || 3} TFs confirmed → Execute ${execDelayMin === 0 ? 'immediately' : `after ${execDelayMin}m`} @ ${executionTimeStr}${colors.reset}`);
                            console.log(`${colors.cyan}   Entry Price: $${trade.entryPrice.toFixed(2)} | Size: $${formatNumberWithCommas(trade.tradeSize)} | TP: $${trade.takeProfitPrice.toFixed(2)} | SL: $${trade.stopLossPrice.toFixed(2)}${colors.reset}`);
                        }

                        // Remove executed window
                        pendingWindows.splice(w, 1);
                    }
                }
            }
        }
        
        // Display any trades that were closed during this candle before showing new pivots
        if (tradeConfig.showTradeDetails && closedTradesThisCandle.length > 0) {
            // Sort closed trades by exit time to ensure chronological order
            closedTradesThisCandle.sort((a, b) => a.exitTime - b.exitTime);
            
            for (const trade of closedTradesThisCandle) {
                const timeStr = formatDualTime(trade.exitTime);
                const pnlColor = trade.pnl >= 0 ? colors.green : colors.red;
                const pnlText = `${pnlColor}${trade.pnl >= 0 ? '+' : ''}${formatNumberWithCommas(trade.pnl)}${colors.reset}`;
                
                console.log(`  \x1b[35;1m└─> [${trade.exitReason}] ${trade.type.toUpperCase()} trade closed @ ${timeStr} | ${(trade.exitPrice)}. PnL: ${pnlText}${colors.reset}`);
                console.log('--------------------------------------------------------------------------------');
            }
        }
        
        // Now show pivots for this candle time (after printing any closes)
        if (tradeConfig.showPivot) {
            for (const [timeframe, pivots] of Object.entries(allTimeframePivots)) {
                const pivotAtTime = pivots.find(p => p.time === currentTime);
                if (pivotAtTime) {
                    const pivotType = pivotAtTime.type.toUpperCase();
                    const pivotSignal = pivotAtTime.signal.toUpperCase();
                    const swingPct = (pivotAtTime.swingPct || 0).toFixed(1);
                    
                    // Calculate the time range for this pivot
                    const tfMinutes = parseTimeframeToMinutes(timeframe);
                    const startTimeObj = new Date(currentTime - (tfMinutes * 60 * 1000));
                    const endTimeObj = new Date(currentTime);
                    
                    // Format pivot time with full date-time format
                    const pivotTimeFormatted = formatDualTime(currentTime);
                    
                    // Format start and end times - extract just the time portions
                    const startTime12 = startTimeObj.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
                    const startTime24 = startTimeObj.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
                    const endTime12 = endTimeObj.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
                    const endTime24 = endTimeObj.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
                    
                    // Format time range
                    const timeRange = `${startTime12} / ${startTime24} - ${endTime12} / ${endTime24}`;
                    
                    // Derive aggregated candle for this timeframe at currentTime to show price range
                    const tfCandles = (timeframeData[timeframe] && timeframeData[timeframe].candles) ? timeframeData[timeframe].candles : [];
                    const aggCandle = tfCandles.find(c => c.time === currentTime);
                    const pivotPriceStr = (typeof pivotAtTime.price === 'number') ? pivotAtTime.price.toFixed(1) : `${pivotAtTime.price}`;
                    // Show open - close instead of low - high
                    const rangeStr = aggCandle ? `${aggCandle.open.toFixed(1)} - ${aggCandle.close.toFixed(1)}` : '';

                    console.log(`${colors.magenta}[${timeframe}] ${pivotType} PIVOT @ ${pivotPriceStr} | ${pivotTimeFormatted} | Signal: ${pivotSignal} | Swing: ${swingPct}% \n ${timeRange}${colors.reset}`);
                    if (rangeStr) {
                        console.log(`${rangeStr}`);
                    }
                    console.log('\n');
                }
            }
        }
        
        // Check for new pivot signals
        const currentPivot = primaryPivots.find(p => p.time === currentTime);
        if (currentPivot) {
            totalSignals++;
            
            let shouldTrade = false;
            let confirmations = [];
            let immediateConfirmations = null; // Store confirmations for immediate execution logging
            
            if (BACKTEST_CONFIG.tradingMode === 'pivot') {
                // Trade individual pivots
                shouldTrade = true;
            } else if (BACKTEST_CONFIG.tradingMode === 'cascade') {
                // Open a pending cascade window; execution will occur when confirmations complete
                const primaryInterval = primaryTf.interval;
                const proximityWindowMs = 5 * 60 * 1000;
                const configuredMinutes = (multiPivotConfig.cascadeSettings?.confirmationWindow?.[primaryInterval]) ?? null;
                const configuredWindowMs = (configuredMinutes != null) ? (configuredMinutes * 60 * 1000) : null;
                const effectiveWindowMs = (configuredWindowMs != null) ? Math.min(proximityWindowMs, configuredWindowMs) : proximityWindowMs;
                const windowEnd = currentTime + effectiveWindowMs;
                pendingWindows.push({ primaryPivot: { ...currentPivot, timeframe: primaryInterval }, openTime: currentTime, windowEnd });
                
                // Immediate evaluation at primary time (captures pre/same-time confirmations)
                const confsNow = checkCascadeConfirmation({ ...currentPivot, timeframe: primaryInterval }, allTimeframePivots, currentTime, primaryInterval);
                if (meetsExecutionRequirements(confsNow)) {
                    // Will be picked up in minute loop next iteration at currentTime; also try execute now
                    const lastConfTime = Math.max(...confsNow.map(c => c.pivot.time));
                    const executionTime = Math.max(currentTime, lastConfTime);
                    const delayMs = tradeConfig.entryDelayMinutes * 60 * 1000;
                    const actualEntryTime = executionTime + delayMs;
                    let entryPriceOverride = null;
                    const delayedEntryIdx = oneMinuteTimeMap.get(actualEntryTime);
                    if (typeof delayedEntryIdx === 'number') {
                        entryPriceOverride = oneMinuteCandles[delayedEntryIdx].close;
                    }
                    if (entryPriceOverride) {
                        // Check if current day is a no-trade day
                        if (isNoTradeDay(actualEntryTime)) {
                            if (tradeConfig.showTradeDetails) {
                                const date = new Date(actualEntryTime);
                                const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
                                const currentDayName = dayNames[date.getDay()];
                                console.log(`  ${colors.yellow}└─> [NO TRADE DAY] ${currentPivot.signal.toUpperCase()} immediate cascade signal skipped - ${currentDayName} is in noTradeDays${colors.reset}`);
                            }
                            continue;
                        }

                        // Apply direction filtering logic
                        let candidateTradeType = null;
                        let shouldOpenTrade = false;
                        
                        if (currentPivot.signal === 'long') {
                            if (tradeConfig.direction === 'buy' || tradeConfig.direction === 'both') {
                                shouldOpenTrade = true;
                                candidateTradeType = 'long';
                            } else if (tradeConfig.direction === 'alternate') {
                                shouldOpenTrade = true;
                                candidateTradeType = 'short'; // Alternate mode: invert
                            }
                        } else if (currentPivot.signal === 'short') {
                            if (tradeConfig.direction === 'sell' || tradeConfig.direction === 'both') {
                                shouldOpenTrade = true;
                                candidateTradeType = 'short';
                            } else if (tradeConfig.direction === 'alternate') {
                                shouldOpenTrade = true;
                                candidateTradeType = 'long'; // Alternate mode: invert
                            }
                        }
                        
                        // Skip if direction filtering blocks this trade
                        if (!shouldOpenTrade) {
                            if (tradeConfig.showTradeDetails) {
                                console.log(`  ${colors.yellow}└─> [DIRECTION FILTER] ${currentPivot.signal.toUpperCase()} immediate cascade signal skipped - direction: ${tradeConfig.direction}${colors.reset}`);
                            }
                            continue;
                        }
                        
                        const tradeType = candidateTradeType;
                        const oppositeType = (tradeType === 'long') ? 'short' : 'long';
                        const flipThreshold = Math.max(1, tradeConfig.numberOfOppositeSignal || 1);

                        // Check for opposite direction trades and flip logic
                        const hasOppositeOpen = openTrades.some(t => t.type === oppositeType);
                        
                        // Update opposite signal counters
                        if (hasOppositeOpen) {
                            oppositeSignalCounts[tradeType] = (oppositeSignalCounts[tradeType] || 0) + 1;
                            oppositeSignalCounts[oppositeType] = 0;
                        } else {
                            oppositeSignalCounts.long = 0;
                            oppositeSignalCounts.short = 0;
                        }

                        // Handle flip logic if enabled
                        if (hasOppositeOpen && tradeConfig.switchOnOppositeSignal) {
                            if (oppositeSignalCounts[tradeType] >= flipThreshold) {
                                // Close opposite trades at current 1m close price
                                let switchExitPrice = null;
                                const switchIdx = oneMinuteTimeMap.get(currentTime);
                                if (typeof switchIdx === 'number') {
                                    switchExitPrice = oneMinuteCandles[switchIdx].close;
                                } else {
                                    // Find nearest 1m candle to current time
                                    const thirtySec = 30 * 1000;
                                    let nearest = null;
                                    for (const c of oneMinuteCandles) {
                                        if (Math.abs(c.time - currentTime) <= thirtySec) {
                                            if (!nearest || Math.abs(c.time - currentTime) < Math.abs(nearest.time - currentTime)) {
                                                nearest = c;
                                            }
                                        }
                                    }
                                    if (nearest) switchExitPrice = nearest.close;
                                }

                                if (switchExitPrice != null) {
                                    const oppositeTrades = openTrades.filter(t => t.type === oppositeType);
                                    for (let k = oppositeTrades.length - 1; k >= 0; k--) {
                                        const t = oppositeTrades[k];
                                        const isLong = t.type === 'long';
                                        
                                        // Apply exit slippage to flip price
                                        const exitSlippage = calculateSlippage(t.tradeSize) * 0.5;
                                        t.originalExitPrice = switchExitPrice;
                                        t.exitSlippage = exitSlippage;
                                        const slippageAdjustedExitPrice = applySlippageToPrice(switchExitPrice, exitSlippage, false, isLong);
                                        
                                        const priceChange = isLong ? (slippageAdjustedExitPrice - t.entryPrice) : (t.entryPrice - slippageAdjustedExitPrice);
                                        let pnl = (priceChange / t.entryPrice) * t.tradeSize * t.leverage;
                                        const fees = t.tradeSize * (tradeConfig.totalMakerFee / 100) * 2;
                                        pnl -= fees;

                                        t.status = 'closed';
                                        t.exitPrice = slippageAdjustedExitPrice;
                                        t.exitTime = currentTime;
                                        t.exitReason = 'FLIP';
                                        t.pnl = pnl;
                                        t.pnlPct = (priceChange / t.entryPrice) * 100 * t.leverage;

                                        capital += pnl;
                                        const idxOpen = openTrades.findIndex(x => x.id === t.id);
                                        if (idxOpen !== -1) openTrades.splice(idxOpen, 1);

                                        if (tradeConfig.showTradeDetails) {
                                            const timeStr = formatDualTime(t.exitTime);
                                            const pnlColor = t.pnl >= 0 ? colors.green : colors.red;
                                            const pnlText = `${pnlColor}${t.pnl >= 0 ? '+' : ''}${formatNumberWithCommas(t.pnl)}${colors.reset}`;
                                            console.log(`  \x1b[35;1m└─> [IMMEDIATE CASCADE FLIP ${oppositeSignalCounts[tradeType]}/${flipThreshold}] ${t.type.toUpperCase()} trade closed @ ${timeStr} | ${t.exitPrice}. PnL: ${pnlText}${colors.reset}`);
                                            console.log('--------------------------------------------------------------------------------');
                                        }
                                    }
                                    oppositeSignalCounts[tradeType] = 0;
                                }
                            } else {
                                // Not enough opposite signals yet - skip opening new trade
                                if (tradeConfig.showTradeDetails) {
                                    console.log(`  ${colors.yellow}└─> [IMMEDIATE CASCADE WAITING] ${tradeType.toUpperCase()} signal ${oppositeSignalCounts[tradeType]}/${flipThreshold} - need ${flipThreshold - oppositeSignalCounts[tradeType]} more opposite signals to flip${colors.reset}`);
                                }
                                continue;
                            }
                        }

                        // Count confirmed cascade signal regardless of trade execution
                        confirmedSignals++;

                        // Respect maxConcurrentTrades limit
                        const maxTrades = tradeConfig.singleTradeMode ? 1 : (tradeConfig.maxConcurrentTrades || 1);
                        if (openTrades.length >= maxTrades) {
                            if (tradeConfig.showTradeDetails) {
                                console.log(`  ${colors.yellow}└─> [MAX CONCURRENT TRADES] ${tradeType.toUpperCase()} immediate cascade signal skipped - ${openTrades.length}/${maxTrades} trades open${colors.reset}`);
                            }
                            continue;
                        }

                        executedTrades++;
                        const trade = createTrade(tradeType, { ...currentPivot, timeframe: primaryInterval }, (function(){
                            switch (tradeConfig.positionSizingMode) {
                                case 'fixed': return tradeConfig.amountPerTrade;
                                case 'percent': return capital * (tradeConfig.riskPerTrade / 100);
                                case 'minimum': return Math.max(capital * (tradeConfig.riskPerTrade / 100), tradeConfig.minimumTradeAmount || 0);
                                default: return tradeConfig.amountPerTrade;
                            }
                        })(), actualEntryTime, primaryInterval, entryPriceOverride);
                        openTrades.push(trade);
                        allTrades.push(trade);
                        
                        // Add cascade logging for immediate execution path
                        if (!tradeConfig.hideCascades && BACKTEST_CONFIG.tradingMode === 'cascade') {
                            const primaryTime12 = formatDualTime(currentTime);
                            const confirmingTFs = confsNow.map(c => c.timeframe).join(', ');
                            console.log(`${colors.green}🎯 CASCADE #${confirmedSignals} CONFIRMED: ${currentPivot.signal.toUpperCase()}${colors.reset}`);
                            console.log(`${colors.cyan}   Primary: ${primaryTime12} | Strength: ${(currentPivot.swingPct || 0).toFixed(1)}% | Confirming TFs: ${confirmingTFs}${colors.reset}`);
                            
                            // Show detailed confirmation timestamps
                            console.log(`${colors.dim}   Confirmation Details:${colors.reset}`);
                            console.log(`${colors.dim}     • Primary TF: ${primaryTf.interval} @ ${formatDualTime(currentTime)}${colors.reset}`);
                            confsNow.forEach(conf => {
                                const confTime = formatDualTime(conf.pivot.time);
                                const timeDiff = Math.round((conf.pivot.time - currentTime) / (60 * 1000));
                                const timeDiffStr = timeDiff === 0 ? 'same time' : (timeDiff > 0 ? `+${timeDiff}m` : `${timeDiff}m`);
                                console.log(`${colors.dim}     • ${conf.timeframe}: @ ${confTime} (${timeDiffStr})${colors.reset}`);
                            });
                            
                            // Determine execution trigger
                            const totalTFs = confsNow.length;
                            const minRequired = multiPivotConfig.cascadeSettings?.minTimeframesRequired || 3;
                            const executionTime = Math.max(currentTime, ...confsNow.map(c => c.pivot.time));
                            const executionTimeStr = formatDualTime(executionTime);
                            const executionDelay = Math.round((executionTime - currentTime) / (60 * 1000));
                            const executionDelayStr = executionDelay === 0 ? 'immediately' : `after ${executionDelay}m`;
                            
                            console.log(`${colors.yellow}   Execution: ${totalTFs}/${minRequired} TFs confirmed → Execute ${executionDelayStr} @ ${executionTimeStr}${colors.reset}`);
                            console.log(`${colors.cyan}   Entry Price: $${trade.entryPrice.toFixed(2)} | Size: $${formatNumberWithCommas(trade.tradeSize)} | TP: $${trade.takeProfitPrice.toFixed(2)} | SL: $${trade.stopLossPrice.toFixed(2)}${colors.reset}`);
                        }
                        
                        // Store confirmations for logging
                        immediateConfirmations = confsNow;
                        // Remove window immediately to avoid duplicate
                        pendingWindows.pop();
                    }
                }
                // Skip immediate trade open in cascade mode; handled by pending windows
            }
            
            // Count confirmed signals based on trading mode
            if (shouldTrade) {
                confirmedSignals++;
            }

            // Decide candidate trade type based on direction rules
            let candidateShouldOpen = false;
            let candidateTradeType = null;
            if (shouldTrade) {
                if (currentPivot.signal === 'long') {
                    if (tradeConfig.direction === 'buy' || tradeConfig.direction === 'both') {
                        candidateShouldOpen = true;
                        candidateTradeType = 'long';
                    } else if (tradeConfig.direction === 'alternate') {
                        candidateShouldOpen = true;
                        candidateTradeType = 'short'; // Alternate mode: invert
                    }
                } else if (currentPivot.signal === 'short') {
                    if (tradeConfig.direction === 'sell' || tradeConfig.direction === 'both') {
                        candidateShouldOpen = true;
                        candidateTradeType = 'short';
                    } else if (tradeConfig.direction === 'alternate') {
                        candidateShouldOpen = true;
                        candidateTradeType = 'long'; // Alternate mode: invert
                    }
                }
            }

            // Threshold-based switch policy with numberOfOppositeSignal logic
            if (BACKTEST_CONFIG.tradingMode === 'cascade') {
                // Cascade mode trade creation handled by pending windows
            } else if (shouldTrade && candidateShouldOpen) {
                const oppositeType = (candidateTradeType === 'long') ? 'short' : 'long';
                const flipThreshold = Math.max(1, tradeConfig.numberOfOppositeSignal || 1);

                // Detect if we have any opposite-direction trades open
                const hasOppositeOpen = openTrades.some(t => t.type === oppositeType);
                const hasSameDirectionOpen = openTrades.some(t => t.type === candidateTradeType);

                // Update opposite signal counters
                if (hasOppositeOpen) {
                    // We received an opposite signal relative to the open trade(s)
                    oppositeSignalCounts[candidateTradeType] = (oppositeSignalCounts[candidateTradeType] || 0) + 1;
                    // Reset counter for the opposite direction
                    oppositeSignalCounts[oppositeType] = 0;
                } else {
                    // No opposite open positions; reset counters
                    oppositeSignalCounts.long = 0;
                    oppositeSignalCounts.short = 0;
                }

                // Decide switch logic based on threshold
                if (hasOppositeOpen && tradeConfig.switchOnOppositeSignal) {
                    const oppositeType = candidateTradeType === 'LONG' ? 'SHORT' : 'LONG';
                    if (oppositeSignalCounts[oppositeType] >= flipThreshold) {
                        // Perform flip: close opposite trades at 1m close of currentTime
                        let switchExitPrice = null;
                        const switchIdx = oneMinuteTimeMap.get(currentTime);
                        if (typeof switchIdx === 'number') {
                            switchExitPrice = oneMinuteCandles[switchIdx].close;
                        } else {
                            const thirtySec = 30 * 1000;
                            let nearest = null;
                            for (const c of oneMinuteCandles) {
                                if (Math.abs(c.time - currentTime) <= thirtySec) {
                                    if (!nearest || Math.abs(c.time - currentTime) < Math.abs(nearest.time - currentTime)) {
                                        nearest = c;
                                    }
                                }
                            }
                            if (nearest) switchExitPrice = nearest.close;
                        }

                        if (switchExitPrice != null) {
                            const opposite = openTrades.filter(t => t.type !== candidateTradeType);
                            // Close each opposite trade
                            for (let k = opposite.length - 1; k >= 0; k--) {
                                const t = opposite[k];
                                const isLong = t.type === 'long';
                                
                                // Apply exit slippage to flip price (half of entry slippage for more realistic simulation)
                                const exitSlippage = calculateSlippage(t.tradeSize) * 0.5;
                                t.originalExitPrice = switchExitPrice;
                                t.exitSlippage = exitSlippage;
                                const slippageAdjustedExitPrice = applySlippageToPrice(switchExitPrice, exitSlippage, false, isLong);
                                
                                const priceChange = isLong ? (slippageAdjustedExitPrice - t.entryPrice) : (t.entryPrice - slippageAdjustedExitPrice);
                                let pnl = (priceChange / t.entryPrice) * t.tradeSize * t.leverage;
                                const fees = t.tradeSize * (tradeConfig.totalMakerFee / 100) * 2; // entry + exit
                                pnl -= fees;

                                t.status = 'closed';
                                t.exitPrice = slippageAdjustedExitPrice;
                                t.exitTime = currentTime;
                                t.exitReason = 'FLIP';
                                t.pnl = pnl;
                                t.pnlPct = (priceChange / t.entryPrice) * 100 * t.leverage;

                                capital += pnl;
                                const idxOpen = openTrades.findIndex(x => x.id === t.id);
                                if (idxOpen !== -1) openTrades.splice(idxOpen, 1);

                                if (tradeConfig.showTradeDetails) {
                                    const timeStr = formatDualTime(t.exitTime);
                                    const pnlColor = t.pnl >= 0 ? colors.green : colors.red;
                                    const pnlText = `${pnlColor}${t.pnl >= 0 ? '+' : ''}${formatNumberWithCommas(t.pnl)}${colors.reset}`;
                                    const actionText = tradeConfig.switchPolicy === 'flip' ? 'FLIP' : 'CLOSE';
                                    console.log(`  \x1b[35;1m└─> [${actionText} ${oppositeSignalCounts[oppositeType]}/${flipThreshold}] ${t.type.toUpperCase()} trade closed @ ${timeStr} | ${t.exitPrice}. PnL: ${pnlText}${colors.reset}`);
                                    console.log('--------------------------------------------------------------------------------');
                                }
                            }
                            
                            // Reset counter after successful switch
                            oppositeSignalCounts[oppositeType] = 0;
                            
                            // For 'close' policy, skip opening new trade
                            if (tradeConfig.switchPolicy === 'close') {
                                if (tradeConfig.showTradeDetails) {
                                    console.log(`  ${colors.yellow}└─> [CLOSE POLICY] Opposite trades closed, skipping new ${candidateTradeType.toUpperCase()} trade${colors.reset}`);
                                }
                                continue; // Skip to next cascade
                            }
                        }
                    } else {
                        // Not enough opposite signals yet - skip opening new trade
                        if (tradeConfig.showTradeDetails) {
                            const actionText = tradeConfig.switchPolicy === 'flip' ? 'flip' : 'close opposite';
                            console.log(`  ${colors.yellow}└─> [WAITING] ${candidateTradeType.toUpperCase()} signal ${oppositeSignalCounts[oppositeType]}/${flipThreshold} - need ${flipThreshold - oppositeSignalCounts[oppositeType]} more opposite signals to ${actionText}${colors.reset}`);
                        }
                        continue; // Skip to next iteration
                    }
                }
            }

            // After switching, respect maxConcurrentTrades limit and open new trade if allowed
            const maxTrades = tradeConfig.singleTradeMode ? 1 : (tradeConfig.maxConcurrentTrades || 1);
            if (shouldTrade && openTrades.length < maxTrades) {
                const shouldOpenTrade = candidateShouldOpen;
                const tradeType = candidateTradeType;
                
                // Check if current day is a no-trade day
                if (shouldOpenTrade && isNoTradeDay(currentTime)) {
                    if (tradeConfig.showTradeDetails) {
                        const date = new Date(currentTime);
                        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
                        const currentDayName = dayNames[date.getDay()];
                        console.log(`  ${colors.yellow}└─> [NO TRADE DAY] ${tradeType.toUpperCase()} signal skipped - ${currentDayName} is in noTradeDays${colors.reset}`);
                    }
                    continue; // Skip this trade
                }
                
                if (shouldOpenTrade && capital > 0) {
                    executedTrades++;
                    
                    // Position sizing
                    let tradeSize;
                    switch (tradeConfig.positionSizingMode) {
                        case 'fixed':
                            tradeSize = tradeConfig.amountPerTrade;
                            break;
                        case 'percent':
                            tradeSize = capital * (tradeConfig.riskPerTrade / 100);
                            break;
                        case 'minimum':
                            tradeSize = Math.max(capital * (tradeConfig.riskPerTrade / 100), tradeConfig.minimumTradeAmount || 0);
                            break;
                        default:
                            tradeSize = tradeConfig.amountPerTrade;
                    }
                    
                    // Apply entry delay from config (realistic execution timing)
                    const delayMs = tradeConfig.entryDelayMinutes * 60 * 1000;
                    const actualEntryTime = currentTime + delayMs;
                    
                    // Entry price: 1m close at delayed entry time
                    let entryPriceOverride = null;
                    const delayedEntryIdx = oneMinuteTimeMap.get(actualEntryTime);
                    if (typeof delayedEntryIdx === 'number') {
                        entryPriceOverride = oneMinuteCandles[delayedEntryIdx].close;
                    } else {
                        // Find nearest 1m candle to delayed entry time
                        const thirtySec = 30 * 1000;
                        let nearest = null;
                        for (const c of oneMinuteCandles) {
                            if (Math.abs(c.time - actualEntryTime) <= thirtySec) {
                                if (!nearest || Math.abs(c.time - actualEntryTime) < Math.abs(nearest.time - actualEntryTime)) {
                                    nearest = c;
                                }
                            }
                        }
                        if (nearest) entryPriceOverride = nearest.close;
                    }

                    // Skip trade if delayed entry time is beyond available data
                    if (!entryPriceOverride) {
                        if (tradeConfig.showTradeDetails) {
                            console.log(`  ${colors.yellow}└─> [DELAYED ENTRY] ${tradeType.toUpperCase()} signal skipped - entry time beyond available data (${tradeConfig.entryDelayMinutes}min delay)${colors.reset}`);
                        }
                        continue;
                    }

                    const trade = createTrade(tradeType, currentPivot, tradeSize, actualEntryTime, primaryTf.interval, entryPriceOverride);
                    openTrades.push(trade);
                    allTrades.push(trade);
                    
                    if (!tradeConfig.hideCascades && BACKTEST_CONFIG.tradingMode === 'cascade' && immediateConfirmations) {
                        const primaryTime12 = formatDualTime(currentTime);
                        const confirmingTFs = immediateConfirmations.map(c => c.timeframe).join(', ');
                        console.log(`${colors.green}🎯 CASCADE #${confirmedSignals} CONFIRMED: ${currentPivot.signal.toUpperCase()}${colors.reset}`);
                        console.log(`${colors.cyan}   Primary: ${primaryTime12} | Strength: ${(currentPivot.swingPct || 0).toFixed(1)}% | Confirming TFs: ${confirmingTFs}${colors.reset}`);
                        
                        // Show detailed confirmation timestamps
                        console.log(`${colors.dim}   Confirmation Details:${colors.reset}`);
                        console.log(`${colors.dim}     • Primary TF: ${primaryTf.interval} @ ${formatDualTime(currentTime)}${colors.reset}`);
                        immediateConfirmations.forEach(conf => {
                            const confTime = formatDualTime(conf.pivot.time);
                            const timeDiff = Math.round((conf.pivot.time - currentTime) / (60 * 1000));
                            const timeDiffStr = timeDiff === 0 ? 'same time' : (timeDiff > 0 ? `+${timeDiff}m` : `${timeDiff}m`);
                            console.log(`${colors.dim}     • ${conf.timeframe}: @ ${confTime} (${timeDiffStr})${colors.reset}`);
                        });
                        
                        // Determine execution trigger
                        const totalTFs = immediateConfirmations.length; // confirmations include all timeframes
                        const minRequired = multiPivotConfig.cascadeSettings?.minTimeframesRequired || 3;
                        const executionTime = Math.max(currentTime, ...immediateConfirmations.map(c => c.pivot.time));
                        const executionTimeStr = formatDualTime(executionTime);
                        const executionDelay = Math.round((executionTime - currentTime) / (60 * 1000));
                        const executionDelayStr = executionDelay === 0 ? 'immediately' : `after ${executionDelay}m`;
                        
                        console.log(`${colors.yellow}   Execution: ${totalTFs}/${minRequired} TFs confirmed → Execute ${executionDelayStr} @ ${executionTimeStr}${colors.reset}`);
                        console.log(`${colors.cyan}   Entry Price: $${trade.entryPrice.toFixed(2)} | Size: $${formatNumberWithCommas(trade.tradeSize)} | TP: $${trade.takeProfitPrice.toFixed(2)} | SL: $${trade.stopLossPrice.toFixed(2)}${colors.reset}`);
                    } else if (tradeConfig.showTradeDetails) {
                        const timeStr = formatDualTime(currentTime);
                        console.log(`${colors.green}OPEN ${trade.type.toUpperCase()} [${timeStr}] ${trade.timeframe} @ $${trade.entryPrice.toFixed(2)} | Size: $${formatNumberWithCommas(trade.tradeSize)} | TP: $${trade.takeProfitPrice.toFixed(2)} | SL: $${trade.stopLossPrice.toFixed(2)}${colors.reset}`);
                    }
                }
            }
        }
        
        // Progress indicator - only show in non-silent mode
        if (i % BACKTEST_CONFIG.progressEvery === 0 && !OPTIMIZATION_CONFIG.silentMode) {
            const progress = ((i / primaryCandles.length) * 100).toFixed(1);
            console.log(`${colors.dim}Progress: ${progress}% (${i}/${primaryCandles.length})${colors.reset}`);
        }
    }
    
    // Close any remaining open trades
    for (const trade of openTrades) {
        const lastCandle = primaryCandles[primaryCandles.length - 1];
        updateTrade(trade, lastCandle);
        capital += trade.pnl;
    }

    // Return results for optimization
    return {
        totalSignals,
        confirmedSignals,
        executedTrades,
        allTrades,
        finalCapital: capital,
        initialCapital: tradeConfig.initialCapital,
        duration: Date.now() - startTime
    };
}

// ===== MAIN OPTIMIZATION FUNCTION =====
async function runOptimization() {
    console.log(`${colors.cyan}=== IMMEDIATE AGGREGATION OPTIMIZER ===${colors.reset}`);
    console.log(`${colors.yellow}Symbol: ${symbol}${colors.reset}`);
    console.log(`${colors.yellow}Detection Mode: ${pivotDetectionMode}${colors.reset}`);
    
    // Display time range information
    const maxCandles = OPTIMIZATION_CONFIG.maxCandles; 
    console.log(`${colors.yellow}Candle Range: ${maxCandles} Candles ${colors.reset}`);
    
    // Generate all parameter combinations
    const combinations = generateParameterCombinations();
    console.log(`${colors.cyan}\nGenerated ${colors.yellow}${combinations.length}${colors.cyan} parameter combinations to test${colors.reset}`);
    
    if (combinations.length === 0) {
        console.log(`${colors.red}No combinations generated. Check your OPTIMIZATION_CONFIG.${colors.reset}`);
        return;
    }
    
    // Pre-load and cache all data once
    await preloadAndCacheData();
    
    const results = [];
    const startTime = Date.now();
    
    console.log(`${colors.cyan}\n=== STARTING OPTIMIZATION ===${colors.reset}`);
    
    for (let i = 0; i < combinations.length; i++) {
        const params = combinations[i];
        
        if (OPTIMIZATION_CONFIG.showProgress && (i % Math.max(1, Math.floor(combinations.length / 20)) === 0 || i === combinations.length - 1)) {
            const progress = ((i / combinations.length) * 100).toFixed(1);
            console.log(`${colors.dim}Progress: ${progress}% (${i + 1}/${combinations.length})${colors.reset}`);
        }
        
        try {
            // Update configurations for compatibility
            tradeConfig = createTradeConfig(params);
            multiPivotConfig = createMultiPivotConfig(params);
            BACKTEST_CONFIG.tradingMode = params.tradingMode;
            BACKTEST_CONFIG.maxCandles = OPTIMIZATION_CONFIG.maxCandles;
            
            // Run optimized backtest with cached data
            const backtestResults = await runOptimizedBacktest(params);
            
            // Calculate performance metrics
            const metrics = calculatePerformanceMetrics(backtestResults);
        
        // 🎯 APPLY RECENT TRADE PERFORMANCE FILTER
        if (!metrics.recentTradeAnalysis.passesFilter) {
            if (OPTIMIZATION_CONFIG.showProgress) {
                // console.log(`${colors.yellow}[${i + 1}/${combinations.length}] FILTERED OUT: ${metrics.recentTradeAnalysis.reason}${colors.reset}`);
            }
            continue; // Skip this configuration
        }
        
        const formattedResult = formatOptimizationResult(params, metrics, i, combinations.length);
        
        results.push(formattedResult);
            
        } catch (error) {
            console.log(`${colors.red}Error in combination ${i + 1}: ${error.message}${colors.reset}`);
            results.push({
                index: i + 1,
                total: combinations.length,
                tradingMode: params.tradingMode,
                direction: params.direction,
                takeProfit: params.takeProfit,
                stopLoss: params.stopLoss,
                leverage: params.leverage,
                timeframes: params.timeframes.map(tf => `${tf.interval}(${tf.minSwingPct}%)`).join('+'),
                totalTrades: 0,
                winRate: '0.0',
                totalPnL: '0.00',
                avgPnL: '0.00',
                maxDrawdown: '0.0',
                profitFactor: '0.00',
                sharpeRatio: '0.00',
                finalCapital: '100.00',
                score: 0,
                error: error.message
            });
        }
    }
    
    const totalTime = Date.now() - startTime;
    
    // Sort results by score (descending)
    results.sort((a, b) => b.score - a.score);
    
    console.log(`${colors.green}\n=== OPTIMIZATION COMPLETED ===${colors.reset}`);
    console.log(`${colors.yellow}Total Time: ${(totalTime / 1000).toFixed(2)} seconds${colors.reset}`);
    console.log(`${colors.yellow}Combinations Tested: ${combinations.length}${colors.reset}`);
    console.log(`${colors.yellow}Average Time per Test: ${(totalTime / combinations.length / 1000).toFixed(2)} seconds${colors.reset}`);
    
    // Display best results
    const topResults = results.slice(0, OPTIMIZATION_CONFIG.showBestResults);
    
    console.log(`${colors.cyan}\n=== TOP ${OPTIMIZATION_CONFIG.showBestResults} RESULTS ===${colors.reset}`);
    console.log('================================================================================');
    console.log('Rank | Score | Mode    | Dir  | TP   | SL   | Lev | Timeframes      | Trades | Win% | PnL     | PF   | DD%  | Final');
    console.log('================================================================================');
    
    topResults.forEach((result, index) => {
        const rank = (index + 1).toString().padStart(4);
        const score = result.score.toFixed(1).padStart(5);
        const mode = result.tradingMode.padEnd(7);
        const dir = result.direction.padEnd(4);
        const tp = result.takeProfit.toString().padStart(4);
        const sl = result.stopLoss.toString().padStart(4);
        const lev = result.leverage.toString().padStart(3);
        const tf = result.timeframes.padEnd(15);
        const trades = result.totalTrades.toString().padStart(6);
        const winRate = result.winRate.padStart(4);
        const pnl = result.totalPnL.padStart(7);
        const pf = result.profitFactor.padStart(4);
        const dd = result.maxDrawdown.padStart(4);
        const final = result.finalCapital.padStart(7);
        
        const color = index < 3 ? colors.green : (index < 5 ? colors.yellow : colors.reset);
        console.log(`${color}${rank} | ${score} | ${mode} | ${dir} | ${tp} | ${sl} | ${lev} | ${tf} | ${trades} | ${winRate} | ${pnl} | ${pf} | ${dd} | ${final}${colors.reset}`);
    });
    
    console.log('================================================================================');
    
    // Show detailed breakdown of top result
    if (topResults.length > 0) {
        const best = topResults[0];
        console.log(`${colors.green}\n=== BEST CONFIGURATION DETAILS ===${colors.reset}`);
        console.log(`${colors.yellow}Score: ${colors.green}${best.score.toFixed(2)}${colors.reset}`);
        console.log(`${colors.yellow}Initial capital: ${colors.green}${baseTradeConfig.initialCapital}$${colors.reset}`);
        console.log(`${colors.yellow}Trading Mode: ${colors.green}${best.tradingMode}${colors.reset}`);
        console.log(`${colors.yellow}Direction: ${colors.green}${best.direction}${colors.reset}`);
        console.log(`${colors.yellow}Take Profit: ${colors.green}${best.takeProfit}%${colors.reset}`);
        console.log(`${colors.yellow}Stop Loss: ${colors.green}${best.stopLoss}%${colors.reset}`);
        console.log(`${colors.yellow}Leverage: ${colors.green}${best.leverage}x${colors.reset}`);
        console.log(`${colors.yellow}Timeframes: ${colors.green}${best.timeframes}${colors.reset}`);
        console.log(`${colors.yellow}Total Trades: ${colors.green}${best.totalTrades}${colors.reset}`);
        console.log(`${colors.yellow}Win Rate: ${colors.green}${best.winRate}%${colors.reset}`);
        console.log(`${colors.yellow}Total P&L: ${colors.green}${best.totalPnL}${colors.reset}`);
        console.log(`${colors.yellow}Profit Factor: ${colors.green}${best.profitFactor}${colors.reset}`);
        console.log(`${colors.yellow}Max Drawdown: ${colors.green}${best.maxDrawdown}%${colors.reset}`);
        console.log(`${colors.yellow}Final Capital: ${colors.green}${best.finalCapital}$${colors.reset}`);
    }
    
    // Export results
    await exportResults(results);
    
    // Display time range information at the end
    if (GLOBAL_CACHE.oneMinuteCandles && GLOBAL_CACHE.oneMinuteCandles.length > 0) {
        const firstCandle = GLOBAL_CACHE.oneMinuteCandles[0];
        const lastCandle = GLOBAL_CACHE.oneMinuteCandles[GLOBAL_CACHE.oneMinuteCandles.length - 1];
        const totalDays = Math.ceil((lastCandle.time - firstCandle.time) / (24 * 60 * 60 * 1000));
        
        const startDate = new Date(firstCandle.time);
        const endDate = new Date(lastCandle.time);
        
        const formatDate = (date) => {
            return date.toLocaleDateString('en-US', {
                weekday: 'short',
                year: 'numeric',
                month: 'short',
                day: 'numeric'
            });
        };
        
        console.log(`${colors.cyan}\n=== DATA TIME RANGE ===${colors.reset}`);
        console.log(`${colors.yellow}Period: ${totalDays} days${colors.reset}`);
        console.log(`${colors.yellow}From: ${formatDate(startDate)} (${formatDualTime(firstCandle.time)})${colors.reset}`);
        console.log(`${colors.yellow}To: ${formatDate(endDate)} (${formatDualTime(lastCandle.time)})${colors.reset}`);
        console.log(`${colors.yellow}Total Candles: ${formatNumberWithCommas(GLOBAL_CACHE.oneMinuteCandles.length)} (1-minute)${colors.reset}`);
    }
    
    console.log(`${colors.green}\n=== OPTIMIZATION FINISHED ===${colors.reset}`);
    return results;
}

// ===== EXECUTION =====
// Check if this file is being run directly
const isMainModule = process.argv[1] && process.argv[1].endsWith('immediateAggregationOptimizer.js');
if (isMainModule) {
    console.log('Starting optimization...');
    runOptimization().catch(console.error);
}
