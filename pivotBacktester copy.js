// pivotBacktester.js
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
} from './config/config.js';

import { tradeConfig } from './config/tradeconfig.js';
import { getCandles } from './apis/bybit.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get the directory name in a way that works with ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

// Helper function to detect pivots using configurable price mode
const detectPivot = (candles, i, pivotLookback, pivotType) => {
    let isPivot = true;
    
    // Get current and comparison prices based on detection mode
    const getCurrentPrice = (candle) => {
        if (pivotDetectionMode === 'extreme') {
            return pivotType === 'high' ? candle.high : candle.low;
        } else {
            return candle.close; // default 'close' mode
        }
    };
    
    const currentPrice = getCurrentPrice(candles[i]);
    
    for (let j = 1; j <= pivotLookback; j++) {
        const comparePrice = getCurrentPrice(candles[i - j]);
        
        if (pivotType === 'high') {
            if (currentPrice <= comparePrice) {
                isPivot = false;
                break;
            }
        } else { // low pivot
            if (currentPrice >= comparePrice) {
                isPivot = false;
                break;
            }
        }
    }
    
    return isPivot;
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

// Display trade configuration at the top
console.log(`${colors.cyan}--- Trade Configuration ---${colors.reset}`);
// Delay info is now displayed within the loading functions, no need to duplicate it here
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



async function runTest() {
    // Display the appropriate title based on the mode
    const modeText = pivotDetectionMode === 'extreme' ? 'Extreme (High/Low)' : 'Close';
    if (useEdges) {
        console.log(`${colors.cyan}--- ${modeText} Pivot Detection Test with Pre-Computed Edge Data ---${colors.reset}`);
    } else if (useLocalData) {
        console.log(`${colors.cyan}--- ${modeText} Pivot Detection Test with Standard CSV Data ---${colors.reset}`);
    } else {
        console.log(`${colors.cyan}--- ${modeText} Pivot Detection Test with Live API Data ---${colors.reset}`);
    }

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
    
    // Ensure there are enough candles for the lookback on both sides
    if (!pivotCandles || pivotCandles.length < (pivotLookback * 2 + 1)) {
        console.error(`Not enough historical data. Need at least ${pivotLookback * 2 + 1} candles for lookback of ${pivotLookback}.`);
        return;
    }
    
    // We're using the pre-loaded candles with edges for both edge calculations and display
    const edgeCandles = pivotCandles; // Using the same candles since they already have edge data
    
    console.log(`Using pre-computed candles with edges for backtesting.`);
    console.log(`Loaded ${pivotCandles.length} candles with pre-computed edge data for display.\n`);
    
    // Define timeframes for edge detection
    const timeframes = ['daily', 'weekly', 'biweekly', 'monthly'];
    
    let lastPivot = { type: null, price: null, time: null, index: 0 };
    const swingThreshold = minSwingPct / 100;
    let pivotCounter = 0;
    let highPivotCount = 0;
    let lowPivotCount = 0;

    // --- Trade State Initialization ---
    let capital = tradeConfig.initialCapital;
    const trades = [];
    const openTrades = []; // Array to hold multiple concurrent trades
    let tradeMaxDrawdown = 0;
    let tradeMaxProfit = 0;
    
    // Create a mapping from pivot candle time to trade candle index for efficient lookup
    const tradeCandle1mIndex = new Map();
    tradeCandles.forEach((candle, index) => {
        tradeCandle1mIndex.set(candle.time, index);
    });

    // Iterate through pivot candles, leaving enough space for lookback on either side
    for (let i = pivotLookback; i < pivotCandles.length; i++) {
        const currentPivotCandle = pivotCandles[i];
        let pivotType = null;

        // Display candle with edge data if enabled
        if (tradeConfig.showCandle) {
            // Calculate current edge data for this candle
            const pivotEdgeData = getCurrentEdgeData(currentPivotCandle.close, currentPivotCandle, edges, timeframes);
                    
            // Format candle data
            const candleTime = new Date(currentPivotCandle.time).toLocaleString();
            const candleData = `${i.toString().padStart(0, '')} | ${candleTime} | O: ${currentPivotCandle.open.toFixed(2)} H: ${currentPivotCandle.high.toFixed(2)} L: ${currentPivotCandle.low.toFixed(2)} C: ${currentPivotCandle.close.toFixed(2)}`;
                    
            // Format edge data for this candle 
                    
            let dailyPct = null, weeklyPct = null, biweeklyPct = null, monthlyPct = null;

            // Find the reference candle from 24 hours ago for the daily edge
            const twentyFourHoursAgo = currentPivotCandle.time - (24 * 60 * 60 * 1000);
            let referenceCandle = null;
                    
            // Find the closest candle to 24 hours ago
            for (let j = 0; j < edgeCandles.length; j++) {
                if (edgeCandles[j].time >= twentyFourHoursAgo) {
                    referenceCandle = edgeCandles[j];
                    break;
                }
            }
                    
            // Calculate and display the daily edge percentage
            let dailyEdgeDebug = '';
            if (referenceCandle) {
                const refTime = new Date(referenceCandle.time).toLocaleString();
                dailyPct = ((currentPivotCandle.close - referenceCandle.close) / referenceCandle.close) * 100;
                const pctSign = dailyPct >= 0 ? '+' : '';
                const pctColor = dailyPct >= 0 ? colors.green : colors.red;
                        
                dailyEdgeDebug = `\n    ${colors.cyan}[DEBUG] 24h Reference:${colors.reset} ${refTime} | C: ${referenceCandle.close.toFixed(2)} | Daily Edge: ${pctColor}${pctSign}${dailyPct.toFixed(2)}%${colors.reset}`;
            } else {
                dailyEdgeDebug = `\n    ${colors.red}[DEBUG] No 24h reference candle found${colors.reset}`;
            }
                    
            // Find the reference candle from 7 days ago for the weekly edge
            const sevenDaysAgo = currentPivotCandle.time - (7 * 24 * 60 * 60 * 1000);
            let weeklyReferenceCandle = null;

            for (let j = 0; j < edgeCandles.length; j++) {
                if (edgeCandles[j].time >= sevenDaysAgo) {
                    weeklyReferenceCandle = edgeCandles[j];
                    break;
                }
            }

            // Calculate and display the weekly edge percentage
            let weeklyEdgeDebug = '';
            if (weeklyReferenceCandle) {
                const refTime = new Date(weeklyReferenceCandle.time).toLocaleString();
                weeklyPct = ((currentPivotCandle.close - weeklyReferenceCandle.close) / weeklyReferenceCandle.close) * 100;
                const pctSign = weeklyPct >= 0 ? '+' : '';
                const pctColor = weeklyPct >= 0 ? colors.green : colors.red;
                
                weeklyEdgeDebug = `\n    ${colors.magenta}[DEBUG] 7d Reference:${colors.reset}  ${refTime} | C: ${weeklyReferenceCandle.close.toFixed(2)} | Weekly Edge: ${pctColor}${pctSign}${weeklyPct.toFixed(2)}%${colors.reset}`;
            } else {
                weeklyEdgeDebug = `\n    ${colors.red}[DEBUG] No 7d reference candle found${colors.reset}`;
            }

            // Find the reference candle from 14 days ago for the bi-weekly edge
            const fourteenDaysAgo = currentPivotCandle.time - (14 * 24 * 60 * 60 * 1000);
            let biweeklyReferenceCandle = null;

            for (let j = 0; j < edgeCandles.length; j++) {
                if (edgeCandles[j].time >= fourteenDaysAgo) {
                    biweeklyReferenceCandle = edgeCandles[j];
                    break;
                }
            }

            // Calculate and display the bi-weekly edge percentage
            let biweeklyEdgeDebug = '';
            if (biweeklyReferenceCandle) {
                const refTime = new Date(biweeklyReferenceCandle.time).toLocaleString();
                biweeklyPct = ((currentPivotCandle.close - biweeklyReferenceCandle.close) / biweeklyReferenceCandle.close) * 100;
                const pctSign = biweeklyPct >= 0 ? '+' : '';
                const pctColor = biweeklyPct >= 0 ? colors.green : colors.red;
                
                biweeklyEdgeDebug = `\n    ${colors.yellow}[DEBUG] 14d Reference:${colors.reset} ${refTime} | C: ${biweeklyReferenceCandle.close.toFixed(2)} | Bi-Weekly Edge: ${pctColor}${pctSign}${biweeklyPct.toFixed(2)}%${colors.reset}`;
            } else {
                biweeklyEdgeDebug = `\n    ${colors.red}[DEBUG] No 14d reference candle found${colors.reset}`;
            }

            // Find the reference candle from 30 days ago for the monthly edge
            const thirtyDaysAgo = currentPivotCandle.time - (30 * 24 * 60 * 60 * 1000);
            let monthlyReferenceCandle = null;

            for (let j = 0; j < edgeCandles.length; j++) {
                if (edgeCandles[j].time >= thirtyDaysAgo) {
                    monthlyReferenceCandle = edgeCandles[j];
                    break;
                }
            }

            // Calculate and display the monthly edge percentage
            let monthlyEdgeDebug = '';
            if (monthlyReferenceCandle) {
                monthlyPct = ((currentPivotCandle.close - monthlyReferenceCandle.close) / monthlyReferenceCandle.close) * 100;
                const monthlySign = monthlyPct >= 0 ? '+' : '';
                const monthlyColor = monthlyPct >= 0 ? colors.green : colors.red;
                monthlyEdgeDebug = `\n    ${colors.blue}[DEBUG] Monthly Edge (30d): ${new Date(monthlyReferenceCandle.time).toLocaleString()} (C: ${monthlyReferenceCandle.close}) -> ${monthlyColor}${monthlySign}${monthlyPct.toFixed(2)}%${colors.reset}`;
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
                const startTime = currentPivotCandle.time - (days * 24 * 60 * 60 * 1000);
                const candlesInRange = edgeCandles.filter(c => c.time >= startTime && c.time <= currentPivotCandle.time);

                if (candlesInRange.length > 0) {
                    const referencePrice = candlesInRange[0].close;
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
            
            let totalRangeDebug = '';
            if (totalRangeParts.length > 0) {
                totalRangeDebug = `\n    ${colors.blue}[DEBUG] Total Range:    ${totalRangeParts.join(' | ')}${colors.reset}`;
            }

            let breakoutRangeDebug = '';
            if (breakoutRangeParts.length > 0) {
                breakoutRangeDebug = `\n    ${colors.yellow}    [DEBUG] Range Breakout: ${breakoutRangeParts.join(' | ')}`;
            }

            // --- Average Range Calculations ---
            const avgLookbackPeriods = { 'Daily': 7, 'Weekly': 4, 'Bi-Weekly': 4, 'Monthly': 4 };
            let avgTotalRangeParts = [];
            let avgBreakoutParts = [];

            for (const [name, lookback] of Object.entries(avgLookbackPeriods)) {
                const daysInPeriod = name === 'Daily' ? 1 : name === 'Weekly' ? 7 : name === 'Bi-Weekly' ? 14 : 30;
                let periodTotalRanges = [];
                let periodUpwardRanges = [];
                let periodDownwardRanges = [];

                for (let i = 0; i < lookback; i++) {
                    const periodEndTime = currentPivotCandle.time - (i * daysInPeriod * 24 * 60 * 60 * 1000);
                    const periodStartTime = periodEndTime - (daysInPeriod * 24 * 60 * 60 * 1000);
                    const candlesInPeriod = edgeCandles.filter(c => c.time >= periodStartTime && c.time < periodEndTime);

                    if (candlesInPeriod.length > 0) {
                        const referencePrice = candlesInPeriod[0].close;
                        const maxHigh = Math.max(...candlesInPeriod.map(c => c.high));
                        const minLow = Math.min(...candlesInPeriod.map(c => c.low));

                        periodTotalRanges.push(((maxHigh - minLow) / minLow) * 100);
                        periodUpwardRanges.push(((maxHigh - referencePrice) / referencePrice) * 100);
                        periodDownwardRanges.push(((minLow - referencePrice) / referencePrice) * 100);
                    }
                }

                if (periodTotalRanges.length > 0) {
                    const avgTotalRange = periodTotalRanges.reduce((a, b) => a + b, 0) / periodTotalRanges.length;
                    avgTotalRangeParts.push(`${name}: ${avgTotalRange.toFixed(2)}%`);

                    const avgUpward = periodUpwardRanges.reduce((a, b) => a + b, 0) / periodUpwardRanges.length;
                    const avgDownward = periodDownwardRanges.reduce((a, b) => a + b, 0) / periodDownwardRanges.length;
                    avgBreakoutParts.push(`${name}: ${formatPercentageWithColor(avgUpward)} / ${formatPercentageWithColor(avgDownward)}`);
                }
            }

            let avgTotalRangeDebug = '';
            if (avgTotalRangeParts.length > 0) {
                avgTotalRangeDebug = `\n    ${colors.cyan}[DEBUG] Avg Total Range:   ${avgTotalRangeParts.join(' | ')}${colors.reset}`;
            }

            let avgBreakoutDebug = '';
            if (avgBreakoutParts.length > 0) {
                avgBreakoutDebug = `\n    ${colors.magenta}[DEBUG] Avg Range Breakout: ${avgBreakoutParts.join(' | ')} `;
            }

            // --- Consolidated Edge and Range Output ---
            let edgeParts = [];
            const timeframesForEdges = { 'Daily': dailyPct, 'Weekly': weeklyPct, 'Bi-Weekly': biweeklyPct, 'Monthly': monthlyPct };
            for (const [name, pct] of Object.entries(timeframesForEdges)) {
                if (pct !== null) {
                    const tfShort = name.charAt(0);
                    edgeParts.push(`${tfShort}:${formatPercentageWithColor(pct)}`);
                }
            }
            const edgesLine = `Edges: ${edgeParts.join(' ')}`;

            const totalRangeLine = `Total Range: ${totalRangeParts.join(' ')}`;
            const avgRangeLine = `Average Range: ${avgTotalRangeParts.join(' ')}`;

            const consolidatedLine = `${edgesLine}  |  ${totalRangeLine}  |  ${avgRangeLine}`;

            // Output candle with its edge data and debug information
            console.log(`${candleData}`);
            console.log(consolidatedLine);
            if (breakoutRangeDebug) console.log(`    ${breakoutRangeDebug.trim()}`);
            if (avgBreakoutDebug) console.log(`    ${avgBreakoutDebug.trim()}`);
        }

        // --- Active Trade Management using 1-minute candles ---
        // Process all open trades using 1-minute candles for accurate execution
        for (let j = openTrades.length - 1; j >= 0; j--) {
            const trade = openTrades[j];
            let tradeClosed = false;
            let exitPrice = null;
            let result = '';
            
            // Find the current 1-minute candle for this pivot candle time
            let currentTradeCandle = null;
            
            // If we have 1-minute candles, find the one closest to current pivot candle time
            if (tradeCandles !== pivotCandles) {
                // Find the 1-minute candle that corresponds to this pivot candle time
                const pivotTime = currentPivotCandle.time;
                
                // Find the closest 1-minute candle at or after the pivot time
                for (let k = 0; k < tradeCandles.length; k++) {
                    if (tradeCandles[k].time >= pivotTime) {
                        currentTradeCandle = tradeCandles[k];
                        break;
                    }
                }
                
                // If no 1-minute candle found at or after pivot time, use the last available
                if (!currentTradeCandle && tradeCandles.length > 0) {
                    currentTradeCandle = tradeCandles[tradeCandles.length - 1];
                }
            } else {
                // Using same timeframe for both pivot and trade execution
                currentTradeCandle = currentPivotCandle;
            }
            
            // Skip trade processing if no trade candle available
            if (!currentTradeCandle) continue;
            
            // Track maximum favorable and unfavorable price movements
            if (trade.type === 'long') {
                // For long trades: favorable = price goes up, unfavorable = price goes down
                const currentFavorable = (currentTradeCandle.high - trade.entryPrice) / trade.entryPrice * 100;
                const currentUnfavorable = (currentTradeCandle.low - trade.entryPrice) / trade.entryPrice * 100;
                
                trade.maxFavorable = Math.max(trade.maxFavorable, currentFavorable);
                trade.maxUnfavorable = Math.min(trade.maxUnfavorable, currentUnfavorable);
            } else { // short
                // For short trades: favorable = price goes down, unfavorable = price goes up
                const currentFavorable = (trade.entryPrice - currentTradeCandle.low) / trade.entryPrice * 100;
                const currentUnfavorable = (trade.entryPrice - currentTradeCandle.high) / trade.entryPrice * 100;
                
                trade.maxFavorable = Math.max(trade.maxFavorable, currentFavorable);
                trade.maxUnfavorable = Math.min(trade.maxUnfavorable, currentUnfavorable);
            }

            // Check for trade timeout if maxTradeTimeMinutes is enabled (greater than 0)
            if (tradeConfig.maxTradeTimeMinutes > 0) {
                const tradeTimeMs = currentTradeCandle.time - trade.entryTime;
                const tradeTimeMinutes = tradeTimeMs / (1000 * 60);
                
                if (tradeTimeMinutes >= tradeConfig.maxTradeTimeMinutes) {
                    tradeClosed = true;
                    exitPrice = currentTradeCandle.close; // Use current trade candle close price for timeout exits
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
                const pnlPct = (trade.type === 'long' ? (exitPrice - trade.entryPrice) / trade.entryPrice : (trade.entryPrice - exitPrice) / trade.entryPrice) * tradeConfig.leverage;
                const grossPnl = trade.size * pnlPct;
                const fee = (trade.size * tradeConfig.leverage * (tradeConfig.totalMakerFee / 100));
                const pnl = grossPnl - fee;
                
                capital += pnl;
                
                // Check if account is liquidated
                if (capital <= 0) {
                    capital = 0; // Ensure capital never goes negative
                    
                    // Log liquidation event
                    console.log(`  ${colors.red}${colors.bold}[LIQUIDATION] Account liquidated! Trading stopped.${colors.reset}`);
                }

                const resultColor = result === 'TP' ? colors.green : colors.red;
                const tradeType = trade.type.toUpperCase();
                const pnlText = `${resultColor}${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}${colors.reset}`;
                // Only log trade details if showTradeDetails is enabled
                if (tradeConfig.showTradeDetails) {
                    console.log(`  \x1b[35;1m└─> [${result}] ${tradeType} trade closed @ ${exitPrice.toFixed(2)}. PnL: ${pnlText}${colors.reset}`);
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

        // Process high pivots using pivot candles
        const isHighPivot = detectPivot(pivotCandles, i, pivotLookback, 'high');
        
        if (isHighPivot) {
            const pivotPrice = getPivotPrice(currentPivotCandle, 'high');
            const swingPct = lastPivot.price ? (pivotPrice - lastPivot.price) / lastPivot.price : 0;
            const isFirstPivot = lastPivot.type === null;
            
            if ((isFirstPivot || Math.abs(swingPct) >= swingThreshold) && (i - lastPivot.index) >= minLegBars) {
                pivotType = 'high';
                pivotCounter++;
                highPivotCount++;
                const barsSinceLast = i - lastPivot.index;
                const movePct = swingPct * 100;
                const formattedTime = new Date(currentPivotCandle.time).toLocaleString();
                
                // Get edge data for this pivot from pre-computed data
                const pivotEdgeData = getCurrentEdgeData(pivotPrice, currentPivotCandle, edges, timeframes);
                
                const swingCandles = lastPivot.price ? pivotCandles.slice(lastPivot.index, i + 1) : null;
                const output = formatPivotOutput('high', pivotCounter, pivotPrice, formattedTime, movePct, barsSinceLast, lastPivot, swingCandles);
                
                // Display pivot info if enabled
                if (tradeConfig.showPivot) {
                    console.log(output);
                    
                    // Display edge data from the candle where the pivot was detected
                    const edgeDisplayData = formatEdgeData(currentPivotCandle, pivotCandles, timeframes);
                    edgeDisplayData.forEach(line => console.log(line));
                }
                
                // Store pivot data using detected pivot price
                lastPivot = { 
                    type: 'high', 
                    price: pivotPrice, 
                    time: currentPivotCandle.time, 
                    index: i,
                    edges: pivotEdgeData
                };
                
                // --- Open Trade at High Pivot ---
                // In normal mode: open SHORT at high pivots
                // In alternate mode: open LONG at high pivots
                const shouldOpenTrade = !isFirstPivot && (
                    (tradeConfig.direction === 'sell') ||
                    (tradeConfig.direction === 'both') ||
                    (tradeConfig.direction === 'alternate')
                );
                
                if (shouldOpenTrade) {
                    // Check if we can open a new trade based on maxConcurrentTrades
                    if (openTrades.length < tradeConfig.maxConcurrentTrades) {
                        // Calculate available capital for this trade
                        const usedCapital = openTrades.reduce((sum, trade) => sum + trade.size, 0);
                        const availableCapital = capital - usedCapital;
                        
                        // Determine trade size based on positionSizingMode
                        let tradeSize = 0;
                        if (tradeConfig.positionSizingMode === 'fixed' && tradeConfig.amountPerTrade) {
                            // Use fixed amount, but check against available capital
                            tradeSize = Math.min(tradeConfig.amountPerTrade, availableCapital);
                        } else if (tradeConfig.positionSizingMode === 'minimum' && tradeConfig.minimumTradeAmount) {
                            // Use percentage of available capital, but enforce minimum amount
                            const percentageAmount = availableCapital * (tradeConfig.riskPerTrade / 100);
                            tradeSize = Math.max(percentageAmount, Math.min(tradeConfig.minimumTradeAmount, availableCapital));
                        } else {
                            // Use percentage of available capital (default 'percent' mode)
                            tradeSize = availableCapital * (tradeConfig.riskPerTrade / 100);
                        }
                        
                        // Only open trade if we have enough capital and account is not liquidated
                        if (tradeSize > 0 && capital > 0) {
                            // Determine trade type based on mode
                            const tradeType = tradeConfig.direction === 'alternate' ? 'long' : 'short';
                            const trade = createTrade(tradeType, currentPivotCandle, lastPivot, i, tradeSize, tradeConfig);
                            openTrades.push(trade);
                            
                            // Only log limit order information if showLimits is enabled
                            if (tradeConfig.showLimits) {
                                const tradeLabel = tradeType.toUpperCase();
                                console.log(`  ${colors.yellow}└─> [${tradeLabel}] Entry: ${trade.entryPrice.toFixed(2)} | Size: ${trade.size.toFixed(2)} | TP: ${trade.takeProfitPrice.toFixed(2)} | SL: ${trade.stopLossPrice.toFixed(2)}${colors.reset}`);
                            }
                        }
                    }
                }
            }
        }

        // Process low pivots using pivot candles
        const isLowPivot = detectPivot(pivotCandles, i, pivotLookback, 'low');
        
        if (isLowPivot) {
            const pivotPrice = getPivotPrice(pivotCandles[i], 'low');
            const swingPct = lastPivot.price ? (pivotPrice - lastPivot.price) / lastPivot.price : 0;
            const isFirstPivot = lastPivot.type === null;
            
            if ((isFirstPivot || Math.abs(swingPct) >= swingThreshold) && (i - lastPivot.index) >= minLegBars) {
                const movePct = swingPct * 100;
                const barsSinceLast = i - lastPivot.index;
                const formattedTime = new Date(pivotCandles[i].time).toLocaleString();
                
                // Get edge data for this pivot from pre-computed data
                const pivotEdgeData = getCurrentEdgeData(pivotPrice, pivotCandles[i], edges, timeframes);
                
                const swingCandles = lastPivot.price ? pivotCandles.slice(lastPivot.index, i + 1) : null;
                const output = formatPivotOutput('low', pivotCounter, pivotPrice, formattedTime, movePct, barsSinceLast, lastPivot, swingCandles);
                
                // Update counters
                pivotCounter++;
                lowPivotCount++;
                
                // Display pivot info if enabled
                if (tradeConfig.showPivot) {
                    console.log(output);
                    
                    // Display edge data from the candle where the pivot was detected
                    const edgeDisplayData = formatEdgeData(currentPivotCandle, pivotCandles, timeframes);
                    edgeDisplayData.forEach(line => console.log(line));
                }
                
                // Store pivot data using detected pivot price
                lastPivot = { type: 'low', price: pivotPrice, time: pivotCandles[i].time, index: i, edges: pivotEdgeData };
                
                // --- Open Trade at Low Pivot ---
                // In normal mode: open LONG at low pivots
                // In alternate mode: open SHORT at low pivots
                const shouldOpenTrade = !isFirstPivot && (
                    (tradeConfig.direction === 'buy') ||
                    (tradeConfig.direction === 'both') ||
                    (tradeConfig.direction === 'alternate')
                );
                
                if (shouldOpenTrade) {
                    // Check if we can open a new trade based on maxConcurrentTrades
                    if (openTrades.length < tradeConfig.maxConcurrentTrades) {
                        // Calculate available capital for this trade
                        const usedCapital = openTrades.reduce((sum, trade) => sum + trade.size, 0);
                        const availableCapital = capital - usedCapital;
                        
                        // Determine trade size based on positionSizingMode
                        let tradeSize = 0;
                        if (tradeConfig.positionSizingMode === 'fixed' && tradeConfig.amountPerTrade) {
                            // Use fixed amount, but check against available capital
                            tradeSize = Math.min(tradeConfig.amountPerTrade, availableCapital);
                        } else if (tradeConfig.positionSizingMode === 'minimum' && tradeConfig.minimumTradeAmount) {
                            // Use percentage of available capital, but enforce minimum amount
                            const percentageAmount = availableCapital * (tradeConfig.riskPerTrade / 100);
                            tradeSize = Math.max(percentageAmount, Math.min(tradeConfig.minimumTradeAmount, availableCapital));
                        } else {
                            // Use percentage of available capital (default 'percent' mode)
                            tradeSize = availableCapital * (tradeConfig.riskPerTrade / 100);
                        }
                        
                        // Only open trade if we have enough capital and account is not liquidated
                        if (tradeSize > 0 && capital > 0) {
                            // Determine trade type based on mode
                            const tradeType = tradeConfig.direction === 'alternate' ? 'short' : 'long';
                            const trade = createTrade(tradeType, pivotCandles[i], lastPivot, i, tradeSize, tradeConfig);
                            openTrades.push(trade);
                            
                            if (tradeConfig.showLimits) {
                                const tradeLabel = tradeType.toUpperCase();
                                console.log(`  ${colors.yellow}└─> [${tradeLabel}]  Entry: ${trade.entryPrice.toFixed(2)} | Size: ${trade.size.toFixed(2)} | TP: ${trade.takeProfitPrice.toFixed(2)} | SL: ${trade.stopLossPrice.toFixed(2)}${colors.reset}`);
                            }
                        }
                    }
                }
            }
        }


    }
    
  

    // --- Final Summary Calculation ---
    const firstPrice = pivotCandles[0].open;
    const highestHigh = Math.max(...pivotCandles.map(c => c.high));
    const lowestLow = Math.min(...pivotCandles.map(c => c.low));

    const totalUpwardChange = ((highestHigh - firstPrice) / firstPrice) * 100;
    const totalDownwardChange = ((lowestLow - firstPrice) / firstPrice) * 100;
    const netPriceRange = ((highestHigh - lowestLow) / lowestLow) * 100;
    
    // --- Check for liquidation (capital <= 0) ---
    // If capital is ever 0 or negative, account is liquidated
    const isLiquidated = capital <= 0;
    if (isLiquidated) {
        // Ensure capital is exactly 0 if liquidated
        capital = 0;
    }

    // --- Trade Summary --- 
    let finalCapital = capital;
    
    // Close any remaining open trades at the end of backtesting using the last candle's close price
    if (openTrades.length > 0) {
        const endPrice = tradeCandles[tradeCandles.length - 1].close;
        
        console.log(`
${colors.yellow}Closing ${openTrades.length} open trade${openTrades.length > 1 ? 's' : ''} at end of backtest.${colors.reset}`);
        
        // Check if account is already liquidated before processing EOB trades
        const alreadyLiquidated = capital <= 0;
        
        // Process each open trade only if not already liquidated
        openTrades.forEach(trade => {
            const pnlPct = (trade.type === 'long' ? (endPrice - trade.entryPrice) / trade.entryPrice : (trade.entryPrice - endPrice) / trade.entryPrice) * tradeConfig.leverage;
            const grossPnl = trade.size * pnlPct;
            const fee = (trade.size * tradeConfig.leverage * (tradeConfig.totalMakerFee / 100));
            const pnl = grossPnl - fee;
            
            // Only update capital if not already liquidated
            if (!alreadyLiquidated) {
                capital += pnl;
                
                // Check if this trade caused liquidation
                if (capital <= 0) {
                    capital = 0; // Ensure capital never goes negative
                    
                    // Log liquidation event
                    console.log(`  ${colors.red}${colors.bold}[LIQUIDATION] Account liquidated! Trading stopped.${colors.reset}`);
                }
            }
            
            // Only show details if showTradeDetails is enabled
            if (tradeConfig.showTradeDetails) {
                console.log(`  └─> [EOB] ${trade.type.toUpperCase()} trade closed @ ${endPrice.toFixed(2)}. PnL: ${(pnl >= 0 ? colors.green : colors.red)}${pnl.toFixed(2)}${colors.reset}`);
            }
            
            // Add the closed trade to the trades array
            trades.push({
                ...trade,
                exitPrice: endPrice,
                exitTime: tradeCandles[tradeCandles.length - 1].time,
                exitIndex: tradeCandles.length - 1,
                status: 'closed',
                result: 'EOB', // End Of Backtest
                grossPnl,
                pnl,
                fee,
                capitalAfter: capital
            });
        });
        
        // Clear the openTrades array
        openTrades.length = 0;
        finalCapital = capital;
    }

    // Define regularTrades and eobTrades at the top level
    const regularTrades = trades.filter(t => t.result !== 'EOB');
    const eobTrades = trades.filter(t => t.result === 'EOB');
    
    // Only display trade details if showTradeDetails is enabled
    if ((trades.length > 0 || activeTrade) && tradeConfig.showTradeDetails) {
        // Display detailed trade information
        console.log(`\n${colors.cyan}--- Trade Details ---${colors.reset}`);
        console.log('--------------------------------------------------------------------------------');
        
        trades.forEach((trade, index) => {
            // Format dates to be more readable
            const entryDate = new Date(trade.entryTime);
            const exitDate = new Date(trade.exitTime);
            const entryDateStr = `${entryDate.toLocaleDateString('en-US', { weekday: 'short' })} ${entryDate.toLocaleDateString()} ${entryDate.toLocaleTimeString()}`;
            const exitDateStr = `${exitDate.toLocaleDateString('en-US', { weekday: 'short' })} ${exitDate.toLocaleDateString()} ${exitDate.toLocaleTimeString()}`;
            
            // Calculate and format duration
            const durationMs = trade.exitTime - trade.entryTime;
            const durationStr = formatDuration(durationMs);
            
            // Determine if win or loss
            const resultColor = trade.pnl >= 0 ? colors.green : colors.red;
            const resultText = trade.pnl >= 0 ? 'WIN' : 'LOSS';
            const pnlPct = ((trade.pnl / trade.size) * 100).toFixed(2);
            
            // Determine trade type color
            const typeColor = trade.type === 'long' ? colors.green : colors.red;
            
            // Format the trade header - entire line in result color
            console.log(`${resultColor}[TRADE ${(index + 1).toString().padStart(2, ' ')}] ${trade.type.toUpperCase()} | P&L: ${pnlPct}% | ${resultText} | Result: ${trade.result}${colors.reset}`);
            console.log();
            console.log(`${colors.cyan}  Entry: ${entryDateStr} at $${trade.entryPrice.toFixed(4)}${colors.reset}`);
            console.log(`${colors.cyan}  Exit:  ${exitDateStr} at $${trade.exitPrice.toFixed(4)}${colors.reset}`);
            console.log(`${colors.cyan}  Duration: ${durationStr}${colors.reset}`);
            
            // Display maximum favorable and unfavorable movements
            const favorableColor = trade.maxFavorable >= 0 ? colors.green : colors.red;
            const unfavorableColor = trade.maxUnfavorable >= 0 ? colors.green : colors.red;
            console.log(`  Max Favorable Movement: ${favorableColor}${trade.maxFavorable.toFixed(4)}%${colors.reset}`);
            console.log(`  Max Unfavorable Movement: ${unfavorableColor}${trade.maxUnfavorable.toFixed(4)}%${colors.reset}`);
            
            // Add price movement information
            const priceDiff = trade.exitPrice - trade.entryPrice;
            const priceDiffPct = (priceDiff / trade.entryPrice * 100).toFixed(4);
            const priceColor = priceDiff >= 0 ? colors.green : colors.red;
            console.log(`  Price Movement: ${priceColor}${priceDiff > 0 ? '+' : ''}${priceDiffPct}%${colors.reset} (${priceColor}$${priceDiff.toFixed(4)}${colors.reset})`);

            // --- Edge Data from Pivot ---
            const pivotCandleForTrade = pivotCandles[trade.entryIndex];
            if (pivotCandleForTrade) {
                const edgeLines = formatEdgeData(pivotCandleForTrade, pivotCandles);
                edgeLines.forEach(line => {
                    // Indent each line by two spaces to match surrounding formatting
                    console.log(`  ${line}`);
                });
            }
            console.log('--------------------------------------------------------------------------------');
        });
    }
    
      
    // Calculate price movement statistics
    if (regularTrades.length > 0) {
        const favorableMovements = regularTrades.map(t => t.maxFavorable);
        const unfavorableMovements = regularTrades.map(t => t.maxUnfavorable);
        
        const maxFavorable = Math.max(...favorableMovements);
        const minFavorable = Math.min(...favorableMovements);
        const avgFavorable = favorableMovements.reduce((sum, val) => sum + val, 0) / favorableMovements.length;
        
        const maxUnfavorable = Math.max(...unfavorableMovements);
        const minUnfavorable = Math.min(...unfavorableMovements);
        const avgUnfavorable = unfavorableMovements.reduce((sum, val) => sum + val, 0) / unfavorableMovements.length;
        
        console.log(`\n${colors.cyan}--- Price Movement Statistics ---${colors.reset}`);
        console.log(`Favorable Movements (Higher is better):`);
        console.log(`  Highest: ${colors.green}${maxFavorable.toFixed(4)}%${colors.reset}`);
        console.log(`  Lowest:  ${colors.yellow}${minFavorable.toFixed(4)}%${colors.reset}`);
        console.log(`  Average: ${colors.cyan}${avgFavorable.toFixed(4)}%${colors.reset}`);
        
        console.log(`Unfavorable Movements (Higher is better):`);
        console.log(`  Highest: ${colors.green}${maxUnfavorable.toFixed(4)}%${colors.reset}`);
        console.log(`  Lowest:  ${colors.red}${minUnfavorable.toFixed(4)}%${colors.reset}`);
        console.log(`  Average: ${colors.cyan}${avgUnfavorable.toFixed(4)}%${colors.reset}`);
    }



    const totalPivots = highPivotCount + lowPivotCount;
    if (totalPivots > 0) {
        const highPct = ((highPivotCount / totalPivots) * 100).toFixed(2);
        const lowPct = ((lowPivotCount / totalPivots) * 100).toFixed(2);
        console.log(`\n${colors.cyan}--- Pivot Summary ---${colors.reset}`);
        console.log(`${colors.green}High Pivots: ${highPivotCount.toString().padStart(2)} (${highPct}%)${colors.reset}`);
        console.log(`${colors.red}Low Pivots:  ${lowPivotCount.toString().padStart(2)} (${lowPct}%)${colors.reset}`);
        console.log(`Total Pivots: ${totalPivots}`);
    }

    // Edge data statistics
    if (totalPivots > 0) {
        // Collect edge data from all pivots
        const edgeStats = {};
        timeframes.forEach(tf => {
            edgeStats[tf] = {
                upEdges: [],
                downEdges: []
            };
        });
        
        // Process all high and low pivots with edge data
        let pivotsWithEdges = 0;
        for (let i = pivotLookback; i < pivotCandles.length; i++) {
            const currentCandle = pivotCandles[i];
            
            // Process high pivots for edge statistics
            const isHighPivot = detectPivot(pivotCandles, i, pivotLookback, 'high');
            
            if (isHighPivot) {
                const swingPct = lastPivot.price ? (currentCandle.high - lastPivot.price) / lastPivot.price : 0;
                const isFirstPivot = lastPivot.type === null;
                
                if ((isFirstPivot || Math.abs(swingPct) >= swingThreshold) && (i - lastPivot.index) >= minLegBars) {
                    // This is a valid high pivot, get its edge data
                    const pivotEdgeData = getCurrentEdgeData(currentCandle.high, currentCandle, edges, timeframes);
                    
                    // Add edge data to statistics
                    timeframes.forEach(tf => {
                        if (pivotEdgeData[tf]) {
                            edgeStats[tf].upEdges.push(pivotEdgeData[tf].upEdge.percentToEdge);
                            edgeStats[tf].downEdges.push(pivotEdgeData[tf].downEdge.percentToEdge);
                        }
                    });
                    
                    pivotsWithEdges++;
                }
            }
            
            // Process low pivots for edge statistics
            const isLowPivot = detectPivot(pivotCandles, i, pivotLookback, 'low');
            
            if (isLowPivot) {
                const swingPct = lastPivot.price ? (currentCandle.low - lastPivot.price) / lastPivot.price : 0;
                const isFirstPivot = lastPivot.type === null;
                
                if ((isFirstPivot || Math.abs(swingPct) >= swingThreshold) && (i - lastPivot.index) >= minLegBars) {
                    // This is a valid low pivot, get its edge data
                    const pivotEdgeData = getCurrentEdgeData(currentCandle.low, currentCandle, edges, timeframes);
                    
                    // Add edge data to statistics
                    timeframes.forEach(tf => {
                        if (pivotEdgeData[tf]) {
                            edgeStats[tf].upEdges.push(pivotEdgeData[tf].upEdge.percentToEdge);
                            edgeStats[tf].downEdges.push(pivotEdgeData[tf].downEdge.percentToEdge);
                        }
                    });
                    
                    pivotsWithEdges++;
                }
            }
        }
        
        // Calculate and display edge statistics
        if (pivotsWithEdges > 0) {
            console.log(`\n${colors.cyan}--- Edge Proximity Statistics ---${colors.reset}`);
            
            timeframes.forEach(tf => {
                const upEdges = edgeStats[tf].upEdges.filter(val => !isNaN(val));
                const downEdges = edgeStats[tf].downEdges.filter(val => !isNaN(val));
                
                if (upEdges.length > 0 && downEdges.length > 0) {
                    const avgUpEdge = upEdges.reduce((sum, val) => sum + val, 0) / upEdges.length;
                    const avgDownEdge = downEdges.reduce((sum, val) => sum + val, 0) / downEdges.length;
                    const maxUpEdge = Math.max(...upEdges);
                    const maxDownEdge = Math.max(...downEdges);
                    
                    console.log(`${tf.charAt(0).toUpperCase() + tf.slice(1)} Timeframe:`);
                    console.log(`  ${colors.green}Avg Up Edge:   ${avgUpEdge.toFixed(2)}%${colors.reset}`);
                    console.log(`  ${colors.red}Avg Down Edge: ${avgDownEdge.toFixed(2)}%${colors.reset}`);
                    console.log(`  ${colors.green}Max Up Edge:   ${maxUpEdge.toFixed(2)}%${colors.reset}`);
                    console.log(`  ${colors.red}Max Down Edge: ${maxDownEdge.toFixed(2)}%${colors.reset}`);
                }
            });
        }
    }

   
    console.log(`\n${colors.cyan}--- Market Movement Summary ---${colors.reset}`);
    console.log(`Max Upward Move: ${colors.green}+${totalUpwardChange.toFixed(2)}%${colors.reset} (from start to ATH)`);
    console.log(`Max Downward Move: ${colors.red}${totalDownwardChange.toFixed(2)}%${colors.reset} (from start to ATL)`);
    console.log(`Net Price Range: ${colors.yellow}${netPriceRange.toFixed(2)}%${colors.reset} (from ATL to ATH)`);



    console.log(`\n \n ${colors.yellow}--- TRADE SUMMARY ---${colors.reset}`);
    
    // Calculate statistics excluding EOB trades
    const closedTrades = regularTrades.length;
    const totalTrades = trades.length;
    const wins = regularTrades.filter(t => t.pnl >= 0).length;
    const losses = regularTrades.filter(t => t.pnl < 0).length;
    const timeoutTrades = regularTrades.filter(t => t.result === 'TIMEOUT').length;
    const tpTrades = regularTrades.filter(t => t.result === 'TP').length;
    const slTrades = regularTrades.filter(t => t.result === 'SL').length;
    const winRate = closedTrades > 0 ? (wins / closedTrades * 100).toFixed(2) : 'N/A';
    const totalRealizedPnl = regularTrades.reduce((acc, t) => acc + t.pnl, 0);
    const totalFees = regularTrades.reduce((acc, t) => acc + t.fee, 0);
    
    // Display trade counts with EOB note if applicable
    if (eobTrades.length > 0) {
        console.log(`Total Closed Trades: ${closedTrades} (excluding ${eobTrades.length} EOB trade${eobTrades.length > 1 ? 's' : ''})`);
    } else {
        console.log(`Total Closed Trades: ${closedTrades}`);
    }
    
    // Display trade result breakdown
    if (closedTrades > 0) {
        console.log(`Trade Results: ${colors.green}TP: ${tpTrades}${colors.reset} | ${colors.red}SL: ${slTrades}${colors.reset} | ${colors.yellow}TIMEOUT: ${timeoutTrades}${colors.reset}`);
    }
    
    if(closedTrades > 0) {
        console.log(`Wins: ${colors.green}${wins}${colors.reset} | Losses: ${colors.red}${losses}${colors.reset}`);
        console.log(`Win Rate: ${colors.yellow}${winRate}%${colors.reset}`);
    }
    
    console.log(`Total PnL: ${(totalRealizedPnl > 0 ? colors.green : colors.red)}${totalRealizedPnl.toFixed(2)}${colors.reset} (after ${totalFees.toFixed(2)} in fees)`);
    
    // Calculate capital excluding EOB trades
    const eobPnl = eobTrades.reduce((acc, t) => acc + t.pnl, 0);
    const adjustedFinalCapital = finalCapital - eobPnl;
    
    console.log(`Initial Capital: ${tradeConfig.initialCapital.toFixed(2)}`);
    
    if (eobTrades.length > 0) {
        console.log(`Final Capital: ${colors.yellow}${adjustedFinalCapital.toFixed(2)}${colors.reset} (excluding EOB trades)`);
    } else {
        console.log(`Final Capital: ${colors.yellow}${finalCapital.toFixed(2)}${colors.reset}`);
    }
    
    const profit = ((adjustedFinalCapital - tradeConfig.initialCapital) / tradeConfig.initialCapital) * 100;
    console.log(`Overall Profit: ${(profit > 0 ? colors.green : colors.red)}${profit.toFixed(2)}%${colors.reset}${eobTrades.length > 0 ? ' (excluding EOB trades)' : ''}`);
      

    // Calculate trade duration statistics if there are regular trades
    if (regularTrades.length > 0) {
        // Get durations in number of candles for each trade
        const tradeDurations = regularTrades.map(trade => trade.exitIndex - trade.entryIndex);
        
        // Convert candle count to actual time duration based on interval
        const tradeDurationsMs = tradeDurations.map(candles => candles * candleDurationMs);
        
        // Find min, max, and average durations
        const minDurationMs = Math.min(...tradeDurationsMs);
        const maxDurationMs = Math.max(...tradeDurationsMs);
        const avgDurationMs = tradeDurationsMs.reduce((sum, duration) => sum + duration, 0) / tradeDurationsMs.length;
        
        // Use the formatDuration function defined at the top level
        
        console.log(`\n${colors.cyan}--- Trade Duration Statistics ---${colors.reset}`);
        console.log(`Shortest Trade: ${colors.yellow}${formatDuration(minDurationMs)}${colors.reset}`);
        console.log(`Longest Trade:  ${colors.yellow}${formatDuration(maxDurationMs)}${colors.reset}`);
        console.log(`Average Trade:  ${colors.cyan}${formatDuration(avgDurationMs)}${colors.reset}`);
    }
    



    if (pivotCandles.length > 0) {
        // Calculate total elapsed time using candle count multiplied by interval duration
        // This is more accurate than using timestamps which might have gaps
        const candleCount = pivotCandles.length;
        const elapsedMs = candleCount * candleDurationMs;

        const days = Math.floor(elapsedMs / (1000 * 60 * 60 * 24));
        const hours = Math.floor((elapsedMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((elapsedMs % (1000 * 60 * 60)) / (1000 * 60));
        
        console.log(`\nData Time Elapsed: ${days} days, ${hours} hours, ${minutes} minutes.`);
        
        // Display information about trade execution candles if different from pivot candles
        if (tradeCandles !== pivotCandles) {
            console.log(`${colors.cyan}Trade Execution: Used ${tradeCandles.length} 1-minute candles for accurate TP/SL tracking${colors.reset}`);
        }
    }

    console.log(`\n${colors.cyan}--- Test Complete ---${colors.reset}`);
}

(async () => {
    try {
        await runTest();
    } catch (err) {
        console.error('\nAn error occurred during the test:', err);
        process.exit(1);
    }
})();
