// multiPivotFronttesterV2.js
// CLEAN TIME-PROGRESSIVE CASCADE DETECTION - NO FUTURE LOOK BIAS

import {
    symbol,
    time as interval,
    useLocalData,
    api,
    pivotDetectionMode,
    limit as configLimit
} from './config/config.js';

import { tradeConfig } from './config/tradeconfig.js';
import { multiPivotConfig } from './config/multiPivotConfig.js';
import { fronttesterconfig } from './config/fronttesterconfig.js';
import { MultiTimeframePivotDetector } from './utils/multiTimeframePivotDetector.js';
import { formatNumber } from './utils/formatters.js';
import fs from 'fs';
import path from 'path';

const colors = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    magenta: '\x1b[35m',
    blue: '\x1b[34m',
    white: '\x1b[37m',
    brightGreen: '\x1b[92m',
    brightYellow: '\x1b[93m',
    brightCyan: '\x1b[96m',
    bold: '\x1b[1m'
};

class CleanTimeProgressiveFronttester {
    constructor() {
        this.timeframeCandles = new Map(); // Raw candle data for each timeframe
        this.timeframePivots = new Map();  // Discovered pivots for each timeframe
        this.currentMinute = 0;            // Current 1-minute index we're processing
        this.oneMinuteCandles = [];        // 1-minute candles for time progression
        this.cascadeCounter = 0;
        this.recentCascades = [];
        this.isRunning = false;
        this.lastLoggedTime = null;        // Track last logged time for progression
        this.activeWindows = new Map();    // Track active cascade windows
        this.windowCounter = 0;            // Counter for window IDs
    }

    async initialize() {
        const dataSource = useLocalData ? 'CSV Files (Local)' : `${api.toUpperCase()} API (Live)`;
        const dataMode = useLocalData ? 'Historical Simulation' : 'Live Market Data';
        
        console.log(`${colors.cyan}=== CLEAN TIME-PROGRESSIVE FRONTTESTER V2 ===${colors.reset}`);
        console.log(`${colors.yellow}Symbol: ${symbol}${colors.reset}`);
        console.log(`${colors.yellow}Data Source: ${dataSource}${colors.reset}`);
        console.log(`${colors.yellow}Mode: ${dataMode}${colors.reset}`);
        console.log(`${colors.yellow}Method: Step-by-step minute progression${colors.reset}`);
        console.log(`${'='.repeat(60)}\n`);

        // Load raw candle data for all timeframes
        await this.loadAllTimeframeData();
        
        // Initialize pivot tracking
        for (const tf of multiPivotConfig.timeframes) {
            this.timeframePivots.set(tf.interval, []);
        }
        
        console.log(`${colors.green}✅ Clean system initialized successfully${colors.reset}`);
        console.log(`${colors.cyan}📊 Ready for time-progressive simulation${colors.reset}\n`);
    }

    async loadAllTimeframeData() {
        const dataSourceType = useLocalData ? 'CSV FILES' : `${api.toUpperCase()} API`;
        console.log(`${colors.cyan}=== LOADING RAW CANDLE DATA FROM ${dataSourceType} ===${colors.reset}`);
        
        const detector = new MultiTimeframePivotDetector(symbol, multiPivotConfig);
        
        for (const tf of multiPivotConfig.timeframes) {
            await detector.loadTimeframeData(tf, useLocalData, fronttesterconfig.dataLimit || configLimit);
            const candles = detector.timeframeData.get(tf.interval) || [];
            this.timeframeCandles.set(tf.interval, candles);
            
            const sourceIndicator = useLocalData ? 'CSV' : 'API';
            console.log(`${colors.yellow}[${tf.interval.padEnd(4)}] Loaded ${candles.length.toString().padStart(4)} candles from ${sourceIndicator}${colors.reset}`);
        }
        
        // Get 1-minute candles for time progression
        this.oneMinuteCandles = this.timeframeCandles.get('1m') || [];
        console.log(`${colors.green}Time progression: ${this.oneMinuteCandles.length} minutes${colors.reset}`);
    }

    startSimulation() {
        if (this.oneMinuteCandles.length === 0) {
            console.error(`${colors.red}No 1-minute candles for simulation${colors.reset}`);
            return;
        }

        console.log(`${colors.cyan}🚀 Starting clean time-progressive simulation...${colors.reset}\n`);
        
        this.isRunning = true;
        this.currentMinute = 0;
        
        const simulationLoop = () => {
            if (!this.isRunning || this.currentMinute >= this.oneMinuteCandles.length) {
                this.finishSimulation();
                return;
            }
            
            const currentCandle = this.oneMinuteCandles[this.currentMinute];
            const currentTime = currentCandle.time;
            
            // Log time progression (configurable interval)
            this.logHourlyProgression(currentTime);
            
            // Step 1: Check for new pivots at current time
            this.detectNewPivotsAtCurrentTime(currentTime);
            
            // Step 2: Check for cascade confirmations (DISABLED - using window-based system instead)
            // this.checkForCascadeAtCurrentTime(currentTime);
            
            // Step 3: Check for expired windows
            this.checkExpiredWindows(currentTime);
            
            // Progress
            if (this.currentMinute % 100 === 0 && this.currentMinute > 0) {
                const progress = ((this.currentMinute / this.oneMinuteCandles.length) * 100).toFixed(1);
                console.log(`${colors.cyan}Progress: ${progress}% (${this.currentMinute}/${this.oneMinuteCandles.length})${colors.reset}`);
            }
            
            this.currentMinute++;
            
            // Continue simulation
            const delay = Math.max(1, Math.floor(1000 / fronttesterconfig.speedMultiplier));
            setTimeout(simulationLoop, delay);
        };
        
        simulationLoop();
    }

    logHourlyProgression(currentTime) {
        const currentDate = new Date(currentTime);
        const intervalMinutes = fronttesterconfig.timeLoggingInterval || 10;
        
        // Calculate time slot based on interval
        const totalMinutes = currentDate.getHours() * 60 + currentDate.getMinutes();
        const timeSlot = Math.floor(totalMinutes / intervalMinutes);
        const currentDay = currentDate.getDate();
        const timeKey = `${currentDay}-${timeSlot}`; // Unique key for day-timeslot combination
        
        if (this.lastLoggedTime !== timeKey) {
            this.lastLoggedTime = timeKey;
            
            const timeString12 = currentDate.toLocaleString('en-US', {
                weekday: 'short',
                month: 'short', 
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                hour12: true
            });
            
            const timeString24 = currentDate.toLocaleTimeString('en-GB', { hour12: false });
            
            const price = this.oneMinuteCandles[this.currentMinute]?.close || 0;
            const progress = ((this.currentMinute / this.oneMinuteCandles.length) * 100).toFixed(1);
            
            console.log(`${colors.brightCyan}⏰ ${timeString12} (${timeString24}) | BTC: $${price.toFixed(1)} | Progress: ${progress}% (${this.currentMinute}/${this.oneMinuteCandles.length})${colors.reset}`);
        }
    }

    detectNewPivotsAtCurrentTime(currentTime) {
        for (const tf of multiPivotConfig.timeframes) {
            const candles = this.timeframeCandles.get(tf.interval) || [];
            const knownPivots = this.timeframePivots.get(tf.interval) || [];
            
            // Find candle at current time for this timeframe
            const candleIndex = this.findCandleIndexAtTime(candles, currentTime, tf.interval);
            if (candleIndex === -1 || candleIndex < tf.lookback) continue;
            
            // Check if we already detected a pivot at this candle
            const candleTime = candles[candleIndex].time;
            const alreadyExists = knownPivots.some(p => p.time === candleTime);
            if (alreadyExists) continue;
            
            // Detect pivot at this candle
            const pivot = this.detectPivotAtCandle(candles, candleIndex, tf);
            if (pivot) {
                knownPivots.push(pivot);
                this.timeframePivots.set(tf.interval, knownPivots);
                
                // Check if this is a primary timeframe pivot - open cascade window
                if (tf.role === 'primary') {
                    this.openPrimaryWindow(pivot, currentTime);
                } else {
                    // Check if this pivot confirms any active windows
                    this.checkWindowConfirmations(pivot, tf, currentTime);
                }
                
                if (fronttesterconfig.showDebug) {
                    console.log(`${colors.yellow}[${tf.interval}] New ${pivot.signal.toUpperCase()} pivot @ $${pivot.price.toFixed(1)} at ${new Date(pivot.time).toLocaleTimeString()}${colors.reset}`);
                }
            }
        }
    }

    findCandleIndexAtTime(candles, targetTime, timeframe) {
        // Find the candle that matches the current time for this timeframe
        const tolerance = this.getTimeframeTolerance(timeframe);
        
        for (let i = 0; i < candles.length; i++) {
            if (Math.abs(candles[i].time - targetTime) <= tolerance) {
                return i;
            }
        }
        return -1;
    }

    getTimeframeTolerance(interval) {
        const unit = interval.slice(-1);
        const value = parseInt(interval.slice(0, -1));
        
        switch(unit) {
            case 'm': return (value * 60 * 1000) / 2; // Half the timeframe
            case 'h': return (value * 60 * 60 * 1000) / 2;
            case 'd': return (value * 24 * 60 * 60 * 1000) / 2;
            default: return 30 * 1000; // 30 seconds default
        }
    }

    detectPivotAtCandle(candles, index, timeframe) {
        if (index < timeframe.lookback) return null;
        
        const currentCandle = candles[index];
        const currentPrice = pivotDetectionMode === 'extreme' ? 
            { high: currentCandle.high, low: currentCandle.low } : 
            { high: currentCandle.close, low: currentCandle.close };
        
        // Check for high pivot (SHORT signal)
        let isHighPivot = true;
        for (let j = 1; j <= timeframe.lookback; j++) {
            const compareCandle = candles[index - j];
            const comparePrice = pivotDetectionMode === 'extreme' ? compareCandle.high : compareCandle.close;
            if (comparePrice >= currentPrice.high) {
                isHighPivot = false;
                break;
            }
        }
        
        // Check for low pivot (LONG signal)
        let isLowPivot = true;
        for (let j = 1; j <= timeframe.lookback; j++) {
            const compareCandle = candles[index - j];
            const comparePrice = pivotDetectionMode === 'extreme' ? compareCandle.low : compareCandle.close;
            if (comparePrice <= currentPrice.low) {
                isLowPivot = false;
                break;
            }
        }
        
        if (isHighPivot) {
            return {
                time: currentCandle.time,
                price: currentPrice.high,
                signal: 'short',
                type: 'high',
                timeframe: timeframe.interval
            };
        } else if (isLowPivot) {
            return {
                time: currentCandle.time,
                price: currentPrice.low,
                signal: 'long',
                type: 'low',
                timeframe: timeframe.interval
            };
        }
        
        return null;
    }

    openPrimaryWindow(primaryPivot, currentTime) {
        this.windowCounter++;
        const windowId = `W${this.windowCounter}`;
        const confirmationWindow = multiPivotConfig.cascadeSettings.confirmationWindow[primaryPivot.timeframe] || 240;
        const windowEndTime = primaryPivot.time + (confirmationWindow * 60 * 1000);
        
        const window = {
            id: windowId,
            primaryPivot,
            openTime: currentTime,
            windowEndTime,
            confirmations: [],
            status: 'active'
        };
        
        this.activeWindows.set(windowId, window);
        
        const timeString12 = new Date(primaryPivot.time).toLocaleString();
        const time24 = new Date(primaryPivot.time).toLocaleTimeString('en-GB', { hour12: false });
        const minRequired = multiPivotConfig.cascadeSettings.minTimeframesRequired || 3;
        
        console.log(`\n${colors.brightYellow}🟡 PRIMARY WINDOW OPENED [${windowId}]: ${primaryPivot.timeframe} ${primaryPivot.signal.toUpperCase()} pivot detected${colors.reset}`);
        console.log(`${colors.yellow}   Time: ${timeString12} (${time24}) | Price: $${primaryPivot.price.toFixed(1)}${colors.reset}`);
        console.log(`${colors.yellow}   Waiting for confirmations within ${confirmationWindow}min window...${colors.reset}`);
        console.log(`${colors.yellow}   Required: ${minRequired} total timeframes (primary + ${minRequired-2} confirmations + execution)${colors.reset}`);
    }
    
    checkWindowConfirmations(pivot, timeframe, currentTime) {
        // Check all active windows for potential confirmations
        for (const [windowId, window] of this.activeWindows) {
            if (window.status !== 'active') continue;
            if (window.primaryPivot.signal !== pivot.signal) continue; // Must match signal
            if (pivot.time < window.primaryPivot.time) continue; // Must be after primary
            if (currentTime > window.windowEndTime) {
                // Window expired
                window.status = 'expired';
                continue;
            }
            
            // Check if this timeframe already confirmed this window
            const alreadyConfirmed = window.confirmations.some(c => c.timeframe === timeframe.interval);
            if (alreadyConfirmed) continue;
            
            // Check if this is 1m execution window - only allow AFTER confirmations are met
            const nonExecutionConfirmations = window.confirmations.filter(c => c.timeframe !== '1m');
            const minRequiredTFs = multiPivotConfig.cascadeSettings.minTimeframesRequired || 3;
            const confirmationsNeeded = minRequiredTFs - 1; // -1 for primary
            
            if (timeframe.interval === '1m') {
                // For 1m execution window, we need enough non-1m confirmations first
                if (nonExecutionConfirmations.length < (confirmationsNeeded - 1)) {
                    // Not enough confirmations yet, skip this 1m pivot
                    return;
                }
                // Also check that this 1m pivot comes AFTER the latest confirmation
                const latestConfirmationTime = Math.max(...window.confirmations.map(c => c.pivot.time));
                if (pivot.time < latestConfirmationTime) {
                    // This 1m pivot is before latest confirmation, skip it
                    return;
                }
            }
            
            // Add confirmation
            window.confirmations.push({
                timeframe: timeframe.interval,
                pivot,
                confirmTime: currentTime
            });
            
            const totalConfirmed = 1 + window.confirmations.length; // +1 for primary
            const timeString = new Date(pivot.time).toLocaleString();
            const time24 = new Date(pivot.time).toLocaleTimeString('en-GB', { hour12: false });
            
            if (timeframe.role === 'secondary') {
                console.log(`${colors.brightMagenta}🟠 SECONDARY WINDOW [${windowId}]: ${timeframe.interval} ${pivot.signal.toUpperCase()} pivot detected${colors.reset}`);
            } else if (timeframe.interval === '1m') {
                console.log(`${colors.brightYellow}🔵 EXECUTION WINDOW [${windowId}]: ${timeframe.interval} ${pivot.signal.toUpperCase()} pivot detected${colors.reset}`);
            } else {
                console.log(`${colors.brightGreen}🟢 CONFIRMATION WINDOW [${windowId}]: ${timeframe.interval} ${pivot.signal.toUpperCase()} pivot detected${colors.reset}`);
            }
            console.log(`${colors.cyan}   Time: ${timeString} (${time24}) | Price: $${pivot.price.toFixed(1)}${colors.reset}`);
            console.log(`${colors.cyan}   Confirmations: ${totalConfirmed}/${minRequiredTFs} (${[window.primaryPivot.timeframe, ...window.confirmations.map(c => c.timeframe)].join(' + ')})${colors.reset}`);
            
            // Check if ready for execution (must have 1m execution window AND other confirmations)
            const hasExecutionWindow = window.confirmations.some(c => c.timeframe === '1m');
            const hasOtherConfirmations = window.confirmations.some(c => c.timeframe !== '1m');
            
            // Only execute if this is the 1m execution window AND we have enough confirmations
            if (timeframe.interval === '1m' && totalConfirmed >= minRequiredTFs && hasOtherConfirmations && window.status !== 'executed') {
                console.log(`${colors.brightGreen}   ✅ EXECUTING CASCADE - All confirmations + execution window ready!${colors.reset}`);
                window.status = 'ready';
                this.executeWindow(window, currentTime);
            } else if (totalConfirmed >= minRequiredTFs && !hasExecutionWindow) {
                console.log(`${colors.yellow}   ⏳ WAITING FOR EXECUTION WINDOW (1m pivot needed)${colors.reset}`);
                window.status = 'awaiting_execution';
            } else if (hasExecutionWindow && !hasOtherConfirmations) {
                console.log(`${colors.yellow}   ⏳ EXECUTION WINDOW READY - Waiting for confirmations${colors.reset}`);
            }
        }
    }
    
    executeWindow(window, currentTime) {
        // Find execution time and price
        const allTimes = [window.primaryPivot.time, ...window.confirmations.map(c => c.pivot.time)];
        const executionTime = Math.max(...allTimes);
        const executionCandle = this.oneMinuteCandles.find(c => Math.abs(c.time - executionTime) <= 30000);
        const executionPrice = executionCandle ? executionCandle.close : window.primaryPivot.price;
        const minutesAfterPrimary = Math.round((executionTime - window.primaryPivot.time) / (1000 * 60));
        
        const cascadeResult = {
            signal: window.primaryPivot.signal,
            strength: (1 + window.confirmations.length) / multiPivotConfig.timeframes.length,
            confirmations: window.confirmations,
            executionTime,
            executionPrice,
            minutesAfterPrimary
        };
        
        this.cascadeCounter++;
        const cascadeInfo = {
            id: this.cascadeCounter,
            primaryPivot: window.primaryPivot,
            cascadeResult,
            timestamp: currentTime,
            windowId: window.id
        };
        
        this.recentCascades.push(cascadeInfo);
        if (this.recentCascades.length > 3) {
            this.recentCascades.shift();
        }
        
        // Enhanced execution logging
        const timeString12 = new Date(executionTime).toLocaleString();
        const time24 = new Date(executionTime).toLocaleTimeString('en-GB', { hour12: false });
        
        console.log(`\n${colors.brightCyan}🎯 CASCADE EXECUTION [${window.id}]: All confirmations met${colors.reset}`);
        console.log(`${colors.cyan}   Execution Time: ${timeString12} (${time24})${colors.reset}`);
        console.log(`${colors.cyan}   Entry Price: $${executionPrice.toFixed(1)} | Strength: ${(cascadeResult.strength * 100).toFixed(0)}% | Total wait: ${minutesAfterPrimary}min${colors.reset}`);
        
        this.displayCascade(cascadeInfo);
        window.status = 'executed';
    }
    
    checkExpiredWindows(currentTime) {
        for (const [windowId, window] of this.activeWindows) {
            if (window.status === 'active' && currentTime > window.windowEndTime) {
                window.status = 'expired';
                const timeString12 = new Date(window.windowEndTime).toLocaleString();
                const time24 = new Date(window.windowEndTime).toLocaleTimeString('en-GB', { hour12: false });
                const totalConfirmed = 1 + window.confirmations.length;
                const minRequiredTFs = multiPivotConfig.cascadeSettings.minTimeframesRequired || 3;
                
                console.log(`\n${colors.red}❌ PRIMARY WINDOW EXPIRED [${windowId}]: ${window.primaryPivot.timeframe} ${window.primaryPivot.signal.toUpperCase()}${colors.reset}`);
                console.log(`${colors.red}   Expired at: ${timeString12} (${time24})${colors.reset}`);
                console.log(`${colors.red}   Final confirmations: ${totalConfirmed}/${minRequiredTFs} (insufficient for execution)${colors.reset}`);
            }
        }
    }

    checkForCascadeAtCurrentTime(currentTime) {
        // Get primary timeframe (first in config)
        const primaryTf = multiPivotConfig.timeframes[0];
        const primaryPivots = this.timeframePivots.get(primaryTf.interval) || [];
        
        if (primaryPivots.length === 0) return;
        
        // Check recent primary pivots for cascade confirmation
        const recentPrimary = primaryPivots.slice(-3); // Check last 3 pivots
        
        for (const primaryPivot of recentPrimary) {
            // Skip if too old or already processed
            const ageMinutes = (currentTime - primaryPivot.time) / (1000 * 60);
            if (ageMinutes > 240 || ageMinutes < 1) continue; // 1-240 minutes old
            
            // Check if already processed
            const alreadyProcessed = this.recentCascades.some(c => 
                c.primaryPivot.time === primaryPivot.time && 
                c.primaryPivot.timeframe === primaryPivot.timeframe
            );
            if (alreadyProcessed) continue;
            
            // Check for cascade confirmation
            const cascadeResult = this.checkCascadeConfirmation(primaryPivot, currentTime);
            if (cascadeResult) {
                this.cascadeCounter++;
                
                const cascadeInfo = {
                    id: this.cascadeCounter,
                    primaryPivot,
                    cascadeResult,
                    timestamp: currentTime
                };
                
                this.recentCascades.push(cascadeInfo);
                if (this.recentCascades.length > 3) {
                    this.recentCascades.shift();
                }
                
                this.displayCascade(cascadeInfo);
            }
        }
    }

    checkCascadeConfirmation(primaryPivot, currentTime) {
        const confirmations = [];
        let totalWeight = 0;
        
        // Check each confirming timeframe (skip primary)
        for (let i = 1; i < multiPivotConfig.timeframes.length; i++) {
            const tf = multiPivotConfig.timeframes[i];
            const pivots = this.timeframePivots.get(tf.interval) || [];
            
            // Look for confirming pivots of same signal within time window
            const windowMinutes = multiPivotConfig.cascadeSettings.confirmationWindow[tf.interval] || 60;
            const windowStart = primaryPivot.time;
            const windowEnd = Math.min(primaryPivot.time + (windowMinutes * 60 * 1000), currentTime);
            
            const confirmingPivots = pivots.filter(p => 
                p.signal === primaryPivot.signal &&
                p.time >= windowStart &&
                p.time <= windowEnd
            );
            
            if (confirmingPivots.length > 0) {
                const latest = confirmingPivots[confirmingPivots.length - 1];
                confirmations.push({
                    timeframe: tf.interval,
                    pivot: latest,
                    weight: tf.weight || 1
                });
                totalWeight += tf.weight || 1;
            }
        }
        
        // Check if we have enough confirmations (primary + confirming timeframes)
        const totalConfirmed = 1 + confirmations.length; // +1 for primary
        const minRequired = multiPivotConfig.cascadeSettings.minTimeframesRequired || 2;
        if (totalConfirmed < minRequired) return null;
        
        // Calculate strength based on total timeframes
        const totalTimeframes = multiPivotConfig.timeframes.length;
        const strength = totalConfirmed / totalTimeframes;
        
        // Find execution time and price
        const allTimes = [primaryPivot.time, ...confirmations.map(c => c.pivot.time)];
        const executionTime = Math.max(...allTimes);
        const executionCandle = this.oneMinuteCandles.find(c => Math.abs(c.time - executionTime) <= 30000);
        const executionPrice = executionCandle ? executionCandle.close : primaryPivot.price;
        
        return {
            signal: primaryPivot.signal,
            strength,
            confirmations,
            executionTime,
            executionPrice,
            minutesAfterPrimary: Math.round((executionTime - primaryPivot.time) / (1000 * 60))
        };
    }

    displayCascade(cascadeInfo) {
        const { id, primaryPivot, cascadeResult } = cascadeInfo;
        
        console.log(`\n${colors.green}🎯 CASCADE #${id} DETECTED: ${primaryPivot.signal.toUpperCase()}${colors.reset}`);
        console.log(`${colors.cyan}${'─'.repeat(50)}${colors.reset}`);
        
        const primaryTime = new Date(primaryPivot.time).toLocaleString();
        const primaryTime24 = new Date(primaryPivot.time).toLocaleTimeString('en-GB', { hour12: false });
        const executionTime = new Date(cascadeResult.executionTime).toLocaleString();
        const executionTime24 = new Date(cascadeResult.executionTime).toLocaleTimeString('en-GB', { hour12: false });
        const confirmingTFs = cascadeResult.confirmations.map(c => c.timeframe).join(', ');
        
        console.log(`${colors.cyan}Primary Time:    ${primaryTime} (${primaryTime24})${colors.reset}`);
        console.log(`${colors.cyan}Execution Time:  ${executionTime} (${executionTime24}) (+${cascadeResult.minutesAfterPrimary}min)${colors.reset}`);
        console.log(`${colors.cyan}Entry Price:     $${cascadeResult.executionPrice.toFixed(1)}${colors.reset}`);
        console.log(`${colors.cyan}Strength:        ${(cascadeResult.strength * 100).toFixed(0)}%${colors.reset}`);
        console.log(`${colors.cyan}Confirming TFs:  ${confirmingTFs}${colors.reset}`);
        console.log(`${colors.cyan}${'─'.repeat(50)}${colors.reset}`);
        
        this.displayRecentCascades();
    }

    displayRecentCascades() {
        if (this.recentCascades.length === 0) return;
        
        console.log(`\n${colors.magenta}┌─ Recent Cascades (${this.recentCascades.length}/3) ${'─'.repeat(30)}${colors.reset}`);
        
        this.recentCascades.forEach(cascade => {
            const { id, primaryPivot, cascadeResult } = cascade;
            const time = new Date(cascadeResult.executionTime).toLocaleTimeString();
            const time24 = new Date(cascadeResult.executionTime).toLocaleTimeString('en-GB', { hour12: false });
            const signal = primaryPivot.signal.toUpperCase();
            const strength = (cascadeResult.strength * 100).toFixed(0);
            const price = cascadeResult.executionPrice.toFixed(1);
            
            console.log(`${colors.magenta}│${colors.reset} ${colors.yellow}[${id.toString().padStart(3)}] ${time.padEnd(11)} (${time24}) | ${signal.padEnd(5)} | ${strength.padStart(2)}% | $${price}${colors.reset}`);
        });
        
        console.log(`${colors.magenta}└${'─'.repeat(60)}${colors.reset}\n`);
    }

    finishSimulation() {
        console.log(`\n${colors.green}🏁 Clean simulation completed!${colors.reset}`);
        console.log(`${colors.cyan}${'─'.repeat(40)}${colors.reset}`);
        console.log(`${colors.yellow}Total Cascades Detected: ${colors.green}${this.cascadeCounter}${colors.reset}`);
        console.log(`${colors.yellow}Minutes Processed:       ${colors.green}${this.currentMinute}${colors.reset}`);
        console.log(`${colors.cyan}${'─'.repeat(40)}${colors.reset}`);
        
        if (this.recentCascades.length > 0) {
            console.log(`\nFinal Cascades:`);
            this.displayRecentCascades();
        }
    }

    stop() {
        this.isRunning = false;
        console.log(`${colors.yellow}🛑 Simulation stopped${colors.reset}`);
    }
}

// Main execution
async function main() {
    const fronttester = new CleanTimeProgressiveFronttester();
    
    try {
        await fronttester.initialize();
        fronttester.startSimulation();
        
        // Handle graceful shutdown
        process.on('SIGINT', () => {
            console.log(`\n${colors.yellow}Shutting down...${colors.reset}`);
            fronttester.stop();
            process.exit(0);
        });
        
    } catch (error) {
        console.error(`${colors.red}Error:${colors.reset}`, error);
        process.exit(1);
    }
}

main().catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
});
