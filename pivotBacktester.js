// tests/instantPivotTest.js
// Self-sufficient test file for instant pivot detection using the user's two-step logic with edge detection.

import {
    symbol,
    time as interval,
    limit,
    minSwingPct,
    pivotLookback,
    minLegBars
} from './config/config.js';
import { getCandles } from './apis/bybit.js';
import { tradeConfig } from './config/tradeconfig.js';

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

// Helper function to detect pivots
const detectPivot = (candles, i, pivotLookback, pivotType) => {
    let isPivot = true;
    
    for (let j = 1; j <= pivotLookback; j++) {
        if (pivotType === 'high') {
            if (candles[i].high <= candles[i - j].high) {
                isPivot = false;
                break;
            }
        } else { // low pivot
            if (candles[i].low >= candles[i - j].low) {
                isPivot = false;
                break;
            }
        }
    }
    
    return isPivot;
};

// Helper function to format edge data display
const formatEdgeData = (pivotEdgeData, timeframes) => {
    const edgeDisplayData = [];
    
    // Section 1: Closest edges - now using currentMove which has the correct sign based on reference
    let edgesSection = `${colors.yellow}Edges:${colors.reset} `;
    timeframes.forEach(tf => {
        if (pivotEdgeData[tf]) {
            // Use the currentMove value which is already properly signed relative to the reference point
            const signedValue = pivotEdgeData[tf].currentMove;
            const color = signedValue >= 0 ? colors.green : colors.red;
            const tfShort = tf === 'daily' ? 'D' : tf === 'weekly' ? 'W' : tf === 'biweekly' ? 'B' : 'M';
            // Use explicit sign in the display
            const signPrefix = signedValue >= 0 ? '+' : '';
            edgesSection += `${tfShort}:${color}${signPrefix}${signedValue.toFixed(2)}%${colors.reset} `;
        }
    });
    
    // Section 2: Average edges (historical average of ranges)
    let avgEdgesSection = `${colors.magenta}Average:${colors.reset} `;
    timeframes.forEach(tf => {
        if (pivotEdgeData[tf] && pivotEdgeData[tf].averageRange) {
            const avgRange = pivotEdgeData[tf].averageRange;
            // Apply sign based on direction - positive for up, negative for down
            const signedValue = avgRange.direction === 'up' 
                ? avgRange.value 
                : -avgRange.value;
            const color = signedValue >= 0 ? colors.green : colors.red;
            const tfShort = tf === 'daily' ? 'D' : tf === 'weekly' ? 'W' : tf === 'biweekly' ? 'B' : 'M';
            // Use explicit sign in the display
            const signPrefix = signedValue >= 0 ? '+' : '';
            avgEdgesSection += `${tfShort}:${color}${signPrefix}${signedValue.toFixed(2)}%${colors.reset} `;
        }
    });
    
    // Section 3: Range/total edges
    let rangeEdgesSection = `${colors.blue}Range:${colors.reset} `;
    timeframes.forEach(tf => {
        if (pivotEdgeData[tf]) {
            // Calculate total range now based on the min/max from reference point
            const upEdge = pivotEdgeData[tf].upEdge.percentToEdge;
            const downEdge = pivotEdgeData[tf].downEdge.percentToEdge;
            const totalRange = Math.abs(upEdge - downEdge); // Total range is always positive
            
            // For sign, use the current position's direction relative to the reference
            // If current price is above reference, range is positive; if below, negative
            const signedTotalRange = pivotEdgeData[tf].currentMove >= 0 ? totalRange : -totalRange;
            
            const color = signedTotalRange >= 0 ? colors.green : colors.red;
            const tfShort = tf === 'daily' ? 'D' : tf === 'weekly' ? 'W' : tf === 'biweekly' ? 'B' : 'M';
            // Use explicit sign in the display
            const signPrefix = signedTotalRange >= 0 ? '+' : '';
            rangeEdgesSection += `${tfShort}:${color}${signPrefix}${signedTotalRange.toFixed(2)}%${colors.reset} `;
        }
    });
    
    // Combine all sections with pipe separators
    edgeDisplayData.push(`${edgesSection} ${colors.cyan}|${colors.reset} ${avgEdgesSection} ${colors.cyan}|${colors.reset} ${rangeEdgesSection}`);
    
    return edgeDisplayData;
};

// Helper function to create a trade
const createTrade = (type, currentCandle, pivotData, i, capital, tradeConfig) => {
    const entryPrice = type === 'long' ? currentCandle.low : currentCandle.high;
    const size = capital * (tradeConfig.riskPerTrade / 100);
    
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

console.log(`${colors.cyan}--- Instant Pivot Detection Test with Edge Analysis (No Lookahead) ---${colors.reset}`);

// Display trade configuration at the top
console.log(`${colors.cyan}--- Trade Configuration ---${colors.reset}`);
console.log(`Direction: ${colors.yellow}${tradeConfig.direction}${colors.reset}`);
console.log(`Take Profit: ${colors.green}${tradeConfig.takeProfit}%${colors.reset}`);
console.log(`Stop Loss: ${colors.red}${tradeConfig.stopLoss}%${colors.reset}`);
console.log(`Leverage: ${colors.yellow}${tradeConfig.leverage}x${colors.reset}`);
console.log(`Maker Fee: ${colors.yellow}${tradeConfig.totalMakerFee}%${colors.reset}`);
console.log(`Initial Capital: ${colors.yellow}${tradeConfig.initialCapital} USDT${colors.reset}`);
console.log(`Risk Per Trade: ${colors.yellow}${tradeConfig.riskPerTrade}%${colors.reset}`);

// Function to calculate edge data for price movements
const calculateEdges = (candles, timeframes) => {
    const edges = {};
    
    // Initialize edges for each timeframe
    timeframes.forEach(tf => {
        edges[tf] = {
            upEdges: [],
            downEdges: [],
            rangeTotals: [] // Store historical range totals for averaging
        };
    });
    
    // Detect the candle interval
    let candleInterval = '1m'; // Default assumption
    if (candles.length > 1) {
        const timeDiff = candles[1].time - candles[0].time;
        if (timeDiff >= 60 * 60 * 1000) { // 1 hour or more
            candleInterval = '1h';
            console.log('Detected hourly candles for edge calculations');
        } else if (timeDiff >= 5 * 60 * 1000) { // 5 minutes or more
            candleInterval = '5m';
            console.log('Detected 5-minute candles for edge calculations');
        } else {
            console.log('Detected 1-minute candles for edge calculations');
        }
    }
    
    // Calculate edges for each timeframe
    timeframes.forEach(tf => {
        // Calculate the number of candles to include for this timeframe
        let tfCandles;
        
        // Adjust candle counts based on detected interval
        if (candleInterval === '1h') {
            // For hourly candles
            switch(tf) {
                case 'daily':
                    tfCandles = 24; // 24 hourly candles for a day
                    break;
                case 'weekly':
                    tfCandles = 24 * 7; // 168 hourly candles for a week
                    break;
                case 'biweekly':
                    tfCandles = 24 * 14; // 336 hourly candles for 2 weeks
                    break;
                case 'monthly':
                    tfCandles = 24 * 30; // 720 hourly candles for a month
                    break;
                default:
                    tfCandles = 24; // Default to daily
            }
        } else {
            // For minute candles (1m or 5m)
            const minuteMultiplier = candleInterval === '5m' ? 5 : 1;
            
            switch(tf) {
                case 'daily':
                    tfCandles = (24 * 60) / minuteMultiplier; // 1440 or 288 candles for a day
                    break;
                case 'weekly':
                    tfCandles = (24 * 60 * 7) / minuteMultiplier; // 10080 or 2016 candles for a week
                    break;
                case 'biweekly':
                    tfCandles = (24 * 60 * 14) / minuteMultiplier; // 20160 or 4032 candles for 2 weeks
                    break;
                case 'monthly':
                    tfCandles = (24 * 60 * 30) / minuteMultiplier; // 43200 or 8640 candles for a month
                    break;
                default:
                    tfCandles = (24 * 60) / minuteMultiplier; // Default to daily
            }
        }
        
        // Adjust calculation window if we don't have enough candles
        if (candles.length < tfCandles) {
            console.warn(`Limited data for ${tf} edge calculation. Using all ${candles.length} available candles instead of ideal ${tfCandles}.`);
            tfCandles = candles.length; // Use all available candles
        }
        
        // Calculate max up and down moves for each window
        for (let i = tfCandles; i < candles.length; i++) {
            const windowCandles = candles.slice(i - tfCandles, i);
            
            // Find max and min prices in the window
            const maxPrice = Math.max(...windowCandles.map(c => c.high));
            const minPrice = Math.min(...windowCandles.map(c => c.low));
            const lastPrice = windowCandles[windowCandles.length - 1].close;
            const referencePrice = windowCandles[0].open; // Use first candle in window as reference point
            
            // Calculate percentage moves relative to the reference price
            const upMove = ((maxPrice - referencePrice) / referencePrice) * 100;
            const downMove = ((minPrice - referencePrice) / referencePrice) * 100;
            const currentMove = ((lastPrice - referencePrice) / referencePrice) * 100;
            
            // Calculate total range (used for historical averaging)
            const totalRange = upMove + downMove;
            
            // Store the edges with reference-based calculations
            edges[tf].upEdges.push({
                time: candles[i].time,
                price: lastPrice,
                edgePrice: maxPrice,
                percentToEdge: upMove,
                referencePrice: referencePrice,
                currentMove: currentMove // Store current position relative to reference
            });
            
            edges[tf].downEdges.push({
                time: candles[i].time,
                price: lastPrice,
                edgePrice: minPrice,
                percentToEdge: downMove,
                referencePrice: referencePrice,
                currentMove: currentMove // Store current position relative to reference
            });
            
            // Store the total range for this timeframe window
            edges[tf].rangeTotals.push({
                time: candles[i].time,
                totalRange: totalRange,
                // Store which direction has more room (for display purposes)
                dominantDirection: upMove > downMove ? 'up' : 'down'
            });
        }
    });
    
    return edges;
};

// Function to get current edge data for a specific price
const getCurrentEdgeData = (price, edges, timeframes) => {
    const edgeData = {};
    
    timeframes.forEach(tf => {
        if (!edges[tf] || edges[tf].upEdges.length === 0 || edges[tf].downEdges.length === 0) {
            return;
        }
        
        // Get the latest edge data for this timeframe
        const latestUpEdge = edges[tf].upEdges[edges[tf].upEdges.length - 1];
        const latestDownEdge = edges[tf].downEdges[edges[tf].downEdges.length - 1];
        
        // Use the stored currentMove value which is relative to the reference price
        // This provides a consistent reference point and proper +/- sign
        const currentMove = latestUpEdge.currentMove; // Same value stored in both up/down edges
        
        // Calculate average of historical ranges based on timeframe
        let lookbackPeriods;
        switch(tf) {
            case 'daily':
                lookbackPeriods = 7; // Past 7 days
                break;
            case 'weekly':
                lookbackPeriods = 4; // Past 4 weeks
                break;
            case 'biweekly':
                lookbackPeriods = 4; // Past 4 biweeks
                break;
            case 'monthly':
                lookbackPeriods = 4; // Past 4 months
                break;
            default:
                lookbackPeriods = 7; // Default to 7 periods
        }
        
        // Ensure we have enough historical data
        const rangeTotals = edges[tf].rangeTotals;
        const historicalRanges = rangeTotals.length >= lookbackPeriods ? 
            rangeTotals.slice(rangeTotals.length - lookbackPeriods) : 
            rangeTotals;
        
        // Calculate average range
        const averageRange = historicalRanges.reduce((sum, range) => sum + range.totalRange, 0) / historicalRanges.length;
        
        // Determine dominant direction in the lookback period
        const upDirectionCount = historicalRanges.filter(range => range.dominantDirection === 'up').length;
        const averageDirection = upDirectionCount > historicalRanges.length / 2 ? 'up' : 'down';
        
        // Calculate distances to up and down edges based on the reference point
        const upPercentToEdge = latestUpEdge.percentToEdge - currentMove;
        const downPercentToEdge = currentMove - latestDownEdge.percentToEdge;
        
        // Determine the closest edge direction based on which has the smaller absolute distance
        const closerToUpEdge = Math.abs(upPercentToEdge) < Math.abs(downPercentToEdge);
        
        edgeData[tf] = {
            // Current position relative to the reference point - this maintains the proper sign
            currentMove: currentMove,
            
            // Store edge data with proper signs based on reference point
            upEdge: {
                price: latestUpEdge.edgePrice,
                percentToEdge: latestUpEdge.percentToEdge, // Original calculation from reference
                currentToEdge: upPercentToEdge, // Distance from current to edge
                referencePrice: latestUpEdge.referencePrice,
                direction: 'up'
            },
            downEdge: {
                price: latestDownEdge.edgePrice,
                percentToEdge: latestDownEdge.percentToEdge, // Original calculation from reference
                currentToEdge: downPercentToEdge, // Distance from current to edge
                referencePrice: latestDownEdge.referencePrice,
                direction: 'down'
            },
            
            // The closestEdge now properly represents the movement direction and distance
            closestEdge: closerToUpEdge ? 
                { direction: 'up', percentToEdge: Math.abs(upPercentToEdge), price: latestUpEdge.edgePrice } : 
                { direction: 'down', percentToEdge: Math.abs(downPercentToEdge), price: latestDownEdge.edgePrice },
                
            // Average of historical ranges with proper direction
            averageRange: {
                value: Math.abs(averageRange), // Always positive magnitude
                direction: averageDirection // Direction indicates if historical range is typically up or down
            }
        };
    });
    
    return edgeData;
};

async function runTest() {
    const allLocalCandles = await getCandles(symbol, interval, null, null, true);
    // Ensure there are enough candles for the lookback on both sides
    if (!allLocalCandles || allLocalCandles.length < (pivotLookback * 2 + 1)) {
        console.error(`Not enough historical data. Need at least ${pivotLookback * 2 + 1} candles for lookback of ${pivotLookback}.`);
        return;
    }
    // Use minute candles for more accurate edge calculations
    console.log(`Using minute candles for edge calculations (more accurate)...`);
    
    // Define edge candles - limit to 43,200 minute candles (30 days) for memory efficiency
    const maxEdgeCandles = Math.min(20160, allLocalCandles.length);
    const edgeCandles = allLocalCandles.slice(-maxEdgeCandles);
    console.log(`Using ${edgeCandles.length} minute candles for edge calculations.`);
    
    // Load display candles limited by user setting
    const candles = allLocalCandles.slice(-limit);
    console.log(`Loaded ${candles.length} of ${allLocalCandles.length} available '${interval}' local candles for display.\n`);
    
    // Define timeframes for edge detection
    const timeframes = ['daily', 'weekly', 'biweekly', 'monthly'];
    
    // Calculate edges for all timeframes using the extended candle set
    const edges = calculateEdges(edgeCandles, timeframes);
    console.log(`${colors.cyan}Calculated edge data for timeframes: ${timeframes.join(', ')}${colors.reset}\n`);

    let lastPivot = { type: null, price: null, time: null, index: 0 };
    const swingThreshold = minSwingPct / 100;
    let pivotCounter = 0;
    let highPivotCount = 0;
    let lowPivotCount = 0;

    // --- Trade State Initialization ---
    let capital = tradeConfig.initialCapital;
    const trades = [];
    let activeTrade = null;
    let tradeMaxDrawdown = 0;
    let tradeMaxProfit = 0;

    // Iterate, leaving enough space for lookback on either side
    for (let i = pivotLookback; i < candles.length; i++) {
        const currentCandle = candles[i];
        let pivotType = null;

        // Display candle with edge data if enabled
        if (tradeConfig.showCandle) {
            // Calculate current edge data for this candle
            const currentPrice = currentCandle.close;
            const pivotEdgeData = getCurrentEdgeData(currentPrice, edges, timeframes);
                    
            // Format candle data
            const candleTime = new Date(currentCandle.time).toLocaleString();
            const candleData = `${i.toString().padStart(6, ' ')} | ${candleTime} | O: ${currentCandle.open.toFixed(2)} H: ${currentCandle.high.toFixed(2)} L: ${currentCandle.low.toFixed(2)} C: ${currentCandle.close.toFixed(2)}`;
                    
            // Format edge data for this candle
            const edgeOutput = formatEdgeData(pivotEdgeData, timeframes);
                    
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
                    
            // Calculate and display the daily edge percentage
            let dailyEdgeDebug = '';
            if (referenceCandle) {
                const refTime = new Date(referenceCandle.time).toLocaleString();
                const dailyPct = ((currentCandle.close - referenceCandle.open) / referenceCandle.open) * 100;
                const pctSign = dailyPct >= 0 ? '+' : '';
                const pctColor = dailyPct >= 0 ? colors.green : colors.red;
                        
                dailyEdgeDebug = `\n    ${colors.cyan}[DEBUG] 24h Reference:${colors.reset} ${refTime} | O: ${referenceCandle.open.toFixed(2)} | Daily Edge: ${pctColor}${pctSign}${dailyPct.toFixed(2)}%${colors.reset}`;
            } else {
                dailyEdgeDebug = `\n    ${colors.red}[DEBUG] No 24h reference candle found${colors.reset}`;
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

            // Calculate and display the weekly edge percentage
            let weeklyEdgeDebug = '';
            if (weeklyReferenceCandle) {
                const refTime = new Date(weeklyReferenceCandle.time).toLocaleString();
                const weeklyPct = ((currentCandle.close - weeklyReferenceCandle.open) / weeklyReferenceCandle.open) * 100;
                const pctSign = weeklyPct >= 0 ? '+' : '';
                const pctColor = weeklyPct >= 0 ? colors.green : colors.red;
                
                weeklyEdgeDebug = `\n    ${colors.magenta}[DEBUG] 7d Reference:${colors.reset}  ${refTime} | O: ${weeklyReferenceCandle.open.toFixed(2)} | Weekly Edge: ${pctColor}${pctSign}${weeklyPct.toFixed(2)}%${colors.reset}`;
            } else {
                weeklyEdgeDebug = `\n    ${colors.red}[DEBUG] No 7d reference candle found${colors.reset}`;
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

            // Calculate and display the bi-weekly edge percentage
            let biweeklyEdgeDebug = '';
            if (biweeklyReferenceCandle) {
                const refTime = new Date(biweeklyReferenceCandle.time).toLocaleString();
                const biweeklyPct = ((currentCandle.close - biweeklyReferenceCandle.open) / biweeklyReferenceCandle.open) * 100;
                const pctSign = biweeklyPct >= 0 ? '+' : '';
                const pctColor = biweeklyPct >= 0 ? colors.green : colors.red;
                
                biweeklyEdgeDebug = `\n    ${colors.yellow}[DEBUG] 14d Reference:${colors.reset} ${refTime} | O: ${biweeklyReferenceCandle.open.toFixed(2)} | Bi-Weekly Edge: ${pctColor}${pctSign}${biweeklyPct.toFixed(2)}%${colors.reset}`;
            } else {
                biweeklyEdgeDebug = `\n    ${colors.red}[DEBUG] No 14d reference candle found${colors.reset}`;
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

            // Calculate and display the monthly edge percentage
            let monthlyEdgeDebug = '';
            if (monthlyReferenceCandle) {
                const refTime = new Date(monthlyReferenceCandle.time).toLocaleString();
                const monthlyPct = ((currentCandle.close - monthlyReferenceCandle.open) / monthlyReferenceCandle.open) * 100;
                const pctSign = monthlyPct >= 0 ? '+' : '';
                const pctColor = monthlyPct >= 0 ? colors.green : colors.red;
                
                monthlyEdgeDebug = `\n    ${colors.blue}[DEBUG] 30d Reference:${colors.reset} ${refTime} | O: ${monthlyReferenceCandle.open.toFixed(2)} | Monthly Edge: ${pctColor}${pctSign}${monthlyPct.toFixed(2)}%${colors.reset}`;
            } else {
                monthlyEdgeDebug = `\n    ${colors.red}[DEBUG] No 30d reference candle found${colors.reset}`;
            }

            // Calculate the average daily edge over the past 7 days
            let sevenDayAvgDebug = '';
            const dailyEdges = [];
            for (let day = 0; day < 7; day++) {
                const targetTime = currentCandle.time - (day * 24 * 60 * 60 * 1000);
                const refTime = targetTime - (24 * 60 * 60 * 1000);
                
                let targetCandle = null;
                let refCandle = null;

                // This is inefficient but necessary for this specific debug calculation
                for (let k = edgeCandles.length - 1; k >= 0; k--) {
                    if (edgeCandles[k].time <= targetTime && !targetCandle) targetCandle = edgeCandles[k];
                    if (edgeCandles[k].time <= refTime && !refCandle) refCandle = edgeCandles[k];
                    if (targetCandle && refCandle) break;
                }

                if (targetCandle && refCandle) {
                    const dailyEdge = ((targetCandle.close - refCandle.open) / refCandle.open) * 100;
                    dailyEdges.push(dailyEdge);
                }
            }

            if (dailyEdges.length > 0) {
                const avgDailyEdge = dailyEdges.reduce((a, b) => a + b, 0) / dailyEdges.length;
                const avgSign = avgDailyEdge >= 0 ? '+' : '';
                const avgColor = avgDailyEdge >= 0 ? colors.green : colors.red;
                sevenDayAvgDebug = `\n    ${colors.green}[DEBUG] 7d Avg Daily Edge:${colors.reset} ${avgColor}${avgSign}${avgDailyEdge.toFixed(2)}%${colors.reset}`;
            } else {
                sevenDayAvgDebug = `\n    ${colors.red}[DEBUG] Could not calculate 7d Avg Daily Edge${colors.reset}`;
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
                    breakoutRangeParts.push(`${name}: ${colors.green}+${upwardRangePct.toFixed(2)}%${colors.reset} / ${colors.red}${downwardRangePct.toFixed(2)}%${colors.reset}`);
                }
            }
            
            let totalRangeDebug = '';
            if (totalRangeParts.length > 0) {
                totalRangeDebug = `\n    ${colors.blue}[DEBUG] Total Range:    ${totalRangeParts.join(' | ')}${colors.reset}`;
            }

            let breakoutRangeDebug = '';
            if (breakoutRangeParts.length > 0) {
                breakoutRangeDebug = `\n    ${colors.yellow}[DEBUG] Range Breakout: ${breakoutRangeParts.join(' | ')}`;
            }

            // Output candle with its edge data and debug information
            console.log(`${candleData} ${edgeOutput}${dailyEdgeDebug}${weeklyEdgeDebug}${biweeklyEdgeDebug}${monthlyEdgeDebug}${sevenDayAvgDebug}${totalRangeDebug}${breakoutRangeDebug}`);
        }

        // --- Active Trade Management ---
        if (activeTrade) {
            let tradeClosed = false;
            let exitPrice = null;
            let result = '';
            
            // Track maximum favorable and unfavorable price movements
            if (activeTrade.type === 'long') {
                // For long trades: favorable = price goes up, unfavorable = price goes down
                const currentFavorable = (currentCandle.high - activeTrade.entryPrice) / activeTrade.entryPrice * 100;
                const currentUnfavorable = (currentCandle.low - activeTrade.entryPrice) / activeTrade.entryPrice * 100;
                
                activeTrade.maxFavorable = Math.max(activeTrade.maxFavorable, currentFavorable);
                activeTrade.maxUnfavorable = Math.min(activeTrade.maxUnfavorable, currentUnfavorable);
            } else { // short
                // For short trades: favorable = price goes down, unfavorable = price goes up
                const currentFavorable = (activeTrade.entryPrice - currentCandle.low) / activeTrade.entryPrice * 100;
                const currentUnfavorable = (activeTrade.entryPrice - currentCandle.high) / activeTrade.entryPrice * 100;
                
                activeTrade.maxFavorable = Math.max(activeTrade.maxFavorable, currentFavorable);
                activeTrade.maxUnfavorable = Math.min(activeTrade.maxUnfavorable, currentUnfavorable);
            }

            // Check for trade timeout if maxTradeTimeMinutes is enabled (greater than 0)
            if (tradeConfig.maxTradeTimeMinutes > 0) {
                const tradeTimeMs = currentCandle.time - activeTrade.entryTime;
                const tradeTimeMinutes = tradeTimeMs / (1000 * 60);
                
                if (tradeTimeMinutes >= tradeConfig.maxTradeTimeMinutes) {
                    tradeClosed = true;
                    exitPrice = currentCandle.close; // Use current candle close price for timeout exits
                    result = 'TIMEOUT';
                }
            }

            if (!tradeClosed) { // Only check TP/SL if not already closed due to timeout
                if (activeTrade.type === 'long') {
                    if (currentCandle.high >= activeTrade.takeProfitPrice) {
                        tradeClosed = true;
                        exitPrice = activeTrade.takeProfitPrice;
                        result = 'TP';
                    } else if (currentCandle.low <= activeTrade.stopLossPrice) {
                        tradeClosed = true;
                        exitPrice = activeTrade.stopLossPrice;
                        result = 'SL';
                    }
                } else { // short
                    if (currentCandle.low <= activeTrade.takeProfitPrice) {
                        tradeClosed = true;
                        exitPrice = activeTrade.takeProfitPrice;
                        result = 'TP';
                    } else if (currentCandle.high >= activeTrade.stopLossPrice) {
                        tradeClosed = true;
                        exitPrice = activeTrade.stopLossPrice;
                        result = 'SL';
                    }
                }
            }

            if (tradeClosed) {
                const pnlPct = (activeTrade.type === 'long' ? (exitPrice - activeTrade.entryPrice) / activeTrade.entryPrice : (activeTrade.entryPrice - exitPrice) / activeTrade.entryPrice) * tradeConfig.leverage;
                const grossPnl = activeTrade.size * pnlPct;
                const fee = (activeTrade.size * tradeConfig.leverage * (tradeConfig.totalMakerFee / 100));
                const pnl = grossPnl - fee;
                
                capital += pnl;

                const resultColor = result === 'TP' ? colors.green : colors.red;
                const tradeType = activeTrade.type.toUpperCase();
                const pnlText = `${resultColor}${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}${colors.reset}`;
                // Only log trade details if showTradeDetails is enabled
                if (tradeConfig.showTradeDetails) {
                    console.log(`  \x1b[35;1m└─> [${result}] ${tradeType} trade closed @ ${exitPrice.toFixed(2)}. PnL: ${pnlText}${colors.reset}`);
                }

                trades.push({
                    ...activeTrade,
                    exitPrice,
                    exitTime: currentCandle.time,
                    exitIndex: i,
                    status: 'closed',
                    result,
                    grossPnl,
                    pnl,
                    fee,
                    capitalAfter: capital
                });
                activeTrade = null;
            }
        }

        // Process high pivots
        const isHighPivot = detectPivot(candles, i, pivotLookback, 'high');
        
        if (isHighPivot) {
            const swingPct = lastPivot.price ? (currentCandle.high - lastPivot.price) / lastPivot.price : 0;
            const isFirstPivot = lastPivot.type === null;
            
            if ((isFirstPivot || Math.abs(swingPct) >= swingThreshold) && (i - lastPivot.index) >= minLegBars) {
                pivotType = 'high';
                pivotCounter++;
                highPivotCount++;
                const barsSinceLast = i - lastPivot.index;
                const movePct = swingPct * 100;
                const formattedTime = new Date(currentCandle.time).toLocaleString();
                
                // Get edge data for this pivot
                const pivotEdgeData = getCurrentEdgeData(currentCandle.high, edges, timeframes);
                
                const swingCandles = lastPivot.price ? candles.slice(lastPivot.index, i + 1) : null;
                const output = formatPivotOutput('high', pivotCounter, currentCandle.high, formattedTime, movePct, barsSinceLast, lastPivot, swingCandles);
                
                // Display pivot info if enabled
                if (tradeConfig.showPivot) {
                    console.log(output);
                    
                    // Display edge data
                    if (pivotEdgeData) {
                        const edgeDisplayData = formatEdgeData(pivotEdgeData, timeframes);
                        edgeDisplayData.forEach(line => console.log(line));
                    }
                }
                
                // Store pivot data
                lastPivot = { 
                    type: 'high', 
                    price: currentCandle.high, 
                    time: currentCandle.time, 
                    index: i,
                    edges: pivotEdgeData
                };
                
                // --- Open Short Trade ---
                if (!isFirstPivot && !activeTrade && (tradeConfig.direction === 'sell' || tradeConfig.direction === 'both')) {
                    activeTrade = createTrade('short', currentCandle, lastPivot, i, capital, tradeConfig);
                    
                    // Only log limit order information if showLimits is enabled
                    if (tradeConfig.showLimits) {
                        console.log(`  ${colors.yellow}└─> [SHORT] Entry: ${activeTrade.entryPrice.toFixed(2)} | Size: ${activeTrade.size.toFixed(2)} | TP: ${activeTrade.takeProfitPrice.toFixed(2)} | SL: ${activeTrade.stopLossPrice.toFixed(2)}${colors.reset}`);
                    }
                }
            }
        }

        // Process low pivots
        const isLowPivot = detectPivot(candles, i, pivotLookback, 'low');
        
        if (isLowPivot) {
            const swingPct = lastPivot.price ? (candles[i].low - lastPivot.price) / lastPivot.price : 0;
            const isFirstPivot = lastPivot.type === null;
            
            if ((isFirstPivot || Math.abs(swingPct) >= swingThreshold) && (i - lastPivot.index) >= minLegBars) {
                const movePct = swingPct * 100;
                const barsSinceLast = i - lastPivot.index;
                const formattedTime = new Date(candles[i].time).toLocaleString();
                
                // Get edge data for this pivot
                const pivotEdgeData = getCurrentEdgeData(candles[i].low, edges, timeframes);
                
                const swingCandles = lastPivot.price ? candles.slice(lastPivot.index, i + 1) : null;
                const output = formatPivotOutput('low', pivotCounter, candles[i].low, formattedTime, movePct, barsSinceLast, lastPivot, swingCandles);
                
                // Update counters
                pivotCounter++;
                lowPivotCount++;
                
                // Display pivot info if enabled
                if (tradeConfig.showPivot) {
                    console.log(output);
                    
                    // Display edge data
                    if (pivotEdgeData) {
                        const edgeDisplayData = formatEdgeData(pivotEdgeData, timeframes);
                        edgeDisplayData.forEach(line => console.log(line));
                    }
                }
                
                // Store pivot data
                lastPivot = { type: 'low', price: candles[i].low, time: candles[i].time, index: i, edges: pivotEdgeData };
                
                // Open a long trade if conditions are met
                if (!isFirstPivot && !activeTrade) {
                    if (tradeConfig.direction === 'buy' || tradeConfig.direction === 'both') {
                        activeTrade = createTrade('long', candles[i], lastPivot, i, capital, tradeConfig);
                        
                        if (tradeConfig.showLimits) {
                            console.log(`  ${colors.yellow}└─> [LONG]  Entry: ${activeTrade.entryPrice.toFixed(2)} | Size: ${activeTrade.size.toFixed(2)} | TP: ${activeTrade.takeProfitPrice.toFixed(2)} | SL: ${activeTrade.stopLossPrice.toFixed(2)}${colors.reset}`);
                        }
                    }
                }
            }
        }


    }
    
  

    // --- Final Summary Calculation ---
    const firstPrice = candles[0].open;
    const highestHigh = Math.max(...candles.map(c => c.high));
    const lowestLow = Math.min(...candles.map(c => c.low));

    const totalUpwardChange = ((highestHigh - firstPrice) / firstPrice) * 100;
    const totalDownwardChange = ((lowestLow - firstPrice) / firstPrice) * 100;
    const netPriceRange = ((highestHigh - lowestLow) / lowestLow) * 100;



    // --- Trade Summary --- 
    let finalCapital = capital;
    
    // Close any open trades at the end of backtesting using the last candle's close price
    if (activeTrade) {
        const endPrice = candles[candles.length - 1].close;
        const pnlPct = (activeTrade.type === 'long' ? (endPrice - activeTrade.entryPrice) / activeTrade.entryPrice : (activeTrade.entryPrice - endPrice) / activeTrade.entryPrice) * tradeConfig.leverage;
        const grossPnl = activeTrade.size * pnlPct;
        const fee = (activeTrade.size * tradeConfig.leverage * (tradeConfig.totalMakerFee / 100));
        const pnl = grossPnl - fee;
        
        capital += pnl;
        finalCapital = capital;
        
        // Always show EOB trade closing message, but only show details if showTradeDetails is enabled
        console.log(`
${colors.yellow}Closing open trade at end of backtest.${colors.reset}`)
        if (tradeConfig.showTradeDetails) {
            console.log(`  └─> [EOB] ${activeTrade.type.toUpperCase()} trade closed @ ${endPrice.toFixed(2)}. PnL: ${(pnl >= 0 ? colors.green : colors.red)}${pnl.toFixed(2)}${colors.reset}`);
        }
        
        // Add the closed trade to the trades array
        trades.push({
            ...activeTrade,
            exitPrice: endPrice,
            exitTime: candles[candles.length - 1].time,
            exitIndex: candles.length - 1,
            status: 'closed',
            result: 'EOB', // End Of Backtest
            grossPnl,
            pnl,
            fee,
            capitalAfter: capital
        });
        
        activeTrade = null;
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
        for (let i = pivotLookback; i < candles.length; i++) {
            const currentCandle = candles[i];
            
            // Process high pivots for edge statistics
            const isHighPivot = detectPivot(candles, i, pivotLookback, 'high');
            
            if (isHighPivot) {
                const swingPct = lastPivot.price ? (currentCandle.high - lastPivot.price) / lastPivot.price : 0;
                const isFirstPivot = lastPivot.type === null;
                
                if ((isFirstPivot || Math.abs(swingPct) >= swingThreshold) && (i - lastPivot.index) >= minLegBars) {
                    // This is a valid high pivot, get its edge data
                    const pivotEdgeData = getCurrentEdgeData(currentCandle.high, edges, timeframes);
                    
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
            const isLowPivot = detectPivot(candles, i, pivotLookback, 'low');
            
            if (isLowPivot) {
                const swingPct = lastPivot.price ? (currentCandle.low - lastPivot.price) / lastPivot.price : 0;
                const isFirstPivot = lastPivot.type === null;
                
                if ((isFirstPivot || Math.abs(swingPct) >= swingThreshold) && (i - lastPivot.index) >= minLegBars) {
                    // This is a valid low pivot, get its edge data
                    const pivotEdgeData = getCurrentEdgeData(currentCandle.low, edges, timeframes);
                    
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
        // Get durations in milliseconds for each trade
        const tradeDurations = regularTrades.map(trade => trade.exitTime - trade.entryTime);
        
        // Find min, max, and average durations
        const minDurationMs = Math.min(...tradeDurations);
        const maxDurationMs = Math.max(...tradeDurations);
        const avgDurationMs = tradeDurations.reduce((sum, duration) => sum + duration, 0) / tradeDurations.length;
        
        // Use the formatDuration function defined at the top level

        
        console.log(`\n${colors.cyan}--- Trade Duration Statistics ---${colors.reset}`);
        console.log(`Shortest Trade: ${colors.yellow}${formatDuration(minDurationMs)}${colors.reset}`);
        console.log(`Longest Trade:  ${colors.yellow}${formatDuration(maxDurationMs)}${colors.reset}`);
        console.log(`Average Trade:  ${colors.cyan}${formatDuration(avgDurationMs)}${colors.reset}`);
    }
    



    if (candles.length > 0) {
        const firstCandleTime = candles[0].time;
        const lastCandleTime = candles[candles.length - 1].time;
        const elapsedMs = lastCandleTime - firstCandleTime;

        const days = Math.floor(elapsedMs / (1000 * 60 * 60 * 24));
        const hours = Math.floor((elapsedMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((elapsedMs % (1000 * 60 * 60)) / (1000 * 60));
        
        console.log(`\nData Time Elapsed: ${days} days, ${hours} hours, ${minutes} minutes.`);
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
