// fronttest.js
// Real-time price update stream and monitoring with candle data

import {
    symbol,
    time as interval,
    hideCandle,
    limit // maximum candles to retain, keeps parity with backtester
} from './config/config.js';
import { tradeConfig } from './config/tradeconfig.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { connectWebSocket } from './apis/bybit_ws.js';
import { getCandles } from './apis/bybit.js';

// Convert the interval string (e.g. "1m", "5m") to its numeric minute value once
// This will be reused throughout the script for all interval-related maths
const intervalValue = parseInt(interval);

// Get the directory name in a way that works with ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Console colors for better output readability
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

// Global variables for trade tracking
let capital = tradeConfig.initialCapital;
const trades = [];
const openTrades = [];

// Display header information
console.log(`${colors.cyan}=== BNB Scalper Fronttest - Live Price Monitor ===${colors.reset}`);
console.log(`${colors.yellow}Symbol: ${symbol} | Interval: ${interval}${colors.reset}`);
console.log(`${colors.magenta}Started at: ${new Date().toLocaleString()}${colors.reset}`);
console.log(`${colors.cyan}=================================================${colors.reset}\n`);

// Format the price with color based on change
const formatPrice = (price, previousPrice) => {
    // If this is the first price we've received, just return the price with no change indicator
    if (previousPrice === null || isNaN(previousPrice) || isNaN(price)) {
        return `${price}`;
    }
    
    const change = price - previousPrice;
    const color = change >= 0 ? colors.green : colors.red;
    const sign = change >= 0 ? '+' : '';
    const changePct = (change / previousPrice) * 100;
    
    return `${color}${price} (${sign}${change.toFixed(2)} | ${sign}${changePct.toFixed(4)}%)${colors.reset}`;
};

// Format a complete candle with colors - simplified assuming consistent object format
const formatCandle = (candle) => {
    if (!candle) {
        return `${colors.red}Invalid candle data${colors.reset}`;
    }
    
    // Assume candle is in standard object format
    const { open, high, low, close, volume, time: timestamp } = candle;
    
    // Format the timestamp with local time
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

// Helper function to get current interval start and end times
const getIntervalBoundaries = (timestamp, intervalStr) => {
    const date = new Date(timestamp);
    const minutes = parseInt(intervalStr);
    
    // Reset seconds and milliseconds
    date.setSeconds(0, 0);
    
    // Calculate the current interval's start
    const currentMinute = date.getMinutes();
    const intervalsElapsed = Math.floor(currentMinute / minutes);
    date.setMinutes(intervalsElapsed * minutes);
    
    const intervalStart = date.getTime();
    
    // Calculate end time (start time + interval in milliseconds)
    const intervalEnd = new Date(intervalStart);
    intervalEnd.setMinutes(intervalEnd.getMinutes() + minutes);
    
    return { start: intervalStart, end: intervalEnd.getTime() };
};



// Helper function to create a trade - simplified without TP/SL logic since it's not in use
const createTrade = (type, currentCandle, tradeSize) => {
    return {
        type,
        entryPrice: currentCandle.close,
        entryTime: currentCandle.time,
        size: tradeSize,
        status: 'open',
        maxFavorable: 0,  // Track maximum favorable price movement
        maxUnfavorable: 0  // Track maximum unfavorable price movement
    };
};

// Check and update open trades based on current price - simplified without TP/SL logic
const updateTrades = (currentPrice, currentTime) => {
    for (let i = 0; i < openTrades.length; i++) {
        const trade = openTrades[i];
        
        if (trade.status !== 'open') continue;
        
        // Calculate current P&L
        const priceDiff = trade.type === 'long' ? 
            currentPrice - trade.entryPrice : 
            trade.entryPrice - currentPrice;
            
        const pricePct = (priceDiff / trade.entryPrice) * 100;
        const leveragedPct = pricePct * tradeConfig.leverage;
        const currentPnL = (trade.size * leveragedPct) / 100;
        
        // Update max favorable/unfavorable metrics
        if (pricePct > trade.maxFavorable) trade.maxFavorable = pricePct;
        if (pricePct < -trade.maxUnfavorable) trade.maxUnfavorable = -pricePct;
        
        // Show current P&L if significant change
        if (Math.abs(pricePct) > 0.05) { // Only show updates for >0.05% price change
            const profitColor = currentPnL >= 0 ? colors.green : colors.red;
            console.log(`${colors.yellow}[TRADE UPDATE] ${trade.type.toUpperCase()} ${symbol} | Current P&L: ${profitColor}${currentPnL.toFixed(2)} USDT (${leveragedPct.toFixed(2)}%)${colors.reset}`);
        }
    }
    
    // Note: No trade closing logic here since TP/SL isn't used
    // This would be where you'd implement manual trade closing if needed
};

// Start the websocket connection and price monitoring
async function startFronttest() {
    console.log(`${colors.yellow}Connecting to WebSocket...${colors.reset}`);
    
    // Initialize trade tracking variables
    let candles = [];
    // Use the global capital variable
    capital = tradeConfig.initialCapital;
    
    // Tracking variables
    let previousPrice = null;
    let lastLogTime = 0;
    let lastCompletedCandleTime = 0;
    let currentIntervalEnd = null;
    let lastProcessedIntervalEnd = null;
    
    // How frequently to update the console (milliseconds)
    const logInterval = 1000; // 1 second
    
    // Function to load historical candles for initial context
    const loadHistoricalCandles = async () => {
        try {
            console.log(`${colors.yellow}Loading historical candles...${colors.reset}`);
            const historicalCandles = await getCandles(symbol, interval, limit);
            if (historicalCandles && historicalCandles.length > 0) {
                // Sort candles chronologically
                historicalCandles.sort((a, b) => a.time - b.time);
                candles = historicalCandles;
                console.log(`${colors.green}Loaded ${candles.length} historical candles${colors.reset}`);
                return true;
            } else {
                console.log(`${colors.red}Failed to load historical candles${colors.reset}`);
                return false;
            }
        } catch (error) {
            console.error(`${colors.red}Error loading historical candles:${colors.reset}`, error);
            return false;
        }
    };
    
    // Process a new candle
    const processNewCandle = (newCandle) => {
        // Add the new candle to our buffer
        candles.push(newCandle);
        
        // Ensure we preserve the same amount of history as backtester.
        // Only prune when we exceed the configured candle limit.
        if (limit > 0 && candles.length > limit) {
            candles.shift();
        }
        
        // Update open trades with latest closing price
        updateTrades(newCandle.close, newCandle.time);
    };
    
    // Function to fetch the latest completed candle from the API
    const fetchLatestCandle = async (forceDisplay = false) => {
        try {
            // For initial display, fetch more candles to ensure we get something
            // The number 100 is much higher than needed but ensures we get data
            const fetchLimit = forceDisplay ? 100 : 5;
            
            if (!hideCandle) {
                console.log(`${colors.yellow}Fetching the most recent ${fetchLimit} candles...${colors.reset}`);
            }
            const candles = await getCandles(symbol, interval, fetchLimit);
            
            if (candles && candles.length >= 1) {
                // Find the most recent candle by comparing timestamps
                // This ensures we get the absolute latest one
                const sortedCandles = [...candles].sort((a, b) => b.time - a.time);
                const latestCandle = sortedCandles[0];
                
                // Get current time for comparison
                const now = new Date();
                const candle_time = new Date(latestCandle.time);
                
                // Debug the candle timestamp and age
                const candleTime = candle_time.toLocaleTimeString();
                const minutesOld = Math.round((now - candle_time) / 60000);
                
                // Log how recent this candle is
                if (!hideCandle) {
                    console.log(`${colors.cyan}Candle timestamp: ${candleTime} (${minutesOld} minutes ago)${colors.reset}`);
                }
                
                // Display if this is a new candle we haven't shown yet OR if forceDisplay is true
                if (forceDisplay || lastCompletedCandleTime === 0 || latestCandle.time > lastCompletedCandleTime) {
                    const messagePrefix = forceDisplay ? 
                        `\n${colors.brightMagenta}Most recent completed candle (${interval}) - ${candleTime} (${minutesOld} min ago)${colors.reset}` :
                        `\n${colors.brightYellow}New candle detected for ${candleTime}${colors.reset}`;
                        
                    console.log(messagePrefix);
                    console.log(formatCandle(latestCandle));
                    console.log(`${colors.cyan}${'='.repeat(80)}${colors.reset}`);
                    
                    // Show next candle time immediately after displaying the candle
                    if (!forceDisplay && currentIntervalEnd) {
                        console.log(`\n${colors.cyan}Next candle close at ${new Date(currentIntervalEnd).toLocaleTimeString()}${colors.reset}`);
                    }
                    
                    lastCompletedCandleTime = latestCandle.time;
                    
                    // Process this new candle
                    processNewCandle(latestCandle);
                    
                    return true;
                } else if (!forceDisplay) {
                    // console.log(`${colors.yellow}No new candle yet. Latest: ${candleTime}${colors.reset}`);
                }
            } else {
                // Always show error messages, even when hideCandle is true
                console.log(`${colors.red}No candle data available. Check your API connection or symbol configuration.${colors.reset}`);
                // Try to get more information about what might be wrong
                console.log(`${colors.yellow}Attempted to fetch candles for symbol: ${symbol}, interval: ${interval}${colors.reset}`);
                console.log(`${colors.yellow}API response returned: ${candles ? 'Empty array' : 'No data'}${colors.reset}`);
            }
            return false;
        } catch (error) {
            // Always show error messages regardless of hideCandle setting
            console.error(`${colors.red}Error fetching candle data:${colors.reset}`, error);
            return false;
        }
    };
    
    // First, load historical candles
    console.log(`${colors.cyan}\nLoading historical candle data...${colors.reset}`);
    const historicalSuccess = await loadHistoricalCandles();
    
    if (!historicalSuccess) {
        console.log(`${colors.yellow}Failed to load historical candles. Will continue with real-time data only.${colors.reset}`);
    }
    
    // Then fetch the latest candle - force display the most recent one regardless
    if (!hideCandle) {
        console.log(`${colors.cyan}\nAttempting to fetch the most recent candle data for context...${colors.reset}`);
    } else {
        console.log(`${colors.cyan}\nFetching initial candle data...${colors.reset}`);
    }
    const initialCandleSuccess = await fetchLatestCandle(true);
    
    if (!initialCandleSuccess) {
        console.log(`${colors.yellow}Failed to fetch initial candle data. Will continue to monitor for real-time updates.${colors.reset}`);
    }
    
    // Set up a timer to check for new candles that syncs with the minute boundary
    // This ensures we check right after a new candle should have closed
    const now = new Date();
    const secondsUntilNextMinute = 60 - now.getSeconds();
    
    if (!hideCandle) {
        console.log(`${colors.cyan}Syncing with minute boundary. Will start checking candles in ${secondsUntilNextMinute} seconds...${colors.reset}`);
    }
    
    // First, set a one-time timeout to sync with the minute boundary
    setTimeout(() => {
        // Then set up the regular interval check
        const candleCheckInterval = setInterval(async () => {
            await fetchLatestCandle();
        }, 5000); // Check every 5 seconds
        
        // Also do an immediate check once we're synced
        fetchLatestCandle();
    }, secondsUntilNextMinute * 1000); // Wait until the next minute boundary
    
    // Connect to WebSocket and process incoming data
    // Make the handler async so we can await the candle fetch when an interval closes
// Break WebSocket processing into smaller functions for better readability
const processInitialPrice = (price, timestamp) => {
    previousPrice = price;
    if (!hideCandle) {
        const time = new Date().toLocaleTimeString();
        console.log(`[${time}] ${symbol}: ${price} (Initial price)`);
    }                
    lastLogTime = timestamp;
    return true; // Indicates processing is complete
};

const handleIntervalEnd = async (timestamp) => {
    // First, calculate boundaries for the next interval and update currentIntervalEnd
    const boundaries = getIntervalBoundaries(timestamp, intervalValue);
    const previousIntervalEnd = currentIntervalEnd;
    currentIntervalEnd = boundaries.end;
    
    // Then fetch and display the latest completed candle (now with correct next interval time)
    await fetchLatestCandle();
    
    // Update tracking to the interval we just processed
    lastProcessedIntervalEnd = previousIntervalEnd;
};

const processRegularUpdate = (price, timestamp) => {
    const time = new Date().toLocaleTimeString();
    const formattedPrice = formatPrice(price, previousPrice);
    
    // Calculate time until next candle close
    const timeUntilClose = Math.max(0, currentIntervalEnd - timestamp);
    const secondsUntilClose = Math.ceil(timeUntilClose / 1000);
    
    if (!hideCandle) {
        console.log(`[${time}] ${symbol}: ${formattedPrice} | ${secondsUntilClose}s until candle close`);
    }
    
    // Update open trades with current price
    updateTrades(price, timestamp);
    
    // Update tracking variables
    previousPrice = price;
    lastLogTime = timestamp;
};

connectWebSocket(symbol, async (data) => {
    try {
        // Extract the data we need
        const timestamp = new Date().getTime();
        const price = parseFloat(data.price);
        
        if (isNaN(price)) {
            console.error(`${colors.red}Received invalid price data${colors.reset}`);
            return;
        }
        
        // Calculate and update interval boundaries if needed
        if (currentIntervalEnd === null) {
            const boundaries = getIntervalBoundaries(timestamp, intervalValue);
            currentIntervalEnd = boundaries.end;
            console.log(`\n${colors.cyan}First candle close at ${new Date(currentIntervalEnd).toLocaleTimeString()}${colors.reset}`);
        }
        
        // Always update previousPrice for the first message
        if (previousPrice === null) {
            if (processInitialPrice(price, timestamp)) return;
        }
        
        // Check if the current interval has ended (and we haven't already processed this interval end)
        if (timestamp >= currentIntervalEnd && currentIntervalEnd !== lastProcessedIntervalEnd) {
            lastProcessedIntervalEnd = currentIntervalEnd;
            await handleIntervalEnd(timestamp);
        }

        // Check if we should log this update (rate limiting)
        if (timestamp - lastLogTime >= logInterval) {
            processRegularUpdate(price, timestamp);
        }
    } catch (error) {
        console.error(`${colors.red}Error processing WebSocket data:${colors.reset}`, error);
        console.error(`${colors.yellow}Data:${colors.reset}`, JSON.stringify(data));
    }
});
    
    if (!hideCandle) {
        console.log(`${colors.green}WebSocket connection established. Waiting for price updates...${colors.reset}`);
    } else {
        console.log(`${colors.green}WebSocket connected. Price updates hidden (hideCandle=true).${colors.reset}`);
    }
}

// Start the fronttest
startFronttest();

// Handle proper cleanup on process termination
process.on('SIGINT', () => {
    console.log(`\n${colors.yellow}Shutting down...${colors.reset}`);
    process.exit(0);
});
