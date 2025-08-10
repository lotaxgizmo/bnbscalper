// multiTimeframePivotDetector.js
// Core multi-timeframe pivot detection and cascade confirmation system

import { multiPivotConfig } from '../config/multiPivotConfig.js';
import { getCandles } from '../apis/bybit.js';
import fs from 'fs';
import path from 'path';
import { limit, pivotDetectionMode, time, minSwingPct, minLegBars, pivotLookback } from '../config/config.js';
import { fmtDateTime } from './formatters.js';

const colors = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    magenta: '\x1b[35m',
    blue: '\x1b[34m',
    bold: '\x1b[1m'
};

export class MultiTimeframePivotDetector {
    constructor(symbol, config = multiPivotConfig) {
        this.symbol = symbol;
        this.config = config;
        this.timeframeData = new Map(); // Store candle data for each timeframe
        this.pivotHistory = new Map();  // Store pivot history for each timeframe
        this.activeSignals = [];        // Store active cascade signals
        this.debug = config.debug || {};
    }

    // Convert interval string to milliseconds
    intervalToMs(interval) {
        const unit = interval.slice(-1);
        const value = parseInt(interval.slice(0, -1));
        
        switch(unit) {
            case 'm': return value * 60 * 1000;
            case 'h': return value * 60 * 60 * 1000;
            case 'd': return value * 24 * 60 * 60 * 1000;
            case 'w': return value * 7 * 24 * 60 * 60 * 1000;
            case 'M': return value * 30 * 24 * 60 * 60 * 1000; // Approximate month
            default: return value * 60 * 1000;
        }
    }

    // Load candle data for a specific timeframe
    async loadTimeframeData(timeframe, useLocalData = true) {
        const { interval } = timeframe;
        
        try {
            let candles = [];
            
            if (useLocalData) {
                // Load from local CSV file
                const csvPath = path.join(process.cwd(), 'data', 'historical', this.symbol, `${interval}.csv`);
                
                if (fs.existsSync(csvPath)) {
                    const fileContent = fs.readFileSync(csvPath, 'utf8');
                    const lines = fileContent
                        .split('\n')
                        .map(line => line.trim())
                        .filter(line => line && line !== 'timestamp,open,high,low,close,volume');
                    
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
                        
                        if (!isNaN(candle.time) && !isNaN(candle.open)) {
                            candles.push(candle);
                        }
                    }
                    
                    candles.sort((a, b) => a.time - b.time);
                    
                    // Calculate appropriate limit for this timeframe (1 month of data)
                    const timeframeLimit = this.calculateTimeframeLimit(interval);
                    
                    // Apply candle limit (use most recent candles)
                    if (candles.length > timeframeLimit) {
                        const originalLength = candles.length;
                        candles = candles.slice(-timeframeLimit); // Keep most recent candles
                        if (this.debug.showTimeframeAnalysis) {
                            console.log(`${colors.yellow}[${interval}] Limiting to ${timeframeLimit} most recent candles out of ${originalLength} available${colors.reset}`);
                        }
                    }
                    
                    if (this.debug.showTimeframeAnalysis) {
                        console.log(`${colors.cyan}[${interval}] Loaded ${candles.length} candles from CSV${colors.reset}`);
                    }
                } else {
                    console.warn(`${colors.yellow}[${interval}] CSV file not found: ${csvPath}${colors.reset}`);
                }
            } else {
                // Calculate appropriate limit for this timeframe (1 month of data)
                const timeframeLimit = this.calculateTimeframeLimit(interval);
                
                // Multi-batch API fetching to get required number of candles
                let allCandles = [];
                let endTime = Date.now();
                let consecutiveErrors = 0;
                const MAX_RETRIES = 3;
                const BATCH_SIZE = 1000; // Bybit API limit per request
                
                if (this.debug.showTimeframeAnalysis) {
                    console.log(`${colors.cyan}[${interval}] Fetching ${timeframeLimit} candles via multi-batch API calls${colors.reset}`);
                }
                
                while (allCandles.length < timeframeLimit && consecutiveErrors < MAX_RETRIES) {
                    try {
                        const batchCandles = await getCandles(this.symbol, interval, BATCH_SIZE, endTime);
                        
                        if (!batchCandles || batchCandles.length === 0) {
                            if (this.debug.showTimeframeAnalysis) {
                                console.log(`${colors.yellow}[${interval}] No more data available, got ${allCandles.length} total candles${colors.reset}`);
                            }
                            break;
                        }
                        
                        // Add new candles to collection (prepend since we're going backwards)
                        allCandles = [...batchCandles, ...allCandles];
                        
                        // Update endTime to fetch next batch (go backwards in time)
                        endTime = batchCandles[0].time - 1;
                        
                        if (this.debug.showTimeframeAnalysis) {
                            console.log(`${colors.cyan}[${interval}] Fetched batch of ${batchCandles.length} candles, total: ${allCandles.length}/${timeframeLimit}${colors.reset}`);
                        }
                        
                        // Reset error counter on successful fetch
                        consecutiveErrors = 0;
                        
                        // Small delay to avoid rate limits
                        await new Promise(resolve => setTimeout(resolve, 100));
                        
                    } catch (error) {
                        consecutiveErrors++;
                        if (this.debug.showTimeframeAnalysis) {
                            console.error(`${colors.red}[${interval}] Batch fetch error (attempt ${consecutiveErrors}/${MAX_RETRIES}): ${error.message}${colors.reset}`);
                        }
                        if (consecutiveErrors < MAX_RETRIES) {
                            await new Promise(resolve => setTimeout(resolve, 1000 * consecutiveErrors));
                        }
                    }
                }
                
                // Remove duplicates and sort
                candles = Array.from(new Map(allCandles.map(c => [c.time, c])).values())
                    .sort((a, b) => a.time - b.time);
                
                // Apply final limit (keep most recent candles)
                if (candles.length > timeframeLimit) {
                    candles = candles.slice(-timeframeLimit);
                }
                
                if (this.debug.showTimeframeAnalysis) {
                    console.log(`${colors.cyan}[${interval}] Loaded ${candles.length} candles from API${colors.reset}`);
                }
            }
            
            this.timeframeData.set(interval, candles);
            this.pivotHistory.set(interval, []);
            
            return candles;
        } catch (error) {
            console.error(`${colors.red}[${interval}] Failed to load data:${colors.reset}`, error);
            return [];
        }
    }

    // Detect pivots for a specific timeframe using its configuration
    detectPivotsForTimeframe(timeframe, candles) {
        const { interval, lookback, minSwingPct, minLegBars } = timeframe;
        const pivots = [];
        
        if (!candles || candles.length < (lookback * 2 + 1)) {
            return pivots;
        }
        
        let lastPivot = { type: null, price: null, time: null, index: 0 };
        const swingThreshold = minSwingPct / 100;
        
        // Iterate through candles, leaving space for lookback
        for (let i = lookback; i < candles.length; i++) {
            const currentCandle = candles[i];
            
            // Check for high pivot
            const isHighPivot = this.detectPivot(candles, i, lookback, 'high');
            if (isHighPivot) {
                const pivotPrice = this.getPivotPrice(currentCandle, 'high');
                const swingPct = lastPivot.price ? (pivotPrice - lastPivot.price) / lastPivot.price : 0;
                const isFirstPivot = lastPivot.type === null;
                
                if ((isFirstPivot || Math.abs(swingPct) >= swingThreshold) && (i - lastPivot.index) >= minLegBars) {
                    const pivot = {
                        type: 'high',
                        price: pivotPrice,
                        time: currentCandle.time,
                        index: i,
                        timeframe: interval,
                        swingPct: swingPct * 100,
                        signal: 'long' // High pivot suggests LONG opportunity (contrarian)
                    };
                    
                    pivots.push(pivot);
                    lastPivot = pivot;
                }
            }
            
            // Check for low pivot
            const isLowPivot = this.detectPivot(candles, i, lookback, 'low');
            if (isLowPivot) {
                const pivotPrice = this.getPivotPrice(currentCandle, 'low');
                const swingPct = lastPivot.price ? (pivotPrice - lastPivot.price) / lastPivot.price : 0;
                const isFirstPivot = lastPivot.type === null;
                
                if ((isFirstPivot || Math.abs(swingPct) >= swingThreshold) && (i - lastPivot.index) >= minLegBars) {
                    const pivot = {
                        type: 'low',
                        price: pivotPrice,
                        time: currentCandle.time,
                        index: i,
                        timeframe: interval,
                        swingPct: swingPct * 100,
                        signal: 'short' // INVERTED: Low pivot suggests SHORT opportunity (contrarian)
                    };
                    
                    pivots.push(pivot);
                    lastPivot = pivot;
                }
            }
        }
        
        return pivots;
    }

    // Helper function to get pivot price based on detection mode
    getPivotPrice(candle, pivotType) {
        if (pivotDetectionMode === 'extreme') {
            return pivotType === 'high' ? candle.high : candle.low;
        } else {
            return candle.close; // default 'close' mode
        }
    }

    // Helper function to get comparison price based on detection mode
    getComparisonPrice(candle, pivotType) {
        if (pivotDetectionMode === 'extreme') {
            return pivotType === 'high' ? candle.high : candle.low;
        } else {
            return candle.close; // default 'close' mode
        }
    }

    // Calculate appropriate candle limit for each timeframe (respects config.js limit)
    calculateTimeframeLimit(interval) {
        // If this is the main timeframe from config, use the configured limit directly
        if (interval === time) {
            return limit;
        }
        
        // For other timeframes, calculate proportional limit based on main timeframe
        const mainUnit = time.slice(-1);
        const mainValue = parseInt(time.slice(0, -1)) || 1;
        const targetUnit = interval.slice(-1);
        const targetValue = parseInt(interval.slice(0, -1)) || 1;
        
        // Convert both intervals to minutes for comparison
        const getMinutes = (val, unit) => {
            switch(unit) {
                case 'm': return val;
                case 'h': return val * 60;
                case 'd': return val * 24 * 60;
                case 'w': return val * 7 * 24 * 60;
                default: return val;
            }
        };
        
        const mainMinutes = getMinutes(mainValue, mainUnit);
        const targetMinutes = getMinutes(targetValue, targetUnit);
        
        // Calculate proportional limit: if main timeframe uses X candles for Y time period,
        // then target timeframe should use (Y time period / target interval) candles
        const proportionalLimit = Math.floor((limit * mainMinutes) / targetMinutes);
        
        return Math.max(proportionalLimit, 50); // Minimum 50 candles for any timeframe
    }

    // Core pivot detection logic (same as original backtester)
    detectPivot(candles, i, pivotLookback, pivotType) {
        let isPivot = true;
        const currentCandle = candles[i];
        const currentPrice = this.getComparisonPrice(currentCandle, pivotType);
        
        for (let j = 1; j <= pivotLookback; j++) {
            const compareCandle = candles[i - j];
            const comparePrice = this.getComparisonPrice(compareCandle, pivotType);
            
            if (pivotType === 'high') {
                if (currentPrice <= comparePrice) {
                    isPivot = false;
                    break;
                }
            } else {
                if (currentPrice >= comparePrice) {
                    isPivot = false;
                    break;
                }
            }
        }
        
        return isPivot;
    }

    // Initialize all timeframe data
    async initializeAllTimeframes(useLocalData = true) {
        if (this.debug.showTimeframeAnalysis) {
            console.log(`${colors.cyan}=== Initializing Multi-Timeframe Analysis ===${colors.reset}`);
            console.log(`${colors.cyan}Timeframes: ${this.config.timeframes.map(tf => tf.interval).join(', ')}${colors.reset}`);
        }
        
        for (const timeframe of this.config.timeframes) {
            await this.loadTimeframeData(timeframe, useLocalData);
            
            // Detect initial pivots for this timeframe
            const candles = this.timeframeData.get(timeframe.interval);
            if (candles && candles.length > 0) {
                const pivots = this.detectPivotsForTimeframe(timeframe, candles);
                this.pivotHistory.set(timeframe.interval, pivots);
                
                if (this.debug.showTimeframeAnalysis) {
                    console.log(`${colors.cyan}[${timeframe.interval}] Detected ${pivots.length} pivots${colors.reset}`);
                }
            }
        }
        
        if (this.debug.showTimeframeAnalysis) {
            console.log(`${colors.cyan}=== Multi-Timeframe Initialization Complete ===${colors.reset}\n`);
        }
    }
    
    // Load raw candle data only - NO pivot pre-calculation (eliminates future look bias)
    async loadRawCandleDataOnly(useLocalData = true, dataLimit = null) {
        if (this.debug.showTimeframeAnalysis) {
            console.log(`${colors.cyan}=== Loading Raw Candle Data (No Future Look Bias) ===${colors.reset}`);
            console.log(`${colors.cyan}Timeframes: ${this.config.timeframes.map(tf => tf.interval).join(', ')}${colors.reset}`);
        }
        
        for (const timeframe of this.config.timeframes) {
            await this.loadTimeframeData(timeframe, useLocalData, dataLimit);
            
            // DO NOT detect pivots here - this eliminates future look bias
            // Pivots will be detected progressively as time advances
            
            if (this.debug.showTimeframeAnalysis) {
                const candles = this.timeframeData.get(timeframe.interval) || [];
                console.log(`${colors.cyan}[${timeframe.interval}] Loaded ${candles.length} raw candles (no pivots calculated)${colors.reset}`);
            }
        }
        
        // Initialize empty pivot history - will be populated progressively
        for (const timeframe of this.config.timeframes) {
            this.pivotHistory.set(timeframe.interval, []);
        }
        
        if (this.debug.showTimeframeAnalysis) {
            console.log(`${colors.cyan}=== Raw Candle Data Loading Complete ===${colors.reset}\n`);
        }
    }

    // Get the most recent pivot for a timeframe
    getLatestPivot(interval) {
        const pivots = this.pivotHistory.get(interval);
        return pivots && pivots.length > 0 ? pivots[pivots.length - 1] : null;
    }

    // Check if a pivot is within the confirmation window
    isPivotWithinWindow(pivot, windowMinutes, currentTime) {
        if (!pivot) return false;
        const pivotAge = (currentTime - pivot.time) / (1000 * 60); // Age in minutes
        return pivotAge <= windowMinutes;
    }

    // Main cascade confirmation logic
    checkCascadeConfirmation(primaryPivot, currentTime) {
        if (!primaryPivot) return null;
        
        const { timeframes, cascadeSettings } = this.config;
        const primaryTimeframe = timeframes[0]; // First timeframe is primary
        const confirmationResults = [];
        
        // Check cascade logging settings
        const cascadeLogging = this.debug.cascadeLogging || {};
        const shouldShowProcess = cascadeLogging.enabled && cascadeLogging.showAllCascades && cascadeLogging.showDetails?.primarySignal;
        
        if (shouldShowProcess) {
            console.log(`${colors.yellow}=== CASCADE CONFIRMATION STARTED ===${colors.reset}`);
            console.log(`${colors.yellow}Primary Signal: ${primaryPivot.signal.toUpperCase()} from ${primaryPivot.timeframe} at ${fmtDateTime(primaryPivot.time)}${colors.reset}`);
        }
        
        // Start cascade from second timeframe (first is primary trigger)
        for (let i = 1; i < timeframes.length; i++) {
            const timeframe = timeframes[i];
            const confirmationWindow = cascadeSettings.confirmationWindow[timeframe.interval] || 60;
            const latestPivot = this.getLatestPivot(timeframe.interval);
            
            const isWithinWindow = this.isPivotWithinWindow(latestPivot, confirmationWindow, currentTime);
            const signalMatches = latestPivot && latestPivot.signal === primaryPivot.signal;
            const confirmed = isWithinWindow && signalMatches;
            
            confirmationResults.push({
                timeframe: timeframe.interval,
                pivot: latestPivot,
                confirmed,
                reason: !latestPivot ? 'No pivot found' : 
                       !isWithinWindow ? 'Outside window' :
                       !signalMatches ? 'Signal mismatch' : 'Confirmed'
            });
            
            if (shouldShowProcess && cascadeLogging.showDetails?.confirmationBreakdown) {
                const status = confirmed ? `${colors.green}✓ CONFIRMED${colors.reset}` : `${colors.red}✗ FAILED${colors.reset}`;
                const reason = confirmed ? '' : ` (${confirmationResults[i-1].reason})`;
                console.log(`${colors.cyan}[${timeframe.interval}]${colors.reset} ${status}${reason}`);
            }
            
            // If this timeframe fails and we require all timeframes, cascade fails
            if (!confirmed && cascadeSettings.requireAllTimeframes) {
                if (shouldShowProcess && cascadeLogging.showDetails?.finalResult) {
                    console.log(`${colors.red}CASCADE FAILED: ${timeframe.interval} confirmation required but not found${colors.reset}\n`);
                }
                return null;
            }
        }
        
        // Check if we have enough confirmations
        const confirmedCount = confirmationResults.filter(r => r.confirmed).length + 1; // +1 for primary
        const totalRequired = cascadeSettings.requireAllTimeframes ? 
            timeframes.length : 
            Math.max(cascadeSettings.minTimeframesRequired || 2, 1);
        
        if (confirmedCount >= totalRequired) {
            if (shouldShowProcess && cascadeLogging.showDetails?.finalResult) {
                console.log(`${colors.green}✓ CASCADE SUCCESS: ${confirmedCount}/${timeframes.length} timeframes confirmed${colors.reset}\n`);
            }
            
            return {
                signal: primaryPivot.signal,
                strength: confirmedCount / timeframes.length,
                primaryPivot,
                confirmations: confirmationResults.filter(r => r.confirmed),
                allResults: confirmationResults
            };
        } else {
            if (shouldShowProcess && cascadeLogging.showDetails?.finalResult) {
                console.log(`${colors.red}CASCADE FAILED: Only ${confirmedCount}/${totalRequired} required confirmations${colors.reset}\n`);
            }
            return null;
        }
    }

    // Forward-looking cascade confirmation - simulates waiting for confirmations
    checkForwardCascadeConfirmation(primaryPivot, oneMinuteCandles) {
        if (!primaryPivot) return null;
        
        const { timeframes, cascadeSettings } = this.config;
        const cascadeLogging = this.debug.cascadeLogging || {};
        const shouldShowProcess = cascadeLogging.enabled && cascadeLogging.showAllCascades && cascadeLogging.showDetails?.primarySignal;
        
        if (shouldShowProcess) {
            console.log(`${colors.yellow}\n === FORWARD CASCADE CONFIRMATION STARTED ===${colors.reset}`);
            console.log(`${colors.yellow}Primary Signal: ${primaryPivot.signal.toUpperCase()} from ${primaryPivot.timeframe} at ${fmtDateTime(primaryPivot.time)}${colors.reset}`);
        }
        
        // Find the primary pivot time in 1-minute candles
        const primaryPivotIndex = oneMinuteCandles.findIndex(candle => candle.time === primaryPivot.time);
        if (primaryPivotIndex === -1) {
            if (shouldShowProcess) {
                console.log(`${colors.red}Primary pivot time not found in 1-minute data${colors.reset}`);
            }
            return null;
        }
        
        // Maximum time to wait for all confirmations (use longest window)
        const maxWaitMinutes = Math.max(...Object.values(cascadeSettings.confirmationWindow));
        const maxWaitCandles = Math.min(maxWaitMinutes, oneMinuteCandles.length - primaryPivotIndex - 1);
        
        // Simulate time progression, checking for confirmations
        for (let minutesAfter = 1; minutesAfter <= maxWaitCandles; minutesAfter++) {
            const currentCandleIndex = primaryPivotIndex + minutesAfter;
            const currentTime = oneMinuteCandles[currentCandleIndex].time;
            
            // Check cascade confirmation at this point in time
            const cascadeResult = this.checkCascadeConfirmationAtTime(primaryPivot, currentTime);
            
            if (cascadeResult) {
                // Find the latest confirmation time among all confirming timeframes
                const confirmationTimes = [primaryPivot.time]; // Start with primary pivot time
                cascadeResult.confirmations.forEach(conf => {
                    if (conf.pivot && conf.pivot.time) {
                        confirmationTimes.push(conf.pivot.time);
                    }
                });
                
                const latestConfirmationTime = Math.max(...confirmationTimes);
                const actualExecutionIndex = oneMinuteCandles.findIndex(candle => candle.time >= latestConfirmationTime);
                
                // Add execution timing info based on actual latest confirmation
                cascadeResult.executionTime = latestConfirmationTime;
                cascadeResult.minutesAfterPrimary = Math.round((latestConfirmationTime - primaryPivot.time) / (1000 * 60));
                cascadeResult.executionPrice = actualExecutionIndex >= 0 ? oneMinuteCandles[actualExecutionIndex].close : oneMinuteCandles[currentCandleIndex].close;
                
                if (shouldShowProcess) {
                    console.log(`${colors.green}✓ FORWARD CASCADE CONFIRMED - Latest confirmation at ${fmtDateTime(latestConfirmationTime)}${colors.reset}`);
                    console.log(`${colors.green}Execution Price: ${cascadeResult.executionPrice} (${cascadeResult.minutesAfterPrimary} min after primary)${colors.reset}`);
                }
                
                return cascadeResult;
            }
        }
        
        if (shouldShowProcess) {
            console.log(`${colors.red}✗ FORWARD CASCADE FAILED: No confirmation within ${maxWaitMinutes} minutes${colors.reset}`);
        }
        
        return null;
    }
    
    // Helper method to check cascade confirmation at a specific time
    checkCascadeConfirmationAtTime(primaryPivot, currentTime) {
        if (!primaryPivot) return null;
        
        const { timeframes, cascadeSettings } = this.config;
        const confirmationResults = [];
        
        // Start cascade from second timeframe (first is primary trigger)
        for (let i = 1; i < timeframes.length; i++) {
            const timeframe = timeframes[i];
            const confirmationWindow = cascadeSettings.confirmationWindow[timeframe.interval] || 60;
            
            // Get the latest pivot for this timeframe at current time
            const latestPivot = this.getLatestPivotAtTime(timeframe.interval, currentTime);
            
            // Check if this pivot is within the confirmation window from primary pivot
            const timeSincePrimary = (currentTime - primaryPivot.time) / (1000 * 60); // minutes
            const isWithinWindow = latestPivot && (latestPivot.time >= primaryPivot.time) && (timeSincePrimary <= confirmationWindow);
            const signalMatches = latestPivot && latestPivot.signal === primaryPivot.signal;
            const confirmed = isWithinWindow && signalMatches;
            
            confirmationResults.push({
                timeframe: timeframe.interval,
                pivot: latestPivot,
                confirmed,
                reason: !latestPivot ? 'No pivot found' : 
                       !isWithinWindow ? 'Outside window' :
                       !signalMatches ? 'Signal mismatch' : 'Confirmed'
            });
            
            // If this timeframe fails and we require all timeframes, cascade fails
            if (!confirmed && cascadeSettings.requireAllTimeframes) {
                return null;
            }
        }
        
        // Check if we have enough confirmations
        const confirmedCount = confirmationResults.filter(r => r.confirmed).length + 1; // +1 for primary
        const totalRequired = cascadeSettings.requireAllTimeframes ? 
            timeframes.length : 
            Math.max(cascadeSettings.minTimeframesRequired || 2, 1);
        
        if (confirmedCount >= totalRequired) {
            return {
                signal: primaryPivot.signal,
                strength: confirmedCount / timeframes.length,
                primaryPivot,
                confirmations: confirmationResults.filter(r => r.confirmed),
                allResults: confirmationResults
            };
        }
        
        return null;
    }
    
    // Get latest pivot for timeframe at a specific point in time
    getLatestPivotAtTime(interval, currentTime) {
        const pivots = this.pivotHistory.get(interval) || [];
        
        // Find the most recent pivot that occurred at or before currentTime
        for (let i = pivots.length - 1; i >= 0; i--) {
            if (pivots[i].time <= currentTime) {
                return pivots[i];
            }
        }
        
        return null;
    }

    // Main analysis function - checks for new cascade signals
    analyzeCascadeSignals(currentTime = Date.now()) {
        const primaryTimeframe = this.config.timeframes[0];
        const latestPrimaryPivot = this.getLatestPivot(primaryTimeframe.interval);
        
        if (!latestPrimaryPivot) {
            return null;
        }
        
        // Check if this pivot is fresh enough to trigger a cascade
        const maxAge = this.config.signalSettings?.maxSignalAge?.[primaryTimeframe.interval] || 480;
        if (!this.isPivotWithinWindow(latestPrimaryPivot, maxAge, currentTime)) {
            return null;
        }
        
        // Check if we already processed this pivot
        const existingSignal = this.activeSignals.find(s => 
            s.primaryPivot.time === latestPrimaryPivot.time && 
            s.primaryPivot.timeframe === latestPrimaryPivot.timeframe
        );
        
        if (existingSignal) {
            return existingSignal; // Already processed
        }
        
        // Run cascade confirmation
        const cascadeResult = this.checkCascadeConfirmation(latestPrimaryPivot, currentTime);
        
        if (cascadeResult) {
            // Add to active signals
            this.activeSignals.push(cascadeResult);
            
            // Clean up old signals
            this.cleanupOldSignals(currentTime);
            
            return cascadeResult;
        }
        
        return null;
    }

    // Clean up expired signals
    cleanupOldSignals(currentTime) {
        const maxAge = 60 * 60 * 1000; // 1 hour in milliseconds
        this.activeSignals = this.activeSignals.filter(signal => 
            (currentTime - signal.primaryPivot.time) < maxAge
        );
    }

    // Get summary of current multi-timeframe state
    getMultiTimeframeSummary() {
        const summary = {
            timeframes: [],
            totalPivots: 0,
            activeSignals: this.activeSignals.length
        };
        
        for (const timeframe of this.config.timeframes) {
            const pivots = this.pivotHistory.get(timeframe.interval) || [];
            const latestPivot = pivots.length > 0 ? pivots[pivots.length - 1] : null;
            
            summary.timeframes.push({
                interval: timeframe.interval,
                role: timeframe.role,
                pivotCount: pivots.length,
                latestPivot: latestPivot ? {
                    type: latestPivot.type,
                    signal: latestPivot.signal,
                    time: fmtDateTime(latestPivot.time),
                    price: latestPivot.price
                } : null
            });
            
            summary.totalPivots += pivots.length;
        }
        
        return summary;
    }
}

export default MultiTimeframePivotDetector;
