// pivotOptimizer.js
// Runs multiple backtests using different TP/SL combinations from optimizerConfig.js
// Uses CLOSE PRICES for pivot detection and trade execution

import {
    symbol,
    time as interval,
    limit,
    minSwingPct,
    pivotLookback,
    minLegBars,
    useEdges,
    useLocalData,
    pivotDetectionMode
} from './config/config.js'; 
import { tradeConfig } from './config/tradeconfig.js';
import { optimizerConfig } from './config/optimizerConfig.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import os from 'os';

// Get the directory name in a way that works with ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Paths for data sources
const CANDLES_WITH_EDGES_FILE = path.join(__dirname, 'data', 'BTCUSDT_1m_40320_candles_with_edges.json');
const CSV_DATA_FILE = path.join(__dirname, 'data', 'historical', symbol, `${interval}.csv`);
const MINUTE_CSV_DATA_FILE = path.join(__dirname, 'data', 'historical', symbol, '1m.csv');

// Ensure optimization directory exists
const OPTIMIZATION_DIR = path.join(__dirname, 'data', 'optimization');
if (!fs.existsSync(OPTIMIZATION_DIR)) {
    fs.mkdirSync(OPTIMIZATION_DIR, { recursive: true });
    console.log(`Created optimization directory: ${OPTIMIZATION_DIR}`);
}

const RESULTS_CSV_FILE = path.join(OPTIMIZATION_DIR, `optimization_results_${symbol}_${interval}_${new Date().toISOString().replace(/:/g, '-')}.csv`);

const colors = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    magenta: '\x1b[35m'
};

// Function to convert interval string to milliseconds
const intervalToMs = (interval) => {
    const unit = interval.slice(-1);
    const value = parseInt(interval.slice(0, -1));
    
    switch(unit) {
        case 'm': return value * 60 * 1000;             // minutes
        case 'h': return value * 60 * 60 * 1000;        // hours
        case 'd': return value * 24 * 60 * 60 * 1000;   // days
        case 'w': return value * 7 * 24 * 60 * 60 * 1000; // weeks
        default: return value * 60 * 1000;              // default to minutes
    }
};

// Get the candle duration based on the interval
const candleDurationMs = intervalToMs(interval);

// Function to load candles with pre-computed edges from JSON file
const loadCandlesWithEdges = (filePath) => {
    try {
        // Read the JSON file
        const jsonData = fs.readFileSync(filePath, 'utf8');
        const data = JSON.parse(jsonData);
        
        // Check if the data is an array (direct candles) or has a candles property
        let candles = Array.isArray(data) ? data : (data.candles || []);
        
        // Apply limit from config if available
        if (limit > 0 && candles.length > limit) {
            // console.log(`Limiting to ${limit} most recent candles out of ${candles.length} available`);
            candles = candles.slice(-limit); // Take the most recent candles based on limit
        }
        
        // console.log(`Loaded ${candles.length} candles with pre-computed edges from ${filePath}`);
        
        // Extract edges if available or use an empty object
        const edges = Array.isArray(data) ? {} : (data.edges || {});
        
        // Return both candles and edges
        return {
            candles: candles,
            edges: edges
        };
    } catch (error) {
        console.error(`Failed to load candles with edges from ${filePath}:`, error);
        process.exit(1);
    }
};

// Function to load candles from CSV file
const loadCandlesFromCSV = (filePath) => {
    try {
        // Check if the file exists
        if (!fs.existsSync(filePath)) {
            console.error(`CSV file not found: ${filePath}`);
            process.exit(1);
        }
        
        // Read the CSV file
        const fileContent = fs.readFileSync(filePath, 'utf8');
        const lines = fileContent
            .split('\n')
            .map(line => line.trim())
            .filter(line => line && line !== 'timestamp,open,high,low,close,volume');
        
        const candles = [];
        
        for (const line of lines) {
            const [time, open, high, low, close, volume] = line.split(',');
            
            const candle = {
                time: parseInt(time),
                open: parseFloat(open),
                high: parseFloat(high),
                low: parseFloat(low),
                close: parseFloat(close),
                volume: parseFloat(volume || '0')
            };
            
            // Validate the candle data
            if (!isNaN(candle.time) && 
                !isNaN(candle.open) && 
                !isNaN(candle.high) && 
                !isNaN(candle.low) && 
                !isNaN(candle.close)) {
                candles.push(candle);
            }
        }
        
        // Apply limit from config if available
        let filteredCandles = candles;
        if (limit > 0 && filteredCandles.length > limit) {
            // console.log(`Limiting to ${limit} most recent candles out of ${filteredCandles.length} available`);
            filteredCandles = filteredCandles.slice(-limit); // Take the most recent candles
        }
        
        // Sort by timestamp to ensure chronological order
        filteredCandles.sort((a, b) => a.time - b.time);
        
        // console.log(`Loaded ${filteredCandles.length} candles from CSV file: ${filePath}`);
        
        // Return candles and empty edges object
        return {
            candles: filteredCandles,
            edges: {}
        };
    } catch (error) {
        console.error(`Failed to load candles from CSV file ${filePath}:`, error);
        process.exit(1);
    }
};

// Function to load 1-minute candles from CSV file within a specific time range
const load1MinuteCandlesFromCSV = (filePath, startTime, endTime) => {
    try {
        // Check if the file exists
        if (!fs.existsSync(filePath)) {
            console.log(`1-minute CSV file not found: ${filePath}. Using pivot timeframe for trade execution.`);
            return [];
        }
        
        // Read the CSV file
        const fileContent = fs.readFileSync(filePath, 'utf8');
        const lines = fileContent
            .split('\n')
            .map(line => line.trim())
            .filter(line => line && line !== 'timestamp,open,high,low,close,volume');
        
        const candles = [];
        
        for (const line of lines) {
            const [time, open, high, low, close, volume] = line.split(',');
            
            const candle = {
                time: parseInt(time),
                open: parseFloat(open),
                high: parseFloat(high),
                low: parseFloat(low),
                close: parseFloat(close),
                volume: parseFloat(volume || '0')
            };
            
            // Validate the candle data and check if it's within the time range
            if (!isNaN(candle.time) && 
                !isNaN(candle.open) && 
                !isNaN(candle.high) && 
                !isNaN(candle.low) && 
                !isNaN(candle.close) &&
                candle.time >= startTime && 
                candle.time <= endTime) {
                candles.push(candle);
            }
        }
        
        // Sort by timestamp to ensure chronological order
        candles.sort((a, b) => a.time - b.time);
        
        console.log(`Loaded ${candles.length} 1-minute candles for trade execution`);
        
        return candles;
    } catch (error) {
        console.error(`Failed to load 1-minute candles from CSV file ${filePath}:`, error);
        return [];
    }
};

// Helper function to get pivot price based on detection mode
const getPivotPrice = (candle, pivotType) => {
    if (pivotDetectionMode === 'extreme') {
        return pivotType === 'high' ? candle.high : candle.low;
    } else {
        // Default to 'close' mode for backward compatibility
        return candle.close;
    }
};

// Helper function to detect pivots using configurable price detection
const detectPivot = (candles, i, pivotLookback, pivotType) => {
    let isPivot = true;
    
    for (let j = 1; j <= pivotLookback; j++) {
        if (pivotType === 'high') {
            if (getPivotPrice(candles[i], pivotType) <= getPivotPrice(candles[i - j], pivotType)) {
                isPivot = false;
                break;
            }
        } else { // low pivot
            if (getPivotPrice(candles[i], pivotType) >= getPivotPrice(candles[i - j], pivotType)) {
                isPivot = false;
                break;
            }
        }
    }
    
    return isPivot;
};

// Helper function to create a trade
const createTrade = (type, currentCandle, pivotData, i, tradeSize, tradeConfig) => {
    const entryPrice = currentCandle.close; // Use close price for trade entry
    // Use the provided trade size directly instead of calculating from capital
    const size = tradeSize;
    
    // Calculate TP/SL differently based on trade type
    const takeProfitPrice = type === 'long'
        ? entryPrice * (1 + (tradeConfig.takeProfit / 100))
        : entryPrice * (1 - (tradeConfig.takeProfit / 100));
        
    const stopLossPrice = type === 'long'
        ? entryPrice * (1 - (tradeConfig.stopLoss / 100))
        : entryPrice * (1 + (tradeConfig.stopLoss / 100));

    return {
        type,
        entryPrice,
        entryTime: currentCandle.time,
        entryIndex: i,
        size,
        status: 'open',
        takeProfitPrice,
        stopLossPrice,
        pivot: { ...pivotData },  // Create a copy to avoid reference issues
        maxFavorable: 0,  // Track maximum favorable price movement
        maxUnfavorable: 0  // Track maximum unfavorable price movement
    };
};

// Function to get edge data for a current price from pre-computed data
const getCurrentEdgeData = (currentPrice, candle, edges, timeframes) => {
    // Check if the candle already has pre-computed edge data
    if (candle && candle.edges) {
        return candle.edges;
    }
    
    // If no pre-computed edges, return empty result
    return {};
};

// Global cache for candle data to avoid reloading for each backtest
let globalPivotCandles = null;
let globalTradeCandles = null;
let globalEdges = null;
let candlesLoaded = false;

// Pre-computed pivot data to avoid recalculating for each TP/SL combination
let precomputedPivots = null;
let pivotsComputed = false;

// Function to load candles once and cache them
function loadCandlesOnce() {
    if (candlesLoaded) return;
    
    console.log('Loading candle data once for all optimizations...');
    
    // Load pivot detection candles based on configuration
    if (useEdges) {
        ({ candles: globalPivotCandles, edges: globalEdges } = loadCandlesWithEdges(CANDLES_WITH_EDGES_FILE));
    } else {
        ({ candles: globalPivotCandles, edges: globalEdges } = loadCandlesFromCSV(CSV_DATA_FILE));
    }
    
    // Load 1-minute candles for trade execution if available and not already 1-minute
    if (useLocalData && interval !== '1m') {
        const startTime = globalPivotCandles[0].time;
        const endTime = globalPivotCandles[globalPivotCandles.length - 1].time;
        globalTradeCandles = load1MinuteCandlesFromCSV(MINUTE_CSV_DATA_FILE, startTime, endTime);
        
        // If no 1-minute candles loaded, fall back to pivot candles
        if (globalTradeCandles.length === 0) {
            globalTradeCandles = globalPivotCandles;
            console.log('Using pivot timeframe candles for trade execution (1-minute data not available)');
        } else {
            console.log(`Trade Execution: Using ${globalTradeCandles.length} 1-minute candles for accurate TP/SL tracking`);
        }
    } else {
        // Use pivot candles for trade execution
        globalTradeCandles = globalPivotCandles;
        console.log('Using pivot timeframe candles for trade execution');
    }
    
    console.log(`Loaded ${globalPivotCandles.length} pivot candles for detection`);
    candlesLoaded = true;
}

// Function to pre-compute all pivots once to avoid recalculating for each TP/SL combination
function computePivotsOnce() {
    if (pivotsComputed) return;
    
    console.log('Pre-computing pivot points for optimization...');
    
    const pivotCandles = globalPivotCandles;
    const edges = globalEdges;
    const timeframes = ['daily', 'weekly', 'biweekly', 'monthly'];
    
    let lastPivot = { type: null, price: null, time: null, index: 0 };
    const swingThreshold = minSwingPct / 100;
    const pivots = [];
    
    // Iterate through candles to find all pivots
    for (let i = pivotLookback; i < pivotCandles.length; i++) {
        const currentPivotCandle = pivotCandles[i];
        
        // Check for high pivots
        const isHighPivot = detectPivot(pivotCandles, i, pivotLookback, 'high');
        if (isHighPivot) {
            const swingPct = lastPivot.price ? (currentPivotCandle.close - lastPivot.price) / lastPivot.price : 0;
            const isFirstPivot = lastPivot.type === null;
            
            if ((isFirstPivot || Math.abs(swingPct) >= swingThreshold) && (i - lastPivot.index) >= minLegBars) {
                const pivotEdgeData = getCurrentEdgeData(currentPivotCandle.high, currentPivotCandle, edges, timeframes);
                
                const pivotData = {
                    type: 'high',
                    price: getPivotPrice(currentPivotCandle, 'high'),
                    time: currentPivotCandle.time,
                    index: i,
                    edges: pivotEdgeData,
                    candle: currentPivotCandle
                };
                
                lastPivot = pivotData;
                pivots.push({ ...pivotData, action: 'short' });
            }
        }
        
        // Check for low pivots
        const isLowPivot = detectPivot(pivotCandles, i, pivotLookback, 'low');
        if (isLowPivot) {
            const swingPct = lastPivot.price ? (currentPivotCandle.close - lastPivot.price) / lastPivot.price : 0;
            const isFirstPivot = lastPivot.type === null;
            
            if ((isFirstPivot || Math.abs(swingPct) >= swingThreshold) && (i - lastPivot.index) >= minLegBars) {
                const pivotEdgeData = getCurrentEdgeData(currentPivotCandle.low, currentPivotCandle, edges, timeframes);
                
                const pivotData = {
                    type: 'low',
                    price: getPivotPrice(currentPivotCandle, 'low'),
                    time: currentPivotCandle.time,
                    index: i,
                    edges: pivotEdgeData,
                    candle: currentPivotCandle
                };
                
                lastPivot = pivotData;
                pivots.push({ ...pivotData, action: 'long' });
            }
        }
    }
    
    precomputedPivots = pivots;
    console.log(`Pre-computed ${pivots.length} pivot points`);
    pivotsComputed = true;
}

// Main function to run a single backtest with specific TP/SL/Leverage values
async function runBacktest(takeProfit, stopLoss, leverage) {
    // Use cached candle data
    const pivotCandles = globalPivotCandles;
    const tradeCandles = globalTradeCandles;
    const edges = globalEdges;
    
    // Create a copy of the trade config with the specific TP/SL/Leverage values
    const testConfig = {
        ...tradeConfig,
        takeProfit: takeProfit,
        stopLoss: stopLoss,
        leverage: leverage,
        // Disable console output for individual backtests
        showCandle: false,
        showPivot: false,
        showTradeDetails: false
    };

    // Ensure there are enough candles for the lookback on both sides
    if (!pivotCandles || pivotCandles.length < (pivotLookback * 2 + 1)) {
        console.error(`Not enough historical data. Need at least ${pivotLookback * 2 + 1} candles for lookback of ${pivotLookback}.`);
        return null;
    }

    // Define timeframes for edge detection
    const timeframes = ['daily', 'weekly', 'biweekly', 'monthly'];
    
    let lastPivot = { type: null, price: null, time: null, index: 0 };
    const swingThreshold = minSwingPct / 100;
    let pivotCounter = 0;
    let highPivotCount = 0;
    let lowPivotCount = 0;

    // --- Trade State Initialization ---
    let capital = testConfig.initialCapital;
    const trades = [];
    const openTrades = [];
    let tradeMaxDrawdown = 0;
    let tradeMaxProfit = 0;

    // Iterate, leaving enough space for lookback on either side
    for (let i = pivotLookback; i < pivotCandles.length; i++) {
        const currentPivotCandle = pivotCandles[i];
        let pivotType = null;
        
        // Find corresponding trade candle for this pivot candle time
        let currentTradeCandle = currentPivotCandle; // Default fallback
        if (tradeCandles !== pivotCandles) {
            // Find 1-minute candle that corresponds to this pivot candle time
            const pivotTime = currentPivotCandle.time;
            for (let k = 0; k < tradeCandles.length; k++) {
                if (tradeCandles[k].time >= pivotTime) {
                    currentTradeCandle = tradeCandles[k];
                    break;
                }
            }
        }

        // --- Active Trade Management ---
        // Process all open trades
        for (let j = openTrades.length - 1; j >= 0; j--) {
            const trade = openTrades[j];
            let tradeClosed = false;
            let exitPrice = null;
            let result = '';
            
            // Track maximum favorable and unfavorable price movements
            if (trade.type === 'long') {
                const currentFavorable = (currentTradeCandle.high - trade.entryPrice) / trade.entryPrice * 100;
                const currentUnfavorable = (currentTradeCandle.low - trade.entryPrice) / trade.entryPrice * 100;
                
                trade.maxFavorable = Math.max(trade.maxFavorable, currentFavorable);
                trade.maxUnfavorable = Math.min(trade.maxUnfavorable, currentUnfavorable);
            } else { // short
                const currentFavorable = (trade.entryPrice - currentTradeCandle.low) / trade.entryPrice * 100;
                const currentUnfavorable = (trade.entryPrice - currentTradeCandle.high) / trade.entryPrice * 100;
                
                trade.maxFavorable = Math.max(trade.maxFavorable, currentFavorable);
                trade.maxUnfavorable = Math.min(trade.maxUnfavorable, currentUnfavorable);
            }

            // Check for trade timeout if maxTradeTimeMinutes is enabled
            if (testConfig.maxTradeTimeMinutes > 0) {
                const tradeTimeMs = currentTradeCandle.time - trade.entryTime;
                const tradeTimeMinutes = tradeTimeMs / (1000 * 60);
                
                if (tradeTimeMinutes >= testConfig.maxTradeTimeMinutes) {
                    tradeClosed = true;
                    exitPrice = currentTradeCandle.close;
                    result = 'TIMEOUT';
                }
            }

            if (!tradeClosed) { // Only check TP/SL if not already closed due to timeout
                if (trade.type === 'long') {
                    if (currentTradeCandle.high >= trade.takeProfitPrice) {
                        tradeClosed = true;
                        exitPrice = trade.takeProfitPrice;
                        result = 'TP';
                    } else if (currentTradeCandle.low <= trade.stopLossPrice) {
                        tradeClosed = true;
                        exitPrice = trade.stopLossPrice;
                        result = 'SL';
                    }
                } else { // short
                    if (currentTradeCandle.low <= trade.takeProfitPrice) {
                        tradeClosed = true;
                        exitPrice = trade.takeProfitPrice;
                        result = 'TP';
                    } else if (currentTradeCandle.high >= trade.stopLossPrice) {
                        tradeClosed = true;
                        exitPrice = trade.stopLossPrice;
                        result = 'SL';
                    }
                }
            }

            if (tradeClosed) {
                const pnlPct = (trade.type === 'long' ? (exitPrice - trade.entryPrice) / trade.entryPrice : (trade.entryPrice - exitPrice) / trade.entryPrice) * testConfig.leverage;
                const grossPnl = trade.size * pnlPct;
                const fee = (trade.size * testConfig.leverage * (testConfig.totalMakerFee / 100));
                const pnl = grossPnl - fee;
                
                capital += pnl;
                
                // Check if account is liquidated
                if (capital <= 0) {
                    capital = 0; // Ensure capital never goes negative
                    // Liquidation message not shown during optimization runs
                }

                trades.push({
                    ...trade,
                    exitPrice,
                    exitTime: currentTradeCandle.time,
                    exitIndex: i,
                    status: 'closed',
                    result,
                    grossPnl,
                    pnl,
                    fee,
                    capitalAfter: capital
                });
                
                // Remove this trade from openTrades array
                openTrades.splice(j, 1);
            }
        }

        // Process high pivots
        const isHighPivot = detectPivot(pivotCandles, i, pivotLookback, 'high');
        
        if (isHighPivot) {
            const swingPct = lastPivot.price ? (currentPivotCandle.close - lastPivot.price) / lastPivot.price : 0;
            const isFirstPivot = lastPivot.type === null;
            
            if ((isFirstPivot || Math.abs(swingPct) >= swingThreshold) && (i - lastPivot.index) >= minLegBars) {
                pivotType = 'high';
                pivotCounter++;
                highPivotCount++;
                
                // Get edge data for this pivot from pre-computed data
                const pivotEdgeData = getCurrentEdgeData(currentPivotCandle.high, currentPivotCandle, edges, timeframes);
                
                // Store pivot data using close price
                lastPivot = { 
                    type: 'high', 
                    price: currentPivotCandle.close, 
                    time: currentPivotCandle.time, 
                    index: i,
                    edges: pivotEdgeData
                };
                
                // --- Open Short Trade ---
                if (!isFirstPivot && (testConfig.direction === 'sell' || testConfig.direction === 'both')) {
                    // Check if we can open a new trade based on maxConcurrentTrades
                    if (openTrades.length < testConfig.maxConcurrentTrades) {
                        // Calculate available capital for this trade
                        const usedCapital = openTrades.reduce((sum, trade) => sum + trade.size, 0);
                        const availableCapital = capital - usedCapital;
                        
                        // Determine trade size based on positionSizingMode
                        let tradeSize = 0;
                        if (testConfig.positionSizingMode === 'fixed' && testConfig.amountPerTrade) {
                            // Use fixed amount, but check against available capital
                            tradeSize = Math.min(testConfig.amountPerTrade, availableCapital);
                        } else {
                            // Use percentage of total capital
                            tradeSize = capital * (testConfig.riskPerTrade / 100);
                        }
                        
                        // Ensure we have enough capital and the trade size is valid
                        if (tradeSize > 0 && tradeSize <= availableCapital && capital > 0) {
                            const shortTrade = createTrade('short', currentPivotCandle, lastPivot, i, tradeSize, testConfig);
                            openTrades.push(shortTrade);
                        }
                    }
                }
            }
        }

        // Process low pivots
        const isLowPivot = detectPivot(pivotCandles, i, pivotLookback, 'low');
        
        if (isLowPivot) {
            const swingPct = lastPivot.price ? (currentPivotCandle.close - lastPivot.price) / lastPivot.price : 0;
            const isFirstPivot = lastPivot.type === null;
            
            if ((isFirstPivot || Math.abs(swingPct) >= swingThreshold) && (i - lastPivot.index) >= minLegBars) {
                pivotType = 'low';
                pivotCounter++;
                lowPivotCount++;
                
                // Get edge data for this pivot from pre-computed data
                const pivotEdgeData = getCurrentEdgeData(currentPivotCandle.low, currentPivotCandle, edges, timeframes);
                
                // Store pivot data using close price
                lastPivot = { 
                    type: 'low', 
                    price: currentPivotCandle.close, 
                    time: currentPivotCandle.time, 
                    index: i,
                    edges: pivotEdgeData
                };
                
                // --- Open Long Trade ---
                if (!isFirstPivot && (testConfig.direction === 'buy' || testConfig.direction === 'both')) {
                    // Check if we can open a new trade based on maxConcurrentTrades
                    if (openTrades.length < testConfig.maxConcurrentTrades) {
                        // Calculate available capital for this trade
                        const usedCapital = openTrades.reduce((sum, trade) => sum + trade.size, 0);
                        const availableCapital = capital - usedCapital;
                        
                        // Determine trade size based on positionSizingMode
                        let tradeSize = 0;
                        if (testConfig.positionSizingMode === 'fixed' && testConfig.amountPerTrade) {
                            // Use fixed amount, but check against available capital
                            tradeSize = Math.min(testConfig.amountPerTrade, availableCapital);
                        } else {
                            // Use percentage of total capital
                            tradeSize = capital * (testConfig.riskPerTrade / 100);
                        }
                        
                        // Ensure we have enough capital and the trade size is valid
                        if (tradeSize > 0 && tradeSize <= availableCapital && capital > 0) {
                            const longTrade = createTrade('long', currentPivotCandle, lastPivot, i, tradeSize, testConfig);
                            openTrades.push(longTrade);
                        }
                    }
                }
            }
        }
    }

    // Close any remaining open trades at the last candle's close price
    const lastPivotCandle = pivotCandles[pivotCandles.length - 1];
    const lastTradeCandle = tradeCandles[tradeCandles.length - 1];
    for (const trade of openTrades) {
        const exitPrice = lastTradeCandle.close;
        const pnlPct = (trade.type === 'long' ? (exitPrice - trade.entryPrice) / trade.entryPrice : (trade.entryPrice - exitPrice) / trade.entryPrice) * testConfig.leverage;
        const grossPnl = trade.size * pnlPct;
        const fee = (trade.size * testConfig.leverage * (testConfig.totalMakerFee / 100));
        const pnl = grossPnl - fee;
        
        capital += pnl;

        trades.push({
            ...trade,
            exitPrice,
            exitTime: lastTradeCandle.time,
            exitIndex: pivotCandles.length - 1,
            status: 'closed',
            result: 'EOB', // End Of Backtest - matching pivotBacktester.js naming
            grossPnl,
            pnl,
            fee,
            capitalAfter: capital
        });
    }

    // Calculate trade statistics
    const closedTrades = trades.filter(t => t.status === 'closed');
    // Filter out EOB trades to match pivotBacktester.js behavior
    const regularTrades = closedTrades.filter(t => t.result !== 'EOB');
    const eobTrades = closedTrades.filter(t => t.result === 'EOB');
    // Use regularTrades instead of closedTrades to exclude EOB trades
    const tpTrades = regularTrades.filter(t => t.result === 'TP');
    const slTrades = regularTrades.filter(t => t.result === 'SL');
    const timeoutTrades = regularTrades.filter(t => t.result === 'TIMEOUT');
    
    // Calculate rates based on regularTrades (excluding EOB trades)
    const tpRate = regularTrades.length > 0 ? (tpTrades.length / regularTrades.length) * 100 : 0;
    const slRate = regularTrades.length > 0 ? (slTrades.length / regularTrades.length) * 100 : 0;
    const timeoutRate = regularTrades.length > 0 ? (timeoutTrades.length / regularTrades.length) * 100 : 0;
    
    // Calculate profit metrics based on regularTrades (excluding EOB trades)
    const totalPnl = regularTrades.reduce((sum, trade) => sum + trade.pnl, 0);
    const profitableTrades = regularTrades.filter(t => t.pnl > 0);
    const unprofitableTrades = regularTrades.filter(t => t.pnl <= 0);
    
    const winRate = regularTrades.length > 0 ? (profitableTrades.length / regularTrades.length) * 100 : 0;
    const totalProfit = profitableTrades.reduce((sum, trade) => sum + trade.pnl, 0);
    const totalLoss = unprofitableTrades.reduce((sum, trade) => sum + trade.pnl, 0);
    
    const avgWin = profitableTrades.length > 0 ? totalProfit / profitableTrades.length : 0;
    const avgLoss = unprofitableTrades.length > 0 ? totalLoss / unprofitableTrades.length : 0;
    
    const profitFactor = Math.abs(totalLoss) > 0 ? Math.abs(totalProfit / totalLoss) : Infinity;
    
    // Calculate net gains
    const initialCapital = testConfig.initialCapital;
    
    // Adjust final capital by removing the impact of EOB trades (to match pivotBacktester.js)
    const eobPnl = eobTrades.reduce((acc, t) => acc + t.pnl, 0);
    const adjustedFinalCapital = capital - eobPnl;
    
    // Use the adjusted final capital for calculations
    const netGain = adjustedFinalCapital - initialCapital;
    const netGainPct = (netGain / initialCapital) * 100;
    
    // Return the backtest results
    return {
        takeProfit,
        stopLoss,
        leverage,
        totalTrades: regularTrades.length, // Only count non-EOB trades
        winRate,
        tpRate,
        slRate,
        timeoutRate,
        // endRate removed as EOB trades are now excluded from metrics
        profitFactor,
        netGain,
        netGainPct,
        initialCapital,
        finalCapital: adjustedFinalCapital,
        avgWin,
        avgLoss
    };
}

// Main function to run the optimizer
async function runOptimizer() {
    // Record start time
    const startTime = process.hrtime.bigint();
    
    console.log(`${colors.cyan}=== Parallel Pivot Optimizer ===${colors.reset}`);
    console.log(`Symbol: ${symbol}, Interval: ${interval}`);
    console.log(`Pivot Detection Mode: ${pivotDetectionMode.charAt(0).toUpperCase() + pivotDetectionMode.slice(1)}`);
    console.log(`Take Profit Range: ${optimizerConfig.takeProfitRange.start} to ${optimizerConfig.takeProfitRange.end} with step ${optimizerConfig.takeProfitRange.step}`);
    console.log(`Stop Loss Range: ${optimizerConfig.stopLossRange.start} to ${optimizerConfig.stopLossRange.end} with step ${optimizerConfig.stopLossRange.step}`);
    console.log(`Leverage Range: ${optimizerConfig.leverageRange.start} to ${optimizerConfig.leverageRange.end} with step ${optimizerConfig.leverageRange.step}`);
    console.log(`Direction: ${tradeConfig.direction}`);
    console.log();
    
    // Load candle data once for all optimizations
    loadCandlesOnce();
    
    // Pre-compute all pivots once for all optimizations
    computePivotsOnce();
    
    // Create header for CSV file
    const csvHeader = 'takeProfit,stopLoss,leverage,totalTrades,winRate,tpRate,slRate,timeoutRate,profitFactor,netGain,netGainPct,initialCapital,finalCapital,avgWin,avgLoss\n';
    fs.writeFileSync(RESULTS_CSV_FILE, csvHeader);
    
    const results = [];
    let totalCombinations = 0;
    
    // Generate all combinations including leverage
    const combinations = [];
    for (let tp = optimizerConfig.takeProfitRange.start; tp <= optimizerConfig.takeProfitRange.end; tp += optimizerConfig.takeProfitRange.step) {
        for (let sl = optimizerConfig.stopLossRange.start; sl <= optimizerConfig.stopLossRange.end; sl += optimizerConfig.stopLossRange.step) {
            for (let lev = optimizerConfig.leverageRange.start; lev <= optimizerConfig.leverageRange.end; lev += optimizerConfig.leverageRange.step) {
                combinations.push({ tp, sl, leverage: lev });
                totalCombinations++;
            }
        }
    }
    
    console.log(`Total combinations to test: ${totalCombinations}`);
    
    // Determine number of CPU cores to use (leaving one core free for system)
    const numCores = Math.max(1, os.cpus().length - 1);
    console.log(`Using ${numCores} CPU cores for parallel processing`);
    
    // Use larger batch sizes for better performance (reduce worker overhead)
    const optimalBatchSize = Math.max(50, Math.ceil(combinations.length / (numCores * 2)));
    const batches = [];
    for (let i = 0; i < combinations.length; i += optimalBatchSize) {
        batches.push(combinations.slice(i, i + optimalBatchSize));
    }
    
    console.log(`Split ${combinations.length} combinations into ${batches.length} batches of ~${optimalBatchSize} each`);
    
    // Initialize counter for tracking progress
    let completedCombinations = 0;
    let lastProgressUpdate = 0;
    let progressLine = '';
    
    // Create a promise that resolves when all workers are done
    const runAllBatches = async () => {
        const batchPromises = batches.map((batch, index) => {
            return new Promise((resolve, reject) => {
                const worker = new Worker(new URL(import.meta.url), {
                    workerData: { 
                        batch, 
                        workerId: index,
                        pivotCandles: globalPivotCandles,
                        tradeCandles: globalTradeCandles,
                        edges: globalEdges,
                        precomputedPivots: precomputedPivots
                    }
                });
                
                worker.on('message', (message) => {
                    if (message.type === 'result') {
                        const result = message.data;
                        results.push(result);
                        
                        // Format the result for CSV
                        const csvLine = `${result.takeProfit},${result.stopLoss},${result.leverage},${result.totalTrades},${result.winRate.toFixed(2)},${result.tpRate.toFixed(2)},${result.slRate.toFixed(2)},${result.timeoutRate.toFixed(2)},${result.profitFactor.toFixed(2)},${result.netGain.toFixed(2)},${result.netGainPct.toFixed(2)},${result.initialCapital},${result.finalCapital.toFixed(2)},${result.avgWin.toFixed(2)},${result.avgLoss.toFixed(2)}\n`;
                        fs.appendFileSync(RESULTS_CSV_FILE, csvLine);
                    } else if (message.type === 'progress') {
                        completedCombinations++;
                        const progressPct = (completedCombinations / totalCombinations * 100);
                        
                        // Update progress bar only when percentage changes by at least 1%
                        if (progressPct - lastProgressUpdate >= 1 || completedCombinations === totalCombinations) {
                            lastProgressUpdate = Math.floor(progressPct);
                            const barWidth = 30; // Width of the progress bar
                            const completedWidth = Math.floor(barWidth * (progressPct / 100));
                            const bar = `[${'='.repeat(completedWidth)}${' '.repeat(barWidth - completedWidth)}]`;
                            progressLine = `\r${colors.cyan}Progress: ${bar} ${progressPct.toFixed(1)}% (${completedCombinations}/${totalCombinations})${colors.reset}`;
                            process.stdout.write(progressLine);
                            
                            // Only log TP/SL/Leverage values every 10% or final result
                            if (progressPct % 10 < 1 || completedCombinations === totalCombinations) {
                                process.stdout.write('\n');
                                console.log(`Current: TP ${message.data.tp.toFixed(2)}%, SL ${message.data.sl.toFixed(2)}%, Leverage ${message.data.leverage}x`);
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
    
    // Display top 5 results
    console.log(`
${colors.green}=== Top 5 Combinations ====${colors.reset}`);
    for (let i = 0; i < Math.min(5, results.length); i++) {
        const r = results[i];
        console.log(`${i+1}. TP: ${r.takeProfit.toFixed(2)}%, SL: ${r.stopLoss.toFixed(2)}%, Leverage: ${r.leverage}x - Trades: ${r.totalTrades}, Win Rate: ${r.winRate.toFixed(2)}%, Net Gain: ${r.netGainPct.toFixed(2)}% ($${r.netGain.toFixed(2)}), Capital: $${r.finalCapital.toFixed(2)}, Profit Factor: ${r.profitFactor.toFixed(2)}`);
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
    
    // Calculate the total time period covered by the backtest
    let totalTradeLengthTime = '';
    const { candles: timeCandles } = useEdges 
        ? loadCandlesWithEdges(CANDLES_WITH_EDGES_FILE)
        : loadCandlesFromCSV(CSV_DATA_FILE);
    
    if (timeCandles && timeCandles.length > 1) {
        const firstCandleTime = new Date(timeCandles[0].time);
        const lastCandleTime = new Date(timeCandles[timeCandles.length - 1].time);
        const totalTimeMs = lastCandleTime - firstCandleTime;
        
        // Calculate months, days, hours, minutes
        const msPerMinute = 60 * 1000;
        const msPerHour = msPerMinute * 60;
        const msPerDay = msPerHour * 24;
        const msPerMonth = msPerDay * 30; // Approximation
        
        const months = Math.floor(totalTimeMs / msPerMonth);
        const remainingAfterMonths = totalTimeMs % msPerMonth;
        
        const days = Math.floor(remainingAfterMonths / msPerDay);
        const remainingAfterDays = remainingAfterMonths % msPerDay;
        
        const hours = Math.floor(remainingAfterDays / msPerHour);
        const remainingAfterHours = remainingAfterDays % msPerHour;
        
        const minutes = Math.floor(remainingAfterHours / msPerMinute);
        
        // Format the time period
        const parts = [];
        if (months > 0) parts.push(`${months} month${months !== 1 ? 's' : ''}`);
        if (days > 0) parts.push(`${days} day${days !== 1 ? 's' : ''}`);
        if (hours > 0) parts.push(`${hours} hour${hours !== 1 ? 's' : ''}`);
        if (minutes > 0) parts.push(`${minutes} minute${minutes !== 1 ? 's' : ''}`);
        
        totalTradeLengthTime = parts.join(', ');
    } else {
        totalTradeLengthTime = 'No candle data available';
    }
    
    console.log(`
${colors.magenta}Execution time: ${timeDisplay}${colors.reset}`);

    console.log(`${colors.cyan}Total combinations tested: ${totalCombinations}${colors.reset}`);
    console.log(`${colors.yellow}Historical data timespan: ${totalTradeLengthTime}${colors.reset}`);
    console.log(`${colors.green}Complete optimization results saved to: ${RESULTS_CSV_FILE}${colors.reset}`);
}

// Worker thread code
if (!isMainThread) {
    // Extract worker data
    const { batch, workerId, pivotCandles, tradeCandles, edges, precomputedPivots } = workerData;
    
    // Set global variables for this worker
    globalPivotCandles = pivotCandles;
    globalTradeCandles = tradeCandles;
    globalEdges = edges;
    // Note: precomputedPivots is passed but not used in current implementation
    candlesLoaded = true;
    pivotsComputed = true;
    
    // Process each combination in the batch
    (async () => {
        for (const combo of batch) {
            // Send progress update to main thread
            parentPort.postMessage({
                type: 'progress',
                data: { tp: combo.tp, sl: combo.sl, leverage: combo.leverage }
            });
            
            // Run the backtest
            const result = await runBacktest(combo.tp, combo.sl, combo.leverage);
            
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
    // Main thread code - run the optimizer
    runOptimizer();
}
