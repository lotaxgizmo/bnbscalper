// pivotFronttester.js
// Real-time pivot detection and trading system with live WebSocket data

import {
    symbol,
    time as interval,
    limit,
    minSwingPct,
    pivotLookback,
    minLegBars,
    pivotDetectionMode
} from './config/config.js';

import { tradeConfig } from './config/tradeconfig.js';
import { fronttesterconfig } from './config/fronttesterconfig.js';
// Removed bybit.js dependency - using embedded API calls
import { connectWebSocket } from './apis/bybit_ws.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get the directory name in a way that works with ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Embedded Bybit API functionality for fronttester (always uses live API data)
const getCandles = async (symbol, interval, limit, customEndTime = null) => {
    const axios = (await import('axios')).default;
    const BASE_URL = 'https://api.bybit.com/v5';
    
    try {
        const allCandles = [];
        let remainingLimit = limit;
        let endTime = customEndTime || Date.now();
        const isSingleCandle = limit === 1; // Track if this is a single candle fetch

        // Convert interval to Bybit format
        const intervalMap = {
            '1m': '1',
            '3m': '3', 
            '5m': '5',
            '15m': '15',
            '30m': '30',
            '1h': '60',
            '2h': '120',
            '4h': '240',
            '6h': '360',
            '12h': '720',
            '1d': 'D',
            '1M': 'M',
            '1w': 'W'
        };

        const bybitInterval = intervalMap[interval] || interval;
        
        // Only show fetching message for bulk operations (not single candles)
        if (!isSingleCandle) {
            console.log(`${colors.cyan}Fetching ${limit} candles from Bybit API for ${symbol} ${interval}...${colors.reset}`);
        }
        
        while (remainingLimit > 0) {
            const batchLimit = Math.min(remainingLimit, 1000);
            const response = await axios.get(`${BASE_URL}/market/kline`, {
                params: {
                    category: 'linear',
                    symbol,
                    interval: bybitInterval,
                    limit: batchLimit,
                    end: endTime
                }
            });

            if (!response.data?.result?.list || response.data.result.list.length === 0) {
                console.log(`${colors.yellow}No more candles available from API${colors.reset}`);
                break;
            }

            // Bybit returns newest first, so we need to reverse the array
            const candles = response.data.result.list.reverse().map(c => ({
                time: parseInt(c[0]), // Bybit API returns timestamps in milliseconds
                open: parseFloat(parseFloat(c[1]).toFixed(4)),
                high: parseFloat(parseFloat(c[2]).toFixed(4)),
                low: parseFloat(parseFloat(c[3]).toFixed(4)),
                close: parseFloat(parseFloat(c[4]).toFixed(4)),
                volume: parseFloat(parseFloat(c[5]).toFixed(4))
            }));

            allCandles.push(...candles);
            remainingLimit -= candles.length;

            if (candles.length < batchLimit) break;

            // Set endTime to the oldest candle's time minus 1ms for next batch
            endTime = candles[0].time - 1;
        }

        // Only show success message for bulk operations (not single candles)
        if (!isSingleCandle) {
            console.log(`${colors.green}Successfully fetched ${allCandles.length} candles from Bybit API${colors.reset}`);
        }
        
        return allCandles;
    } catch (error) {
        console.error(`${colors.red}Error fetching candles from Bybit API:${colors.reset}`, error.message);
        return [];
    }
};

// Paths for data sources
const CANDLES_WITH_EDGES_FILE = path.join(__dirname, 'data', 'BTCUSDT_1m_40320_candles_with_edges.json');
const CSV_DATA_FILE = path.join(__dirname, 'data', 'historical', symbol, `${interval}.csv`);
const MINUTE_CSV_DATA_FILE = path.join(__dirname, 'data', 'historical', symbol, '1m.csv');

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

// Convert the interval string (e.g. "1m", "5m") to its numeric minute value
const intervalValue = parseInt(interval);

// Real-time system variables
let candleBuffer = []; // Rolling buffer of candles for pivot detection
let lastPivot = { type: null, price: null, time: 0, index: -1 }; // Initialize index to -1 so range starts from pivotLookback
let pivotCounter = 0;
let totalCandlesProcessed = 0; // Track total candles processed (not just buffer size)
let highPivotCount = 0;
let lowPivotCount = 0;
let currentIntervalEnd = null;
let lastProcessedIntervalEnd = null;
let lastPrice = null;

// Past mode simulation variables
let simulationCandles = []; // Full historical dataset for simulation
let simulationIndex = 0;    // Current position in simulation
let simulationTimer = null; // Timer for candle delivery
let simulationStartTime = null; // When simulation started

// Trade state variables
let capital = tradeConfig.initialCapital;
const trades = [];
const openTrades = [];
let tradeMaxDrawdown = 0;
let tradeMaxProfit = 0;

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

// Format pivot output for both high and low pivots
const formatPivotOutput = (pivotType, pivotCounter, pivotPrice, formattedTime, movePct, barsSinceLast, lastPivot, swingCandles) => {
    const pivotColor = pivotType === 'high' ? colors.green : colors.red;
    const movePrefix = pivotType === 'high' ? '+' : ''; // High pivots show + sign, low pivots don't need it as they're negative
    
    let output = `\n ${pivotColor}${pivotCounter}.[PIVOT] ${pivotType.toUpperCase()} @ ${pivotPrice.toFixed(2)} | Time: ${formattedTime} | Move: ${movePrefix}${movePct.toFixed(2)}% | Bars: ${barsSinceLast}${colors.reset}`;
    
    if (lastPivot.price && swingCandles) {
        const swingATL = Math.min(...swingCandles.map(c => c.low));
        const swingATH = Math.max(...swingCandles.map(c => c.high));
        
        const swingLowPct = ((swingATL - lastPivot.price) / lastPivot.price) * 100;
        const swingHighPct = ((swingATH - lastPivot.price) / lastPivot.price) * 100;
        
        const swingLowText = `${colors.red}${swingATL.toFixed(2)} (${swingLowPct.toFixed(2)}%)${colors.reset}`;
        const swingHighText = `${colors.green}${swingATH.toFixed(2)} (${swingHighPct.toFixed(2)}%)${colors.reset}`;
        output += ` | ${colors.cyan}Swing Low:${colors.reset} ${swingLowText} | ${colors.cyan}Swing High:${colors.reset} ${swingHighText}`;
    }
    
    return output;
};

// Helper function to get pivot price based on detection mode
const getPivotPrice = (candle, pivotType) => {
    if (pivotDetectionMode === 'extreme') {
        return pivotType === 'high' ? candle.high : candle.low;
    } else {
        return candle.close; // default 'close' mode
    }
};

// Helper function to detect pivots using configurable price mode - LEFT-SIDE ONLY LIKE BACKTESTER
const detectPivot = (candles, i, pivotLookback, pivotType) => {
    // Must have enough candles on left side
    if (i < pivotLookback) {
        return false;
    }
    
    // Get current and comparison prices based on detection mode
    const getCurrentPrice = (candle) => {
        if (pivotDetectionMode === 'extreme') {
            return pivotType === 'high' ? candle.high : candle.low;
        } else {
            return candle.close; // default 'close' mode
        }
    };
    
    const currentPrice = getCurrentPrice(candles[i]);
    
    // Check LEFT side (backward lookback) ONLY - EXACTLY LIKE BACKTESTER
    for (let j = 1; j <= pivotLookback; j++) {
        const comparePrice = getCurrentPrice(candles[i - j]);
        
        if (pivotType === 'high') {
            if (currentPrice <= comparePrice) {
                return false;
            }
        } else { // low pivot
            if (currentPrice >= comparePrice) {
                return false;
            }
        }
    }
    
    return true;
};

// Helper function to format percentage with color
const formatPercentageWithColor = (pct, includeSign = true) => {
    const pctSign = includeSign && pct >= 0 ? '+' : '';
    const pctColor = pct >= 0 ? colors.green : colors.red;
    return `${pctColor}${pctSign}${pct.toFixed(2)}%${colors.reset}`;
};

// Helper function to format edge data display - COPY EXACT SAME LOGIC FROM CANDLE DISPLAY
const formatEdgeData = (currentCandle, edgeCandles, timeframes) => {
    const edgeDisplayData = [];
    
    // COPY THE EXACT SAME LOGIC FROM THE CANDLE DISPLAY SECTION
    let dailyPct = null, weeklyPct = null, biweeklyPct = null, monthlyPct = null;

    // Find the reference candle from 24 hours ago for the daily edge
    const twentyFourHoursAgo = currentCandle.time - (24 * 60 * 60 * 1000);
    let referenceCandle = null;
            
    // Find the closest candle to 24 hours ago
    for (let j = 0; j < edgeCandles.length; j++) {
        if (edgeCandles[j].time >= twentyFourHoursAgo) {
            referenceCandle = edgeCandles[j];
            break;
        }
    }
            
    // Calculate the daily edge percentage
    if (referenceCandle) {
        dailyPct = ((currentCandle.close - referenceCandle.open) / referenceCandle.open) * 100;
    }
            
    // Find the reference candle from 7 days ago for the weekly edge
    const sevenDaysAgo = currentCandle.time - (7 * 24 * 60 * 60 * 1000);
    let weeklyReferenceCandle = null;

    for (let j = 0; j < edgeCandles.length; j++) {
        if (edgeCandles[j].time >= sevenDaysAgo) {
            weeklyReferenceCandle = edgeCandles[j];
            break;
        }
    }

    // Calculate the weekly edge percentage
    if (weeklyReferenceCandle) {
        weeklyPct = ((currentCandle.close - weeklyReferenceCandle.open) / weeklyReferenceCandle.open) * 100;
    }

    // Find the reference candle from 14 days ago for the bi-weekly edge
    const fourteenDaysAgo = currentCandle.time - (14 * 24 * 60 * 60 * 1000);
    let biweeklyReferenceCandle = null;

    for (let j = 0; j < edgeCandles.length; j++) {
        if (edgeCandles[j].time >= fourteenDaysAgo) {
            biweeklyReferenceCandle = edgeCandles[j];
            break;
        }
    }

    // Calculate the bi-weekly edge percentage
    if (biweeklyReferenceCandle) {
        biweeklyPct = ((currentCandle.close - biweeklyReferenceCandle.open) / biweeklyReferenceCandle.open) * 100;
    }

    // Find the reference candle from 30 days ago for the monthly edge
    const thirtyDaysAgo = currentCandle.time - (30 * 24 * 60 * 60 * 1000);
    let monthlyReferenceCandle = null;

    for (let j = 0; j < edgeCandles.length; j++) {
        if (edgeCandles[j].time >= thirtyDaysAgo) {
            monthlyReferenceCandle = edgeCandles[j];
            break;
        }
    }

    // Calculate the monthly edge percentage
    if (monthlyReferenceCandle) {
        monthlyPct = ((currentCandle.close - monthlyReferenceCandle.open) / monthlyReferenceCandle.open) * 100;
    }

    // --- Ranged Edge Calculation (Highest High to Lowest Low) ---
    const timeframesForRange = {
        'Daily': 1,
        'Weekly': 7,
        'Bi-Weekly': 14,
        'Monthly': 30
    };

    let totalRangeParts = [];
    let breakoutRangeParts = [];

    for (const [name, days] of Object.entries(timeframesForRange)) {
        const startTime = currentCandle.time - (days * 24 * 60 * 60 * 1000);
        const candlesInRange = edgeCandles.filter(c => c.time >= startTime && c.time <= currentCandle.time);

        if (candlesInRange.length > 0) {
            const referencePrice = candlesInRange[0].open;
            const maxHigh = Math.max(...candlesInRange.map(c => c.high));
            const minLow = Math.min(...candlesInRange.map(c => c.low));

            // 1. Total Range Calculation (High vs Low)
            const totalRangePct = ((maxHigh - minLow) / minLow) * 100;
            totalRangeParts.push(`${name}: ${totalRangePct.toFixed(2)}%`);

            // 2. Breakout Range Calculation (High/Low vs Start)
            const upwardRangePct = ((maxHigh - referencePrice) / referencePrice) * 100;
            const downwardRangePct = ((minLow - referencePrice) / referencePrice) * 100;
            breakoutRangeParts.push(`${name}: ${formatPercentageWithColor(upwardRangePct)} / ${formatPercentageWithColor(downwardRangePct)}`);
        }
    }

    // --- Average Range Calculations ---
    const avgLookbackPeriods = { 'Daily': 7, 'Weekly': 4, 'Bi-Weekly': 4, 'Monthly': 4 };
    let avgBreakoutParts = [];

    for (const [name, lookback] of Object.entries(avgLookbackPeriods)) {
        const daysInPeriod = name === 'Daily' ? 1 : name === 'Weekly' ? 7 : name === 'Bi-Weekly' ? 14 : 30;
        let periodUpwardRanges = [];
        let periodDownwardRanges = [];

        for (let i = 0; i < lookback; i++) {
            const periodEndTime = currentCandle.time - (i * daysInPeriod * 24 * 60 * 60 * 1000);
            const periodStartTime = periodEndTime - (daysInPeriod * 24 * 60 * 60 * 1000);
            const candlesInPeriod = edgeCandles.filter(c => c.time >= periodStartTime && c.time < periodEndTime);

            if (candlesInPeriod.length > 0) {
                const referencePrice = candlesInPeriod[0].open;
                const maxHigh = Math.max(...candlesInPeriod.map(c => c.high));
                const minLow = Math.min(...candlesInPeriod.map(c => c.low));

                periodUpwardRanges.push(((maxHigh - referencePrice) / referencePrice) * 100);
                periodDownwardRanges.push(((minLow - referencePrice) / referencePrice) * 100);
            }
        }

        if (periodUpwardRanges.length > 0 && periodDownwardRanges.length > 0) {
            const avgUpward = periodUpwardRanges.reduce((a, b) => a + b, 0) / periodUpwardRanges.length;
            const avgDownward = periodDownwardRanges.reduce((a, b) => a + b, 0) / periodDownwardRanges.length;
            avgBreakoutParts.push(`${name}: ${formatPercentageWithColor(avgUpward)} / ${formatPercentageWithColor(avgDownward)}`);
        }
    }
    
    // Format the main edge line
    let edgeLine = `${colors.yellow}Edges:${colors.reset} `;
    if (dailyPct !== null) edgeLine += `D:${formatPercentageWithColor(dailyPct)} `;
    if (weeklyPct !== null) edgeLine += `W:${formatPercentageWithColor(weeklyPct)} `;
    if (biweeklyPct !== null) edgeLine += `B:${formatPercentageWithColor(biweeklyPct)} `;
    if (monthlyPct !== null) edgeLine += `M:${formatPercentageWithColor(monthlyPct)} `;
    
    edgeLine += ` |  ${colors.cyan}Total Range:${colors.reset} `;
    edgeLine += totalRangeParts.join(' ');
    
    edgeLine += ` |  ${colors.magenta}Average Range:${colors.reset} `;
    // Calculate average ranges from the same logic as candle display
    const avgLookback = { 'Daily': 7, 'Weekly': 4, 'Bi-Weekly': 4, 'Monthly': 4 };
    let avgRangeParts = [];
    
    for (const [name, lookback] of Object.entries(avgLookback)) {
        const daysInPeriod = name === 'Daily' ? 1 : name === 'Weekly' ? 7 : name === 'Bi-Weekly' ? 14 : 30;
        let periodTotalRanges = [];

        for (let i = 0; i < lookback; i++) {
            const periodEndTime = currentCandle.time - (i * daysInPeriod * 24 * 60 * 60 * 1000);
            const periodStartTime = periodEndTime - (daysInPeriod * 24 * 60 * 60 * 1000);
            const candlesInPeriod = edgeCandles.filter(c => c.time >= periodStartTime && c.time < periodEndTime);

            if (candlesInPeriod.length > 0) {
                const maxHigh = Math.max(...candlesInPeriod.map(c => c.high));
                const minLow = Math.min(...candlesInPeriod.map(c => c.low));
                periodTotalRanges.push(((maxHigh - minLow) / minLow) * 100);
            }
        }

        if (periodTotalRanges.length > 0) {
            const avgTotalRange = periodTotalRanges.reduce((a, b) => a + b, 0) / periodTotalRanges.length;
            avgRangeParts.push(`${name}: ${avgTotalRange.toFixed(2)}%`);
        }
    }
    
    edgeLine += avgRangeParts.join(' ');
    edgeDisplayData.push(edgeLine);
    
    // Add DEBUG lines
    let debugLine1 = `    ${colors.blue}    [DEBUG] Range Breakout:${colors.reset} `;
    debugLine1 += breakoutRangeParts.join(' | ');
    edgeDisplayData.push(debugLine1);
    
    let debugLine2 = `    ${colors.blue}[DEBUG] Avg Range Breakout:${colors.reset} `;
    debugLine2 += avgBreakoutParts.join(' | ');
    edgeDisplayData.push(debugLine2);
    
    // Add a blank line for better readability after each pivot
    edgeDisplayData.push('');
    
    return edgeDisplayData;
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
const createTrade = (type, currentCandle, pivotData, i, tradeSize, tradeConfig) => {
    let entryPrice = currentCandle.close; // Use close price for trade entry
    
    // Apply entry slippage
    const entrySlippage = calculateSlippage(tradeSize, tradeConfig);
    entryPrice = applySlippage(entryPrice, type, entrySlippage);
    
    // Use the provided trade size directly instead of calculating from capital
    const size = tradeSize;
    
    // Calculate TP/SL differently based on trade type (using original entry price for calculation)
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
        maxUnfavorable: 0,  // Track maximum unfavorable price movement
        entrySlippage: entrySlippage * 100,  // Store entry slippage percentage for reporting
        lastFundingTime: currentCandle.time  // Track last funding payment time
    };
};

const displayCandleInfo = (candle, candleNumber, pivotType = null) => {
    const formattedTime = new Date(candle.time).toLocaleString();
    const o = candle.open.toFixed(2);
    const h = candle.high.toFixed(2);
    const l = candle.low.toFixed(2);
    const c = candle.close.toFixed(2);
    const cColor = c >= o ? colors.green : colors.red;

    let pivotIndicator = '   ';
    if (pivotType) {
        const pivotColor = pivotType === 'high' ? colors.green : colors.red;
        const pivotArrow = pivotType === 'high' ? '▲ H' : '▼ L';
        pivotIndicator = `${pivotColor}${pivotArrow}${colors.reset}`;
    }

    console.log(`  ${(candleNumber).toString().padStart(5, ' ')} | ${pivotIndicator} | ${formattedTime} | O: ${o} H: ${h} L: ${l} C: ${cColor}${c}${colors.reset} `);
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

// Helper function to get current interval start and end times
const getIntervalBoundaries = (timestamp, intervalMinutes) => {
    const date = new Date(timestamp);
    
    // Reset seconds and milliseconds
    date.setSeconds(0, 0);
    
    // Calculate the current interval start by rounding down to the nearest interval
    const currentMinutes = date.getMinutes();
    const intervalStart = Math.floor(currentMinutes / intervalMinutes) * intervalMinutes;
    date.setMinutes(intervalStart);
    
    const start = date.getTime();
    const end = start + (intervalMinutes * 60 * 1000);
    
    return { start, end };
};

// Display header information
const modeDisplay = fronttesterconfig.pastMode ? `Past Mode Simulation (${fronttesterconfig.speedMultiplier}x speed)` : 'Live Pivot Trading';
console.log(`${colors.cyan}=== BNB Scalper Fronttester - ${modeDisplay} ===${colors.reset}`);
console.log(`${colors.yellow}Symbol: ${symbol} | Interval: ${interval}${colors.reset}`);
if (fronttesterconfig.pastMode) {
    console.log(`${colors.magenta}Simulation Speed: ${fronttesterconfig.speedMultiplier}x | Candle Interval: ${60000 / fronttesterconfig.speedMultiplier}ms${colors.reset}`);
}
console.log(`${colors.magenta}Started at: ${new Date().toLocaleString()}${colors.reset}`);
console.log(`${colors.cyan}=================================================${colors.reset}\n`);

// Display trade configuration
console.log(`${colors.cyan}--- Trade Configuration ---${colors.reset}`);
let directionDisplay = tradeConfig.direction;
if (tradeConfig.direction === 'alternate') {
    directionDisplay = 'alternate (LONG at highs, SHORT at lows)';
}
console.log(`Direction: ${colors.yellow}${directionDisplay}${colors.reset}`);
console.log(`Pivot Detection Mode: ${colors.yellow}${pivotDetectionMode === 'extreme' ? 'Extreme (High/Low)' : 'Close'}${colors.reset}`);
console.log(`Take Profit: ${colors.green}${tradeConfig.takeProfit}%${colors.reset}`);
console.log(`Stop Loss: ${colors.red}${tradeConfig.stopLoss}%${colors.reset}`);
console.log(`Leverage: ${colors.yellow}${tradeConfig.leverage}x${colors.reset}`);
console.log(`Maker Fee: ${colors.yellow}${tradeConfig.totalMakerFee}%${colors.reset}`);
console.log(`Initial Capital: ${colors.yellow}${tradeConfig.initialCapital} USDT${colors.reset}`);
console.log(`Risk Per Trade: ${colors.yellow}${tradeConfig.riskPerTrade}%${colors.reset}`);

// Display position sizing mode
let positionSizingDisplay = '';
if (tradeConfig.positionSizingMode === 'fixed') {
    positionSizingDisplay = `Fixed (${tradeConfig.amountPerTrade} USDT)`;
} else if (tradeConfig.positionSizingMode === 'minimum') {
    positionSizingDisplay = `Minimum (${tradeConfig.riskPerTrade}% min ${tradeConfig.minimumTradeAmount} USDT)`;
} else {
    positionSizingDisplay = `Percentage (${tradeConfig.riskPerTrade}%)`;
}
console.log(`Position Sizing: ${colors.yellow}${positionSizingDisplay}${colors.reset}`);

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

// Function to get edge data for a current price from pre-computed data
const getCurrentEdgeData = (currentPrice, candle, edges, timeframes) => {
    // Check if the candle already has pre-computed edge data
    if (candle && candle.edges) {
        // Debug log to see what edge data is available
        // console.log('Found edge data for candle:', new Date(candle.time).toLocaleString(), Object.keys(candle.edges));
        return candle.edges;
    }
    
    // If no pre-computed edges, return empty result
    // console.warn('No pre-computed edge data found for candle:', new Date(candle.time).toLocaleString());
    return {};
};



// Format the price with color based on change
const formatPrice = (price, previousPrice) => {
    if (previousPrice === null || isNaN(previousPrice) || isNaN(price)) {
        return `${price}`;
    }
    
    const change = price - previousPrice;
    const color = change >= 0 ? colors.green : colors.red;
    const sign = change >= 0 ? '+' : '';
    const changePct = (change / previousPrice) * 100;
    
    return `${color}${price} (${sign}${change.toFixed(2)} | ${sign}${changePct.toFixed(4)}%)${colors.reset}`;
};

// Format a complete candle with colors
const formatCandle = (candle) => {
    if (!candle) {
        return `${colors.red}Invalid candle data${colors.reset}`;
    }
    
    const { open, high, low, close, volume, time: timestamp } = candle;
    
    const candleDate = new Date(timestamp);
    const timeStr = candleDate.toLocaleTimeString();
    const dateStr = candleDate.toLocaleDateString();
    
    const direction = close >= open ? colors.green : colors.red;
    const change = close - open;
    const changePct = (change / open) * 100;
    const sign = change >= 0 ? '+' : '';
    const range = high - low;
    const rangePct = (range / low) * 100;
    
    return [
        `${colors.bold}${colors.cyan}CANDLE CLOSED [${interval}] at ${timeStr} (${dateStr})${colors.reset}`,
        `${colors.bold}O: ${colors.yellow}${open.toFixed(4)}${colors.reset}`,
        `${colors.bold}H: ${colors.brightGreen}${high.toFixed(4)}${colors.reset}`,
        `${colors.bold}L: ${colors.brightRed}${low.toFixed(4)}${colors.reset}`,
        `${colors.bold}C: ${direction}${close.toFixed(4)}${colors.reset}`,
        `${direction}Change: ${sign}${change.toFixed(4)} (${sign}${changePct.toFixed(4)}%)${colors.reset}`,
        `${colors.magenta}Range: ${range.toFixed(4)} (${rangePct.toFixed(4)}%)${colors.reset}`,
        `${colors.yellow}Volume: ${volume.toFixed(2)}${colors.reset}`
    ].join(' | ');
};

// Initialize simulation mode with historical data
async function initializeSimulation() {
    try {
        if (fronttesterconfig.showSystemStatus) {
            console.log(`${colors.cyan}Loading historical data for simulation...${colors.reset}`);
        }
        
        // Load full historical dataset
        const fullLimit = fronttesterconfig.simulationLength || limit;
        const allCandles = await getCandles(symbol, interval, fullLimit);
        
        if (!allCandles || allCandles.length === 0) {
            throw new Error('Failed to fetch simulation candles');
        }
        
        // Sort candles chronologically
        simulationCandles = allCandles.sort((a, b) => a.time - b.time);
        
        if (fronttesterconfig.showSystemStatus) {
            console.log(`${colors.green}Loaded ${simulationCandles.length} candles for simulation${colors.reset}`);
            console.log(`${colors.yellow}Simulation period: ${new Date(simulationCandles[0].time).toLocaleString()} to ${new Date(simulationCandles[simulationCandles.length - 1].time).toLocaleString()}${colors.reset}`);
        }
        
        // Initialize with first batch for pivot detection
        const initialBatchSize = Math.min(pivotLookback * 2 + 10, simulationCandles.length);
        candleBuffer = simulationCandles.slice(0, initialBatchSize);
        simulationIndex = initialBatchSize;
        totalCandlesProcessed = candleBuffer.length;
        
        // Detect initial pivots
        await analyzeInitialPivots();
        
        // Start simulation
        startSimulation();
        
    } catch (error) {
        console.error(`${colors.red}Failed to initialize simulation:${colors.reset}`, error);
        process.exit(1);
    }
}

// Start the simulation timer
function startSimulation() {
    const intervalMs = 60000 / fronttesterconfig.speedMultiplier; // 60 seconds / speed multiplier
    simulationStartTime = Date.now();
    
    if (fronttesterconfig.showSystemStatus) {
        console.log(`${colors.green}\n🚀 Starting simulation at ${fronttesterconfig.speedMultiplier}x speed (${intervalMs}ms per candle)${colors.reset}`);
        console.log(`${colors.cyan}Remaining candles to simulate: ${simulationCandles.length - simulationIndex}${colors.reset}\n`);
        
        // Show current position
        if (candleBuffer.length > 0 && !fronttesterconfig.hideCandles) {
            const latestCandle = candleBuffer[candleBuffer.length - 1];
            console.log(`${colors.brightCyan}--- SIMULATION STARTING POSITION ---${colors.reset}`);
            console.log(`${formatCandle(latestCandle)}`);
            console.log(`${colors.brightCyan}--- Simulation will continue from here ---${colors.reset}\n`);
        }
    }
    
    // Start the simulation timer
    simulationTimer = setInterval(() => {
        deliverNextCandle();
    }, intervalMs);
}

// Deliver the next candle in simulation
function deliverNextCandle() {
    if (simulationIndex >= simulationCandles.length) {
        // Simulation complete
        clearInterval(simulationTimer);
        console.log(`${colors.green}\n🎯 Simulation completed! Processed ${simulationCandles.length} candles.${colors.reset}`);
        
        // Show final summary
        showSimulationSummary();
        return;
    }
    
    const nextCandle = simulationCandles[simulationIndex];
    simulationIndex++;
    
    // Add to buffer and maintain size limit
    candleBuffer.push(nextCandle);
    totalCandlesProcessed++;
    
    if (candleBuffer.length > limit) {
        candleBuffer.shift(); // Remove oldest candle
    }
    
    // Display the candle (same as live mode)
    if (!fronttesterconfig.hideCandles) {
        console.log(`\n${formatCandle(nextCandle)}`);
    }
    
    // Show progress
    if (fronttesterconfig.showProgress) {
        const remaining = simulationCandles.length - simulationIndex;
        const progress = ((simulationIndex / simulationCandles.length) * 100).toFixed(1);
        console.log(`${colors.cyan}Progress: ${progress}% | Remaining: ${remaining} candles${colors.reset}\n`);
    }
    
    // Process the candle (same logic as live mode)
    processNewCandle(nextCandle);
}

// Show simulation summary
function showSimulationSummary() {
    const duration = Date.now() - simulationStartTime;
    const durationSec = (duration / 1000).toFixed(1);
    
    console.log(`${colors.brightGreen}=== SIMULATION SUMMARY ===${colors.reset}`);
    console.log(`${colors.yellow}Total Candles Processed: ${simulationCandles.length}${colors.reset}`);
    console.log(`${colors.yellow}Simulation Duration: ${durationSec} seconds${colors.reset}`);
    console.log(`${colors.yellow}Speed Multiplier: ${fronttesterconfig.speedMultiplier}x${colors.reset}`);
    console.log(`${colors.yellow}Pivots Detected: ${pivotCounter}${colors.reset}`);
    console.log(`${colors.yellow}Trades Executed: ${trades.length}${colors.reset}`);
    console.log(`${colors.yellow}Final Capital: ${capital.toFixed(2)} USDT${colors.reset}`);
}

async function initializeSystem() {
    if (fronttesterconfig.pastMode) {
        await initializeSimulation();
        return;
    }
    
    // Original live mode initialization
    const reducedLimit = Math.min(1000, limit); // Load max 1000 candles for faster startup
    
    try {
        const initialCandles = await getCandles(symbol, interval, reducedLimit);
        
        if (!initialCandles || initialCandles.length === 0) {
            throw new Error('Failed to fetch initial candles');
        }
        
        // Sort candles chronologically and populate buffer
        candleBuffer = initialCandles.sort((a, b) => a.time - b.time);
        totalCandlesProcessed = candleBuffer.length; // Initialize with historical candles
        
        // Initialize interval tracking
        const now = Date.now();
        const boundaries = getIntervalBoundaries(now, intervalValue);
        currentIntervalEnd = boundaries.end;
        lastProcessedIntervalEnd = boundaries.start;
        
        // Detect initial pivots in the loaded data
        await analyzeInitialPivots();
        
        // Start WebSocket connection
        startRealTimeMonitoring();
        
    } catch (error) {
        console.error(`${colors.red}Failed to initialize system:${colors.reset}`, error);
        process.exit(1);
    }
}

// Analyze initial candles for existing pivots
async function analyzeInitialPivots() {
    let pivotsFound = 0;
    const maxPivotsToShow = 10;
    const allPivots = []; // Store all pivots to show the last ones
    
    // Analyze the loaded candles for pivots
    for (let i = pivotLookback; i < candleBuffer.length; i++) {
        const candle = candleBuffer[i];
        const swingThreshold = minSwingPct / 100;
        
        // Check for high pivot
        const isHighPivot = detectPivot(candleBuffer, i, pivotLookback, 'high');
        if (isHighPivot) {
            const pivotPrice = getPivotPrice(candle, 'high');
            const swingPct = lastPivot.price ? (pivotPrice - lastPivot.price) / lastPivot.price : 0;
            const isFirstPivot = lastPivot.type === null;
            
            if ((isFirstPivot || Math.abs(swingPct) >= swingThreshold) && (i - lastPivot.index) >= minLegBars) {
                pivotCounter++;
                highPivotCount++;
                pivotsFound++;
                
                const barsSinceLast = i - lastPivot.index;
                const movePct = swingPct * 100;
                const formattedTime = new Date(candle.time).toLocaleString();
                
                // Store pivot info for later display
                allPivots.push({
                    type: 'high',
                    counter: pivotCounter,
                    price: pivotPrice,
                    time: formattedTime,
                    movePct,
                    barsSinceLast
                });
                
                lastPivot = { type: 'high', price: pivotPrice, index: i, time: candle.time };
            }
        }
        
        // Check for low pivot
        const isLowPivot = detectPivot(candleBuffer, i, pivotLookback, 'low');
        if (isLowPivot) {
            const pivotPrice = getPivotPrice(candle, 'low');
            const swingPct = lastPivot.price ? (pivotPrice - lastPivot.price) / lastPivot.price : 0;
            const isFirstPivot = lastPivot.type === null;
            
            if ((isFirstPivot || Math.abs(swingPct) >= swingThreshold) && (i - lastPivot.index) >= minLegBars) {
                pivotCounter++;
                lowPivotCount++;
                pivotsFound++;
                
                const barsSinceLast = i - lastPivot.index;
                const movePct = swingPct * 100;
                const formattedTime = new Date(candle.time).toLocaleString();
                
                // Store pivot info for later display
                allPivots.push({
                    type: 'low',
                    counter: pivotCounter,
                    price: pivotPrice,
                    time: formattedTime,
                    movePct,
                    barsSinceLast
                });
                
                lastPivot = { type: 'low', price: pivotPrice, index: i, time: candle.time };
            }
        }
    }
    
    // Display the LAST maxPivotsToShow pivots
    const pivotsToShow = allPivots.slice(-maxPivotsToShow);
    pivotsToShow.forEach(pivot => {
        const icon = pivot.type === 'high' ? '📈' : '📉';
        const color = pivot.type === 'high' ? colors.brightGreen : colors.brightRed;
        const typeLabel = pivot.type.toUpperCase();
        console.log(`${color}${icon} ${typeLabel} PIVOT #${pivot.counter} @ ${pivot.price.toFixed(4)} (${pivot.time}) | Move: ${pivot.movePct.toFixed(2)}% | Bars: ${pivot.barsSinceLast}${colors.reset}`);
    });
    
    console.log(`${colors.cyan}Found ${pivotsFound} pivots in historical data (showing last ${Math.min(pivotsFound, maxPivotsToShow)})${colors.reset}`);
    
    // Simple approach: Just track the last pivot time for comparison
    if (fronttesterconfig.showDebug) {
        if (lastPivot.type) {
            console.log(`${colors.dim || ''}[DEBUG] Last historical pivot: ${lastPivot.type} @ ${lastPivot.price} (${new Date(lastPivot.time).toLocaleString()})${colors.reset || ''}`);
        } else {
            console.log(`${colors.dim || ''}[DEBUG] No historical pivots found. Starting fresh.${colors.reset || ''}`);
        }
    }
    
    if (fronttesterconfig.showSystemStatus) {
        console.log(`${colors.yellow}System ready for real-time pivot detection...${colors.reset}\n`);
    }
}

// Start real-time WebSocket monitoring
function startRealTimeMonitoring() {
    const ws = connectWebSocket(symbol, (data) => {
        handlePriceUpdate(data);
    });
    
    // Handle WebSocket connection events
    ws.on('open', () => {
        if (fronttesterconfig.showSystemStatus) {
            console.log(`${colors.green}✓ WebSocket connected - monitoring ${symbol}${colors.reset}`);
        }
        
        // Display the latest available candle so user knows where we're starting from
        if (!fronttesterconfig.hideCandles) {
            const latestCandle = candleBuffer[candleBuffer.length - 1];
            console.log(`\n${colors.brightCyan}--- CURRENT POSITION ---${colors.reset}`);
            console.log(`${formatCandle(latestCandle)}`);
            console.log(`${colors.brightCyan}--- Starting from here ---${colors.reset}`);
            
            // Show next candle time
            const nextCandleTime = new Date(currentIntervalEnd).toLocaleTimeString();
            console.log(`${colors.cyan}Next candle close at ${nextCandleTime}${colors.reset}\n`);
        }
        
        // Start heartbeat to show system is alive
        setInterval(() => {
            if (!hideCandle && fronttesterconfig.showHeartbeat) {
                const now = new Date().toLocaleTimeString();
                const nextCandle = new Date(currentIntervalEnd).toLocaleTimeString();
                console.log(`${colors.dim}[${now}] System monitoring... Next candle: ${nextCandle}${colors.reset}`);
            }
        }, 30000); // Every 30 seconds
    });
    
    ws.on('error', (error) => {
        if (fronttesterconfig.showSystemStatus) {
            console.error(`${colors.red}WebSocket error:${colors.reset}`, error);
        }
    });
    
    ws.on('close', () => {
        if (fronttesterconfig.showSystemStatus) {
            console.log(`${colors.yellow}WebSocket connection closed. Attempting to reconnect...${colors.reset}`);
        }
        setTimeout(() => startRealTimeMonitoring(), 5000);
    });
}

// Handle real-time price updates
function handlePriceUpdate(data) {
    if (!data || !data.price) return;
    
    const currentPrice = parseFloat(data.price);
    const timestamp = Date.now();
    
    // Update last price for display
    const priceDisplay = formatPrice(currentPrice, lastPrice);
    
    // Only show price updates if not hiding candles
    if (!hideCandle) {
        const timeStr = new Date(timestamp).toLocaleTimeString();
        const nextCandleTime = new Date(currentIntervalEnd).toLocaleTimeString();
        console.log(`${colors.white}[${timeStr}] ${symbol}: ${priceDisplay} | Next candle close at ${nextCandleTime}${colors.reset}`);
    }
    
    lastPrice = currentPrice;
    
    // Check if we've reached the end of the current interval
    if (timestamp >= currentIntervalEnd) {
        handleIntervalEnd(timestamp);
    }
}

// Handle interval end and fetch new candle
const handleIntervalEnd = async (timestamp) => {
    // First, calculate boundaries for the next interval and update currentIntervalEnd
    const boundaries = getIntervalBoundaries(timestamp, intervalValue);
    const previousIntervalEnd = currentIntervalEnd;
    currentIntervalEnd = boundaries.end;
    
    // Then fetch and display the latest completed candle
    await fetchLatestCandle();
    
    // Update tracking to the interval we just processed
    lastProcessedIntervalEnd = previousIntervalEnd;
};

// Fetch the latest completed candle and process it
const fetchLatestCandle = async () => {
    try {
        const latestCandles = await getCandles(symbol, interval, 1);
        
        if (latestCandles && latestCandles.length > 0) {
            const newCandle = latestCandles[0];
            
            // Add to buffer and maintain size limit
            candleBuffer.push(newCandle);
            totalCandlesProcessed++; // Track total candles processed
            
            if (candleBuffer.length > limit) {
                candleBuffer.shift(); // Remove oldest candle
            }
            
            // Display completed candles (controlled by hideCandles config)
            if (!fronttesterconfig.hideCandles) {
                console.log(`\n${formatCandle(newCandle)}`);
                const nextCandleTime = new Date(currentIntervalEnd).toLocaleTimeString();
                console.log(`${colors.cyan}Next candle close at ${nextCandleTime}${colors.reset}\n`);
            }
            
            // Process the new candle for pivot detection and trading
            await processNewCandle(newCandle);
            
        } else {
            console.error(`${colors.red}Failed to fetch latest candle${colors.reset}`);
        }
    } catch (error) {
        console.error(`${colors.red}Error fetching latest candle:${colors.reset}`, error);
    }
    
};

// Process new candle for pivot detection and trading - SIMULATION COMPATIBLE
const processNewCandle = async (newCandle) => {
    // Ensure we have enough candles for pivot detection
    if (candleBuffer.length < (pivotLookback * 2 + 1)) {
        console.log(`${colors.yellow}Waiting for more candles... (${candleBuffer.length}/${pivotLookback * 2 + 1})${colors.reset}`);
        return;
    }
    
    const swingThreshold = minSwingPct / 100;
    
    // Process active trades first
    await processActiveTrades(newCandle);
    
    // SEQUENTIAL APPROACH: Check for pivots at the current position
    // This mimics exactly how the backtester works - LEFT-SIDE ONLY
    const currentIndex = candleBuffer.length - 1;
    
    // FULL BUFFER RE-ANALYSIS: Re-analyze entire buffer like restart does
    // This ensures we catch all pivots just like when restarting the fronttester
    let tempLastPivot = { type: null, price: null, time: null, index: 0 };
    let tempPivotCounter = 0;
    
    // Re-analyze the ENTIRE buffer from scratch (exactly like restart)
    for (let i = pivotLookback; i < candleBuffer.length; i++) {
        const pivotCandle = candleBuffer[i];
        
        if (fronttesterconfig.showPivotChecking) {
            console.log(`${colors.dim || ''}[DEBUG] Checking for pivot at index ${i} (${new Date(pivotCandle.time).toLocaleString()}) - Price: ${pivotCandle.close}${colors.reset || ''}`);
        }
        
        // Check for high pivot
        const isHighPivot = detectPivot(candleBuffer, i, pivotLookback, 'high');
        
        if (isHighPivot) {
            const pivotPrice = getPivotPrice(pivotCandle, 'high');
            const swingPct = tempLastPivot.price ? (pivotPrice - tempLastPivot.price) / tempLastPivot.price : 0;
            const isFirstPivot = tempLastPivot.type === null;
            
            if ((isFirstPivot || Math.abs(swingPct) >= swingThreshold) && (i - tempLastPivot.index) >= minLegBars) {
                tempPivotCounter++;
                const barsSinceLast = i - tempLastPivot.index;
                const movePct = swingPct * 100;
                
                // Check if this is a NEW pivot (not previously detected)
                const isNewPivot = !lastPivot.time || pivotCandle.time > lastPivot.time;
                
                if (isNewPivot) {
                    highPivotCount++;
                    pivotCounter++;
                    const pivotTime = new Date(pivotCandle.time);
                    const formattedTime = `${pivotTime.toLocaleDateString()} ${pivotTime.toLocaleTimeString()}`;
                    
                    // Format NEW pivot output
                    const icon = '📈';
                    const color = colors.brightRed;
                    const modeLabel = fronttesterconfig.pastMode ? 'SIMULATION' : 'REAL-TIME';
                    const output = `${color}${icon} HIGH PIVOT #${pivotCounter} @ ${pivotPrice.toFixed(4)} (${formattedTime}) | Move: ${movePct.toFixed(2)}% | Bars: ${barsSinceLast} | 🆕 ${modeLabel}${colors.reset}`;
                    
                    console.log(output);
                    
                    // Execute trade logic
                    await executeTradeLogic('high', pivotCandle, { type: 'high', price: pivotPrice, time: pivotCandle.time, index: i });
                }
                
                // Update temp pivot tracking
                tempLastPivot = { 
                    type: 'high', 
                    price: pivotPrice, 
                    time: pivotCandle.time, 
                    index: i
                };
            }
        }
        
        // Check for low pivot
        const isLowPivot = detectPivot(candleBuffer, i, pivotLookback, 'low');
        
        if (isLowPivot) {
            const pivotPrice = getPivotPrice(pivotCandle, 'low');
            const swingPct = tempLastPivot.price ? (pivotPrice - tempLastPivot.price) / tempLastPivot.price : 0;
            const isFirstPivot = tempLastPivot.type === null;
            
            if ((isFirstPivot || Math.abs(swingPct) >= swingThreshold) && (i - tempLastPivot.index) >= minLegBars) {
                tempPivotCounter++;
                const barsSinceLast = i - tempLastPivot.index;
                const movePct = swingPct * 100;
                
                // Check if this is a NEW pivot (not previously detected)
                const isNewPivot = !lastPivot.time || pivotCandle.time > lastPivot.time;
                
                if (isNewPivot) {
                    lowPivotCount++;
                    pivotCounter++;
                    const pivotTime = new Date(pivotCandle.time);
                    const formattedTime = `${pivotTime.toLocaleDateString()} ${pivotTime.toLocaleTimeString()}`;
                    
                    // Format NEW pivot output
                    const icon = '📉';
                    const color = colors.brightGreen;
                    const modeLabel = fronttesterconfig.pastMode ? 'SIMULATION' : 'REAL-TIME';
                    const output = `${color}${icon} LOW PIVOT #${pivotCounter} @ ${pivotPrice.toFixed(4)} (${formattedTime}) | Move: ${movePct.toFixed(2)}% | Bars: ${barsSinceLast} | 🆕 ${modeLabel}${colors.reset}`;
                    
                    console.log(output);
                    
                    // Execute trade logic
                    await executeTradeLogic('low', pivotCandle, { type: 'low', price: pivotPrice, time: pivotCandle.time, index: i });
                }
                
                // Update temp pivot tracking
                tempLastPivot = { 
                    type: 'low', 
                    price: pivotPrice, 
                    time: pivotCandle.time, 
                    index: i
                };
            }
        }
    }
    
    // Update global pivot state with the latest pivot found in buffer analysis
    if (tempLastPivot.time) {
        lastPivot = tempLastPivot;
    }
};

// Process active trades for TP/SL monitoring
const processActiveTrades = async (currentCandle) => {
    for (let j = openTrades.length - 1; j >= 0; j--) {
        const trade = openTrades[j];
        let tradeClosed = false;
        let exitPrice = null;
        let result = '';
        
        // Track maximum favorable and unfavorable price movements
        if (trade.type === 'long') {
            const currentFavorable = (currentCandle.high - trade.entryPrice) / trade.entryPrice * 100;
            const currentUnfavorable = (currentCandle.low - trade.entryPrice) / trade.entryPrice * 100;
            
            trade.maxFavorable = Math.max(trade.maxFavorable, currentFavorable);
            trade.maxUnfavorable = Math.min(trade.maxUnfavorable, currentUnfavorable);
        } else { // short
            const currentFavorable = (trade.entryPrice - currentCandle.low) / trade.entryPrice * 100;
            const currentUnfavorable = (trade.entryPrice - currentCandle.high) / trade.entryPrice * 100;
            
            trade.maxFavorable = Math.max(trade.maxFavorable, currentFavorable);
            trade.maxUnfavorable = Math.min(trade.maxUnfavorable, currentUnfavorable);
        }

        // Check for trade timeout if enabled
        if (tradeConfig.maxTradeTimeMinutes > 0) {
            const tradeTimeMs = currentCandle.time - trade.entryTime;
            const tradeTimeMinutes = tradeTimeMs / (1000 * 60);
            
            if (tradeTimeMinutes >= tradeConfig.maxTradeTimeMinutes) {
                tradeClosed = true;
                exitPrice = currentCandle.close;
                result = 'TIMEOUT';
            }
        }

        if (!tradeClosed) {
            if (trade.type === 'long') {
                if (currentCandle.high >= trade.takeProfitPrice) {
                    tradeClosed = true;
                    exitPrice = trade.takeProfitPrice;
                    result = 'TP';
                } else if (currentCandle.low <= trade.stopLossPrice) {
                    tradeClosed = true;
                    exitPrice = trade.stopLossPrice;
                    result = 'SL';
                }
            } else { // short
                if (currentCandle.low <= trade.takeProfitPrice) {
                    tradeClosed = true;
                    exitPrice = trade.takeProfitPrice;
                    result = 'TP';
                } else if (currentCandle.high >= trade.stopLossPrice) {
                    tradeClosed = true;
                    exitPrice = trade.stopLossPrice;
                    result = 'SL';
                }
            }
        }

        if (tradeClosed) {
            // Apply exit slippage
            const exitSlippage = calculateSlippage(trade.size, tradeConfig);
            const slippageAdjustedExitPrice = applySlippage(exitPrice, trade.type, exitSlippage);
            
            // Calculate funding rate cost
            const fundingCost = calculateFundingRate(
                tradeConfig, 
                currentCandle.time, 
                trade.entryTime, 
                trade.size, 
                tradeConfig.leverage
            );
            
            // Calculate PnL
            const pnlPct = (trade.type === 'long' 
                ? (slippageAdjustedExitPrice - trade.entryPrice) / trade.entryPrice 
                : (trade.entryPrice - slippageAdjustedExitPrice) / trade.entryPrice) * tradeConfig.leverage;
            const grossPnl = trade.size * pnlPct;
            const tradingFee = (trade.size * tradeConfig.leverage * (tradeConfig.totalMakerFee / 100));
            const pnl = grossPnl - tradingFee - fundingCost;
            
            capital += pnl;
            
            // Check for liquidation
            if (capital <= 0) {
                capital = 0;
                console.log(`  ${colors.red}${colors.bold}[LIQUIDATION] Account liquidated! Trading stopped.${colors.reset}`);
            }

            const resultColor = result === 'TP' ? colors.green : colors.red;
            const tradeType = trade.type.toUpperCase();
            const pnlText = `${resultColor}${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}${colors.reset}`;
            
            if (tradeConfig.showTradeDetails) {
                console.log(`  \x1b[35;1m└─> [${result}] ${tradeType} trade closed @ ${exitPrice.toFixed(2)}. PnL: ${pnlText}${colors.reset}`);
            }

            trades.push({
                ...trade,
                exitPrice: slippageAdjustedExitPrice,
                originalExitPrice: exitPrice,
                exitTime: currentCandle.time,
                status: 'closed',
                result,
                grossPnl,
                pnl,
                tradingFee,
                fundingCost,
                exitSlippage: exitSlippage * 100,
                capitalAfter: capital
            });
            
            // Remove from open trades
            openTrades.splice(j, 1);
        }
    }
};

// Execute trade logic when pivot is detected
const executeTradeLogic = async (pivotType, pivotCandle, pivotData) => {
    const isFirstPivot = pivotCounter === 1;
    
    // Determine if we should open a trade
    let shouldOpenTrade = false;
    let tradeType = null;
    
    if (pivotType === 'high') {
        shouldOpenTrade = !isFirstPivot && (
            (tradeConfig.direction === 'sell') ||
            (tradeConfig.direction === 'both') ||
            (tradeConfig.direction === 'alternate')
        );
        tradeType = tradeConfig.direction === 'alternate' ? 'long' : 'short';
    } else { // low pivot
        shouldOpenTrade = !isFirstPivot && (
            (tradeConfig.direction === 'buy') ||
            (tradeConfig.direction === 'both') ||
            (tradeConfig.direction === 'alternate')
        );
        tradeType = tradeConfig.direction === 'alternate' ? 'short' : 'long';
    }
    
    if (shouldOpenTrade && openTrades.length < tradeConfig.maxConcurrentTrades) {
        // Calculate available capital
        const usedCapital = openTrades.reduce((sum, trade) => sum + trade.size, 0);
        const availableCapital = capital - usedCapital;
        
        // Determine trade size
        let tradeSize = 0;
        if (tradeConfig.positionSizingMode === 'fixed' && tradeConfig.amountPerTrade) {
            tradeSize = Math.min(tradeConfig.amountPerTrade, availableCapital);
        } else if (tradeConfig.positionSizingMode === 'minimum' && tradeConfig.minimumTradeAmount) {
            const percentageAmount = availableCapital * (tradeConfig.riskPerTrade / 100);
            tradeSize = Math.max(percentageAmount, Math.min(tradeConfig.minimumTradeAmount, availableCapital));
        } else {
            tradeSize = availableCapital * (tradeConfig.riskPerTrade / 100);
        }
        
        // Only open trade if we have enough capital
        if (tradeSize > 0 && capital > 0) {
            const trade = createTrade(tradeType, pivotCandle, pivotData, candleBuffer.length - 1, tradeSize, tradeConfig);
            openTrades.push(trade);
            
            if (tradeConfig.showLimits) {
                const tradeLabel = tradeType.toUpperCase();
                console.log(`  ${colors.yellow}└─> [${tradeLabel}] Entry: ${trade.entryPrice.toFixed(2)} | Size: ${trade.size.toFixed(2)} | TP: ${trade.takeProfitPrice.toFixed(2)} | SL: ${trade.stopLossPrice.toFixed(2)}${colors.reset}`);
            }
        }
    }
};

// Start the real-time system
(async () => {
    try {
        await initializeSystem();
    } catch (err) {
        console.error('\nAn error occurred during system initialization:', err);
        process.exit(1);
    }
})();
