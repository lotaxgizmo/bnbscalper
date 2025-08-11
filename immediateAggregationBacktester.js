// immediateAggregationBacktester.js
// Advanced backtester using immediate aggregation technology
// Supports both individual pivot trading and cascade confirmation strategies
// ===== CONFIGURATION =====
const BACKTEST_CONFIG = {
    // Trading mode
    tradingMode: 'pivot',     // 'pivot' = trade individual pivots, 'cascade' = require multi-timeframe confirmation
    
    // Data settings
    useLiveAPI: false,           // Force API data
    // maxCandles: 86400,          // 1 week of 1m candles for testing
    maxCandles: 43200,          // 1 week of 1m candles for testing
    
    // Output settings
    showEveryNthTrade: 1,       // Show every Nth trade
    showFirstNTrades: 20,       // Always show first N trades
    progressEvery: 5000,        // Progress update frequency
    
    // Cascade requirements (only used in cascade mode)
    minConfirmations: 1,        // Minimum confirmations needed
    requirePrimaryTimeframe: true, // Must have primary timeframe confirmation
};

import {
    symbol,
    useLocalData,
    pivotDetectionMode
} from './config/config.js';

import { tradeConfig } from './config/tradeconfig.js';
import { multiPivotConfig } from './config/multiPivotConfig.js';
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
        console.log(`${colors.green}Loaded ${limitedCandles.length} 1m candles from CSV${colors.reset}`);
        return limitedCandles;
    } else {
        const candles = await getCandles(symbol, '1m', BACKTEST_CONFIG.maxCandles);
        console.log(`${colors.green}Loaded ${candles.length} 1m candles from API${colors.reset}`);
        return candles.sort((a, b) => a.time - b.time);
    }
}

// ===== PIVOT DETECTION =====
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
    
    // Validate minimum swing percentage requirement
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

// ===== TRADE MANAGEMENT =====
function createTrade(signal, pivot, tradeSize, currentTime, timeframe) {
    const entryPrice = pivot.price;
    const isLong = signal === 'long';
    
    // Calculate TP and SL based on config
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
        pnl: 0,
        pnlPct: 0,
        pivot: pivot
    };
}

function updateTrade(trade, currentCandle) {
    const currentPrice = currentCandle.close;
    const isLong = trade.type === 'long';
    
    // Check for TP/SL hits
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
        
        // Calculate P&L
        const priceChange = isLong ? (currentPrice - trade.entryPrice) : (trade.entryPrice - currentPrice);
        trade.pnl = (priceChange / trade.entryPrice) * trade.tradeSize * trade.leverage;
        trade.pnlPct = (priceChange / trade.entryPrice) * 100 * trade.leverage;
        
        // Apply fees
        const totalFees = trade.tradeSize * (tradeConfig.totalMakerFee / 100) * 2; // Entry + exit
        trade.pnl -= totalFees;
    }
    
    return shouldClose;
}

// ===== CASCADE CONFIRMATION =====
function checkCascadeConfirmation(primaryPivot, allTimeframePivots, currentTime) {
    const confirmations = [];
    const timeWindow = 5 * 60 * 1000; // 5 minutes window for confirmation
    
    for (const [timeframe, pivots] of Object.entries(allTimeframePivots)) {
        if (pivots.length === 0) continue;
        
        // Find recent pivots of the same type within time window
        const recentPivots = pivots.filter(p => 
            p.signal === primaryPivot.signal &&
            Math.abs(p.time - currentTime) <= timeWindow
        );
        
        if (recentPivots.length > 0) {
            const tfConfig = multiPivotConfig.timeframes.find(tf => tf.interval === timeframe);
            confirmations.push({
                timeframe: timeframe,
                role: tfConfig?.role || 'secondary',
                weight: tfConfig?.weight || 1,
                pivot: recentPivots[0]
            });
        }
    }
    
    return confirmations;
}

function meetsExecutionRequirements(confirmations) {
    if (confirmations.length < BACKTEST_CONFIG.minConfirmations) {
        return false;
    }
    
    if (BACKTEST_CONFIG.requirePrimaryTimeframe) {
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
    
    console.log(`${colors.cyan}\n=== INITIALIZING IMMEDIATE AGGREGATION SYSTEM ===${colors.reset}`);
    
    for (const tfConfig of multiPivotConfig.timeframes) {
        const tf = tfConfig.interval;
        const timeframeMinutes = parseTimeframeToMinutes(tf);
        
        console.log(`${colors.cyan}[${tf}] Processing ${timeframeMinutes}-minute aggregation...${colors.reset}`);
        
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
        console.log(`${colors.green}[${tf}] Built ${aggregatedCandles.length} candles, detected ${pivots.length} pivots using immediate aggregation${colors.reset}`);
    }
    
    console.log(`${colors.green}✅ Immediate aggregation system initialized successfully${colors.reset}`);
    
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
    const openTrades = [];
    const allTrades = [];
    let totalSignals = 0;
    let confirmedSignals = 0;
    let executedTrades = 0;
    
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
        
        // Update existing trades with each 1-minute candle in the range
        for (const minuteCandle of minuteCandlesInRange) {
            for (let j = openTrades.length - 1; j >= 0; j--) {
                const trade = openTrades[j];
                const shouldClose = updateTrade(trade, minuteCandle);
                
                if (shouldClose) {
                    capital += trade.pnl;
                    const closedTrade = openTrades.splice(j, 1)[0];
                    closedTradesThisCandle.push(closedTrade);
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
                    
                    console.log(`${colors.magenta}[${timeframe}] ${pivotType} PIVOT @ ${pivotTimeFormatted} | Signal: ${pivotSignal} | Swing: ${swingPct}% \n ${timeRange}${colors.reset}\n`);
                }
            }
        }
        
        // Check for new pivot signals
        const currentPivot = primaryPivots.find(p => p.time === currentTime);
        if (currentPivot) {
            totalSignals++;
            
            let shouldTrade = false;
            let confirmations = [];
            
            if (BACKTEST_CONFIG.tradingMode === 'pivot') {
                // Trade individual pivots
                shouldTrade = true;
            } else if (BACKTEST_CONFIG.tradingMode === 'cascade') {
                // Require cascade confirmation
                confirmations = checkCascadeConfirmation(currentPivot, allTimeframePivots, currentTime);
                shouldTrade = meetsExecutionRequirements(confirmations);
            }
            
            // Count confirmed signals based on trading mode
            if (shouldTrade) {
                confirmedSignals++;
            }
            
            if (shouldTrade && (!tradeConfig.singleTradeMode || openTrades.length === 0)) {
                // TRADE EXECUTION LOGIC - Check direction configuration
                let shouldOpenTrade = false;
                let tradeType = null;
                
                if (currentPivot.signal === 'long') {
                    // Long signal from pivot
                    if (tradeConfig.direction === 'buy' || tradeConfig.direction === 'both') {
                        shouldOpenTrade = true;
                        tradeType = 'long';
                    } else if (tradeConfig.direction === 'alternate') {
                        shouldOpenTrade = true;
                        tradeType = 'short'; // Alternate: short on high pivots
                    }
                } else if (currentPivot.signal === 'short') {
                    // Short signal from pivot
                    if (tradeConfig.direction === 'sell' || tradeConfig.direction === 'both') {
                        shouldOpenTrade = true;
                        tradeType = 'short';
                    } else if (tradeConfig.direction === 'alternate') {
                        shouldOpenTrade = true;
                        tradeType = 'long'; // Alternate: long on low pivots
                    }
                }
                
                if (shouldOpenTrade && capital > 0) {
                    executedTrades++;
                    
                    // Calculate trade size
                    let tradeSize;
                    switch (tradeConfig.positionSizingMode) {
                        case 'fixed':
                            tradeSize = tradeConfig.amountPerTrade;
                            break;
                        case 'percent':
                            tradeSize = capital * (tradeConfig.riskPerTrade / 100);
                            break;
                        default:
                            tradeSize = tradeConfig.amountPerTrade;
                    }
                    
                    // Create trade with the determined trade type
                    const trade = createTrade(tradeType, currentPivot, tradeSize, currentTime, primaryTf.interval);
                    openTrades.push(trade);
                    allTrades.push(trade);
                    
                    // Only show cascade confirmation details if not hidden
                    if (!tradeConfig.hideCascades && BACKTEST_CONFIG.tradingMode === 'cascade' && confirmations.length > 0) {
                        const primaryTime12 = formatDualTime(currentTime);
                        const confirmingTFs = confirmations.map(c => c.timeframe).join(', ');
                        
                        console.log(`${colors.green}🎯 CASCADE #${confirmedSignals} CONFIRMED: ${currentPivot.signal.toUpperCase()}${colors.reset}`);
                        console.log(`${colors.cyan}   Primary: ${primaryTime12} | Strength: ${(currentPivot.swingPct || 0).toFixed(1)}% | Confirming TFs: ${confirmingTFs}${colors.reset}`);
                        console.log(`${colors.cyan}   Entry Price: $${trade.entryPrice.toFixed(2)} | Size: $${formatNumberWithCommas(trade.tradeSize)} | TP: $${trade.takeProfitPrice.toFixed(2)} | SL: $${trade.stopLossPrice.toFixed(2)}${colors.reset}`);
                    } 
                    // Only show trade entry details if showTradeDetails is enabled
                    else if (tradeConfig.showTradeDetails) {
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

    // Show individual trade details if there are trades
    if (allTrades.length > 0 && allTrades.length <= 20 && tradeConfig.showTradeDetails) {
       console.log(`\n${colors.cyan}--- Individual Trade Details ---${colors.reset}`);
       allTrades.forEach((trade, index) => {
           const pnlColor = trade.pnl >= 0 ? colors.green : colors.red;
           const entryTime = formatDualTime(trade.entryTime);
           const exitTime = formatDualTime(trade.exitTime);
           
           console.log(`${colors.yellow}Trade #${index + 1}: ${colors.cyan}${trade.type.toUpperCase()}${colors.reset}`);
           console.log(`  Entry: ${entryTime} @ $${formatNumberWithCommas(trade.entryPrice)}`);
           console.log(`  Exit:  ${exitTime} @ $${formatNumberWithCommas(trade.exitPrice)} [${trade.exitReason}]`);
           console.log(`  P&L: ${pnlColor}${trade.pnl >= 0 ? '+' : ''}${formatNumberWithCommas(trade.pnl)} USDT (${trade.pnlPct.toFixed(2)}%)${colors.reset}`);
           console.log('--------------------------------------------------------------------------------');
       });
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
