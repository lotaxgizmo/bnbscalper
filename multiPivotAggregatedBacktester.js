// multiPivotAggregatedBacktester.js
// 1m-aggregated multi-timeframe pivot backtester with immediate market order execution
// Uses CandleAggregator to build higher timeframes from 1m candles for real-time pivot detection

import {
    symbol,
    time as interval,
    useLocalData,
    api,
    pivotDetectionMode
} from './config/config.js';

import { tradeConfig } from './config/tradeconfig.js';
import { multiPivotConfig } from './config/multiPivotConfig.js';
import { CandleAggregator } from './zaggregator/candleAggregator.js';
import { getCandles } from './apis/bybit.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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

// Utility functions
const formatNumberWithCommas = (num) => {
    if (typeof num !== 'number') return num;
    return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

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

// Load 1m candles from local CSV or API
async function load1mCandles() {
    console.log(`${colors.cyan}Loading 1m candles...${colors.reset}`);
    
    if (useLocalData) {
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
        
        console.log(`${colors.green}Loaded ${candles.length} 1m candles from CSV${colors.reset}`);
        return candles;
    } else {
        // Load from API
        const limit = 43200; // ~30 days of 1m candles
        const candles = await getCandles(symbol, '1m', limit);
        console.log(`${colors.green}Loaded ${candles.length} 1m candles from API${colors.reset}`);
        return candles.sort((a, b) => a.time - b.time);
    }
}

// Pivot detection function adapted for aggregated candles
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
    
    return {
        type: pivotType,
        price: pivotPrice,
        time: currentCandle.time,
        index: index,
        signal: pivotType === 'high' ? 'short' : 'long' // Inverted signals per memory
    };
}

// Check for cascade confirmation across timeframes
function checkCascadeConfirmation(primaryPivot, aggregator, currentTime) {
    const confirmations = [];
    
    // Get timeframes from config (excluding primary)
    const primaryTF = multiPivotConfig.timeframes.find(tf => tf.role === 'primary');
    const timeframes = multiPivotConfig.timeframes
        .filter(tf => tf.role !== 'primary')
        .sort((a, b) => {
            const aMs = parseTimeframeToMs(a.interval);
            const bMs = parseTimeframeToMs(b.interval);
            return bMs - aMs; // Largest to smallest
        });
    
    for (const tfConfig of timeframes) {
        // Get both active (forming) and last closed candles
        const activeTF = aggregator.getActive(tfConfig.interval);
        const lastClosedTF = aggregator.getLastClosed(tfConfig.interval);
        
        // Build series for pivot detection (last closed + active if exists)
        const tfSeries = [];
        if (lastClosedTF) tfSeries.push(lastClosedTF);
        if (activeTF) tfSeries.push(activeTF);
        
        if (tfSeries.length < tfConfig.lookback + 1) continue;
        
        // Check for pivot in the most recent candle (active or last closed)
        const latestIndex = tfSeries.length - 1;
        const pivot = detectPivot(tfSeries, latestIndex, {
            pivotLookback: tfConfig.lookback,
            minSwingPct: tfConfig.minSwingPct,
            minLegBars: tfConfig.minLegBars
        });
        
        if (pivot && pivot.signal === primaryPivot.signal) {
            // Check timing constraints
            const timeDiff = Math.abs(currentTime - pivot.time);
            const maxAge = tfConfig.role === 'execution' ? 60000 : 300000; // 1min for execution, 5min for confirmation
            
            if (timeDiff <= maxAge) {
                confirmations.push({
                    timeframe: tfConfig.interval,
                    pivot: pivot,
                    role: tfConfig.role,
                    confirmTime: pivot.time
                });
            }
        }
    }
    
    return confirmations;
}

// Check if cascade meets execution requirements
function meetsExecutionRequirements(confirmations, config) {
    const executionTFs = confirmations.filter(c => c.role === 'execution');
    const confirmationTFs = confirmations.filter(c => c.role === 'confirmation');
    
    // Need at least minimum confirmations
    if (confirmations.length < config.cascadeSettings.minTimeframesRequired) {
        return false;
    }
    
    // Execution timeframes can't confirm without confirmation timeframes (door logic)
    if (executionTFs.length > 0 && confirmationTFs.length === 0) {
        return false;
    }
    
    return true;
}

// Create and manage trades
function createTrade(type, pivot, tradeSize, currentTime) {
    const leverage = tradeConfig.leverage;
    const positionSize = tradeSize * leverage;
    
    const takeProfitPercent = tradeConfig.takeProfitPercent / 100;
    const stopLossPercent = tradeConfig.stopLossPercent / 100;
    
    let takeProfitPrice, stopLossPrice;
    
    if (type === 'long') {
        takeProfitPrice = pivot.price * (1 + takeProfitPercent);
        stopLossPrice = pivot.price * (1 - stopLossPercent);
    } else {
        takeProfitPrice = pivot.price * (1 - takeProfitPercent);
        stopLossPrice = pivot.price * (1 + stopLossPercent);
    }
    
    return {
        id: Date.now() + Math.random(),
        type: type,
        entryPrice: pivot.price,
        entryTime: currentTime,
        positionSize: positionSize,
        tradeSize: tradeSize,
        leverage: leverage,
        takeProfitPrice: takeProfitPrice,
        stopLossPrice: stopLossPrice,
        status: 'open',
        pnl: 0,
        exitPrice: null,
        exitTime: null,
        exitReason: null
    };
}

// Monitor and close trades
function monitorTrades(trades, currentCandle, currentTime) {
    const closedTrades = [];
    
    for (const trade of trades) {
        if (trade.status !== 'open') continue;
        
        let shouldClose = false;
        let exitReason = '';
        let exitPrice = null;
        
        if (trade.type === 'long') {
            if (currentCandle.high >= trade.takeProfitPrice) {
                shouldClose = true;
                exitReason = 'TP';
                exitPrice = trade.takeProfitPrice;
            } else if (currentCandle.low <= trade.stopLossPrice) {
                shouldClose = true;
                exitReason = 'SL';
                exitPrice = trade.stopLossPrice;
            }
        } else { // short
            if (currentCandle.low <= trade.takeProfitPrice) {
                shouldClose = true;
                exitReason = 'TP';
                exitPrice = trade.takeProfitPrice;
            } else if (currentCandle.high >= trade.stopLossPrice) {
                shouldClose = true;
                exitReason = 'SL';
                exitPrice = trade.stopLossPrice;
            }
        }
        
        if (shouldClose) {
            trade.status = 'closed';
            trade.exitPrice = exitPrice;
            trade.exitTime = currentTime;
            trade.exitReason = exitReason;
            
            // Calculate P&L
            if (trade.type === 'long') {
                trade.pnl = (exitPrice - trade.entryPrice) * trade.leverage * (trade.tradeSize / trade.entryPrice);
            } else {
                trade.pnl = (trade.entryPrice - exitPrice) * trade.leverage * (trade.tradeSize / trade.entryPrice);
            }
            
            closedTrades.push(trade);
        }
    }
    
    return closedTrades;
}

// Parse timeframe string to milliseconds (from aggregator)
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

// Main backtesting function
async function runAggregatedBacktest() {
    console.log(`${colors.cyan}=== 1m-Aggregated Multi-Timeframe Backtester ===${colors.reset}`);
    console.log(`${colors.yellow}Symbol: ${symbol}${colors.reset}`);
    const primaryTF = multiPivotConfig.timeframes.find(tf => tf.role === 'primary');
    console.log(`${colors.yellow}Primary Timeframe: ${primaryTF ? primaryTF.interval : 'Not found'}${colors.reset}`);
    console.log(`${colors.yellow}Data Source: ${useLocalData ? 'Local CSV' : 'API'}${colors.reset}`);
    
    // Load 1m candles
    const oneMinuteCandles = await load1mCandles();
    
    // Setup aggregator with all timeframes
    const timeframes = multiPivotConfig.timeframes.map(tf => tf.interval);
    const aggregator = new CandleAggregator(timeframes, { keepSeries: true });
    
    // Trading state
    let capital = tradeConfig.initialCapital;
    const allTrades = [];
    const openTrades = [];
    let totalSignals = 0;
    let confirmedSignals = 0;
    
    console.log(`${colors.cyan}\nStarting 1m-by-1m aggregated backtesting...${colors.reset}`);
    
    // Process each 1m candle
    for (let i = 0; i < oneMinuteCandles.length; i++) {
        const currentCandle = oneMinuteCandles[i];
        const currentTime = currentCandle.time;
        
        // Update aggregator with current 1m candle
        aggregator.update(currentCandle);
        
        // Monitor existing trades
        const closedTrades = monitorTrades(openTrades, currentCandle, currentTime);
        for (const closedTrade of closedTrades) {
            capital += closedTrade.pnl;
            
            const pnlColor = closedTrade.pnl >= 0 ? colors.green : colors.red;
            const pnlSign = closedTrade.pnl >= 0 ? '+' : '';
            console.log(`${colors.cyan}[${new Date(closedTrade.exitTime).toLocaleString()}] ${colors.yellow}${closedTrade.exitReason} ${closedTrade.type.toUpperCase()} @ $${closedTrade.exitPrice.toFixed(2)} | P&L: ${pnlColor}${pnlSign}${formatNumberWithCommas(closedTrade.pnl)} USDT${colors.reset} | Capital: $${formatNumberWithCommas(capital)}`);
        }
        
        // Remove closed trades from open trades
        for (let j = openTrades.length - 1; j >= 0; j--) {
            if (openTrades[j].status === 'closed') {
                openTrades.splice(j, 1);
            }
        }
        
        // Check for primary timeframe pivots
        const primaryTFConfig = multiPivotConfig.timeframes.find(tf => tf.role === 'primary');
        if (!primaryTFConfig) continue;
        
        // Get primary timeframe series (both closed and active)
        const primarySeries = [];
        const lastClosed = aggregator.getLastClosed(primaryTFConfig.interval);
        const active = aggregator.getActive(primaryTFConfig.interval);
        
        if (lastClosed) primarySeries.push(lastClosed);
        if (active) primarySeries.push(active);
        
        if (primarySeries.length < primaryTFConfig.lookback + 1) continue;
        
        // Check for pivot in most recent candle
        const latestIndex = primarySeries.length - 1;
        const primaryPivot = detectPivot(primarySeries, latestIndex, {
            pivotLookback: primaryTFConfig.lookback,
            minSwingPct: primaryTFConfig.minSwingPct,
            minLegBars: primaryTFConfig.minLegBars
        });
        
        if (primaryPivot) {
            totalSignals++;
            
            console.log(`${colors.magenta}[${new Date(currentTime).toLocaleString()}] Primary ${primaryTFConfig.interval} ${primaryPivot.type.toUpperCase()} pivot @ $${primaryPivot.price.toFixed(2)} (${primaryPivot.signal.toUpperCase()})${colors.reset}`);
            
            // Check for cascade confirmation
            const confirmations = checkCascadeConfirmation(primaryPivot, aggregator, currentTime);
            
            if (confirmations.length > 0) {
                console.log(`${colors.yellow}  Confirmations: ${confirmations.map(c => `${c.timeframe}(${c.role})`).join(', ')}${colors.reset}`);
                
                if (meetsExecutionRequirements(confirmations, multiPivotConfig)) {
                    confirmedSignals++;
                    
                    // Calculate trade size
                    let tradeSize;
                    switch (tradeConfig.positionSizing) {
                        case 'fixed':
                            tradeSize = tradeConfig.fixedTradeSize;
                            break;
                        case 'percentage':
                            tradeSize = capital * (tradeConfig.percentageOfCapital / 100);
                            break;
                        case 'minimum':
                            tradeSize = Math.max(tradeConfig.fixedTradeSize, capital * (tradeConfig.percentageOfCapital / 100));
                            break;
                        default:
                            tradeSize = tradeConfig.fixedTradeSize;
                    }
                    
                    // Create and execute trade
                    const trade = createTrade(primaryPivot.signal, primaryPivot, tradeSize, currentTime);
                    openTrades.push(trade);
                    allTrades.push(trade);
                    
                    console.log(`${colors.green}  ✅ CASCADE CONFIRMED - ${trade.type.toUpperCase()} @ $${trade.entryPrice.toFixed(2)} | Size: $${formatNumberWithCommas(trade.tradeSize)} | TP: $${trade.takeProfitPrice.toFixed(2)} | SL: $${trade.stopLossPrice.toFixed(2)}${colors.reset}`);
                } else {
                    console.log(`${colors.red}  ❌ Execution requirements not met${colors.reset}`);
                }
            } else {
                console.log(`${colors.red}  ❌ No confirmations found${colors.reset}`);
            }
        }
        
        // Progress indicator
        if (i % 1000 === 0) {
            const progress = ((i / oneMinuteCandles.length) * 100).toFixed(1);
            console.log(`${colors.cyan}Progress: ${progress}% (${i}/${oneMinuteCandles.length})${colors.reset}`);
        }
    }
    
    // Final results
    console.log(`\n${colors.cyan}=== BACKTESTING RESULTS ===${colors.reset}`);
    console.log(`${colors.yellow}Total Primary Signals: ${colors.green}${totalSignals}${colors.reset}`);
    console.log(`${colors.yellow}Confirmed Cascades: ${colors.green}${confirmedSignals}${colors.reset}`);
    console.log(`${colors.yellow}Total Trades: ${colors.green}${allTrades.length}${colors.reset}`);
    
    if (allTrades.length > 0) {
        const winningTrades = allTrades.filter(t => t.pnl > 0);
        const winRate = ((winningTrades.length / allTrades.length) * 100).toFixed(1);
        const totalPnl = allTrades.reduce((sum, t) => sum + t.pnl, 0);
        const totalReturn = ((totalPnl / tradeConfig.initialCapital) * 100).toFixed(2);
        
        console.log(`${colors.yellow}Win Rate: ${colors.green}${winRate}%${colors.reset}`);
        console.log(`${colors.yellow}Total P&L: ${totalPnl >= 0 ? colors.green : colors.red}${formatNumberWithCommas(totalPnl)} USDT${colors.reset}`);
        console.log(`${colors.yellow}Total Return: ${totalReturn >= 0 ? colors.green : colors.red}${formatNumberWithCommas(parseFloat(totalReturn))}%${colors.reset}`);
        console.log(`${colors.yellow}Final Capital: ${capital >= 0 ? colors.green : colors.red}${formatNumberWithCommas(capital)} USDT${colors.reset}`);
    }
    
    const dataSpan = (oneMinuteCandles[oneMinuteCandles.length - 1].time - oneMinuteCandles[0].time) / (1000 * 60 * 60 * 24);
    console.log(`${colors.cyan}Data Span: ${dataSpan.toFixed(1)} days${colors.reset}`);
    
    console.log(`\n${colors.cyan}--- 1m-Aggregated Backtesting Complete ---${colors.reset}`);
}

// Run the backtester
(async () => {
    try {
        await runAggregatedBacktest();
    } catch (err) {
        console.error('\nAn error occurred during backtesting:', err);
        process.exit(1);
    }
})();
