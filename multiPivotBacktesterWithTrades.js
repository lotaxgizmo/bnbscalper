
// multiPivotBacktesterWithTrades.js
// Complete multi-timeframe pivot backtester that trades confirmed cascades with full trade execution

// Debug configuration
const DEBUG_CONFIG = {
    showConfirmationLogs: false,  // Toggle for confirmation logs
    showExecutionLogs: false      // Toggle for execution logs
};

import {
    symbol,
    time as interval,
    useLocalData,
    api,
    pivotDetectionMode
} from './config/config.js';

import { tradeConfig } from './config/tradeconfig.js';
import { multiPivotConfig } from './config/multiPivotConfig.js';
import { MultiTimeframePivotDetector } from './utils/multiTimeframePivotDetector.js';
import { formatNumber } from './utils/formatters.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get the directory name in a way that works with ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const colors = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    magenta: '\x1b[35m',
    blue: '\x1b[34m',
    white: '\x1b[37m',
    brightRed: '\x1b[91m',
    brightGreen: '\x1b[92m',
    brightYellow: '\x1b[93m',
    brightBlue: '\x1b[94m',
    brightMagenta: '\x1b[95m',
    brightCyan: '\x1b[96m',
    brightWhite: '\x1b[97m',
    bold: '\x1b[1m'
};

// Utility function to format numbers with commas
const formatNumberWithCommas = (num) => {
    if (typeof num !== 'number') return num;
    return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

// Utility function to format duration in milliseconds to a readable string
const formatDuration = (ms) => {
    const days = Math.floor(ms / (1000 * 60 * 60 * 24));
    const hours = Math.floor((ms % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    
    if (days > 0) {
        return `${days} days, ${hours} hours, ${minutes} minutes`;
    } else {
        return `${hours} hours, ${minutes} minutes`;
    }
};

// Helper function to calculate slippage based on configuration
const calculateSlippage = (tradeSize, tradeConfig) => {
    if (!tradeConfig.enableSlippage) return 0;
    
    let slippagePercent = 0;
    
    switch (tradeConfig.slippageMode) {
        case 'fixed':
            slippagePercent = tradeConfig.slippagePercent;
            break;
        case 'variable':
            const range = tradeConfig.variableSlippageMax - tradeConfig.variableSlippageMin;
            slippagePercent = tradeConfig.variableSlippageMin + (Math.random() * range);
            break;
        case 'market_impact':
            const marketImpact = (tradeSize / 1000) * tradeConfig.marketImpactFactor;
            slippagePercent = tradeConfig.slippagePercent + marketImpact;
            break;
        default:
            slippagePercent = tradeConfig.slippagePercent;
    }
    
    return slippagePercent / 100;
};

// Helper function to calculate funding rate cost
const calculateFundingRate = (tradeConfig, currentTime, entryTime, positionSize, leverage) => {
    if (!tradeConfig.enableFundingRate) return 0;
    
    const tradeDurationMs = currentTime - entryTime;
    const tradeDurationHours = tradeDurationMs / (1000 * 60 * 60);
    const fundingPeriods = Math.floor(tradeDurationHours / tradeConfig.fundingRateHours);
    
    if (fundingPeriods <= 0) return 0;
    
    let fundingRatePercent = 0;
    
    switch (tradeConfig.fundingRateMode) {
        case 'fixed':
            fundingRatePercent = tradeConfig.fundingRatePercent;
            break;
        case 'variable':
            const range = tradeConfig.variableFundingMax - tradeConfig.variableFundingMin;
            fundingRatePercent = tradeConfig.variableFundingMin + (Math.random() * range);
            break;
        default:
            fundingRatePercent = tradeConfig.fundingRatePercent;
    }
    
    const totalFundingCost = positionSize * leverage * (fundingRatePercent / 100) * fundingPeriods;
    return totalFundingCost;
};

// Helper function to apply slippage to exit price
const applySlippage = (exitPrice, tradeType, slippagePercent) => {
    if (slippagePercent === 0) return exitPrice;
    
    if (tradeType === 'long') {
        return exitPrice * (1 - slippagePercent);
    } else {
        return exitPrice * (1 + slippagePercent);
    }
};

// Helper function to create a trade from cascade confirmation
const createTrade = (type, cascadeResult, tradeSize, takeProfit, stopLoss) => {
    let entryPrice = cascadeResult.executionPrice;
    
    const entrySlippage = calculateSlippage(tradeSize, tradeConfig);
    entryPrice = applySlippage(entryPrice, type, entrySlippage);
    
    const takeProfitPrice = type === 'long'
        ? entryPrice * (1 + (takeProfit / 100))
        : entryPrice * (1 - (takeProfit / 100));
        
    const stopLossPrice = type === 'long'
        ? entryPrice * (1 - (stopLoss / 100))
        : entryPrice * (1 + (stopLoss / 100));

    return {
        type,
        entryPrice,
        entryTime: cascadeResult.executionTime,
        size: tradeSize,
        status: 'open',
        takeProfitPrice,
        stopLossPrice,
        cascade: cascadeResult,
        maxFavorable: 0,
        maxUnfavorable: 0,
        entrySlippage: entrySlippage * 100,
        lastFundingTime: cascadeResult.executionTime,
        
        // Trailing stop tracking
        originalTakeProfitPrice: takeProfitPrice,
        originalStopLossPrice: stopLossPrice,
        bestPrice: entryPrice, // Track best price achieved
        trailingStopActive: false, // Whether trailing stop is active
        trailingTakeProfitActive: false, // Whether trailing TP is active
        trailingStopPrice: stopLossPrice, // Current trailing stop price
        trailingTakeProfitPrice: takeProfitPrice // Current trailing TP price
    };
};

// Window-based cascade confirmation function (matches fronttester logic)
function checkWindowBasedCascade(primaryPivot, detector, oneMinuteCandles, multiPivotConfig) {
    const confirmationWindow = multiPivotConfig.cascadeSettings.confirmationWindow[primaryPivot.timeframe] || 60;
    const windowEndTime = primaryPivot.time + (confirmationWindow * 60 * 1000);
    const minRequiredTFs = multiPivotConfig.cascadeSettings.minTimeframesRequired || 3;
    
    // DEBUG: Enabled for investigation
    const isFirstFew = true;
    
    // Find all confirming timeframes (exclude primary)
    const confirmingTimeframes = multiPivotConfig.timeframes.slice(1); // Skip primary (first)
    const confirmations = [];
    
    // Collect all confirmations within window
    let allConfirmations = [];
    const timeframeRoles = new Map();
    
    // Map timeframe roles for hierarchical validation
    multiPivotConfig.timeframes.forEach(tf => {
        timeframeRoles.set(tf.interval, tf.role);
    });
    
    // Check each confirming timeframe for matching pivots within window
    for (const tf of confirmingTimeframes) {
        const pivots = detector.pivotHistory.get(tf.interval) || [];
        
        // Look for confirming pivots within window
        const confirmingPivots = pivots.filter(p => 
            p.signal === primaryPivot.signal &&
            p.time >= primaryPivot.time &&
            p.time <= windowEndTime
        );
        
        // Add all confirming pivots to collection
        for (const pivot of confirmingPivots) {
            allConfirmations.push({
                timeframe: tf.interval,
                pivot: pivot,
                confirmTime: pivot.time,
                role: timeframeRoles.get(tf.interval) || 'unknown'
            });
        }
    }
    
    // Apply hierarchical validation (updated):
    // Do not drop execution confirmations or enforce ordering here.
    // Role requirements are enforced later in checkHierarchicalExecution().
    
    // Sort confirmations by time (earliest first)
    allConfirmations.sort((a, b) => a.confirmTime - b.confirmTime);
    
    // Find the earliest time when we have minimum required confirmations
    let executionTime = primaryPivot.time;
    let executionPrice = primaryPivot.price;
    const confirmedTimeframes = new Set(['4h']); // Primary timeframe
    
    for (const confirmation of allConfirmations) {
        confirmedTimeframes.add(confirmation.timeframe);
        
        if (isFirstFew && DEBUG_CONFIG.showConfirmationLogs) {
            console.log(`   ✅ ${confirmation.timeframe} confirms at ${new Date(confirmation.confirmTime).toISOString()} ($${confirmation.pivot.price})`);
        }
        
        // Check if we now have minimum required confirmations
        if (confirmedTimeframes.size >= minRequiredTFs) {
            // FRONTTESTER COMPATIBILITY: Execute at LATEST confirmation time (like fronttester)
            // Build final confirmations list first
            confirmations.length = 0;
            const usedTimeframes = new Set();
            for (const conf of allConfirmations) {
                if (conf.confirmTime <= confirmation.confirmTime && !usedTimeframes.has(conf.timeframe)) {
                    confirmations.push(conf);
                    usedTimeframes.add(conf.timeframe);
                }
            }
            
            // Find execution time as LATEST confirmation time (matches fronttester Math.max logic)
            const allTimes = [primaryPivot.time, ...confirmations.map(c => c.confirmTime)];
            executionTime = Math.max(...allTimes);
            
            // FRONTTESTER COMPATIBILITY: Use 1-minute candle close price at execution time
            const executionCandle = oneMinuteCandles.find(c => Math.abs(c.time - executionTime) <= 30000);
            executionPrice = executionCandle ? executionCandle.close : primaryPivot.price;
            
            if (isFirstFew && DEBUG_CONFIG.showExecutionLogs) {
                console.log(`   ⏰ EXECUTION: ${confirmedTimeframes.size}/${minRequiredTFs} confirmations met at ${new Date(executionTime).toISOString()} ($${executionPrice})`);
            }
            
            break;
        }
    }
    
    const totalConfirmed = 1 + confirmations.length; // +1 for primary
    
    // Check hierarchical execution requirements (matches fronttester logic)
    if (totalConfirmed >= minRequiredTFs) {
        const canExecute = checkHierarchicalExecution(primaryPivot, confirmations, multiPivotConfig);
        if (canExecute) {
            return {
                signal: primaryPivot.signal,
                executionTime,
                executionPrice,
                confirmations,
                strength: Math.min(totalConfirmed / multiPivotConfig.timeframes.length, 1.0),
                minutesAfterPrimary: Math.round((executionTime - primaryPivot.time) / (1000 * 60))
            };
        }
    }
    
    return null;
}

// Hierarchical execution check (updated role-based logic)
function checkHierarchicalExecution(primaryPivot, confirmations, multiPivotConfig) {
    // All confirmed timeframes (primary + confirmations)
    const confirmedTimeframes = [
        primaryPivot.timeframe,
        ...confirmations.map(c => c.timeframe)
    ];

    const minRequired = multiPivotConfig.cascadeSettings.minTimeframesRequired || 3;
    if (confirmedTimeframes.length < minRequired) return false;

    // Primary enforcement
    const primaryTF = multiPivotConfig.timeframes.find(tf => tf.role === 'primary')?.interval;
    const requirePrimary = !!multiPivotConfig.cascadeSettings.requirePrimaryTimeframe;
    const hasPrimary = primaryTF ? confirmedTimeframes.includes(primaryTF) : false;

    // Execution enforcement
    const executionTF = multiPivotConfig.timeframes.find(tf => tf.role === 'execution')?.interval;
    const executionRoleExists = !!executionTF;
    if (executionRoleExists && !confirmedTimeframes.includes(executionTF)) return false;

    if (requirePrimary && !hasPrimary) return false;

    return true;
}

// Fronttester-compatible pivot detection function (with swing filtering)
function detectPivotAtCandle(candles, index, timeframe, lastPivots) {
    if (index < timeframe.lookback) return null;
    
    const currentCandle = candles[index];
    const { minSwingPct, minLegBars } = timeframe;
    const swingThreshold = minSwingPct / 100;
    
    // Get last pivot for this timeframe (for swing filtering)
    const lastPivot = lastPivots.get(timeframe.interval) || { type: null, price: null, time: null, index: 0 };
    
    // Check for high pivot (LONG signal - CONTRARIAN)
    let isHighPivot = true;
    for (let j = 1; j <= timeframe.lookback; j++) {
        const compareCandle = candles[index - j];
        const comparePrice = pivotDetectionMode === 'extreme' ? compareCandle.high : compareCandle.close;
        const currentPrice = pivotDetectionMode === 'extreme' ? currentCandle.high : currentCandle.close;
        if (comparePrice >= currentPrice) {
            isHighPivot = false;
            break;
        }
    }
    
    if (isHighPivot) {
        const pivotPrice = pivotDetectionMode === 'extreme' ? currentCandle.high : currentCandle.close;
        const swingPct = lastPivot.price ? (pivotPrice - lastPivot.price) / lastPivot.price : 0;
        const isFirstPivot = lastPivot.type === null;
        
        // Apply swing filtering (matches fronttester logic)
        if ((isFirstPivot || Math.abs(swingPct) >= swingThreshold) && (index - lastPivot.index) >= minLegBars) {
            const pivot = {
                time: currentCandle.time,
                price: pivotPrice,
                signal: 'long',  // INVERTED: High pivot = LONG signal
                type: 'high',
                timeframe: timeframe.interval,
                index: index,
                swingPct: swingPct * 100
            };
            
            // Update last pivot for this timeframe
            lastPivots.set(timeframe.interval, pivot);
            return pivot;
        }
    }
    
    // Check for low pivot (SHORT signal - CONTRARIAN)
    let isLowPivot = true;
    for (let j = 1; j <= timeframe.lookback; j++) {
        const compareCandle = candles[index - j];
        const comparePrice = pivotDetectionMode === 'extreme' ? compareCandle.low : compareCandle.close;
        const currentPrice = pivotDetectionMode === 'extreme' ? currentCandle.low : currentCandle.close;
        if (comparePrice <= currentPrice) {
            isLowPivot = false;
            break;
        }
    }
    
    if (isLowPivot) {
        const pivotPrice = pivotDetectionMode === 'extreme' ? currentCandle.low : currentCandle.close;
        const swingPct = lastPivot.price ? (pivotPrice - lastPivot.price) / lastPivot.price : 0;
        const isFirstPivot = lastPivot.type === null;
        
        // Apply swing filtering (matches fronttester logic)
        if ((isFirstPivot || Math.abs(swingPct) >= swingThreshold) && (index - lastPivot.index) >= minLegBars) {
            const pivot = {
                time: currentCandle.time,
                price: pivotPrice,
                signal: 'short', // INVERTED: Low pivot = SHORT signal
                type: 'low',
                timeframe: timeframe.interval,
                index: index,
                swingPct: swingPct * 100
            };
            
            // Update last pivot for this timeframe
            lastPivots.set(timeframe.interval, pivot);
            return pivot;
        }
    }
    
    return null;
}



// Main backtesting function
async function runMultiTimeframeBacktest() {
    console.log(`${colors.cyan}=== MULTI-TIMEFRAME PIVOT BACKTESTER WITH TRADES ===${colors.reset}`);
    console.log(`${colors.yellow}Symbol: ${symbol}${colors.reset}`);
    console.log(`${colors.yellow}Detection Mode: ${pivotDetectionMode === 'extreme' ? 'Extreme (High/Low)' : 'Close'}${colors.reset}`);
    console.log(`${colors.yellow}Data Source: ${useLocalData ? 'Local CSV' : 'Live API'}${colors.reset}\n`);

    // Display trade configuration
    console.log(`${colors.cyan}--- Trade Configuration ---${colors.reset}`);
    let directionDisplay = tradeConfig.direction;
    if (tradeConfig.direction === 'alternate') {
        directionDisplay = 'alternate (LONG at highs, SHORT at lows)';
    }
    console.log(`Direction: ${colors.yellow}${directionDisplay}${colors.reset}`);
    console.log(`Take Profit: ${colors.green}${tradeConfig.takeProfit}%${colors.reset}`);
    console.log(`Stop Loss: ${colors.red}${tradeConfig.stopLoss}%${colors.reset}`);
    console.log(`Leverage: ${colors.yellow}${tradeConfig.leverage}x${colors.reset}`);
    console.log(`Initial Capital: ${colors.yellow}${tradeConfig.initialCapital} USDT${colors.reset}`);
    
    // Display trailing stop configuration
    if (tradeConfig.enableTrailingStop || tradeConfig.enableTrailingTakeProfit) {
        console.log(`${colors.magenta}--- Trailing Stop Configuration ---${colors.reset}`);
        
        if (tradeConfig.enableTrailingStop) {
            console.log(`Trailing Stop Loss: ${colors.brightCyan}ENABLED${colors.reset} (Distance: ${colors.yellow}${tradeConfig.trailingStopDistance}%${colors.reset})`);
        } else {
            console.log(`Trailing Stop Loss: ${colors.red}DISABLED${colors.reset}`);
        }
        
        if (tradeConfig.enableTrailingTakeProfit) {
            console.log(`Trailing Take Profit: ${colors.brightCyan}ENABLED${colors.reset} (Trigger: ${colors.green}${tradeConfig.trailingTakeProfitTrigger}%${colors.reset}, Distance: ${colors.yellow}${tradeConfig.trailingTakeProfitDistance}%${colors.reset})`);
        } else {
            console.log(`Trailing Take Profit: ${colors.red}DISABLED${colors.reset}`);
        }
    } else {
        console.log(`${colors.magenta}Trailing Stops: ${colors.red}DISABLED${colors.reset}`);
    }

    // Initialize multi-timeframe pivot detection system with fronttester-compatible detection
    console.log(`\n${colors.cyan}=== INITIALIZING MULTI-TIMEFRAME PIVOT SYSTEM ===${colors.reset}`);
    const detector = new MultiTimeframePivotDetector(symbol, multiPivotConfig);
    
    try {
        // Load raw candle data only (no pre-calculated pivots)
        await detector.loadRawCandleDataOnly(useLocalData);

        // Ensure 1m candles are available for trade tracking even if not part of cascade TFs
        let oneMinutePreload = detector.timeframeData.get('1m') || [];
        if (oneMinutePreload.length === 0) {
            try {
                if (detector.debug.showTimeframeAnalysis) {
                    console.log(`${colors.cyan}[1m] Loading 1-minute candles for trade tracking${colors.reset}`);
                }
                await detector.loadTimeframeData({ interval: '1m' }, useLocalData);
                oneMinutePreload = detector.timeframeData.get('1m') || [];
                if (detector.debug.showTimeframeAnalysis) {
                    console.log(`${colors.green}[1m] Loaded ${oneMinutePreload.length} 1-minute candles for trade tracking${colors.reset}`);
                }
            } catch (e) {
                console.warn(`${colors.yellow}[WARN] Failed to load 1m candles for trade tracking. Backtester will fall back to pivot prices for execution if needed.${colors.reset}`);
            }
        }
        
        // Use fronttester-compatible pivot detection with shared lastPivots tracking
        const lastPivots = new Map(); // Track last pivots for swing filtering across all timeframes
        
        // Initialize lastPivots for each timeframe
        for (const tf of multiPivotConfig.timeframes) {
            lastPivots.set(tf.interval, { type: null, price: null, time: null, index: 0 });
        }
        
        for (const tf of multiPivotConfig.timeframes) {
            const candles = detector.timeframeData.get(tf.interval) || [];
            const pivots = [];
            
            console.log(`${colors.cyan}[${tf.interval}] Processing ${candles.length} candles with lookback ${tf.lookback}${colors.reset}`);
            
            for (let i = tf.lookback; i < candles.length; i++) {
                const pivot = detectPivotAtCandle(candles, i, tf, lastPivots);
                if (pivot) {
                    pivots.push(pivot);
                    // console.log(`${colors.yellow}[${tf.interval}] PIVOT DETECTED: ${pivot.type.toUpperCase()} at ${new Date(pivot.time).toLocaleString()} - Price: $${pivot.price.toFixed(2)} - Signal: ${pivot.signal.toUpperCase()}${colors.reset}`);
                }
            }
            
            detector.pivotHistory.set(tf.interval, pivots);
            console.log(`${colors.green}[${tf.interval}] Detected ${pivots.length} pivots using fronttester logic${colors.reset}`);
        }
        
        console.log(`${colors.green}✅ Multi-timeframe system initialized successfully${colors.reset}`);
        
        const totalPivots = multiPivotConfig.timeframes.reduce((sum, tf) => {
            const pivots = detector.pivotHistory.get(tf.interval) || [];
            return sum + pivots.length;
        }, 0);
        
        console.log(`${colors.cyan}Total pivots detected across all timeframes: ${colors.yellow}${totalPivots}${colors.reset}`);
        
        multiPivotConfig.timeframes.forEach(tf => {
            const pivots = detector.pivotHistory.get(tf.interval) || [];
            console.log(`  ${colors.yellow}${tf.interval.padEnd(4)}${colors.reset}: ${colors.green}${pivots.length.toString().padStart(4)}${colors.reset} pivots`);
        });
        
    } catch (error) {
        console.error(`${colors.red}Failed to initialize multi-timeframe system:${colors.reset}`, error);
        process.exit(1);
    }

    // Get 1-minute candles for trade execution
    const oneMinuteCandles = detector.timeframeData.get('1m') || [];
    if (oneMinuteCandles.length === 0) {
        console.error(`${colors.red}No 1-minute candles available for trade execution${colors.reset}`);
        process.exit(1);
    }

    console.log(`${colors.green}Successfully loaded ${oneMinuteCandles.length} 1-minute candles for trade execution${colors.reset}`);

    // Start backtesting with cascade confirmation and trade execution
    console.log(`\n${colors.cyan}=== STARTING MULTI-TIMEFRAME BACKTESTING WITH TRADES ===${colors.reset}`);
    
    let totalSignals = 0;
    let confirmedSignals = 0;
    let cascadeNumber = 0;
    
    // Trade state initialization
    let capital = tradeConfig.initialCapital;
    const trades = [];
    const openTrades = [];
    
    // Get all pivots from the primary timeframe
    const primaryTimeframe = multiPivotConfig.timeframes[0];
    const primaryPivots = detector.pivotHistory.get(primaryTimeframe.interval) || [];
    
    console.log(`${colors.yellow}Processing ${primaryPivots.length} primary signals from ${primaryTimeframe.interval} timeframe${colors.reset}`);
    
    // Process each primary pivot for cascade confirmation and trading
    for (const primaryPivot of primaryPivots) {
        totalSignals++;
        
        // FIRST: Monitor existing trades using 1-minute candles (close trades before processing new cascades)
        for (let j = openTrades.length - 1; j >= 0; j--) {
            const trade = openTrades[j];
            let tradeClosed = false;
            let exitPrice = null;
            let result = '';
            let finalTradeCandle = null;
            
            // Find relevant 1-minute candles for this trade
            const tradeStartIndex = oneMinuteCandles.findIndex(candle => candle.time >= trade.entryTime);
            const currentPivotTime = primaryPivot.time;
            const tradeEndIndex = oneMinuteCandles.findIndex(candle => candle.time >= currentPivotTime);
            
            if (tradeStartIndex !== -1 && tradeEndIndex !== -1) {
                const relevantCandles = oneMinuteCandles.slice(tradeStartIndex, tradeEndIndex + 1);
                
                for (const tradeCandle of relevantCandles) {
                    // Update max favorable/unfavorable movements
                    if (trade.type === 'long') {
                        const currentFavorable = (tradeCandle.high - trade.entryPrice) / trade.entryPrice * 100;
                        const currentUnfavorable = (trade.entryPrice - tradeCandle.low) / trade.entryPrice * 100;
                        
                        trade.maxFavorable = Math.max(trade.maxFavorable, currentFavorable);
                        trade.maxUnfavorable = Math.min(trade.maxUnfavorable, currentUnfavorable);
                    } else {
                        const currentFavorable = (trade.entryPrice - tradeCandle.low) / trade.entryPrice * 100;
                        const currentUnfavorable = (trade.entryPrice - tradeCandle.high) / trade.entryPrice * 100;
                        
                        trade.maxFavorable = Math.max(trade.maxFavorable, currentFavorable);
                        trade.maxUnfavorable = Math.min(trade.maxUnfavorable, currentUnfavorable);
                    }

                    // Check timeout
                    if (tradeConfig.maxTradeTimeMinutes > 0) {
                        const tradeTimeMs = tradeCandle.time - trade.entryTime;
                        const tradeTimeMinutes = tradeTimeMs / (1000 * 60);
                        
                        if (tradeTimeMinutes >= tradeConfig.maxTradeTimeMinutes) {
                            tradeClosed = true;
                            exitPrice = tradeCandle.close;
                            result = 'TIMEOUT';
                            finalTradeCandle = tradeCandle;
                            break;
                        }
                    }

                    // Advanced TP/SL with Trailing Stop Logic
                    if (!tradeClosed) {
                        if (trade.type === 'long') {
                            // Update best price for long trades
                            if (tradeCandle.high > trade.bestPrice) {
                                trade.bestPrice = tradeCandle.high;
                                
                                // Check if we should activate trailing stop
                                if (tradeConfig.enableTrailingStop && !trade.trailingStopActive) {
                                    const currentProfitPct = ((trade.bestPrice - trade.entryPrice) / trade.entryPrice) * 100;
                                    if (currentProfitPct > 0) { // Activate trailing stop when in profit
                                        trade.trailingStopActive = true;
                                    }
                                }
                                
                                // Check if we should activate trailing take profit
                                if (tradeConfig.enableTrailingTakeProfit && !trade.trailingTakeProfitActive) {
                                    const currentProfitPct = ((trade.bestPrice - trade.entryPrice) / trade.entryPrice) * 100;
                                    if (currentProfitPct >= tradeConfig.trailingTakeProfitTrigger) {
                                        trade.trailingTakeProfitActive = true;
                                    }
                                }
                                
                                // Update trailing stop price
                                if (trade.trailingStopActive) {
                                    const newTrailingStop = trade.bestPrice * (1 - (tradeConfig.trailingStopDistance / 100));
                                    trade.trailingStopPrice = Math.max(trade.trailingStopPrice, newTrailingStop);
                                }
                                
                                // Update trailing take profit price
                                if (trade.trailingTakeProfitActive) {
                                    const newTrailingTP = trade.bestPrice * (1 - (tradeConfig.trailingTakeProfitDistance / 100));
                                    trade.trailingTakeProfitPrice = Math.max(trade.trailingTakeProfitPrice, newTrailingTP);
                                }
                            }
                            
                            // Check for exits
                            // First check trailing take profit (if active)
                            if (trade.trailingTakeProfitActive && tradeCandle.low <= trade.trailingTakeProfitPrice) {
                                tradeClosed = true;
                                exitPrice = trade.trailingTakeProfitPrice;
                                result = 'TRAILING_TP';
                                finalTradeCandle = tradeCandle;
                                break;
                            }
                            // Then check regular take profit (if trailing TP not active)
                            else if (!trade.trailingTakeProfitActive && tradeCandle.high >= trade.takeProfitPrice) {
                                tradeClosed = true;
                                exitPrice = trade.takeProfitPrice;
                                result = 'TP';
                                finalTradeCandle = tradeCandle;
                                break;
                            }
                            // Check trailing stop loss (if active)
                            else if (trade.trailingStopActive && tradeCandle.low <= trade.trailingStopPrice) {
                                tradeClosed = true;
                                exitPrice = trade.trailingStopPrice;
                                result = 'TRAILING_SL';
                                finalTradeCandle = tradeCandle;
                                break;
                            }
                            // Check regular stop loss (if trailing stop not active)
                            else if (!trade.trailingStopActive && tradeCandle.low <= trade.stopLossPrice) {
                                tradeClosed = true;
                                exitPrice = trade.stopLossPrice;
                                result = 'SL';
                                finalTradeCandle = tradeCandle;
                                break;
                            }
                        } else { // SHORT TRADES
                            // Update best price for short trades (lower is better)
                            if (tradeCandle.low < trade.bestPrice) {
                                trade.bestPrice = tradeCandle.low;
                                
                                // Check if we should activate trailing stop
                                if (tradeConfig.enableTrailingStop && !trade.trailingStopActive) {
                                    const currentProfitPct = ((trade.entryPrice - trade.bestPrice) / trade.entryPrice) * 100;
                                    if (currentProfitPct > 0) { // Activate trailing stop when in profit
                                        trade.trailingStopActive = true;
                                    }
                                }
                                
                                // Check if we should activate trailing take profit
                                if (tradeConfig.enableTrailingTakeProfit && !trade.trailingTakeProfitActive) {
                                    const currentProfitPct = ((trade.entryPrice - trade.bestPrice) / trade.entryPrice) * 100;
                                    if (currentProfitPct >= tradeConfig.trailingTakeProfitTrigger) {
                                        trade.trailingTakeProfitActive = true;
                                    }
                                }
                                
                                // Update trailing stop price
                                if (trade.trailingStopActive) {
                                    const newTrailingStop = trade.bestPrice * (1 + (tradeConfig.trailingStopDistance / 100));
                                    trade.trailingStopPrice = Math.min(trade.trailingStopPrice, newTrailingStop);
                                }
                                
                                // Update trailing take profit price
                                if (trade.trailingTakeProfitActive) {
                                    const newTrailingTP = trade.bestPrice * (1 + (tradeConfig.trailingTakeProfitDistance / 100));
                                    trade.trailingTakeProfitPrice = Math.min(trade.trailingTakeProfitPrice, newTrailingTP);
                                }
                            }
                            
                            // Check for exits
                            // First check trailing take profit (if active)
                            if (trade.trailingTakeProfitActive && tradeCandle.low <= trade.trailingTakeProfitPrice) {
                                tradeClosed = true;
                                exitPrice = trade.trailingTakeProfitPrice;
                                result = 'TRAILING_TP';
                                finalTradeCandle = tradeCandle;
                                break;
                            }
                            // Then check regular take profit (if trailing TP not active)
                            else if (!trade.trailingTakeProfitActive && tradeCandle.low <= trade.takeProfitPrice) {
                                tradeClosed = true;
                                exitPrice = trade.takeProfitPrice;
                                result = 'TP';
                                finalTradeCandle = tradeCandle;
                                break;
                            }
                            // Check trailing stop loss (if active)
                            else if (trade.trailingStopActive && tradeCandle.high >= trade.trailingStopPrice) {
                                tradeClosed = true;
                                exitPrice = trade.trailingStopPrice;
                                result = 'TRAILING_SL';
                                finalTradeCandle = tradeCandle;
                                break;
                            }
                            // Check regular stop loss (if trailing stop not active)
                            else if (!trade.trailingStopActive && tradeCandle.high >= trade.stopLossPrice) {
                                tradeClosed = true;
                                exitPrice = trade.stopLossPrice;
                                result = 'SL';
                                finalTradeCandle = tradeCandle;
                                break;
                            }
                        }
                    }
                }
            }

            if (tradeClosed && finalTradeCandle) {
                const exitSlippage = calculateSlippage(trade.size, tradeConfig);
                const slippageAdjustedExitPrice = applySlippage(exitPrice, trade.type, exitSlippage);
                
                const fundingCost = calculateFundingRate(
                    tradeConfig, 
                    finalTradeCandle.time, 
                    trade.entryTime, 
                    trade.size, 
                    tradeConfig.leverage
                );
                
                const pnlPct = (trade.type === 'long' 
                    ? (slippageAdjustedExitPrice - trade.entryPrice) / trade.entryPrice 
                    : (trade.entryPrice - slippageAdjustedExitPrice) / trade.entryPrice) * tradeConfig.leverage;
                const grossPnl = trade.size * pnlPct;
                const tradingFee = (trade.size * tradeConfig.leverage * (tradeConfig.totalMakerFee / 100));
                const pnl = grossPnl - tradingFee - fundingCost;
                
                capital += pnl;
                
                if (capital <= 0) {
                    capital = 0;
                    console.log(`  ${colors.red}${colors.bold}[LIQUIDATION] Account liquidated! Trading stopped.${colors.reset}`);
                }

                const tradeType = trade.type.toUpperCase();
                const pnlColor = pnl >= 0 ? colors.green : colors.red;
                const pnlText = `${pnlColor}${pnl >= 0 ? '+' : ''}${formatNumberWithCommas(pnl)}${colors.reset}`;
                
                if (tradeConfig.showTradeDetails) {
                    console.log(`  \x1b[35;1m└─> [${result}] ${tradeType} trade closed @ ${formatNumberWithCommas(exitPrice)}. PnL: ${pnlText}${colors.reset}`);
                }

                trades.push({
                    ...trade,
                    exitPrice: slippageAdjustedExitPrice,
                    originalExitPrice: exitPrice,
                    exitTime: finalTradeCandle.time,
                    status: 'closed',
                    result,
                    grossPnl,
                    pnl,
                    tradingFee,
                    fundingCost,
                    exitSlippage: exitSlippage * 100,
                    capitalAfter: capital
                });
                
                openTrades.splice(j, 1);
            }
        }
        
        // SECOND: Check for window-based cascade confirmation (realistic approach)
        const cascadeResult = checkWindowBasedCascade(primaryPivot, detector, oneMinuteCandles, multiPivotConfig);
        
        const logging = multiPivotConfig.debug.cascadeLogging;
        
        if (cascadeResult) {
            confirmedSignals++;
            cascadeNumber++;
            
            const confirmationCount = cascadeResult.confirmations.length + 1;
            const shouldShow = logging.enabled && 
                              confirmationCount >= logging.minConfirmationsToShow;
            
            if (!tradeConfig.hideCascades && shouldShow && logging.showDetails.confirmedSignalSummary) {
                const primaryTime12 = new Date(primaryPivot.time).toLocaleString();
                const primaryTime24Only = new Date(primaryPivot.time).toLocaleTimeString('en-GB', { hour12: false });
                const executionTime12 = new Date(cascadeResult.executionTime).toLocaleString();
                const executionTime24Only = new Date(cascadeResult.executionTime).toLocaleTimeString('en-GB', { hour12: false });
                const confirmingTFs = cascadeResult.confirmations.map(c => c.timeframe).join(', ');
                
                console.log(`${colors.green}🎯 CASCADE #${cascadeNumber} CONFIRMED: ${primaryPivot.signal.toUpperCase()}${colors.reset}`);
                console.log(`${colors.cyan}   Primary: ${primaryTime12} (${primaryTime24Only}) | Execution: ${executionTime12} (${executionTime24Only}) (+${cascadeResult.minutesAfterPrimary}min)${colors.reset}`);
                console.log(`${colors.cyan}   Entry Price: ${(cascadeResult.executionPrice)} | Strength: ${(cascadeResult.strength * 100).toFixed(0)}% | Confirming TFs: ${confirmingTFs}${colors.reset}`);
            }
            
            // TRADE EXECUTION LOGIC
            let shouldOpenTrade = false;
            let tradeType = null;
            
            if (primaryPivot.signal === 'long') {
                // Long signal from cascade
                if (tradeConfig.direction === 'buy' || tradeConfig.direction === 'both') {
                    shouldOpenTrade = true;
                    tradeType = 'long';
                } else if (tradeConfig.direction === 'alternate') {
                    shouldOpenTrade = true;
                    tradeType = 'short';
                }
            } else if (primaryPivot.signal === 'short') {
                // Short signal from cascade
                if (tradeConfig.direction === 'sell' || tradeConfig.direction === 'both') {
                    shouldOpenTrade = true;
                    tradeType = 'short';
                } else if (tradeConfig.direction === 'alternate') {
                    shouldOpenTrade = true;
                    tradeType = 'long';
                }
            }
            
            if (shouldOpenTrade && capital > 0) {
                // If flip mode is enabled, first close opposite trades at execution time
                if (tradeConfig.switchOnOppositeSignal) {
                    const oppositeType = (tradeType === 'long') ? 'short' : 'long';
                    // Determine execution candle for accurate close price
                    const execTime = cascadeResult.executionTime;
                    const executionCandle = oneMinuteCandles.find(c => Math.abs(c.time - execTime) <= 30000);
                    const flipExitPriceRaw = executionCandle ? executionCandle.close : cascadeResult.executionPrice;

                    for (let j = openTrades.length - 1; j >= 0; j--) {
                        const t = openTrades[j];
                        if (t.type !== oppositeType) continue;

                        // Compute slippage-adjusted exit
                        const exitSlippage = calculateSlippage(t.size, tradeConfig);
                        const slippageAdjustedExitPrice = applySlippage(flipExitPriceRaw, t.type, exitSlippage);

                        // Funding up to execution time
                        const fundingCost = calculateFundingRate(
                            tradeConfig,
                            execTime,
                            t.entryTime,
                            t.size,
                            tradeConfig.leverage
                        );

                        const pnlPct = (t.type === 'long'
                            ? (slippageAdjustedExitPrice - t.entryPrice) / t.entryPrice
                            : (t.entryPrice - slippageAdjustedExitPrice) / t.entryPrice) * tradeConfig.leverage;
                        const grossPnl = t.size * pnlPct;
                        const tradingFee = (t.size * tradeConfig.leverage * (tradeConfig.totalMakerFee / 100));
                        const pnl = grossPnl - tradingFee - fundingCost;

                        capital += pnl;
                        if (capital <= 0) {
                            capital = 0;
                            console.log(`  ${colors.red}${colors.bold}[LIQUIDATION] Account liquidated! Trading stopped.${colors.reset}`);
                        }

                        if (tradeConfig.showTradeDetails) {
                            const tradeTypeLabel = t.type.toUpperCase();
                            const pnlColor = pnl >= 0 ? colors.green : colors.red;
                            const pnlText = `${pnlColor}${pnl >= 0 ? '+' : ''}${formatNumberWithCommas(pnl)}${colors.reset}`;
                            console.log(`  \x1b[35;1m└─> [FLIP] ${tradeTypeLabel} trade closed @ ${formatNumberWithCommas(flipExitPriceRaw)}. PnL: ${pnlText}${colors.reset}`);
                        }

                        trades.push({
                            ...t,
                            exitPrice: slippageAdjustedExitPrice,
                            originalExitPrice: flipExitPriceRaw,
                            exitTime: execTime,
                            status: 'closed',
                            result: 'FLIP',
                            grossPnl,
                            pnl,
                            tradingFee,
                            fundingCost,
                            exitSlippage: exitSlippage * 100,
                            capitalAfter: capital
                        });

                        openTrades.splice(j, 1);
                    }
                }

                // Ignore same-direction signal if a same-direction trade is already open
                const hasSameDirectionOpen = openTrades.some(t => t.type === tradeType);
                if (hasSameDirectionOpen) {
                    // Do not open another same-direction trade
                } else if (openTrades.length < tradeConfig.maxConcurrentTrades) {
                    const usedCapital = openTrades.reduce((sum, trade) => sum + trade.size, 0);
                    const availableCapital = capital - usedCapital;
                    
                    let tradeSize = 0;
                    if (tradeConfig.positionSizingMode === 'fixed' && tradeConfig.amountPerTrade) {
                        tradeSize = Math.min(tradeConfig.amountPerTrade, availableCapital);
                    } else if (tradeConfig.positionSizingMode === 'minimum' && tradeConfig.minimumTradeAmount) {
                        const percentageAmount = availableCapital * (tradeConfig.riskPerTrade / 100);
                        tradeSize = Math.max(percentageAmount, Math.min(tradeConfig.minimumTradeAmount, availableCapital));
                    } else {
                        tradeSize = availableCapital * (tradeConfig.riskPerTrade / 100);
                    }
                    
                    if (tradeSize > 0) {
                        const trade = createTrade(tradeType, cascadeResult, tradeSize, tradeConfig.takeProfit, tradeConfig.stopLoss);
                        openTrades.push(trade);
                        
                        if (tradeConfig.showLimits) {
                            const tradeLabel = tradeType.toUpperCase();
                            console.log(`  ${colors.yellow}└─> [${tradeLabel}] Entry: ${formatNumberWithCommas(trade.entryPrice)} | Size: ${formatNumberWithCommas(trade.size)} | TP: ${formatNumberWithCommas(trade.takeProfitPrice)} | SL: ${formatNumberWithCommas(trade.stopLossPrice)}${colors.reset}`);
                        }
                    }
                }
            }
            
        } else {
            cascadeNumber++;
            
            if (!tradeConfig.hideCascades && logging.enabled && logging.showAllCascades) {
                const failedTime12 = new Date(primaryPivot.time).toLocaleString();
                const failedTime24Only = new Date(primaryPivot.time).toLocaleTimeString('en-GB', { hour12: false });
                console.log(`${colors.red}✗ CASCADE #${cascadeNumber} FAILED: ${primaryPivot.signal} from ${primaryTimeframe.interval} at ${failedTime12} (${failedTime24Only})${colors.reset}`);
            }
        }
        
        // Progress indicator
        if (!tradeConfig.hideCascades && logging.showProgress && (totalSignals % logging.showProgressEvery === 0 || totalSignals <= 10)) {
            const progress = ((totalSignals / primaryPivots.length) * 100).toFixed(1);
            console.log(`${colors.cyan}Progress: ${progress}% (${totalSignals}/${primaryPivots.length} primary signals processed)${colors.reset}`);
        }
    }

    // Close remaining open trades
    if (openTrades.length > 0) {
        const endPrice = oneMinuteCandles[oneMinuteCandles.length - 1].close;

        
        console.log(`\n${colors.yellow}Closing ${openTrades.length} open trade${openTrades.length > 1 ? 's' : ''} at end of backtest.${colors.reset}`);
        
        openTrades.forEach(trade => {
            const exitSlippage = calculateSlippage(trade.size, tradeConfig);
            const slippageAdjustedEndPrice = applySlippage(endPrice, trade.type, exitSlippage);
            
            const fundingCost = calculateFundingRate(
                tradeConfig, 
                oneMinuteCandles[oneMinuteCandles.length - 1].time, 
                trade.entryTime, 
                trade.size, 
                tradeConfig.leverage
            );
            
            const pnlPct = (trade.type === 'long' 
                ? (slippageAdjustedEndPrice - trade.entryPrice) / trade.entryPrice 
                : (trade.entryPrice - slippageAdjustedEndPrice) / trade.entryPrice) * tradeConfig.leverage;
            const grossPnl = trade.size * pnlPct;
            const tradingFee = (trade.size * tradeConfig.leverage * (tradeConfig.totalMakerFee / 100));
            const pnl = grossPnl - tradingFee - fundingCost;
            
            capital += pnl;
            
            if (capital <= 0) {
                capital = 0;
                console.log(`  ${colors.red}${colors.bold}[LIQUIDATION] Account liquidated!${colors.reset}`);
            }
            
            if (tradeConfig.showTradeDetails) {
                console.log(`  └─> [EOB] ${trade.type.toUpperCase()} trade closed @ ${formatNumberWithCommas(endPrice)}. PnL: ${(pnl >= 0 ? colors.green : colors.red)}${formatNumberWithCommas(pnl)}${colors.reset}`);
            }
            
            trades.push({
                ...trade,
                exitPrice: slippageAdjustedEndPrice,
                originalExitPrice: endPrice,
                exitTime: oneMinuteCandles[oneMinuteCandles.length - 1].time,
                status: 'closed',
                result: 'EOB',
                grossPnl,
                pnl,
                tradingFee,
                fundingCost,
                exitSlippage: exitSlippage * 100,
                capitalAfter: capital
            });
        });
        
        openTrades.length = 0;
    }

   

    // Trade summary
    if (trades.length > 0) {
         // Only display trade details if showTradeDetails is enabled
         if (tradeConfig.showTradeDetails) {
            // Display detailed trade information
            console.log(`\n${colors.cyan}--- Trade Details ---${colors.reset}`);
            console.log('--------------------------------------------------------------------------------');
            
            trades.forEach((trade, index) => {
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
                const pnlPct = ((trade.pnl / trade.size) * 100).toFixed(2);
                
                // Format the trade header - entire line in result color
                console.log(`${resultColor}[TRADE ${(index + 1).toString().padStart(2, ' ')}] ${trade.type.toUpperCase()} | P&L: ${pnlPct}% | ${resultText} | Result: ${trade.result}${colors.reset}`);
                console.log();
                console.log(`${colors.cyan}  Entry: ${entryDateStr} at $${trade.entryPrice.toFixed(2)}${colors.reset}`);
                console.log(`${colors.cyan}  Exit:  ${exitDateStr} at $${trade.exitPrice.toFixed(2)}${colors.reset}`);
                console.log(`${colors.cyan}  Duration: ${durationStr}${colors.reset}`);
                
                // Add trade amount, loss, and remainder information
                const tradeAmount = trade.size;
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
                
                // Display maximum favorable and unfavorable movements
                const favorableColor = trade.maxFavorable >= 0 ? colors.green : colors.red;
                const unfavorableColor = trade.maxUnfavorable >= 0 ? colors.green : colors.red;
                console.log(`  Max Favorable Movement: ${favorableColor}${trade.maxFavorable.toFixed(4)}%${colors.reset}`);
                console.log(`  Max Unfavorable Movement: ${unfavorableColor}${trade.maxUnfavorable.toFixed(4)}%${colors.reset}`);
                
                // Add price movement information
                const priceDiff = trade.exitPrice - trade.entryPrice;
                const priceDiffPct = (priceDiff / trade.entryPrice * 100).toFixed(4);
                const priceColor = priceDiff >= 0 ? colors.green : colors.red;
                console.log(`  Price Movement: ${priceColor}${priceDiff > 0 ? '+' : ''}${priceDiffPct}%${colors.reset} (${priceColor}$${formatNumberWithCommas(priceDiff)}${colors.reset})`);
                
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
                        const slippageDiff = trade.originalExitPrice - trade.exitPrice;
                        const slippageDiffColor = slippageDiff >= 0 ? colors.red : colors.green;
                        console.log(`  Exit Price Impact: $${formatNumberWithCommas(trade.originalExitPrice)} → $${formatNumberWithCommas(trade.exitPrice)} (${slippageDiffColor}${slippageDiff > 0 ? '-' : '+'}$${formatNumberWithCommas(Math.abs(slippageDiff))}${colors.reset})`);
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
                        const trailingStopTriggered = trade.result === 'TRAILING_SL';
                        const trailingStopColor = trailingStopTriggered ? colors.red : colors.yellow;
                        console.log(`    ${trailingStopColor}• Trailing SL: ${trailingStopTriggered ? 'TRIGGERED' : 'ACTIVE'} at $${formatNumberWithCommas(trade.trailingStopPrice)}${colors.reset}`);
                    }
                    
                    if (trade.trailingTakeProfitActive) {
                        const trailingTPTriggered = trade.result === 'TRAILING_TP';
                        const trailingTPColor = trailingTPTriggered ? colors.green : colors.yellow;
                        console.log(`    ${trailingTPColor}• Trailing TP: ${trailingTPTriggered ? 'TRIGGERED' : 'ACTIVE'} at $${formatNumberWithCommas(trade.trailingTakeProfitPrice)}${colors.reset}`);
                    }
                    
                    // Show best price achieved
                    const bestPriceColor = trade.type === 'long' ? 
                        (trade.bestPrice > trade.entryPrice ? colors.green : colors.red) :
                        (trade.bestPrice < trade.entryPrice ? colors.green : colors.red);
                    console.log(`    ${bestPriceColor}• Best Price: $${formatNumberWithCommas(trade.bestPrice)}${colors.reset}`);
                    
                    // Show original vs trailing prices
                    console.log(`    ${colors.cyan}• Original TP/SL: $${formatNumberWithCommas(trade.originalTakeProfitPrice)} / $${formatNumberWithCommas(trade.originalStopLossPrice)}${colors.reset}`);
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
        const winningTrades = trades.filter(t => t.pnl > 0);
        const losingTrades = trades.filter(t => t.pnl <= 0);
        const winRate = ((winningTrades.length / trades.length) * 100).toFixed(1);
        
        const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0);
        const totalReturn = ((totalPnl / tradeConfig.initialCapital) * 100).toFixed(2);
        
        console.log(`\n${colors.cyan}--- Trading Performance ---${colors.reset}`);
        console.log(`${colors.yellow}Total Trades: ${colors.green}${trades.length}${colors.reset}`);
        console.log(`${colors.yellow}Winning Trades: ${colors.green}${winningTrades.length}${colors.reset}`);
        console.log(`${colors.yellow}Losing Trades: ${colors.red}${losingTrades.length}${colors.reset}`);
        console.log(`${colors.yellow}Win Rate: ${colors.green}${winRate}%${colors.reset}`);
        console.log(`${colors.yellow}Total P&L: ${totalPnl >= 0 ? colors.green : colors.red}${formatNumberWithCommas(totalPnl)} USDT${colors.reset}`);
        console.log(`${colors.yellow}Total Return: ${totalReturn >= 0 ? colors.green : colors.red}${formatNumberWithCommas(parseFloat(totalReturn))}%${colors.reset}`);
        console.log(`${colors.yellow}Final Capital: ${capital >= 0 ? colors.green : colors.red}${formatNumberWithCommas(capital)} USDT${colors.reset}`);
        
       
    }


     // Display results summary
     console.log(`\n${colors.cyan}=== BACKTESTING RESULTS SUMMARY ===${colors.reset}`);
     console.log(`${colors.yellow}Total Primary Signals: ${colors.green}${totalSignals}${colors.reset}`);
     console.log(`${colors.yellow}Confirmed Cascade Signals: ${colors.green}${confirmedSignals}${colors.reset}`);
     
     if (totalSignals > 0) {
         const confirmationRate = ((confirmedSignals / totalSignals) * 100).toFixed(1);
         console.log(`${colors.yellow}Cascade Confirmation Rate: ${colors.green}${confirmationRate}%${colors.reset}`);
     }
    
    const dataStartTime = oneMinuteCandles[0].time;
    const dataEndTime = oneMinuteCandles[oneMinuteCandles.length - 1].time;
    const totalHours = (dataEndTime - dataStartTime) / (1000 * 60 * 60);
    const signalsPerDay = totalSignals > 0 ? ((totalSignals / totalHours) * 24).toFixed(2) : '0';
    const confirmedSignalsPerDay = confirmedSignals > 0 ? ((confirmedSignals / totalHours) * 24).toFixed(2) : '0';
    
    console.log(`${colors.yellow}Primary Signal Frequency: ${colors.green}${signalsPerDay} signals/day${colors.reset}`);
    console.log(`${colors.yellow}Confirmed Signal Frequency: ${colors.green}${confirmedSignalsPerDay} confirmed/day${colors.reset}`);
    
    const dataSpanDays = (totalHours / 24).toFixed(1);
    console.log(`${colors.cyan}Data Timespan: ${dataSpanDays} days${colors.reset}`);

    console.log(`\n${colors.cyan}--- Multi-Timeframe Backtesting Complete ---${colors.reset}`);
}

// Run the backtester
(async () => {
    try {
        await runMultiTimeframeBacktest();
    } catch (err) {
        console.error('\nAn error occurred during backtesting:', err);
        process.exit(1);
    }
})();
