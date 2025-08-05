// fronttest.js
// Real-time price update stream and monitoring with candle data

import {
    symbol,
    time as interval,
    hideCandle
} from './config/config.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { connectWebSocket } from './apis/bybit_ws.js';
import { getCandles } from './apis/bybit.js';

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

// Format a complete candle with colors
const formatCandle = (candle) => {
    if (!candle) {
        return `${colors.red}Invalid candle data${colors.reset}`;
    }
    
    // Convert from API format if necessary (check if candle is object or array)
    const open = candle.open !== undefined ? candle.open : (Array.isArray(candle) ? parseFloat(candle[1]) : 0);
    const high = candle.high !== undefined ? candle.high : (Array.isArray(candle) ? parseFloat(candle[2]) : 0);
    const low = candle.low !== undefined ? candle.low : (Array.isArray(candle) ? parseFloat(candle[3]) : 0);
    const close = candle.close !== undefined ? candle.close : (Array.isArray(candle) ? parseFloat(candle[4]) : 0);
    const volume = candle.volume !== undefined ? candle.volume : (Array.isArray(candle) ? parseFloat(candle[5]) : 0);
    const timestamp = candle.time !== undefined ? candle.time : (Array.isArray(candle) ? parseInt(candle[0]) : 0);
    
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

// Start the websocket connection and price monitoring
async function startFronttest() {
    console.log(`${colors.yellow}Connecting to WebSocket...${colors.reset}`);
    
    // Parse interval to get numeric value
    const intervalValue = parseInt(interval.replace('m', ''));
    console.log(`Using ${intervalValue} minute interval`);
    
    // Tracking variables
    let previousPrice = null;
    let lastLogTime = 0;
    let lastCompletedCandleTime = 0;
    let currentIntervalEnd = null;
    
    // How frequently to update the console (milliseconds)
    const logInterval = 1000; // 1 second
    
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
                    lastCompletedCandleTime = latestCandle.time;
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
    
    // Initial fetch of the latest candle - force display the most recent one regardless
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
    connectWebSocket(symbol, (data) => {
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
                // Get the current interval boundaries
                const boundaries = getIntervalBoundaries(timestamp, intervalValue);
                currentIntervalEnd = boundaries.end;
                console.log(`\n${colors.cyan}Next candle close at ${new Date(currentIntervalEnd).toLocaleTimeString()}${colors.reset}`);
            }
            
            // Always update previousPrice for the first message
            if (previousPrice === null) {
                previousPrice = price;
                // Log the initial price without comparison
                if (!hideCandle) {
                    const time = new Date().toLocaleTimeString();
                    console.log(`[${time}] ${symbol}: ${price} (Initial price)`);
                }                
                lastLogTime = timestamp;
                return;
            }
            
            // Check if the current interval has ended
            if (timestamp >= currentIntervalEnd) {
                // Calculate boundaries for the next interval
                const boundaries = getIntervalBoundaries(timestamp, intervalValue);
                currentIntervalEnd = boundaries.end;
                
                // We'll let the timer handle fetching the candle data
                // This prevents duplicate API calls
                
                console.log(`\n${colors.cyan}Next candle close at ${new Date(currentIntervalEnd).toLocaleTimeString()}${colors.reset}`);
            }
            
            // Check if we should log this update (rate limiting)
            if (timestamp - lastLogTime >= logInterval) {
                // Format and log the price update
                const time = new Date().toLocaleTimeString();
                const formattedPrice = formatPrice(price, previousPrice);
                
                // Calculate time until next candle close
                const timeUntilClose = Math.max(0, currentIntervalEnd - timestamp);
                const secondsUntilClose = Math.ceil(timeUntilClose / 1000);
                
                if (!hideCandle) {
                    console.log(`[${time}] ${symbol}: ${formattedPrice} | ${secondsUntilClose}s until candle close`);
                }
                
                // Update tracking variables
                previousPrice = price;
                lastLogTime = timestamp;
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
