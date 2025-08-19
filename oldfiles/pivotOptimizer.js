// pivotOptimizer.js
// Runs multiple backtests using different TP/SL combinations from optimizerConfig.js
// Self-sufficient test file for instant pivot detection with configurable price mode (close or extreme) for pivot detection and trade execution.

import {
    symbol,
    time as interval,
    limit,
    minSwingPct,
    pivotLookback,
    minLegBars,
    useEdges,
    useLocalData,
    delay,
    api,
    pivotDetectionMode
} from '../config/config.js'; 
import { tradeConfig } from '../config/tradeconfig.js';
import { optimizerConfig } from '../config/optimizerConfig.js';
import { getCandles } from '../apis/bybit.js';
import { formatNumber } from '../utils/formatters.js';
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

// Utility function to format duration in milliseconds to a readable string
// Adjusted to account for the candle interval
const formatDuration = (ms) => {
    // For intervals other than 1m, adjust the calculation
    // This represents the actual duration, not just timestamp difference
    
    const days = Math.floor(ms / (1000 * 60 * 60 * 24));
    const hours = Math.floor((ms % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    
    if (days > 0) {
        return `${days} days, ${hours} hours, ${minutes} minutes`;
    } else {
        return `${hours} hours, ${minutes} minutes`;
    }
};

// Function to load candles with edge data from a JSON file
const loadCandlesWithEdges = (filePath) => {
    try {
        if (!fs.existsSync(filePath)) {
            console.error(`${colors.red}JSON file not found: ${filePath}${colors.reset}`);
            process.exit(1);
        }
        
        // Read the JSON file
        const fileContent = fs.readFileSync(filePath, 'utf8');
        const data = JSON.parse(fileContent);
        
        let candles = data.candles || [];
        const edges = data.edges || {};
        
        console.log(`Found ${colors.yellow}${candles.length}${colors.reset} candles in JSON file: ${filePath}`);
        
        // Sort candles chronologically (oldest to newest)
        candles.sort((a, b) => a.time - b.time);
        
        // Store total number of candles for reporting
        const totalCandles = candles.length;
        
        // If delay is specified, move back in time by that many candles
        if (delay > 0) {
            if (totalCandles <= delay) {
                console.error(`${colors.red}[ERROR] Delay value (${delay} candles) is greater than or equal to the total number of available candles (${totalCandles}). Cannot apply delay.${colors.reset}`);
                process.exit(1);
            }
            
            // Calculate what the end position should be after accounting for delay
            const endPos = totalCandles - delay;
            
            // If we're also limiting the number of candles, ensure we don't go out of bounds
            const startPos = Math.max(0, endPos - limit);
            
            // Get the timestamps for reporting
            const originalLatestTimestamp = candles[totalCandles - 1].time;
            const delayedLatestTimestamp = candles[endPos - 1].time;
            
            // Calculate time difference for user-friendly output
            const timeDifferenceMs = originalLatestTimestamp - delayedLatestTimestamp;
            const timeDifferenceMinutes = Math.floor(timeDifferenceMs / (60 * 1000));
            const timeDifferenceHours = Math.floor(timeDifferenceMinutes / 60);
            const timeDifferenceDays = Math.floor(timeDifferenceHours / 24);
            
            // Format the time difference for display
            let timeMessage = '';
            if (timeDifferenceDays > 0) {
                timeMessage += `${timeDifferenceDays} day${timeDifferenceDays !== 1 ? 's' : ''}`;
                const remainingHours = timeDifferenceHours % 24;
                if (remainingHours > 0) {
                    timeMessage += ` and ${remainingHours} hour${remainingHours !== 1 ? 's' : ''}`;
                }
            } else if (timeDifferenceHours > 0) {
                timeMessage += `${timeDifferenceHours} hour${timeDifferenceHours !== 1 ? 's' : ''}`;
                const remainingMinutes = timeDifferenceMinutes % 60;
                if (remainingMinutes > 0) {
                    timeMessage += ` and ${remainingMinutes} minute${remainingMinutes !== 1 ? 's' : ''}`;
                }
            } else {
                timeMessage += `${timeDifferenceMinutes} minute${timeDifferenceMinutes !== 1 ? 's' : ''}`;
            }
            
            // Slice the candles to get the right window based on delay and limit
            candles = candles.slice(startPos, endPos);
            
            // Display user-friendly information about the delay
            console.log(`${colors.yellow}[DELAY MODE] Backtesting with data from ${timeMessage} ago (shifted back by ${delay} candles)${colors.reset}`);
            console.log(`${colors.yellow}[DELAY] Latest candle date: ${new Date(delayedLatestTimestamp).toLocaleString()}${colors.reset}`);
            console.log(`${colors.yellow}[DELAY] Using ${candles.length} candles from positions ${startPos} to ${endPos-1} out of ${totalCandles} total${colors.reset}`);
        } else {
            // No delay - just apply the limit if specified
            if (limit > 0 && totalCandles > limit) {
                console.log(`Limiting to ${colors.yellow}${limit}${colors.reset} most recent candles out of ${totalCandles} available`);
                candles = candles.slice(-limit);
            }
        }
        
        console.log(`Loaded ${candles.length} candles with edge data from JSON file: ${filePath}`);
        
        return { candles, edges };
    } catch (error) {
        console.error(`${colors.red}Failed to load candles from JSON file ${filePath}:${colors.reset}`, error);
        process.exit(1);
    }
};

// Function to load candles with delay - this handles both limit and delay parameters
const loadCandlesWithDelay = (filePath, candleLimit, delayCandles) => {
    try {
        if (!fs.existsSync(filePath)) {
            console.error(`${colors.red}CSV file not found: ${filePath}${colors.reset}`);
            process.exit(1);
        }
        
        const fileContent = fs.readFileSync(filePath, 'utf8');
        const lines = fileContent
            .split('\n')
            .map(line => line.trim())
            .filter(line => line && line !== 'timestamp,open,high,low,close,volume');
        
        console.log(`Found ${colors.yellow}${lines.length}${colors.reset} candles in CSV file: ${filePath}`);
        
        let candles = [];
        
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
            
            if (!isNaN(candle.time) && !isNaN(candle.open) && !isNaN(candle.high) && !isNaN(candle.low) && !isNaN(candle.close)) {
                candles.push(candle);
            }
        }
        
        // Sort candles chronologically (oldest to newest)
        candles.sort((a, b) => a.time - b.time);
        
        // Store total number of candles for reporting
        const totalCandles = candles.length;
        
        // If delay is specified, move back in time by that many candles
        if (delayCandles > 0) {
            if (totalCandles <= delayCandles) {
                console.error(`${colors.red}[ERROR] Delay value (${delayCandles} candles) is greater than or equal to the total number of available candles (${totalCandles}). Cannot apply delay.${colors.reset}`);
                process.exit(1);
            }
            
            // Calculate what the end position should be after accounting for delay
            const endPos = totalCandles - delayCandles;
            
            // If we're also limiting the number of candles, ensure we don't go out of bounds
            const startPos = Math.max(0, endPos - candleLimit);
            
            // Get the timestamps for reporting
            const originalLatestTimestamp = candles[totalCandles - 1].time;
            const delayedLatestTimestamp = candles[endPos - 1].time;
            
            // Calculate time difference for user-friendly output
            const timeDifferenceMs = originalLatestTimestamp - delayedLatestTimestamp;
            const timeDifferenceMinutes = Math.floor(timeDifferenceMs / (60 * 1000));
            const timeDifferenceHours = Math.floor(timeDifferenceMinutes / 60);
            const timeDifferenceDays = Math.floor(timeDifferenceHours / 24);
            
            // Format the time difference for display
            let timeMessage = '';
            if (timeDifferenceDays > 0) {
                timeMessage += `${timeDifferenceDays} day${timeDifferenceDays !== 1 ? 's' : ''}`;
                const remainingHours = timeDifferenceHours % 24;
                if (remainingHours > 0) {
                    timeMessage += ` and ${remainingHours} hour${remainingHours !== 1 ? 's' : ''}`;
                }
            } else if (timeDifferenceHours > 0) {
                timeMessage += `${timeDifferenceHours} hour${timeDifferenceHours !== 1 ? 's' : ''}`;
                const remainingMinutes = timeDifferenceMinutes % 60;
                if (remainingMinutes > 0) {
                    timeMessage += ` and ${remainingMinutes} minute${remainingMinutes !== 1 ? 's' : ''}`;
                }
            } else {
                timeMessage += `${timeDifferenceMinutes} minute${timeDifferenceMinutes !== 1 ? 's' : ''}`;
            }
            
            // Slice the candles to get the right window based on delay and limit
            candles = candles.slice(startPos, endPos);
            
            // Display user-friendly information about the delay
            console.log(`${colors.yellow}[DELAY MODE] Backtesting with data from ${timeMessage} ago (shifted back by ${delayCandles} candles)${colors.reset}`);
            console.log(`${colors.yellow}[DELAY] Latest candle date: ${new Date(delayedLatestTimestamp).toLocaleString()}${colors.reset}`);
            console.log(`${colors.yellow}[DELAY] Using ${candles.length} candles from positions ${startPos} to ${endPos-1} out of ${totalCandles} total${colors.reset}`);
        } else {
            // No delay - just apply the limit if specified
            if (candleLimit > 0 && totalCandles > candleLimit) {
                console.log(`Limiting to ${colors.yellow}${candleLimit}${colors.reset} most recent candles out of ${totalCandles} available`);
                candles = candles.slice(-candleLimit);
            }
        }
        
        return { candles, edges: {} };
    } catch (error) {
        console.error(`${colors.red}Failed to load candles from CSV file ${filePath}:${colors.reset}`, error);
        process.exit(1);
    }
};

// Function to load candles from CSV file - this now delegates to loadCandlesWithDelay
const loadCandlesFromCSV = (filePath) => {
    // Use the new function that handles both limit and delay
    const result = loadCandlesWithDelay(filePath, limit, delay);
    console.log(`Loaded ${result.candles.length} candles from CSV file: ${filePath}`);
    return result;
};

// Function to load 1-minute candles for trade execution
const load1MinuteCandlesFromCSV = (filePath, startTime, endTime) => {
    try {
        if (!fs.existsSync(filePath)) {
            console.error(`${colors.red}1-minute CSV file not found: ${filePath}${colors.reset}`);
            return [];
        }
        
        const fileContent = fs.readFileSync(filePath, 'utf8');
        const lines = fileContent
            .split('\n')
            .map(line => line.trim())
            .filter(line => line && line !== 'timestamp,open,high,low,close,volume');
        
        let candles = [];
        
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
            
            if (!isNaN(candle.time) && !isNaN(candle.open) && !isNaN(candle.high) && !isNaN(candle.low) && !isNaN(candle.close)) {
                // Only include candles within the specified time range
                if (candle.time >= startTime && candle.time <= endTime) {
                    candles.push(candle);
                }
            }
        }
        
        // Sort candles chronologically
        candles.sort((a, b) => a.time - b.time);
        
        return candles;
    } catch (error) {
        console.error(`${colors.red}Failed to load 1-minute candles from CSV file ${filePath}:${colors.reset}`, error);
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

// Helper function to calculate slippage based on configuration
const calculateSlippage = (tradeSize, tradeConfig) => {
    if (!tradeConfig.enableSlippage) return 0;
    
    let slippagePercent = 0;
    
    switch (tradeConfig.slippageMode) {
        case 'fixed':
            slippagePercent = tradeConfig.slippagePercent;
            break;
            
        case 'variable':
            // Random slippage between min and max
            const range = tradeConfig.variableSlippageMax - tradeConfig.variableSlippageMin;
            slippagePercent = tradeConfig.variableSlippageMin + (Math.random() * range);
            break;
            
        case 'market_impact':
            // Base slippage + market impact based on trade size
            const marketImpact = (tradeSize / 1000) * tradeConfig.marketImpactFactor;
            slippagePercent = tradeConfig.slippagePercent + marketImpact;
            break;
            
        default:
            slippagePercent = tradeConfig.slippagePercent;
    }
    
    return slippagePercent / 100; // Convert to decimal
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
            // Random funding rate between min and max for each period
            const range = tradeConfig.variableFundingMax - tradeConfig.variableFundingMin;
            fundingRatePercent = tradeConfig.variableFundingMin + (Math.random() * range);
            break;
            
        default:
            fundingRatePercent = tradeConfig.fundingRatePercent;
    }
    
    // Calculate total funding cost: position size * leverage * funding rate * number of periods
    const totalFundingCost = positionSize * leverage * (fundingRatePercent / 100) * fundingPeriods;
    
    return totalFundingCost;
};

// Helper function to apply slippage to exit price
const applySlippage = (exitPrice, tradeType, slippagePercent) => {
    if (slippagePercent === 0) return exitPrice;
    
    // Slippage always works against the trader
    if (tradeType === 'long') {
        // For long trades, slippage reduces the exit price (worse fill)
        return exitPrice * (1 - slippagePercent);
    } else {
        // For short trades, slippage increases the exit price (worse fill)
        return exitPrice * (1 + slippagePercent);
    }
};

// Helper function to create a trade
const createTrade = (type, currentCandle, pivotData, i, tradeSize, takeProfit, stopLoss) => {
    let entryPrice = currentCandle.close; // Use close price for trade entry
    
    // Apply entry slippage
    const entrySlippage = calculateSlippage(tradeSize, tradeConfig);
    entryPrice = applySlippage(entryPrice, type, entrySlippage);
    
    // Use the provided trade size directly instead of calculating from capital
    const size = tradeSize;
    
    // Calculate TP/SL differently based on trade type (using original entry price for calculation)
    const takeProfitPrice = type === 'long'
        ? entryPrice * (1 + (takeProfit / 100))
        : entryPrice * (1 - (takeProfit / 100));
        
    const stopLossPrice = type === 'long'
        ? entryPrice * (1 - (stopLoss / 100))
        : entryPrice * (1 + (stopLoss / 100));

    // Trade enters at the END of the pivot candle (when pivot is confirmed)
    const entryTime = currentCandle.time + candleDurationMs;
    
    return {
        type,
        entryPrice,
        entryTime: entryTime,
        entryIndex: i,
        size,
        status: 'open',
        takeProfitPrice,
        stopLossPrice,
        pivot: { ...pivotData },  // Create a copy to avoid reference issues
        maxFavorable: 0,  // Track maximum favorable price movement
        maxUnfavorable: 0,  // Track maximum unfavorable price movement
        entrySlippage: entrySlippage * 100,  // Store entry slippage percentage for reporting
        lastFundingTime: entryTime  // Track last funding payment time
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
async function loadCandlesOnce() {
    if (candlesLoaded) return;
    
    console.log('Loading candle data once for all optimizations...');
    
    // Load pivot detection candles based on configuration
    let pivotCandles, edges;
    if (useEdges) {
        ({ candles: pivotCandles, edges } = loadCandlesWithEdges(CANDLES_WITH_EDGES_FILE));
    } else if (useLocalData) {
        ({ candles: pivotCandles, edges } = loadCandlesFromCSV(CSV_DATA_FILE));
    } else {
        // Fetch live data from API
        console.log(`\n=== FETCHING LIVE DATA FROM ${api.toUpperCase()} API ===`);
        const rawCandles = await getCandles(symbol, interval, limit);
        
        // Sort candles chronologically (API may return in reverse order)
        // Remove duplicates and ensure proper chronological order
        const uniqueCandles = Array.from(new Map(rawCandles.map(c => [c.time, c])).values());
        pivotCandles = uniqueCandles.sort((a, b) => a.time - b.time);
        
        console.log(`Sorted ${pivotCandles.length} candles chronologically`);
        console.log(`Time range: ${new Date(pivotCandles[0].time).toLocaleString()} to ${new Date(pivotCandles[pivotCandles.length-1].time).toLocaleString()}`);
        
        edges = {}; // No pre-computed edge data for live API calls
    }
    
    // Validate pivot candle data
    if (!pivotCandles || pivotCandles.length === 0) {
        console.error(`${colors.red}Failed to fetch pivot candles${colors.reset}`);
        process.exit(1);
    }
    
    globalPivotCandles = pivotCandles;
    globalEdges = edges;
    
    console.log(`${colors.green}Successfully loaded ${pivotCandles.length} pivot candles (${interval})${colors.reset}`);
    
    // Load 1-minute candles for trade execution (only if using local data and interval is not 1m)
    let tradeCandles = [];
    if (useLocalData && interval !== '1m') {
        const startTime = pivotCandles[0].time;
        const endTime = pivotCandles[pivotCandles.length - 1].time;
        tradeCandles = load1MinuteCandlesFromCSV(MINUTE_CSV_DATA_FILE, startTime, endTime);
        
        if (tradeCandles.length > 0) {
            console.log(`${colors.green}Successfully loaded ${tradeCandles.length} 1-minute candles for trade execution${colors.reset}`);
        } else {
            console.log(`${colors.yellow}No 1-minute candles found, using ${interval} candles for trade execution${colors.reset}`);
            tradeCandles = pivotCandles; // Fallback to pivot candles
        }
    } else {
        // Use pivot candles for trade execution if interval is 1m or not using local data
        tradeCandles = pivotCandles;
        if (interval === '1m') {
            console.log(`${colors.cyan}Using 1-minute candles for both pivot detection and trade execution${colors.reset}`);
        } else {
            console.log(`${colors.yellow}Using ${interval} candles for trade execution (1-minute data not available)${colors.reset}`);
        }
    }
    
    globalTradeCandles = tradeCandles;
    
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

// Main function to run a single backtest with specific TP/SL/Leverage and pivot parameters
async function runBacktest(takeProfit, stopLoss, leverage, minSwingPctParam, minLegBarsParam, pivotLookbackParam) {
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

    // Use passed parameters instead of global config values
    const swingThreshold = minSwingPctParam / 100;
    const lookback = pivotLookbackParam;
    const minLegBarsParam_val = minLegBarsParam;
    
    // Ensure there are enough candles for the lookback on both sides
    if (!pivotCandles || pivotCandles.length < (lookback * 2 + 1)) {
        console.error(`Not enough historical data. Need at least ${lookback * 2 + 1} candles for lookback of ${lookback}.`);
        return null;
    }

    // Define timeframes for edge detection
    const timeframes = ['daily', 'weekly', 'biweekly', 'monthly'];
    
    let lastPivot = { type: null, price: null, time: null, index: 0 };
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
    for (let i = lookback; i < pivotCandles.length; i++) {
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

        // --- Active Trade Management using 1-minute candles ---
        // Process all open trades using 1-minute candles for accurate execution
        for (let j = openTrades.length - 1; j >= 0; j--) {
            const trade = openTrades[j];
            let tradeClosed = false;
            let exitPrice = null;
            let result = '';
            let finalTradeCandle = null;
            
            // If we have 1-minute candles, process ALL candles from trade entry time onwards
            if (tradeCandles !== pivotCandles) {
                const currentPivotEndTime = currentPivotCandle.time + candleDurationMs;
                const previousPivotEndTime = i > 0 ? pivotCandles[i-1].time + candleDurationMs : 0;
                
                // Find all 1-minute candles from trade entry time (end of previous pivot) to current pivot end
                // Only process candles AFTER the trade entry time
                const relevantTradeCandles = tradeCandles.filter(tc => 
                    tc.time >= Math.max(trade.entryTime, previousPivotEndTime) && tc.time <= currentPivotEndTime
                );
                
                // Process each 1-minute candle in chronological order
                for (const tradeCandle of relevantTradeCandles) {
                    // Skip if trade already closed
                    if (tradeClosed) break;
                    
                    // Track maximum favorable and unfavorable price movements
                    if (trade.type === 'long') {
                        const currentFavorable = (tradeCandle.high - trade.entryPrice) / trade.entryPrice * 100;
                        const currentUnfavorable = (tradeCandle.low - trade.entryPrice) / trade.entryPrice * 100;
                        
                        trade.maxFavorable = Math.max(trade.maxFavorable, currentFavorable);
                        trade.maxUnfavorable = Math.min(trade.maxUnfavorable, currentUnfavorable);
                    } else { // short
                        const currentFavorable = (trade.entryPrice - tradeCandle.low) / trade.entryPrice * 100;
                        const currentUnfavorable = (trade.entryPrice - tradeCandle.high) / trade.entryPrice * 100;
                        
                        trade.maxFavorable = Math.max(trade.maxFavorable, currentFavorable);
                        trade.maxUnfavorable = Math.min(trade.maxUnfavorable, currentUnfavorable);
                    }

                    // Check for trade timeout if maxTradeTimeMinutes is enabled
                    if (testConfig.maxTradeTimeMinutes > 0) {
                        const tradeTimeMs = tradeCandle.time - trade.entryTime;
                        const tradeTimeMinutes = tradeTimeMs / (1000 * 60);
                        
                        if (tradeTimeMinutes >= testConfig.maxTradeTimeMinutes) {
                            tradeClosed = true;
                            exitPrice = tradeCandle.close;
                            result = 'TIMEOUT';
                            finalTradeCandle = tradeCandle;
                            break;
                        }
                    }

                    // Check TP/SL conditions
                    if (!tradeClosed) {
                        if (trade.type === 'long') {
                            if (tradeCandle.high >= trade.takeProfitPrice) {
                                tradeClosed = true;
                                exitPrice = trade.takeProfitPrice;
                                result = 'TP';
                                finalTradeCandle = tradeCandle;
                                break;
                            } else if (tradeCandle.low <= trade.stopLossPrice) {
                                tradeClosed = true;
                                exitPrice = trade.stopLossPrice;
                                result = 'SL';
                                finalTradeCandle = tradeCandle;
                                break;
                            }
                        } else { // short
                            if (tradeCandle.low <= trade.takeProfitPrice) {
                                tradeClosed = true;
                                exitPrice = trade.takeProfitPrice;
                                result = 'TP';
                                finalTradeCandle = tradeCandle;
                                break;
                            } else if (tradeCandle.high >= trade.stopLossPrice) {
                                tradeClosed = true;
                                exitPrice = trade.stopLossPrice;
                                result = 'SL';
                                finalTradeCandle = tradeCandle;
                                break;
                            }
                        }
                    }
                }
            } else {
                // Using same timeframe for both pivot and trade execution
                const currentTradeCandle = currentPivotCandle;
                
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
                        finalTradeCandle = currentTradeCandle;
                    }
                }

                if (!tradeClosed) {
                    if (trade.type === 'long') {
                        if (currentTradeCandle.high >= trade.takeProfitPrice) {
                            tradeClosed = true;
                            exitPrice = trade.takeProfitPrice;
                            result = 'TP';
                            finalTradeCandle = currentTradeCandle;
                        } else if (currentTradeCandle.low <= trade.stopLossPrice) {
                            tradeClosed = true;
                            exitPrice = trade.stopLossPrice;
                            result = 'SL';
                            finalTradeCandle = currentTradeCandle;
                        }
                    } else { // short
                        if (currentTradeCandle.low <= trade.takeProfitPrice) {
                            tradeClosed = true;
                            exitPrice = trade.takeProfitPrice;
                            result = 'TP';
                            finalTradeCandle = currentTradeCandle;
                        } else if (currentTradeCandle.high >= trade.stopLossPrice) {
                            tradeClosed = true;
                            exitPrice = trade.stopLossPrice;
                            result = 'SL';
                            finalTradeCandle = currentTradeCandle;
                        }
                    }
                }
            }

            if (tradeClosed && finalTradeCandle) {
                // Apply exit slippage
                const exitSlippage = calculateSlippage(trade.size, testConfig);
                const slippageAdjustedExitPrice = applySlippage(exitPrice, trade.type, exitSlippage);
                
                // Calculate funding rate cost
                const fundingCost = calculateFundingRate(
                    testConfig, 
                    finalTradeCandle.time, 
                    trade.entryTime, 
                    trade.size, 
                    testConfig.leverage
                );
                
                // Calculate PnL using slippage-adjusted exit price
                const pnlPct = (trade.type === 'long' 
                    ? (slippageAdjustedExitPrice - trade.entryPrice) / trade.entryPrice 
                    : (trade.entryPrice - slippageAdjustedExitPrice) / trade.entryPrice) * testConfig.leverage;
                const grossPnl = trade.size * pnlPct;
                const tradingFee = (trade.size * testConfig.leverage * (testConfig.totalMakerFee / 100));
                const pnl = grossPnl - tradingFee - fundingCost;
                
                capital += pnl;
                
                // Check if account is liquidated
                if (capital <= 0) {
                    capital = 0; // Ensure capital never goes negative
                }

                // Find the correct exit index in the trade candles array
                let exitIndex = i; // Default to pivot candle index
                if (tradeCandles !== pivotCandles && finalTradeCandle) {
                    // Find the index of the final trade candle in the tradeCandles array
                    exitIndex = tradeCandles.findIndex(tc => tc.time === finalTradeCandle.time);
                    if (exitIndex === -1) exitIndex = i; // Fallback to pivot index
                }

                trades.push({
                    ...trade,
                    exitPrice: slippageAdjustedExitPrice,
                    originalExitPrice: exitPrice,  // Store original exit price before slippage
                    exitTime: finalTradeCandle.time,
                    exitIndex: exitIndex,
                    status: 'closed',
                    result,
                    grossPnl,
                    pnl,
                    tradingFee,
                    fundingCost,
                    exitSlippage: exitSlippage * 100,  // Store exit slippage percentage for reporting
                    capitalAfter: capital
                });
                
                // Remove this trade from openTrades array
                openTrades.splice(j, 1);
            }
        }

        // Process high pivots
        const isHighPivot = detectPivot(pivotCandles, i, lookback, 'high');
        
        if (isHighPivot) {
            const swingPct = lastPivot.price ? (currentPivotCandle.close - lastPivot.price) / lastPivot.price : 0;
            const isFirstPivot = lastPivot.type === null;
            
            if ((isFirstPivot || Math.abs(swingPct) >= swingThreshold) && (i - lastPivot.index) >= minLegBarsParam_val) {
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
                            const shortTrade = createTrade('short', currentPivotCandle, lastPivot, i, tradeSize, takeProfit, stopLoss);
                            openTrades.push(shortTrade);
                        }
                    }
                }
            }
        }

        // Process low pivots
        const isLowPivot = detectPivot(pivotCandles, i, lookback, 'low');
        
        if (isLowPivot) {
            const swingPct = lastPivot.price ? (currentPivotCandle.close - lastPivot.price) / lastPivot.price : 0;
            const isFirstPivot = lastPivot.type === null;
            
            if ((isFirstPivot || Math.abs(swingPct) >= swingThreshold) && (i - lastPivot.index) >= minLegBarsParam_val) {
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
                            const longTrade = createTrade('long', currentPivotCandle, lastPivot, i, tradeSize, takeProfit, stopLoss);
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
        minSwingPct: minSwingPctParam,
        minLegBars: minLegBarsParam_val,
        pivotLookback: lookback,
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
    
    // Display the appropriate title based on the mode
    const modeText = pivotDetectionMode === 'extreme' ? 'Extreme (High/Low)' : 'Close';
    if (useEdges) {
        console.log(`${colors.cyan}=== ${modeText} Pivot Optimizer with Pre-Computed Edge Data ===${colors.reset}`);
    } else if (useLocalData) {
        console.log(`${colors.cyan}=== ${modeText} Pivot Optimizer with Standard CSV Data ===${colors.reset}`);
    } else {
        console.log(`${colors.cyan}=== ${modeText} Pivot Optimizer with Live API Data ===${colors.reset}`);
    }
    
    console.log(`Symbol: ${symbol}, Interval: ${interval}`);
    console.log(`Pivot Detection Mode: ${pivotDetectionMode.charAt(0).toUpperCase() + pivotDetectionMode.slice(1)}`);
    console.log(`Take Profit Range: ${optimizerConfig.takeProfitRange.start} to ${optimizerConfig.takeProfitRange.end} with step ${optimizerConfig.takeProfitRange.step}`);
    console.log(`Stop Loss Range: ${optimizerConfig.stopLossRange.start} to ${optimizerConfig.stopLossRange.end} with step ${optimizerConfig.stopLossRange.step}`);
    console.log(`Leverage Range: ${optimizerConfig.leverageRange.start} to ${optimizerConfig.leverageRange.end} with step ${optimizerConfig.leverageRange.step}`);
    console.log(`Min Swing % Range: ${optimizerConfig.minSwingPctRange.start} to ${optimizerConfig.minSwingPctRange.end} with step ${optimizerConfig.minSwingPctRange.step}`);
    console.log(`Min Leg Bars Range: ${optimizerConfig.minLegBarsRange.start} to ${optimizerConfig.minLegBarsRange.end} with step ${optimizerConfig.minLegBarsRange.step}`);
    console.log(`Pivot Lookback Range: ${optimizerConfig.pivotLookbackRange.start} to ${optimizerConfig.pivotLookbackRange.end} with step ${optimizerConfig.pivotLookbackRange.step}`);
    
    // Display direction with alternate mode explanation
    let directionDisplay = tradeConfig.direction;
    if (tradeConfig.direction === 'alternate') {
        directionDisplay = 'alternate (LONG at highs, SHORT at lows)';
    }
    console.log(`Direction: ${colors.yellow}${directionDisplay}${colors.reset}`);
    
    console.log(`Initial Capital: ${colors.yellow}${tradeConfig.initialCapital} USDT${colors.reset}`);
    console.log(`Risk Per Trade: ${colors.yellow}${tradeConfig.riskPerTrade}%${colors.reset}`);
    console.log(`Maker Fee: ${colors.yellow}${tradeConfig.totalMakerFee}%${colors.reset}`);
    
    // Display funding rate and slippage settings
    if (tradeConfig.enableFundingRate) {
        const fundingModeDisplay = tradeConfig.fundingRateMode === 'variable' 
            ? `Variable (${tradeConfig.variableFundingMin}% to ${tradeConfig.variableFundingMax}%)`
            : `Fixed (${tradeConfig.fundingRatePercent}%)`;
        console.log(`Funding Rate: ${colors.yellow}${fundingModeDisplay} every ${tradeConfig.fundingRateHours}h${colors.reset}`);
    } else {
        console.log(`Funding Rate: ${colors.red}Disabled${colors.reset}`);
    }

    if (tradeConfig.enableSlippage) {
        let slippageModeDisplay = '';
        switch (tradeConfig.slippageMode) {
            case 'fixed':
                slippageModeDisplay = `Fixed (${tradeConfig.slippagePercent}%)`;
                break;
            case 'variable':
                slippageModeDisplay = `Variable (${tradeConfig.variableSlippageMin}% to ${tradeConfig.variableSlippageMax}%)`;
                break;
            case 'market_impact':
                slippageModeDisplay = `Market Impact (${tradeConfig.slippagePercent}% + ${tradeConfig.marketImpactFactor}% per 1000 USDT)`;
                break;
            default:
                slippageModeDisplay = `Fixed (${tradeConfig.slippagePercent}%)`;
        }
        console.log(`Slippage: ${colors.yellow}${slippageModeDisplay}${colors.reset}`);
    } else {
        console.log(`Slippage: ${colors.red}Disabled${colors.reset}`);
    }
    
    console.log();
    
    // Load candle data once for all optimizations
    await loadCandlesOnce();
    
    // Pre-compute all pivots once for all optimizations
    computePivotsOnce();
    
    // Create header for CSV file
    const csvHeader = 'takeProfit,stopLoss,leverage,minSwingPct,minLegBars,pivotLookback,totalTrades,winRate,tpRate,slRate,timeoutRate,profitFactor,netGain,netGainPct,initialCapital,finalCapital,avgWin,avgLoss\n';
    fs.writeFileSync(RESULTS_CSV_FILE, csvHeader);
    
    const results = [];
    let totalCombinations = 0;
    
    // Generate all combinations including leverage and pivot parameters
    const combinations = [];
    for (let tp = optimizerConfig.takeProfitRange.start; tp <= optimizerConfig.takeProfitRange.end; tp += optimizerConfig.takeProfitRange.step) {
        for (let sl = optimizerConfig.stopLossRange.start; sl <= optimizerConfig.stopLossRange.end; sl += optimizerConfig.stopLossRange.step) {
            for (let lev = optimizerConfig.leverageRange.start; lev <= optimizerConfig.leverageRange.end; lev += optimizerConfig.leverageRange.step) {
                for (let minSwing = optimizerConfig.minSwingPctRange.start; minSwing <= optimizerConfig.minSwingPctRange.end; minSwing += optimizerConfig.minSwingPctRange.step) {
                    for (let minLeg = optimizerConfig.minLegBarsRange.start; minLeg <= optimizerConfig.minLegBarsRange.end; minLeg += optimizerConfig.minLegBarsRange.step) {
                        for (let lookback = optimizerConfig.pivotLookbackRange.start; lookback <= optimizerConfig.pivotLookbackRange.end; lookback += optimizerConfig.pivotLookbackRange.step) {
                            combinations.push({ 
                                tp, 
                                sl, 
                                leverage: lev, 
                                minSwingPct: minSwing, 
                                minLegBars: minLeg, 
                                pivotLookback: lookback 
                            });
                            totalCombinations++;
                        }
                    }
                }
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
                        const csvLine = `${result.takeProfit},${result.stopLoss},${result.leverage},${result.minSwingPct},${result.minLegBars},${result.pivotLookback},${result.totalTrades},${result.winRate.toFixed(2)},${result.tpRate.toFixed(2)},${result.slRate.toFixed(2)},${result.timeoutRate.toFixed(2)},${result.profitFactor.toFixed(2)},${formatNumber(result.netGain)},${result.netGainPct.toFixed(2)},${formatNumber(result.initialCapital)},${formatNumber(result.finalCapital)},${formatNumber(result.avgWin)},${formatNumber(result.avgLoss)}\n`;
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
                            
                            // Only log parameter values every 10% or final result
                            if (progressPct % 10 < 1 || completedCombinations === totalCombinations) {
                                process.stdout.write('\n');
                                console.log(`Current: TP ${message.data.tp.toFixed(2)}%, SL ${message.data.sl.toFixed(2)}%, Lev ${message.data.leverage}x, Swing ${message.data.minSwingPct}%, MinLeg ${message.data.minLegBars}, Lookback ${message.data.pivotLookback}`);
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
        console.log(`${i+1}. TP: ${r.takeProfit.toFixed(2)}%, SL: ${r.stopLoss.toFixed(2)}%, Lev: ${r.leverage}x, Swing: ${r.minSwingPct}%, MinLeg: ${r.minLegBars}, Lookback: ${r.pivotLookback}`);
        console.log(`    Trades: ${r.totalTrades}, Win Rate: ${r.winRate.toFixed(2)}%, Net Gain: ${r.netGainPct.toFixed(2)}% ($${formatNumber(r.netGain)}), Capital: $${formatNumber(r.finalCapital)}, Profit Factor: ${r.profitFactor.toFixed(2)}\n`);
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
                data: { 
                    tp: combo.tp, 
                    sl: combo.sl, 
                    leverage: combo.leverage, 
                    minSwingPct: combo.minSwingPct, 
                    minLegBars: combo.minLegBars, 
                    pivotLookback: combo.pivotLookback 
                }
            });
            
            // Run the backtest
            const result = await runBacktest(
                combo.tp, 
                combo.sl, 
                combo.leverage, 
                combo.minSwingPct, 
                combo.minLegBars, 
                combo.pivotLookback
            );
            
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
