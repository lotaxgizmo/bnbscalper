// multiPivotFronttesterLive.js
// LIVE MULTI-TIMEFRAME CASCADE DETECTION WITH REAL-TIME API DATA

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
import { connectWebSocket } from './apis/bybit_ws.js';
import { getCandles } from './apis/bybit.js';
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

class LiveMultiTimeframeFronttester {
    constructor() {
        this.timeframeCandles = new Map(); // Raw candle data for each timeframe
        this.timeframePivots = new Map();  // Discovered pivots for each timeframe
        this.currentPrice = 0;             // Current live price from WebSocket
        this.lastCandleUpdate = new Map(); // Track last candle update time for each timeframe
        this.cascadeCounter = 0;
        this.recentCascades = [];
        this.isRunning = false;
        this.activeWindows = new Map();    // Track active cascade windows
        this.windowCounter = 0;            // Counter for window IDs
        this.ws = null;                    // WebSocket connection
        this.candleUpdateInterval = null;  // Interval for checking candle updates
        this.lastHeartbeat = Date.now();   // Track heartbeat
    }

    async initialize() {
        console.log(`${colors.cyan}=== LIVE MULTI-TIMEFRAME FRONTTESTER ===${colors.reset}`);
        console.log(`${colors.yellow}Symbol: ${symbol}${colors.reset}`);
        console.log(`${colors.yellow}Mode: Live Real-Time Trading${colors.reset}`);
        console.log(`${colors.yellow}Data Source: ${api.toUpperCase()} API + WebSocket${colors.reset}`);
        console.log(`${'='.repeat(60)}\n`);

        // Load initial historical data for all timeframes
        await this.loadInitialData();
        
        // Initialize pivot tracking
        for (const tf of multiPivotConfig.timeframes) {
            this.timeframePivots.set(tf.interval, []);
            this.lastCandleUpdate.set(tf.interval, 0);
        }
        
        // Connect to WebSocket for live price updates
        await this.connectWebSocket();
        
        console.log(`${colors.green}✅ Live system initialized successfully${colors.reset}`);
        console.log(`${colors.cyan}📊 Ready for live cascade detection${colors.reset}\n`);
    }

    async loadInitialData() {
        console.log(`${colors.cyan}=== LOADING INITIAL HISTORICAL DATA ===${colors.reset}`);
        
        const detector = new MultiTimeframePivotDetector(symbol, multiPivotConfig);
        
        for (const tf of multiPivotConfig.timeframes) {
            await detector.loadTimeframeData(tf, useLocalData, fronttesterconfig.dataLimit || configLimit);
            const candles = detector.timeframeData.get(tf.interval) || [];
            this.timeframeCandles.set(tf.interval, candles);
            
            // Analyze existing pivots in historical data
            this.analyzeHistoricalPivots(tf, candles);
            
            console.log(`${colors.yellow}[${tf.interval.padEnd(4)}] Loaded ${candles.length.toString().padStart(4)} candles | ${this.timeframePivots.get(tf.interval).length} pivots${colors.reset}`);
        }
        
        console.log(`${colors.green}Historical data loaded successfully${colors.reset}`);
    }

    analyzeHistoricalPivots(timeframe, candles) {
        const pivots = [];
        const { interval, lookback } = timeframe;
        
        if (candles.length < lookback * 2) return;
        
        // Analyze all historical candles for pivots
        for (let i = lookback; i < candles.length; i++) {
            const pivot = this.detectPivotAtCandle(candles, i, timeframe);
            if (pivot) {
                pivots.push(pivot);
            }
        }
        
        this.timeframePivots.set(interval, pivots);
    }

    async connectWebSocket() {
        console.log(`${colors.cyan}🔌 Connecting to ${api.toUpperCase()} WebSocket...${colors.reset}`);
        
        this.ws = connectWebSocket(symbol, (tickerData) => {
            this.handleWebSocketData(tickerData);
        });

        // Set up periodic candle updates
        this.candleUpdateInterval = setInterval(() => {
            this.checkForNewCandles();
        }, 60000); // Check every minute for new candles

        // Set up heartbeat monitoring
        setInterval(() => {
            this.showHeartbeat();
        }, 30000); // Heartbeat every 30 seconds
    }

    handleWebSocketData(tickerData) {
        if (tickerData && tickerData.price) {
            this.currentPrice = parseFloat(tickerData.price);
            this.lastHeartbeat = Date.now();
            
            if (fronttesterconfig.showHeartbeat) {
                // Only log price updates occasionally to avoid spam
                const now = Date.now();
                if (!this.lastPriceLog || now - this.lastPriceLog > 10000) { // Every 10 seconds
                    console.log(`${colors.brightCyan}💰 Live Price: $${this.currentPrice.toLocaleString()}${colors.reset}`);
                    this.lastPriceLog = now;
                }
            }
        }
    }

    showHeartbeat() {
        if (!fronttesterconfig.showHeartbeat) return;
        
        const now = Date.now();
        const timeSinceLastUpdate = now - this.lastHeartbeat;
        const status = timeSinceLastUpdate < 60000 ? 
            `${colors.green}LIVE${colors.reset}` : 
            `${colors.red}STALE${colors.reset}`;
        
        const timeString = new Date().toLocaleTimeString();
        console.log(`${colors.cyan}💓 ${timeString} | Status: ${status} | Price: $${this.currentPrice.toLocaleString()} | Windows: ${this.activeWindows.size}${colors.reset}`);
    }

    async checkForNewCandles() {
        const now = Date.now();
        
        for (const tf of multiPivotConfig.timeframes) {
            const currentCandles = this.timeframeCandles.get(tf.interval) || [];
            if (currentCandles.length === 0) continue;
            
            const lastCandle = currentCandles[currentCandles.length - 1];
            const timeframeDuration = this.getTimeframeDuration(tf.interval);
            const expectedNextCandleTime = lastCandle.time + timeframeDuration;
            
            // Check if we should have a new candle by now
            if (now >= expectedNextCandleTime + 30000) { // 30 second buffer
                await this.fetchLatestCandle(tf);
            }
        }
        
        // Clean up expired windows
        this.cleanupExpiredWindows(now);
    }

    async fetchLatestCandle(timeframe) {
        try {
            // Fetch the latest candles for this timeframe
            const latestCandles = await getCandles(symbol, timeframe.interval, 2);
            if (latestCandles.length === 0) return;
            
            const currentCandles = this.timeframeCandles.get(timeframe.interval) || [];
            const lastKnownTime = currentCandles.length > 0 ? currentCandles[currentCandles.length - 1].time : 0;
            
            // Check for new candles
            const newCandles = latestCandles.filter(candle => candle.time > lastKnownTime);
            
            if (newCandles.length > 0) {
                // Add new candles
                currentCandles.push(...newCandles);
                
                // Keep only recent candles (limit buffer size)
                const maxCandles = this.calculateTimeframeLimit(timeframe.interval);
                if (currentCandles.length > maxCandles) {
                    currentCandles.splice(0, currentCandles.length - maxCandles);
                }
                
                this.timeframeCandles.set(timeframe.interval, currentCandles);
                
                // Check for new pivots in the new candles
                this.checkForNewPivots(timeframe, newCandles);
                
                if (fronttesterconfig.showSystemStatus) {
                    const timeString = new Date().toLocaleTimeString();
                    console.log(`${colors.green}📊 [${timeframe.interval}] New candle at ${timeString} | Price: $${newCandles[newCandles.length - 1].close.toFixed(1)}${colors.reset}`);
                }
            }
        } catch (error) {
            console.error(`${colors.red}Error fetching latest candle for ${timeframe.interval}:${colors.reset}`, error.message);
        }
    }

    checkForNewPivots(timeframe, newCandles) {
        const currentCandles = this.timeframeCandles.get(timeframe.interval) || [];
        const currentPivots = this.timeframePivots.get(timeframe.interval) || [];
        
        // Check each new candle for pivot formation
        for (const newCandle of newCandles) {
            const candleIndex = currentCandles.findIndex(c => c.time === newCandle.time);
            if (candleIndex === -1 || candleIndex < timeframe.lookback) continue;
            
            const pivot = this.detectPivotAtCandle(currentCandles, candleIndex, timeframe);
            if (pivot) {
                // Check if we already have this pivot
                const alreadyExists = currentPivots.some(p => p.time === pivot.time);
                if (!alreadyExists) {
                    currentPivots.push(pivot);
                    this.timeframePivots.set(timeframe.interval, currentPivots);
                    
                    // Handle pivot detection
                    this.handleNewPivot(pivot, timeframe);
                }
            }
        }
    }

    handleNewPivot(pivot, timeframe) {
        const currentTime = Date.now();
        
        if (fronttesterconfig.showDebug) {
            const timeString = new Date(pivot.time).toLocaleString();
            const time24 = new Date(pivot.time).toLocaleTimeString('en-GB', { hour12: false });
            console.log(`${colors.yellow}[${timeframe.interval}] New ${pivot.signal.toUpperCase()} pivot @ $${pivot.price.toFixed(1)} at ${timeString} (${time24})${colors.reset}`);
        }
        
        // Check if this is a primary timeframe pivot - open cascade window
        if (timeframe.role === 'primary') {
            this.openPrimaryWindow(pivot, currentTime);
        } else {
            // Check if this pivot confirms any active windows
            this.checkWindowConfirmations(pivot, timeframe, currentTime);
        }
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
        
        const timeString = new Date(primaryPivot.time).toLocaleString();
        const time24 = new Date(primaryPivot.time).toLocaleTimeString('en-GB', { hour12: false });
        const minRequired = multiPivotConfig.cascadeSettings.minTimeframesRequired || 3;
        
        console.log(`\n${colors.brightYellow}🟡 PRIMARY WINDOW OPENED [${windowId}]: ${primaryPivot.timeframe} ${primaryPivot.signal.toUpperCase()} pivot detected${colors.reset}`);
        console.log(`${colors.yellow}   Time: ${timeString} (${time24}) | Price: $${primaryPivot.price.toFixed(1)}${colors.reset}`);
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
        const executionPrice = this.currentPrice || window.primaryPivot.price; // Use live price if available
        const minutesAfterPrimary = Math.round((executionTime - window.primaryPivot.time) / (1000 * 60));
        
        const cascadeResult = {
            signal: window.primaryPivot.signal,
            strength: (1 + window.confirmations.length) / multiPivotConfig.timeframes.length,
            confirmations: window.confirmations,
            executionTime,
            executionPrice,
            minutesAfterPrimary,
            livePrice: this.currentPrice
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
        const timeString = new Date(executionTime).toLocaleString();
        const time24 = new Date(executionTime).toLocaleTimeString('en-GB', { hour12: false });
        
        console.log(`\n${colors.brightCyan}🎯 LIVE CASCADE EXECUTION [${window.id}]: All confirmations met${colors.reset}`);
        console.log(`${colors.cyan}   Execution Time: ${timeString} (${time24})${colors.reset}`);
        console.log(`${colors.cyan}   Entry Price: $${executionPrice.toFixed(1)} | Live Price: $${this.currentPrice.toFixed(1)} | Strength: ${(cascadeResult.strength * 100).toFixed(0)}% | Total wait: ${minutesAfterPrimary}min${colors.reset}`);
        
        this.displayCascade(cascadeInfo);
        window.status = 'executed';
    }

    cleanupExpiredWindows(currentTime) {
        for (const [windowId, window] of this.activeWindows) {
            if (window.status === 'active' && currentTime > window.windowEndTime) {
                window.status = 'expired';
                const timeString = new Date(window.windowEndTime).toLocaleString();
                const time24 = new Date(window.windowEndTime).toLocaleTimeString('en-GB', { hour12: false });
                const totalConfirmed = 1 + window.confirmations.length;
                const minRequiredTFs = multiPivotConfig.cascadeSettings.minTimeframesRequired || 3;
                
                console.log(`\n${colors.red}❌ PRIMARY WINDOW EXPIRED [${windowId}]: ${window.primaryPivot.timeframe} ${window.primaryPivot.signal.toUpperCase()}${colors.reset}`);
                console.log(`${colors.red}   Expired at: ${timeString} (${time24})${colors.reset}`);
                console.log(`${colors.red}   Final confirmations: ${totalConfirmed}/${minRequiredTFs} (insufficient for execution)${colors.reset}`);
            }
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

    getTimeframeDuration(interval) {
        const unit = interval.slice(-1);
        const value = parseInt(interval.slice(0, -1));
        
        switch(unit) {
            case 'm': return value * 60 * 1000;
            case 'h': return value * 60 * 60 * 1000;
            case 'd': return value * 24 * 60 * 60 * 1000;
            default: return value * 60 * 1000;
        }
    }

    calculateTimeframeLimit(interval) {
        const unit = interval.slice(-1);
        const value = parseInt(interval.slice(0, -1));
        
        // Calculate 1 month of data for each timeframe
        switch(unit) {
            case 'm': return Math.floor((30 * 24 * 60) / value); // 30 days worth
            case 'h': return Math.floor((30 * 24) / value);      // 30 days worth
            case 'd': return 30;                                 // 30 days
            default: return Math.floor((30 * 24 * 60) / value);
        }
    }

    displayCascade(cascadeInfo) {
        const { id, primaryPivot, cascadeResult } = cascadeInfo;
        
        console.log(`\n${colors.green}🎯 LIVE CASCADE #${id} DETECTED: ${primaryPivot.signal.toUpperCase()}${colors.reset}`);
        console.log(`${colors.cyan}${'─'.repeat(50)}${colors.reset}`);
        
        const primaryTime = new Date(primaryPivot.time).toLocaleString();
        const primaryTime24 = new Date(primaryPivot.time).toLocaleTimeString('en-GB', { hour12: false });
        const executionTime = new Date(cascadeResult.executionTime).toLocaleString();
        const executionTime24 = new Date(cascadeResult.executionTime).toLocaleTimeString('en-GB', { hour12: false });
        const confirmingTFs = cascadeResult.confirmations.map(c => c.timeframe).join(', ');
        
        console.log(`${colors.cyan}Primary Time:    ${primaryTime} (${primaryTime24})${colors.reset}`);
        console.log(`${colors.cyan}Execution Time:  ${executionTime} (${executionTime24}) (+${cascadeResult.minutesAfterPrimary}min)${colors.reset}`);
        console.log(`${colors.cyan}Entry Price:     $${cascadeResult.executionPrice.toFixed(1)}${colors.reset}`);
        console.log(`${colors.cyan}Live Price:      $${cascadeResult.livePrice.toFixed(1)}${colors.reset}`);
        console.log(`${colors.cyan}Strength:        ${(cascadeResult.strength * 100).toFixed(0)}%${colors.reset}`);
        console.log(`${colors.cyan}Confirming TFs:  ${confirmingTFs}${colors.reset}`);
        console.log(`${colors.cyan}${'─'.repeat(50)}${colors.reset}`);
        
        this.displayRecentCascades();
    }

    displayRecentCascades() {
        if (this.recentCascades.length === 0) return;
        
        console.log(`\n${colors.magenta}┌─ Recent Live Cascades (${this.recentCascades.length}/3) ${'─'.repeat(25)}${colors.reset}`);
        
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

    startLiveTrading() {
        console.log(`${colors.cyan}🚀 Starting live multi-timeframe cascade detection...${colors.reset}\n`);
        this.isRunning = true;
        
        // Show initial status
        console.log(`${colors.green}✅ Live trading system is now active${colors.reset}`);
        console.log(`${colors.cyan}📊 Monitoring ${multiPivotConfig.timeframes.length} timeframes for cascade formation${colors.reset}`);
        console.log(`${colors.yellow}⏰ System will detect pivots and cascades in real-time${colors.reset}\n`);
    }

    stop() {
        this.isRunning = false;
        
        if (this.ws) {
            this.ws.close();
        }
        
        if (this.candleUpdateInterval) {
            clearInterval(this.candleUpdateInterval);
        }
        
        console.log(`${colors.yellow}🛑 Live trading system stopped${colors.reset}`);
        console.log(`${colors.cyan}📊 Final Statistics:${colors.reset}`);
        console.log(`${colors.cyan}   Total Cascades: ${this.cascadeCounter}${colors.reset}`);
        console.log(`${colors.cyan}   Active Windows: ${this.activeWindows.size}${colors.reset}`);
    }
}

// Main execution
async function main() {
    const liveFronttester = new LiveMultiTimeframeFronttester();
    
    try {
        await liveFronttester.initialize();
        liveFronttester.startLiveTrading();
        
        // Handle graceful shutdown
        process.on('SIGINT', () => {
            console.log(`\n${colors.yellow}Shutting down live system...${colors.reset}`);
            liveFronttester.stop();
            process.exit(0);
        });
        
        // Keep the process running
        setInterval(() => {
            // Keep alive
        }, 1000);
        
    } catch (error) {
        console.error(`${colors.red}Error:${colors.reset}`, error);
        process.exit(1);
    }
}

main().catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
});
