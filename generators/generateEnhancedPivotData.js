// generateEnhancedPivotData.js

// Configuration - Change this value to modify number of parallel workers
const NUM_WORKERS = 8;


import { Worker } from 'worker_threads';
import path from 'path';
import { fileURLToPath } from 'url';


import {
    api,
    time as interval,
    symbol,
    limit,
    minSwingPct,
    shortWindow,
    longWindow,
    confirmOnClose,
    minLegBars,
    delay
} from '../config/config.js';

import PivotTracker from '../utils/pivotTracker.js';
import { fetchCandles } from '../utils/candleAnalytics.js';
import { savePivotData } from '../utils/pivotCache.js';

// Import edge calculation functions
const timeframes = {
    daily: 24 * 60 * 60 * 1000,      // 24 hours
    weekly: 7 * 24 * 60 * 60 * 1000,  // 7 days
    biweekly: 14 * 24 * 60 * 60 * 1000, // 14 days
    monthly: 30 * 24 * 60 * 60 * 1000  // 30 days
};

// Calculate move within a specific time window
function calculateMove(candles, windowStart, windowEnd) {
    const windowCandles = candles.filter(c => c.time >= windowStart && c.time <= windowEnd);
    
    if (!windowCandles.length) return null;
    
    // Get reference price from start of period
    const referencePrice = windowCandles[0].open;
    const currentPrice = windowCandles[windowCandles.length - 1].close;
    
    // Track high and low for total range
    let highPrice = windowCandles[0].high;
    let lowPrice = windowCandles[0].low;
    let highTime = windowCandles[0].time;
    let lowTime = windowCandles[0].time;
    
    for (const candle of windowCandles) {
        if (candle.high > highPrice) {
            highPrice = candle.high;
            highTime = candle.time;
        }
        if (candle.low < lowPrice) {
            lowPrice = candle.low;
            lowTime = candle.time;
        }
    }
    
    // Calculate position relative to reference (start of period)
    const positionPct = ((currentPrice - referencePrice) / referencePrice) * 100;
    
    // Calculate total range relative to reference
    const totalRange = ((highPrice - lowPrice) / referencePrice) * 100;
    
    // Direction is based on position relative to reference, not short-term movement
    const direction = positionPct >= 0 ? 'U' : 'D';

    return {
        high: highPrice,
        highTime: highTime,
        low: lowPrice,
        lowTime: lowTime,
        current: currentPrice,
        reference: referencePrice,
        // Total range is always positive
        move: parseFloat(totalRange.toFixed(2)),
        // Position maintains its sign to show where we are relative to reference
        position: parseFloat(positionPct.toFixed(2))
    };
}

// Calculate average move for a timeframe
function calculateAverageMove(candles, endTime, periodMs, count) {
    const moves = [];
    for (let i = 1; i <= count; i++) {
        const periodEnd = endTime - (i - 1) * periodMs;
        const periodStart = periodEnd - periodMs;
        const result = calculateMove(candles, periodStart, periodEnd);
        if (result) {
            moves.push(result.move);
        }
    }
    return moves.length ? parseFloat((moves.reduce((a, b) => a + b, 0) / moves.length).toFixed(2)) : null;
}

// Calculate edge data for a specific timestamp
function calculateEdgeData(candles, timestamp) {
    const edgeData = {};
    
    for (const [timeframe, duration] of Object.entries(timeframes)) {
        const windowEnd = timestamp;
        const windowStart = windowEnd - duration;
        
        const move = calculateMove(candles, windowStart, windowEnd);
        if (!move) continue;

        let averageMove = null;
        if (timeframe === 'daily') {
            averageMove = {
                week: calculateAverageMove(candles, windowEnd, duration, 7),
                twoWeeks: calculateAverageMove(candles, windowEnd, duration, 14),
                month: calculateAverageMove(candles, windowEnd, duration, 30)
            };
        } else if (timeframe === 'weekly') {
            averageMove = calculateAverageMove(candles, windowEnd, duration, 4);
        } else if (timeframe === 'biweekly') {
            averageMove = calculateAverageMove(candles, windowEnd, duration, 4);
        } else if (timeframe === 'monthly') {
            averageMove = calculateAverageMove(candles, windowEnd, duration, 3);
        }

        edgeData[timeframe] = {
            ...move,
            averageMove
        };
    }

    return edgeData;
}

function createWorker(workerData, workerProgress) {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const workerPath = path.join(__dirname, 'pivotWorker.js');
    
    return new Promise((resolve, reject) => {
        const worker = new Worker(workerPath);
        let workerPivots = [];

        worker.on('message', (message) => {
            if (message.type === 'progress') {
                // Update progress for this worker
                workerProgress[message.workerId] = message.progress;
            } else if (message.type === 'complete') {
                // Process pivots to add validation data and displayTime
                const processedPivots = message.pivots.map(pivot => {
                    // Add validation to ensure pivot data matches actual candle data
                    const matchingCandle = workerData.candles.find(c => c.time === pivot.time);
                    if (matchingCandle) {
                        // Add candle data to pivot for validation
                        pivot.candleData = {
                            open: matchingCandle.open,
                            high: matchingCandle.high,
                            low: matchingCandle.low,
                            close: matchingCandle.close
                        };
                        // Add display time for better readability
                        pivot.displayTime = new Date(pivot.time * 1000).toLocaleTimeString();
                    }
                    return pivot;
                });
                
                workerPivots = processedPivots;
                worker.terminate();
                resolve({ pivots: workerPivots });
            }
        });

        worker.on('error', reject);
        worker.on('exit', (code) => {
            if (code !== 0 && code !== null) {
                reject(new Error(`Worker stopped with exit code ${code}`));
            }
        });

        worker.postMessage(workerData);
    });
}

function clearLines(count) {
    // Move up count lines
    process.stdout.write(`\x1b[${count}A`);
    // Clear everything below
    process.stdout.write('\x1b[J');
    // Move cursor to beginning of line
    process.stdout.write('\r');
}

let timerInterval = null;
let globalStartTime = 0;
let workerProgress = {};

function formatTimer(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

function drawProgressBars(workerProgress, startTime) {
    const output = [];
    // Calculate elapsed time
    const elapsed = performance.now() - startTime;

    // Add timer line
    output.push(`⏱️ Time elapsed: ${formatTimer(elapsed)}`);
    output.push('');

    // Add progress bars
    for (let i = 1; i <= NUM_WORKERS; i++) {
        const progress = workerProgress[i] || 0;
        const progressBar = '='.repeat(progress / 2) + '>' + ' '.repeat(50 - progress / 2);
        output.push(`Worker ${i}: [${progressBar}] ${progress}%`);
    }

    // Write all lines at once
    process.stdout.write(output.join('\n') + '\n');
}

function formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    const remainingMinutes = minutes % 60;
    const remainingSeconds = seconds % 60;
    const remainingMs = ms % 1000;

    let result = '';
    if (hours > 0) result += `${hours}h `;
    if (remainingMinutes > 0) result += `${remainingMinutes}m `;
    if (remainingSeconds > 0) result += `${remainingSeconds}s `;
    result += `${remainingMs}ms`;
    
    return result;
}

async function generateEnhancedPivotData() {
    globalStartTime = performance.now();
    
    // Setup timer interval
    timerInterval = setInterval(() => {
        // Only clear and redraw if we have some progress to show
        if (Object.keys(workerProgress).length > 0) {
            clearLines(NUM_WORKERS + 2); // +2 for timer and blank line
            drawProgressBars(workerProgress, globalStartTime);
        }
    }, 1000);
    
    // Initial setup message
    console.log(`\n▶ Generating Enhanced Pivot Data for ${symbol} [${interval}] using ${api}\n`);

    // 1. Get candles
    console.log('Reading candles from local data...');
    const candlesPerDay = 24 * 60; // 1440 candles per day
    const daysNeeded = 31; // Need a month of data for edge calculations
    const neededCandles = Math.max(limit, candlesPerDay * daysNeeded);
    
    const candles = await fetchCandles(symbol, interval, neededCandles, api, delay);
    candles.sort((a, b) => a.time - b.time);
    console.log(`Processing ${candles.length} candles from ${neededCandles} total`);

    // Show data range
    const startDate = new Date(candles[0].time).toLocaleString();
    const endDate = new Date(candles[candles.length - 1].time).toLocaleString();
    console.log('Data Range:');
    console.log(`Start: ${startDate}`);
    console.log(`End: ${endDate}
`);

    // 2. Process candles in parallel batches using workers with overlap to prevent missing pivots
    const batchSize = Math.ceil(candles.length / NUM_WORKERS); // Split into equal parts based on NUM_WORKERS
    const batches = [];
    
    // Define overlap size based on the longWindow parameter to ensure no pivots are missed
    // This ensures each batch has enough context from the previous batch
    const overlapSize = Math.max(longWindow * 2, 50); // At least twice the long window or 50 candles
    
    for (let i = 0; i < candles.length; i += batchSize) {
        // For all batches except the first, include overlap from previous batch
        const startIndex = i === 0 ? 0 : Math.max(0, i - overlapSize);
        const endIndex = Math.min(candles.length, i + batchSize);
        batches.push({
            candles: candles.slice(startIndex, endIndex),
            actualStartIndex: i, // Store the actual start index without overlap
            hasOverlap: i > 0,
            overlapSize: i > 0 ? i - startIndex : 0
        });
    }

    console.log(`Processing ${candles.length} candles in ${batches.length} parallel batches...\n`);
    
    // Reset progress tracking
    workerProgress = {};
    
    const pivotConfig = { minSwingPct, shortWindow, longWindow, confirmOnClose, minLegBars };
    // Draw initial progress bars
    drawProgressBars(workerProgress, globalStartTime);

    const workerPromises = batches.map((batchInfo, index) => {
        return createWorker({
            batch: batchInfo.candles,
            pivotConfig,
            candles, // Full candle set needed for edge calculations
            timeframes,
            workerId: index + 1,
            hasOverlap: batchInfo.hasOverlap,
            overlapSize: batchInfo.overlapSize,
            actualStartIndex: batchInfo.actualStartIndex
        }, workerProgress);
    });

    const results = await Promise.all(workerPromises);
    let pivots = results.flatMap(result => result.pivots);
    
    // Sort pivots by time to ensure chronological order
    pivots.sort((a, b) => a.time - b.time);

    console.log(`Total enhanced pivots found: ${pivots.length}`);

    // 3. Save enhanced pivot data
    console.log('\nSaving enhanced pivot data to cache...');
    savePivotData(symbol, interval + '_enhanced', pivots, pivotConfig, { 
        candles,
        generatedAt: Date.now(),
        lastUpdate: Date.now()
    });

    const endTime = performance.now();
    const duration = endTime - globalStartTime;
    
    // Clear timer interval
    clearInterval(timerInterval);
    
    console.log('\n✅ Enhanced pivot data generation complete!');
    console.log(`\n⏱️ Total execution time: ${formatTimer(duration)}`);
    console.log('\nYou can now use this data for advanced edge-aware analysis');
}

// Run the generator
generateEnhancedPivotData().catch(console.error);
