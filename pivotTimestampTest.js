// pivotTimestampTest.js
// A lightweight, single-file solution to test and fix pivot timestamp issues

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';

// Configuration
const CONFIG = {
    symbol: 'BTCUSDT',
    interval: '1m',
    minSwingPct: 0.3,
    shortWindow: 10,
    longWindow: 20,
    confirmOnClose: true,
    minLegBars: 2,
    // Process one month of candles (approximately 43200 minutes in a month)
    maxCandles: 1200,
    // Start from the latest candle and go back one month
    startFromLatest: true
};

// Utility functions
function formatDateTime(timestamp) {
    if (typeof timestamp !== 'number') {
        console.error('Invalid timestamp:', timestamp);
        return 'Invalid timestamp';
    }
    
    const date = new Date(timestamp * 1000); // Convert seconds to milliseconds
    const options = {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    };
    return date.toLocaleString('en-US', options);
}

// Enhanced PivotTracker class for testing
class PivotTracker {
    constructor(config) {
        this.minSwingPct = config.minSwingPct / 100;
        this.confirmOnClose = config.confirmOnClose || false;
        this.minLegBars = config.minLegBars || 3;
        
        this.direction = null;
        this.pivotPrice = null;
        this.pivotTime = null;
        this.extremePrice = null;
        this.extremeTime = null;
        this.extremeCandle = null; // Store the entire candle where extreme was found
        this.legBars = 0;
    }
    
    update(candle) {
        const { high, low, close, time } = candle;
        const price = close; // Use closing price for simplicity
        
        // Initialize on first candle
        if (this.direction === null) {
            this.direction = 'up'; // Assume starting direction
            this.extremePrice = low;
            this.extremeTime = time;
            this.extremeCandle = {...candle}; // Store full candle
            this.pivotPrice = low;
            this.pivotTime = time;
            this.legBars = 1;
            return null;
        }
        
        // Track leg bars
        this.legBars++;
        
        // Looking for higher highs (in uptrend)
        if (this.direction === 'up') {
            // New high found, update extreme
            if (high > this.extremePrice) {
                this.extremePrice = high;
                this.extremeTime = time;
                this.extremeCandle = {...candle}; // Store full candle where high was found
                this.legBars = 1; // Reset leg bars
                return null;
            }
            
            // When confirmOnClose is true, use closing price for confirmation
            // but still track the actual high as the pivot price
            const reference = this.confirmOnClose ? price : low;
            const retrace = (this.extremePrice - reference) / this.extremePrice;
            
            // Check for a significant retracement
            if (retrace >= this.minSwingPct && this.legBars >= this.minLegBars) {
                // Confirm pivot high
                const pivot = this._confirmPivot('high', candle);
                
                // Switch direction
                this.direction = 'down';
                this.extremePrice = low;
                this.extremeTime = time;
                this.extremeCandle = {...candle}; // Store full candle
                this.legBars = 1;
                
                return pivot;
            }
        }
        // Looking for lower lows (in downtrend)
        else if (this.direction === 'down') {
            // New low found, update extreme
            if (low < this.extremePrice) {
                this.extremePrice = low;
                this.extremeTime = time;
                this.extremeCandle = {...candle}; // Store full candle where low was found
                this.legBars = 1; // Reset leg bars
                return null;
            }
            
            // When confirmOnClose is true, use closing price for confirmation
            // but still track the actual low as the pivot price
            const reference = this.confirmOnClose ? price : high;
            const retrace = (reference - this.extremePrice) / reference;
            
            // Check for a significant retracement
            if (retrace >= this.minSwingPct && this.legBars >= this.minLegBars) {
                // Confirm pivot low
                const pivot = this._confirmPivot('low', candle);
                
                // Switch direction
                this.direction = 'up';
                this.extremePrice = high;
                this.extremeTime = time;
                this.extremeCandle = {...candle}; // Store full candle
                this.legBars = 1;
                
                return pivot;
            }
        }
        
        return null;
    }
    
    _confirmPivot(type, confirmationCandle) {
        // Calculate move percentage
        let movePct = 0;
        if (this.pivotPrice) {
            if (type === 'high') {
                movePct = ((this.extremePrice - this.pivotPrice) / this.pivotPrice) * 100;
            } else {
                movePct = ((this.pivotPrice - this.extremePrice) / this.pivotPrice) * 100;
            }
        }
        
        // Create pivot object with both extreme and confirmation data
        const pivot = {
            type,
            price: this.extremePrice,
            time: this.extremeTime,
            previousPrice: this.pivotPrice,
            previousTime: this.pivotTime,
            movePct,
            bars: this.legBars,
            confirmedOnClose: this.confirmOnClose,
            displayTime: new Date(this.extremeTime * 1000).toLocaleTimeString(),
            confirmationTime: confirmationCandle.time,
            confirmationDisplayTime: new Date(confirmationCandle.time * 1000).toLocaleTimeString(),
            // Store the original candle where the extreme price was found
            extremeCandle: this.extremeCandle,
            // Also store the confirmation candle
            confirmationCandle: {...confirmationCandle}
        };
        
        // Update pivot price/time for next pivot calculation
        this.pivotPrice = this.extremePrice;
        this.pivotTime = this.extremeTime;
        
        return pivot;
    }
}

// Function to load candle data from CSV file
async function loadCandleData() {
    try {
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = path.dirname(__filename);
        const dataPath = path.join(__dirname, 'data', 'historical', 'BTCUSDT', '1m.csv');
        
        console.log(`Loading candle data from ${dataPath}...`);
        
        // Read CSV file line by line
        let allCandles = [];
        const fileStream = createReadStream(dataPath);
        const rl = createInterface({
            input: fileStream,
            crlfDelay: Infinity
        });
        
        // Parse CSV header
        let isFirstLine = true;
        let headers = [];
        
        for await (const line of rl) {
            if (isFirstLine) {
                // Skip header
                isFirstLine = false;
                headers = line.split(',');
                continue;
            }
            
            // Parse CSV line
            const values = line.split(',');
            const timestamp = parseInt(values[0]);
            
            // Create candle object
            const candle = {
                time: Math.floor(timestamp / 1000), // Convert milliseconds to seconds
                open: parseFloat(values[1]),
                high: parseFloat(values[2]),
                low: parseFloat(values[3]),
                close: parseFloat(values[4]),
                volume: parseFloat(values[5])
            };
            
            allCandles.push(candle);
        }
        
        // Sort by time (newest first if starting from latest)
        allCandles.sort((a, b) => CONFIG.startFromLatest ? b.time - a.time : a.time - b.time);
        
        // Take only the required number of candles
        const candles = allCandles.slice(0, CONFIG.maxCandles);
        
        // Sort back to chronological order for processing
        candles.sort((a, b) => a.time - b.time);
        
        console.log(`Loaded ${candles.length} candles out of ${allCandles.length} total`);
        
        // Show data range
        if (candles.length > 0) {
            const startDate = new Date(candles[0].time * 1000).toLocaleString();
            const endDate = new Date(candles[candles.length - 1].time * 1000).toLocaleString();
            console.log('Data Range:');
            console.log(`Start: ${startDate}`);
            console.log(`End: ${endDate}\n`);

            // No specific target timestamp check needed
        }

        return candles;
    } catch (error) {
        console.error('Error loading candle data:', error);
        return [];
    }
}

// Function to generate pivots
function generatePivots(candles, config) {
    console.log('Generating pivots with enhanced PivotTracker...');
    const pivotTracker = new PivotTracker(config);
    const pivots = [];
    
    // Process candles and collect pivots
    candles.forEach(candle => {
        const pivot = pivotTracker.update(candle);
        if (pivot) {
            // Make sure we have both extreme and confirmation data
            if (!pivot.extremeCandle) {
                console.warn(`Warning: Pivot missing extreme candle data at time ${pivot.time}`);
            }
            if (!pivot.confirmationCandle) {
                console.warn(`Warning: Pivot missing confirmation candle data at time ${pivot.time}`);
            }
            pivots.push(pivot);
        }
    });
    
    console.log(`Found ${pivots.length} pivots\n`);
    return pivots;
}

// Function to display all pivots with clear formatting
function simulateBacktest(candles, pivots) {
    console.log('\n===== ALL PIVOTS =====');
    console.log('Showing all generated pivots with timestamps and prices:\n');
    
    // No specific target timestamp check - we're looking at all pivots
    
    // Display all pivots in a clean table format
    console.log('INDEX | TYPE | PRICE    | TIME                           | DISPLAY TIME | MOVE % | BARS');
    console.log('------+------+----------+--------------------------------+-------------+-------+-----');
    
    pivots.forEach((pivot, index) => {
        const idx = String(index + 1).padStart(5, ' ');
        const type = pivot.type.toUpperCase().padEnd(4, ' ');
        const price = pivot.price.toFixed(2).padStart(8, ' ');
        const time = formatDateTime(pivot.time).padEnd(30, ' ');
        const displayTime = pivot.displayTime.padEnd(11, ' ');
        const movePct = pivot.movePct.toFixed(2).padStart(5, ' ');
        const bars = String(pivot.bars || 'N/A').padStart(4, ' ');
        
        console.log(`${idx} | ${type} | ${price} | ${time} | ${displayTime} | ${movePct}% | ${bars}`);
    });
    
    // Check for timestamp and price discrepancies
    console.log('\n===== DISCREPANCY CHECK =====');
    let discrepancies = 0;
    
    pivots.forEach((pivot, index) => {
        // Check if we have both extreme and confirmation data
        if (!pivot.extremeCandle) {
            console.log(`Pivot #${index + 1}: Missing extreme candle data!`);
            discrepancies++;
            return;
        }
        
        if (!pivot.confirmationCandle) {
            console.log(`Pivot #${index + 1}: Missing confirmation candle data!`);
            discrepancies++;
            return;
        }
        
        // For high pivots, check if the price matches the extreme candle high
        if (pivot.type === 'high' && pivot.price !== pivot.extremeCandle.high) {
            console.log(`Pivot #${index + 1} (HIGH): Pivot price ${pivot.price} ≠ Extreme candle high ${pivot.extremeCandle.high}`);
            discrepancies++;
        }
        // For low pivots, check if the price matches the extreme candle low
        else if (pivot.type === 'low' && pivot.price !== pivot.extremeCandle.low) {
            console.log(`Pivot #${index + 1} (LOW): Pivot price ${pivot.price} ≠ Extreme candle low ${pivot.extremeCandle.low}`);
            discrepancies++;
        }
        
        // Check if pivot time matches extreme candle time
        if (pivot.time !== pivot.extremeCandle.time) {
            console.log(`Pivot #${index + 1} (${pivot.type.toUpperCase()}): Pivot time ${pivot.time} ≠ Extreme candle time ${pivot.extremeCandle.time}`);
            discrepancies++;
        }
        
        // Check if confirmation time matches confirmation candle time
        if (pivot.confirmationTime !== pivot.confirmationCandle.time) {
            console.log(`Pivot #${index + 1} (${pivot.type.toUpperCase()}): Confirmation time ${pivot.confirmationTime} ≠ Confirmation candle time ${pivot.confirmationCandle.time}`);
            discrepancies++;
        }
        
        // Display both timestamps for reference using the built-in Date object
        const extremeDate = new Date(pivot.time * 1000);
        const confirmDate = new Date(pivot.confirmationTime * 1000);
        console.log(`Pivot #${index + 1} (${pivot.type.toUpperCase()}): Extreme time: ${extremeDate.toLocaleString()}, Confirmation time: ${confirmDate.toLocaleString()}`);
    });
    
    if (discrepancies === 0) {
        console.log('No timestamp or price discrepancies found! The fix is working correctly.');
    } else {
        console.log(`Found ${discrepancies} discrepancies that need attention.`);
    }
    
    console.log('==========================');
}

// Function to display a simple pivot summary
function simulateMiniBacktest(candles, pivots) {
    // Skip this function since we're focusing on showing all pivots
    return;
}

// Main function
async function main() {
    console.log('===== Pivot Timestamp Test =====');
    console.log('This is a lightweight test to verify pivot timestamp accuracy');
    console.log('Configuration:', CONFIG);
    
    // 1. Load candle data
    const candles = await loadCandleData();
    if (candles.length === 0) {
        console.error('No candle data available. Exiting.');
        return;
    }
    
    // 2. Generate pivots
    const pivots = generatePivots(candles, CONFIG);
    if (pivots.length === 0) {
        console.error('No pivots generated. Exiting.');
        return;
    }
    
    // 3. Simulate backtest to verify timestamps
    simulateBacktest(candles, pivots);
    
    // 4. Run a mini backtest simulation
    simulateMiniBacktest(candles, pivots);
    
    console.log('\n===== Test Complete =====');
}

// Run the test
main().catch(console.error);
