// immediateAggregationBacktester.js
// Advanced backtester using immediate aggregation technology
// Supports both individual pivot trading and cascade confirmation strategies
// ===== CONFIGURATION =====
const BACKTEST_CONFIG = {
    // Trading mode
    tradingMode: 'cascade',     // 'pivot' = trade individual pivots, 'cascade' = require multi-timeframe confirmation
    // tradingMode: 'pivot',     // 'pivot' = trade individual pivots, 'cascade' = require multi-timeframe confirmation

    // Data settings
    useLiveAPI: false,           // Force API data
    // maxCandles: 129600,        // 1 week of 1m candles for testing
    // maxCandles: 86400,        // 1 week of 1m candles for testing
    maxCandles: 43200,        // 1 week of 1m candles for testing
    // maxCandles: 20160,          // 1 week of 1m candles for testing
    // maxCandles: 10080,          // 1 week of 1m candles for testing

    // Output settings
    showEveryNthTrade: 1,       // Show every Nth trade
    showFirstNTrades: 20,       // Always show first N trades
    progressEvery: 5000,        // Progress update frequency
    
    // Logging settings
    showInitializationLogs: false,  // Hide immediate aggregation initialization logs

};

import {
    symbol,
    useLocalData,
    pivotDetectionMode
} from './config/config.js';

import { tradeConfig } from './config/tradeconfig.js';
import { multiPivotConfig } from './config/multiAggConfig.js';
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
    console.log(`${colors.cyan}Loading 1m candles...${colors.reset}`);
    
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
        
        const limitedCandles = candles.slice(-BACKTEST_CONFIG.maxCandles);
        const firstCandle = limitedCandles[0];
        const lastCandle = limitedCandles[limitedCandles.length - 1];
        console.log(`${colors.green}Loaded ${limitedCandles.length} 1m candles from CSV${colors.reset}`);
        console.log(`${colors.cyan}Data Range: ${formatDualTime(firstCandle.time)} → ${formatDualTime(lastCandle.time)}${colors.reset}`);
        return limitedCandles;
    } else {
        const candles = await getCandles(symbol, '1m', BACKTEST_CONFIG.maxCandles);
        const sortedCandles = candles.sort((a, b) => a.time - b.time);
        const firstCandle = sortedCandles[0];
        const lastCandle = sortedCandles[sortedCandles.length - 1];
        console.log(`${colors.green}Loaded ${candles.length} 1m candles from API${colors.reset}`);
        console.log(`${colors.cyan}Data Range: ${formatDualTime(firstCandle.time)} → ${formatDualTime(lastCandle.time)}${colors.reset}`);
        return sortedCandles;
    }
}

// ===== PIVOT DETECTION =====
function detectPivot(candles, index, config) {
    const { pivotLookback, minSwingPct, minLegBars } = config;
    
    // Allow lookback = 0 by skipping only the very first candle (no previous reference)
    if (pivotLookback === 0 && index === 0) return null;
    if (index < pivotLookback || index >= candles.length) return null;
    
    const currentCandle = candles[index];
    const currentHigh = pivotDetectionMode === 'close' ? currentCandle.close : currentCandle.high;
    const currentLow = pivotDetectionMode === 'close' ? currentCandle.close : currentCandle.low;
    
    // Check for high pivot
    let isHighPivot = true;
    if (pivotLookback > 0) {
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
    }
    
    // Check for low pivot
    let isLowPivot = true;
    if (pivotLookback > 0) {
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
    }

    // Special handling when lookback = 0: compare to previous candle only
    if (pivotLookback === 0) {
        const prev = candles[index - 1];
        const prevHigh = pivotDetectionMode === 'close' ? prev.close : prev.high;
        const prevLow = pivotDetectionMode === 'close' ? prev.close : prev.low;
        isHighPivot = currentHigh > prevHigh;
        isLowPivot = currentLow < prevLow;

        // If both directions qualify (large range crossing), pick the dominant excursion
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
    
    // Calculate swing percentage
    let maxSwingPct = 0;
    
    // Validate minimum swing percentage requirement
    if (minSwingPct > 0) {
        // When lookback = 0, still compute swing vs previous candle (j=1)
        const upper = pivotLookback === 0 ? 1 : pivotLookback;
        for (let j = 1; j <= upper; j++) {
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

// ===== IMMEDIATE AGGREGATION =====
function buildImmediateAggregatedCandles(oneMinCandles, timeframeMinutes) {
    const aggregatedCandles = [];
    const bucketSizeMs = timeframeMinutes * 60 * 1000;
    
    // Group 1m candles into timeframe buckets
    const buckets = new Map();
    
    for (const candle of oneMinCandles) {
        // Calculate bucket END time for proper timeframe representation
        const bucketEnd = Math.ceil(candle.time / bucketSizeMs) * bucketSizeMs;
        
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



// ===== MAIN BACKTESTING FUNCTION =====
async function runImmediateAggregationBacktest() {
    const startTime = Date.now();
    
    console.log(`${colors.cyan}=== IMMEDIATE AGGREGATION BACKTESTER ===${colors.reset}`);
    console.log(`${colors.yellow}Symbol: ${symbol}${colors.reset}`);
    console.log(`${colors.yellow}Trading Mode: ${BACKTEST_CONFIG.tradingMode.toUpperCase()}${colors.reset}`);
    console.log(`${colors.yellow}Detection Mode: ${pivotDetectionMode}${colors.reset}`);
    
    // Display trade configuration
    console.log(`\n${colors.cyan}--- Trade Configuration ---${colors.reset}`);
    let directionDisplay = tradeConfig.direction;
    if (tradeConfig.direction === 'alternate') {
        directionDisplay = 'alternate (LONG at highs, SHORT at lows)';
    }
    console.log(`Direction: ${colors.yellow}${directionDisplay}${colors.reset}`);
    console.log(`Take Profit: ${colors.green}${tradeConfig.takeProfit}%${colors.reset}`);
    console.log(`Stop Loss: ${colors.red}${tradeConfig.stopLoss}%${colors.reset}`);
    console.log(`Leverage: ${colors.yellow}${tradeConfig.leverage}x${colors.reset}`);
    console.log(`Initial Capital: ${colors.yellow}${tradeConfig.initialCapital} USDT${colors.reset}`);
    console.log(`Trade Tracking: ${colors.green}1-minute precision${colors.reset}`);
    
    // Load data
    const oneMinuteCandles = await load1mCandles();
    
    // Build aggregated candles for all timeframes
    const timeframeData = {};
    const allTimeframePivots = {};
    
    if (BACKTEST_CONFIG.showInitializationLogs) {
        console.log(`${colors.cyan}\n=== INITIALIZING IMMEDIATE AGGREGATION SYSTEM ===${colors.reset}`);
    }
    
    for (const tfConfig of multiPivotConfig.timeframes) {
        const tf = tfConfig.interval;
        const timeframeMinutes = parseTimeframeToMinutes(tf);
        
        if (BACKTEST_CONFIG.showInitializationLogs) {
            console.log(`${colors.cyan}[${tf}] Processing ${timeframeMinutes}-minute aggregation...${colors.reset}`);
        }
        
        const aggregatedCandles = buildImmediateAggregatedCandles(oneMinuteCandles, timeframeMinutes);
        timeframeData[tf] = {
            candles: aggregatedCandles,
            config: tfConfig
        };
        
        // Detect all pivots for this timeframe
        const pivots = [];
        let lastAcceptedPivotIndex = null; // enforce minLegBars between accepted pivots
        for (let i = tfConfig.lookback; i < aggregatedCandles.length; i++) {
            const pivot = detectPivot(aggregatedCandles, i, {
                pivotLookback: tfConfig.lookback,
                minSwingPct: tfConfig.minSwingPct,
                minLegBars: tfConfig.minLegBars
            });

            if (!pivot) continue;

            // Enforce minimum bars between consecutive pivots
            if (lastAcceptedPivotIndex !== null) {
                const barsSinceLast = i - lastAcceptedPivotIndex;
                if (typeof tfConfig.minLegBars === 'number' && barsSinceLast < tfConfig.minLegBars) {
                    continue; // skip pivot: not enough bars since previous accepted pivot
                }
            }

            pivots.push(pivot);
            lastAcceptedPivotIndex = i;
        }
        
        allTimeframePivots[tf] = pivots;
        if (BACKTEST_CONFIG.showInitializationLogs) {
            console.log(`${colors.green}[${tf}] Built ${aggregatedCandles.length} candles, detected ${pivots.length} pivots using immediate aggregation${colors.reset}`);
        }
    }
    
    if (BACKTEST_CONFIG.showInitializationLogs) {
        console.log(`${colors.green}✅ Immediate aggregation system initialized successfully${colors.reset}`);
    }
    
    const totalPivots = Object.values(allTimeframePivots).reduce((sum, pivots) => sum + pivots.length, 0);
    console.log(`${colors.cyan}Total pivots detected across all timeframes: ${colors.yellow}${totalPivots}${colors.reset}`);
    
    multiPivotConfig.timeframes.forEach(tfConfig => {
        const pivots = allTimeframePivots[tfConfig.interval] || [];
        console.log(`  ${colors.yellow}${tfConfig.interval.padEnd(4)}${colors.reset}: ${colors.green}${pivots.length.toString().padStart(4)}${colors.reset} pivots`);
    });
    
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
    
    console.log(`${colors.cyan}\n=== STARTING IMMEDIATE AGGREGATION BACKTESTING WITH TRADES ===${colors.reset}`);
    console.log(`${colors.yellow}Initial Capital: $${formatNumberWithCommas(capital)}${colors.reset}`);
    console.log(`${colors.yellow}Processing ${primaryPivots.length} primary signals from ${primaryTf.interval} timeframe${colors.reset}`);
    console.log(`${colors.yellow}Trade monitoring using 1-minute precision${colors.reset}`);
    
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
        
        // Progress indicator
        if (i % BACKTEST_CONFIG.progressEvery === 0) {
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

    // Trade summary with comprehensive details
    if (allTrades.length > 0) {
         // Only display trade details if showTradeDetails is enabled
         if (tradeConfig.showTradeDetails) {
            // Display detailed trade information
            console.log(`\n${colors.cyan}--- Trade Details ---${colors.reset}`);
            console.log('--------------------------------------------------------------------------------');
            
            allTrades.forEach((trade, index) => {
                // Format dates to be more readable
                const entryDate = new Date(trade.entryTime);
                const exitDate = new Date(trade.exitTime);
                const entryTime12 = entryDate.toLocaleTimeString();
                const entryTime24Only = entryDate.toLocaleTimeString('en-GB', { hour12: false });
                const exitTime12 = exitDate.toLocaleTimeString();
                const exitTime24Only = exitDate.toLocaleTimeString('en-GB', { hour12: false });
                const entryDateStr = `${entryDate.toLocaleDateString('en-US', { weekday: 'short' })} ${entryDate.toLocaleDateString()} ${entryTime12} (${entryTime24Only})`;
                const exitDateStr = `${exitDate.toLocaleDateString('en-US', { weekday: 'short' })} ${exitDate.toLocaleDateString()} ${exitTime12} (${exitTime24Only})`;
                
                // Calculate and format duration using actual trade times
                const durationMs = trade.exitTime - trade.entryTime;
                const formatDuration = (ms) => {
                    const totalMinutes = Math.floor(ms / (1000 * 60));
                    const days = Math.floor(totalMinutes / (24 * 60));
                    const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
                    const minutes = totalMinutes % 60;
                    
                    if (days > 0) {
                        return `${days} days, ${hours} hours, ${minutes} minutes`;
                    } else if (hours > 0) {
                        return `${hours} hours, ${minutes} minutes`;
                    } else {
                        return `${minutes} minutes`;
                    }
                };
                const durationStr = formatDuration(durationMs);
                
                // Determine if win or loss
                const resultColor = trade.pnl >= 0 ? colors.green : colors.red;
                const resultText = trade.pnl >= 0 ? 'WIN' : 'LOSS';
                const pnlPct = ((trade.pnl / trade.tradeSize) * 100).toFixed(2);
                
                // Format the trade header - entire line in result color
                console.log(`${resultColor}[TRADE ${(index + 1).toString().padStart(2, ' ')}] ${trade.type.toUpperCase()} | P&L: ${pnlPct}% | ${resultText} | Result: ${trade.exitReason}${colors.reset}`);
                console.log();
                console.log(`${colors.cyan}  Entry: ${entryDateStr} at $${trade.entryPrice.toFixed(2)}${colors.reset}`);
                console.log(`${colors.cyan}  Exit:  ${exitDateStr} at $${trade.exitPrice.toFixed(2)}${colors.reset}`);
                console.log(`${colors.cyan}  Duration: ${durationStr}${colors.reset}`);
                
                // Add trade amount, loss, and remainder information
                const tradeAmount = trade.tradeSize;
                const tradeLoss = trade.pnl < 0 ? Math.abs(trade.pnl) : 0;
                const tradeRemainder = tradeAmount + trade.pnl; // Original amount + P&L = what's left
                
                console.log(`${colors.yellow}  Trade Amount: $${formatNumberWithCommas(tradeAmount)}${colors.reset}`);
                
                // Add TRADE PROFIT/LOSS line
                if (trade.pnl >= 0) {
                    console.log(`${colors.green}  Trade Profit: $${formatNumberWithCommas(trade.pnl)}${colors.reset}`);
                } else {
                    console.log(`${colors.red}  Trade Loss: $${formatNumberWithCommas(Math.abs(trade.pnl))}${colors.reset}`);
                }
                
                console.log(`${colors.cyan}  Trade Remainder: $${formatNumberWithCommas(tradeRemainder)}${colors.reset}`);
                
                // Display maximum favorable and unfavorable movements (if available)
                if (trade.maxFavorable !== undefined && trade.maxUnfavorable !== undefined) {
                    const favorableColor = trade.maxFavorable >= 0 ? colors.green : colors.red;
                    const unfavorableColor = trade.maxUnfavorable >= 0 ? colors.green : colors.red;
                    console.log(`  Max Favorable Movement: ${favorableColor}${trade.maxFavorable.toFixed(4)}%${colors.reset}`);
                    console.log(`  Max Unfavorable Movement: ${unfavorableColor}${trade.maxUnfavorable.toFixed(4)}%${colors.reset}`);
                }
                
                // Add price movement information
                const priceDiff = trade.exitPrice - trade.entryPrice;
                const priceDiffPct = (priceDiff / trade.entryPrice * 100).toFixed(4);
                const priceColor = priceDiff >= 0 ? colors.green : colors.red;
                console.log(`  Price Movement: ${priceColor}${priceDiff > 0 ? '+' : ''}${priceDiffPct}%${colors.reset} (${priceColor}$${formatNumberWithCommas(priceDiff)}${colors.reset})`);
                
                // Display funding costs if any
                if (tradeConfig.enableFundingRate && trade.fundingCosts && trade.fundingCosts.length > 0) {
                    const totalFundingCost = trade.fundingCosts.reduce((sum, f) => sum + f.cost, 0);
                    const fundingColor = totalFundingCost > 0 ? colors.red : colors.green;
                    console.log(`  Funding Costs: ${fundingColor}${totalFundingCost > 0 ? '-' : '+'}$${formatNumberWithCommas(Math.abs(totalFundingCost))}${colors.reset} (${trade.fundingCosts.length} payments)`);
                }
                
                // Display slippage information if enabled
                if (tradeConfig.enableSlippage && (trade.entrySlippage || trade.exitSlippage)) {
                    const entrySlippageText = trade.entrySlippage ? `Entry: ${colors.red}-${trade.entrySlippage.toFixed(4)}%${colors.reset}` : '';
                    const exitSlippageText = trade.exitSlippage ? `Exit: ${colors.red}-${trade.exitSlippage.toFixed(4)}%${colors.reset}` : '';
                    const slippageDisplay = [entrySlippageText, exitSlippageText].filter(Boolean).join(' | ');
                    if (slippageDisplay) {
                        console.log(`  Slippage Impact: ${slippageDisplay}`);
                    }
                    
                    // Show original vs slippage-adjusted prices if available
                    if (trade.originalExitPrice && Math.abs(trade.originalExitPrice - trade.exitPrice) > 0.0001) {
                        const isLong = trade.type === 'long';
                        const madeWorse = isLong ? (trade.exitPrice < trade.originalExitPrice) : (trade.exitPrice > trade.originalExitPrice);
                        const diffAbs = Math.abs(trade.exitPrice - trade.originalExitPrice);
                        const slippageDiffColor = madeWorse ? colors.red : colors.green;
                        console.log(`  Exit Price Impact: $${formatNumberWithCommas(trade.originalExitPrice)} → $${formatNumberWithCommas(trade.exitPrice)} (${slippageDiffColor}${madeWorse ? '-' : '+'}$${formatNumberWithCommas(diffAbs)}${colors.reset})`);
                    }
                }
                
                // Display funding cost information if enabled
                if (tradeConfig.enableFundingRate && trade.fundingCost && Math.abs(trade.fundingCost) > 0.01) {
                    const fundingColor = trade.fundingCost >= 0 ? colors.red : colors.green;
                    console.log(`  Funding Cost: ${fundingColor}${trade.fundingCost >= 0 ? '-' : '+'}$${formatNumberWithCommas(Math.abs(trade.fundingCost))}${colors.reset}`);
                }
                
                // Display trailing stop information if used
                if (trade.trailingStopActive || trade.trailingTakeProfitActive) {
                    console.log(`  ${colors.magenta}Trailing Stop Info:${colors.reset}`);
                    
                    if (trade.trailingStopActive) {
                        const trailingStopTriggered = trade.exitReason === 'TRAILING_SL';
                        const trailingStopColor = trailingStopTriggered ? colors.red : colors.yellow;
                        console.log(`    ${trailingStopColor}• Trailing SL: ${trailingStopTriggered ? 'TRIGGERED' : 'ACTIVE'} at $${formatNumberWithCommas(trade.trailingStopPrice)}${colors.reset}`);
                    }
                    
                    if (trade.trailingTakeProfitActive) {
                        const trailingTPTriggered = trade.exitReason === 'TRAILING_TP';
                        const trailingTPColor = trailingTPTriggered ? colors.green : colors.yellow;
                        console.log(`    ${trailingTPColor}• Trailing TP: ${trailingTPTriggered ? 'TRIGGERED' : 'ACTIVE'} at $${formatNumberWithCommas(trade.trailingTakeProfitPrice)}${colors.reset}`);
                    }
                    
                    // Show best price achieved
                    if (trade.bestPrice !== undefined) {
                        const bestPriceColor = trade.type === 'long' ? 
                            (trade.bestPrice > trade.entryPrice ? colors.green : colors.red) :
                            (trade.bestPrice < trade.entryPrice ? colors.green : colors.red);
                        console.log(`    ${bestPriceColor}• Best Price: $${formatNumberWithCommas(trade.bestPrice)}${colors.reset}`);
                    }
                    
                    // Show original vs trailing prices
                    if (trade.originalTakeProfitPrice && trade.originalStopLossPrice) {
                        console.log(`    ${colors.cyan}• Original TP/SL: $${formatNumberWithCommas(trade.originalTakeProfitPrice)} / $${formatNumberWithCommas(trade.originalStopLossPrice)}${colors.reset}`);
                    }
                }
                
                // Display cost breakdown
                if (trade.tradingFee || trade.fundingCost) {
                    const tradingFeeText = trade.tradingFee ? `Trading: $${formatNumberWithCommas(trade.tradingFee)}` : '';
                    const fundingText = (trade.fundingCost && Math.abs(trade.fundingCost) > 0.01) ? `Funding: $${formatNumberWithCommas(Math.abs(trade.fundingCost))}` : '';
                    const costBreakdown = [tradingFeeText, fundingText].filter(Boolean).join(' | ');
                    if (costBreakdown) {
                        console.log(`  ${colors.yellow}Cost Breakdown: ${costBreakdown}${colors.reset}`);
                    }
                }
                
                console.log('--------------------------------------------------------------------------------');
            });
        }
    }
    
    // Final results
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    // Display results summary
    console.log(`\n${colors.cyan}=== BACKTESTING RESULTS SUMMARY ===${colors.reset}`);
    console.log(`${colors.yellow}Total Primary Signals: ${colors.green}${totalSignals}${colors.reset}`);
    
    // Show pattern confirmation stats
    if (BACKTEST_CONFIG.tradingMode === 'pivot') {
        console.log(`${colors.yellow}Confirmed Signals: ${colors.green}${confirmedSignals}${colors.reset} (All signals confirmed in pivot mode)`);
    } else {
        console.log(`${colors.yellow}Confirmed Cascade Signals: ${colors.green}${confirmedSignals}${colors.reset}`);
    }
    
    // Show trade execution stats
    console.log(`${colors.yellow}Executed Trades: ${colors.green}${executedTrades}${colors.reset}`);
    
    if (totalSignals > 0) {
        const confirmationRate = ((confirmedSignals / totalSignals) * 100).toFixed(1);
        console.log(`${colors.yellow}Signal Confirmation Rate: ${colors.green}${confirmationRate}%${colors.reset}`);
        
        const executionRate = ((executedTrades / confirmedSignals) * 100).toFixed(1);
        console.log(`${colors.yellow}Trade Execution Rate: ${colors.green}${executionRate}%${colors.reset} (confirmed signals that became trades)`);
    }
    
    const dataStartTime = oneMinuteCandles[0].time;
    const dataEndTime = oneMinuteCandles[oneMinuteCandles.length - 1].time;
    const totalHours = (dataEndTime - dataStartTime) / (1000 * 60 * 60);
    const signalsPerDay = totalSignals > 0 ? ((totalSignals / totalHours) * 24).toFixed(2) : '0';
    const confirmedSignalsPerDay = confirmedSignals > 0 ? ((confirmedSignals / totalHours) * 24).toFixed(2) : '0';
    
    console.log(`${colors.yellow}Primary Signal Frequency: ${colors.green}${signalsPerDay} signals/day${colors.reset}`);
    console.log(`${colors.yellow}Confirmed Signal Frequency: ${colors.green}${confirmedSignalsPerDay} confirmed/day${colors.reset}`);
    
    const executedTradesPerDay = executedTrades > 0 ? ((executedTrades / totalHours) * 24).toFixed(2) : '0';
    console.log(`${colors.yellow}Executed Trade Frequency: ${colors.green}${executedTradesPerDay} trades/day${colors.reset}`);
    
    const dataSpanDays = (totalHours / 24).toFixed(1);
    console.log(`${colors.cyan}Data Timespan: ${dataSpanDays} days${colors.reset}`);
    
    if (allTrades.length > 0) {
        const winningTrades = allTrades.filter(t => t.pnl > 0);
        const losingTrades = allTrades.filter(t => t.pnl <= 0);
        const winRate = ((winningTrades.length / allTrades.length) * 100).toFixed(1);
        const totalPnl = allTrades.reduce((sum, t) => sum + t.pnl, 0);
        const totalReturn = ((totalPnl / tradeConfig.initialCapital) * 100).toFixed(2);
        
        console.log(`\n${colors.cyan}--- Trading Performance ---${colors.reset}`);
        console.log(`${colors.yellow}Total Trades: ${colors.green}${allTrades.length}${colors.reset}`);
        console.log(`${colors.yellow}Winning Trades: ${colors.green}${winningTrades.length}${colors.reset}`);
        console.log(`${colors.yellow}Losing Trades: ${colors.red}${losingTrades.length}${colors.reset}`);
        console.log(`${colors.yellow}Win Rate: ${colors.green}${winRate}%${colors.reset}`);
        console.log(`${colors.yellow}Total P&L: ${totalPnl >= 0 ? colors.green : colors.red}${formatNumberWithCommas(totalPnl)} USDT${colors.reset}`);
        console.log(`${colors.yellow}Total Return: ${totalReturn >= 0 ? colors.green : colors.red}${formatNumberWithCommas(parseFloat(totalReturn))}%${colors.reset}`);
        console.log(`${colors.yellow}Final Capital: ${capital >= 0 ? colors.green : colors.red}${formatNumberWithCommas(capital)} USDT${colors.reset}`);
        
       
    }
    
    console.log(`\n${colors.cyan}--- Multi-Timeframe Backtesting Complete ---${colors.reset}`);
}

// Run the backtester
(async () => {
    try {
        await runImmediateAggregationBacktest();
    } catch (err) {
        console.error('\nAn error occurred during backtesting:', err);
        process.exit(1);
    }
})();
