// multiPivotFronttester.js
// Real-time multi-timeframe cascade detection and trading system

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
import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get the directory name in a way that works with ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

// Utility function to format numbers with commas
const formatNumberWithCommas = (num) => {
    if (typeof num !== 'number') return num;
    return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

// Utility function to play beep sound
const playBeep = (volume = 1) => {
    if (!fronttesterconfig.enableBeeps) return;
    
    const beepChar = '\u0007'; // ASCII bell character
    
    // Play multiple beeps based on volume setting
    for (let i = 0; i < volume; i++) {
        process.stdout.write(beepChar);
        if (i < volume - 1) {
            // Small delay between beeps
            setTimeout(() => {}, 100);
        }
    }
};

class MultiPivotFronttester {
    constructor() {
        this.detector = null;
        this.recentCascades = [];
        this.ws = null;
        this.isRunning = false;
        this.lastCheckTime = 0;
        this.simulationIndex = 0;
        this.simulationCandles = [];
        this.capital = tradeConfig.initialCapital;
        this.trades = [];
        this.openTrades = [];
        this.cascadeCounter = 0;
        this.processedPivots = new Set(); // Track processed pivot timestamps
        
        // Use configured limit or override
        this.dataLimit = fronttesterconfig.dataLimit || configLimit;
    }

    async initialize() {
        console.log(`${colors.cyan}=== MULTI-TIMEFRAME CASCADE FRONTTESTER ===${colors.reset}`);
        console.log(`${colors.yellow}Symbol: ${symbol}${colors.reset}`);
        console.log(`${colors.yellow}Detection Mode: ${pivotDetectionMode === 'extreme' ? 'Extreme (High/Low)' : 'Close'}${colors.reset}`);
        console.log(`${colors.yellow}Data Source: ${useLocalData ? 'Local CSV' : 'Live API'}${colors.reset}`);
        console.log(`${colors.yellow}Mode: ${fronttesterconfig.pastMode ? 'Past Simulation' : 'Live WebSocket'}${colors.reset}`);
        console.log(`${colors.yellow}Execution: ${fronttesterconfig.executionMode.toUpperCase()}${colors.reset}`);
        console.log(`${colors.yellow}Refresh Interval: ${fronttesterconfig.refreshInterval}s${colors.reset}`);
        console.log(`${colors.yellow}Data Limit: ${this.dataLimit} candles${colors.reset}`);
        console.log(`${colors.yellow}Audio Beeps: ${fronttesterconfig.enableBeeps ? colors.green + 'ENABLED' + colors.reset : colors.red + 'DISABLED' + colors.reset} ${fronttesterconfig.enableBeeps ? `(Volume: ${fronttesterconfig.beepVolume})` : ''}${colors.reset}`);
        console.log(`${'='.repeat(60)}\n`);

        // Initialize time-progressive multi-timeframe system (NO FUTURE LOOK BIAS)
        console.log(`${colors.cyan}=== INITIALIZING TIME-PROGRESSIVE SYSTEM ===${colors.reset}`);
        this.detector = new MultiTimeframePivotDetector(symbol, multiPivotConfig);
        
        try {
            // Load raw candle data only - NO pivot pre-calculation
            await this.detector.loadRawCandleDataOnly(useLocalData, this.dataLimit);
            console.log(`${colors.green}✅ Raw candle data loaded successfully${colors.reset}`);
            
            // Display available data ranges (not pivots - we don't know them yet!)
            multiPivotConfig.timeframes.forEach(tf => {
                const candles = this.detector.timeframeData.get(tf.interval) || [];
                console.log(`  ${colors.yellow}${tf.interval.padEnd(4)}${colors.reset}: ${colors.green}${candles.length.toString().padStart(4)}${colors.reset} candles`);
            });
            
        } catch (error) {
            console.error(`${colors.red}Failed to initialize time-progressive system:${colors.reset}`, error);
            process.exit(1);
        }

        // Get 1-minute candles for simulation progression
        const oneMinuteCandles = this.detector.timeframeData.get('1m') || [];
        if (oneMinuteCandles.length === 0) {
            console.error(`${colors.red}No 1-minute candles available for simulation${colors.reset}`);
            process.exit(1);
        }

        console.log(`${colors.green}Successfully loaded ${oneMinuteCandles.length} 1-minute candles for time progression${colors.reset}`);
        console.log(`${colors.cyan}⚠️  NO FUTURE LOOK BIAS - Pivots will be detected as time progresses${colors.reset}`);

        // Initialize time-progressive tracking
        this.currentSimulationTime = oneMinuteCandles[0].time; // Start at beginning
        this.timeframeKnownPivots = new Map(); // Track pivots known at current time
        multiPivotConfig.timeframes.forEach(tf => {
            this.timeframeKnownPivots.set(tf.interval, []);
        });

        if (fronttesterconfig.pastMode) {
            this.setupPastModeSimulation(oneMinuteCandles);
        } else {
            this.setupLiveMode();
        }
    }

    setupPastModeSimulation(oneMinuteCandles) {
        console.log(`\n${colors.cyan}=== PAST MODE SIMULATION SETUP ===${colors.reset}`);
        
        this.simulationCandles = [...oneMinuteCandles];
        
        if (fronttesterconfig.startFromEnd) {
            // Start from most recent data and work backwards in time
            this.simulationCandles.reverse();
            this.simulationIndex = 0;
        } else {
            // Start from oldest data
            this.simulationIndex = 0;
        }
        
        const totalCandles = fronttesterconfig.simulationLength || this.simulationCandles.length;
        const actualCandles = Math.min(totalCandles, this.simulationCandles.length);
        
        // Calculate time information
        const startCandle = this.simulationCandles[0];
        const endCandle = this.simulationCandles[this.simulationCandles.length - 1];
        const startTime = new Date(startCandle.time);
        const endTime = new Date(endCandle.time);
        
        // Calculate duration
        const durationMs = Math.abs(endTime.getTime() - startTime.getTime());
        const totalMinutes = Math.floor(durationMs / (1000 * 60));
        const days = Math.floor(totalMinutes / (24 * 60));
        const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
        const minutes = totalMinutes % 60;
        
        // Calculate months (approximate)
        const months = Math.floor(days / 30);
        const remainingDays = days % 30;
        
        // Format duration string
        let durationStr = '';
        if (months > 0) {
            durationStr += `${months} month${months > 1 ? 's' : ''}`;
            if (remainingDays > 0 || hours > 0 || minutes > 0) durationStr += ', ';
        }
        if (remainingDays > 0) {
            durationStr += `${remainingDays} day${remainingDays > 1 ? 's' : ''}`;
            if (hours > 0 || minutes > 0) durationStr += ', ';
        }
        if (hours > 0) {
            durationStr += `${hours} hour${hours > 1 ? 's' : ''}`;
            if (minutes > 0) durationStr += ', ';
        }
        if (minutes > 0) {
            durationStr += `${minutes} minute${minutes > 1 ? 's' : ''}`;
        }
        
        // Display time information
        console.log(`${colors.yellow}Simulation Length: ${actualCandles} candles${colors.reset}`);
        console.log(`${colors.yellow}Speed Multiplier: ${fronttesterconfig.speedMultiplier}x${colors.reset}`);
        console.log(`${colors.yellow}Direction: ${fronttesterconfig.startFromEnd ? 'Recent → Older' : 'Older → Recent'}${colors.reset}`);
        
        console.log(`\n${colors.cyan}--- Time Range Information ---${colors.reset}`);
        if (fronttesterconfig.startFromEnd) {
            console.log(`${colors.yellow}Starting from: ${endTime.toLocaleString()} (${endTime.toLocaleTimeString('en-GB', { hour12: false })})${colors.reset}`);
            console.log(`${colors.yellow}Ending at: ${startTime.toLocaleString()} (${startTime.toLocaleTimeString('en-GB', { hour12: false })})${colors.reset}`);
        } else {
            console.log(`${colors.yellow}Starting from: ${startTime.toLocaleString()} (${startTime.toLocaleTimeString('en-GB', { hour12: false })})${colors.reset}`);
            console.log(`${colors.yellow}Ending at: ${endTime.toLocaleString()} (${endTime.toLocaleTimeString('en-GB', { hour12: false })})${colors.reset}`);
        }
        console.log(`${colors.yellow}Data Span: ${durationStr || 'Less than 1 minute'}${colors.reset}`);
        console.log(`${colors.yellow}Total Minutes: ${formatNumberWithCommas(totalMinutes)} minutes${colors.reset}`);
        
        // Calculate estimated simulation time
        const baseInterval = Math.max(1, Math.floor(1000 / fronttesterconfig.speedMultiplier));
        const estimatedSimTimeMs = actualCandles * baseInterval;
        const estimatedSimTimeSeconds = Math.floor(estimatedSimTimeMs / 1000);
        const estimatedSimTimeMinutes = Math.floor(estimatedSimTimeSeconds / 60);
        const remainingSeconds = estimatedSimTimeSeconds % 60;
        
        let estimatedTimeStr = '';
        if (estimatedSimTimeMinutes > 0) {
            estimatedTimeStr = `${estimatedSimTimeMinutes} minute${estimatedSimTimeMinutes > 1 ? 's' : ''}`;
            if (remainingSeconds > 0) estimatedTimeStr += `, ${remainingSeconds} second${remainingSeconds > 1 ? 's' : ''}`;
        } else {
            estimatedTimeStr = `${estimatedSimTimeSeconds} second${estimatedSimTimeSeconds > 1 ? 's' : ''}`;
        }
        
        console.log(`${colors.cyan}Estimated Simulation Time: ${estimatedTimeStr}${colors.reset}`);
        
        console.log(`\n${colors.green}🚀 Starting past mode simulation...${colors.reset}\n`);
        this.startPastModeSimulation();
    }

    setupLiveMode() {
        console.log(`\n${colors.cyan}=== LIVE MODE SETUP ===${colors.reset}`);
        console.log(`${colors.yellow}WebSocket URL: wss://stream.bybit.com/v5/public/linear${colors.reset}`);
        console.log(`${colors.yellow}Subscription: ${symbol} kline data${colors.reset}\n`);
        
        this.connectWebSocket();
    }

    startPastModeSimulation() {
        this.isRunning = true;
        
        const baseInterval = Math.max(1, Math.floor(1000 / fronttesterconfig.speedMultiplier));
        const refreshInterval = fronttesterconfig.refreshInterval * 1000; // Convert to ms
        
        const simulationLoop = () => {
            if (!this.isRunning) return;
            
            const totalCandles = fronttesterconfig.simulationLength || this.simulationCandles.length;
            
            if (this.simulationIndex >= totalCandles || this.simulationIndex >= this.simulationCandles.length) {
                console.log(`\n${colors.green}🏁 Past mode simulation completed!${colors.reset}`);
                this.displayFinalSummary();
                return;
            }
            
            const currentCandle = this.simulationCandles[this.simulationIndex];
            
            // Check for cascades every candle (every minute in simulation time)
            // This simulates real-time monitoring where we check every minute
            this.checkForCascades(currentCandle);
            
            // Progress indicator
            if (fronttesterconfig.showProgress && this.simulationIndex % 100 === 0 && this.simulationIndex > 0) {
                const progress = ((this.simulationIndex / totalCandles) * 100).toFixed(1);
                const progressBar = '█'.repeat(Math.floor(progress / 5)) + '░'.repeat(20 - Math.floor(progress / 5));
                console.log(`${colors.cyan}Progress: [${progressBar}] ${progress}% (${this.simulationIndex}/${totalCandles})${colors.reset}`);
            }
            
            this.simulationIndex++;
            setTimeout(simulationLoop, baseInterval);
        };
        
        simulationLoop();
    }

    connectWebSocket() {
        const wsUrl = 'wss://stream.bybit.com/v5/public/linear';
        
        try {
            this.ws = new WebSocket(wsUrl);
            
            this.ws.on('open', () => {
                if (fronttesterconfig.showSystemStatus) {
                    console.log(`${colors.green}✅ WebSocket connected to Bybit${colors.reset}`);
                }
                
                // Subscribe to kline data
                const subscribeMsg = {
                    op: 'subscribe',
                    args: [`kline.1.${symbol}`]
                };
                
                this.ws.send(JSON.stringify(subscribeMsg));
                console.log(`${colors.cyan}📡 Subscribed to ${symbol} 1-minute kline data${colors.reset}\n`);
                
                this.isRunning = true;
                this.startLiveMode();
            });
            
            this.ws.on('message', (data) => {
                try {
                    const message = JSON.parse(data.toString());
                    
                    if (message.topic && message.topic.includes('kline') && message.data) {
                        this.handleKlineData(message.data);
                    }
                } catch (error) {
                    console.error(`${colors.red}Error parsing WebSocket message:${colors.reset}`, error);
                }
            });
            
            this.ws.on('error', (error) => {
                if (fronttesterconfig.showSystemStatus) {
                    console.error(`${colors.red}WebSocket error:${colors.reset}`, error);
                }
            });
            
            this.ws.on('close', () => {
                if (fronttesterconfig.showSystemStatus) {
                    console.log(`${colors.yellow}WebSocket connection closed${colors.reset}`);
                }
                
                if (this.isRunning) {
                    console.log(`${colors.cyan}Attempting to reconnect in 5 seconds...${colors.reset}`);
                    setTimeout(() => this.connectWebSocket(), 5000);
                }
            });
            
        } catch (error) {
            console.error(`${colors.red}Failed to connect WebSocket:${colors.reset}`, error);
            process.exit(1);
        }
    }

    startLiveMode() {
        const refreshInterval = fronttesterconfig.refreshInterval * 1000;
        
        const liveLoop = () => {
            if (!this.isRunning) return;
            
            this.checkForCascades();
            
            if (fronttesterconfig.showHeartbeat) {
                const time = new Date().toLocaleTimeString();
                console.log(`${colors.cyan}💓 [${time}] Monitoring cascades... (${this.recentCascades.length} recent)${colors.reset}`);
            }
            
            setTimeout(liveLoop, refreshInterval);
        };
        
        liveLoop();
    }

    handleKlineData(klineData) {
        // Process incoming kline data from WebSocket
        if (!fronttesterconfig.hideCandles) {
            const candle = klineData[0];
            const time = new Date(parseInt(candle.start)).toLocaleTimeString();
            console.log(`${colors.yellow}📊 [${time}] ${symbol}: ${candle.close}${colors.reset}`);
        }
    }

    checkForCascades(currentCandle = null) {
        // Update current simulation time if provided
        if (currentCandle && currentCandle.time) {
            this.currentSimulationTime = currentCandle.time;
        }
        
        // TIME-PROGRESSIVE PIVOT DETECTION - Only detect pivots up to current time
        this.updateKnownPivotsUpToCurrentTime();
        
        // Get primary timeframe pivots that we know about at current time
        const primaryTimeframe = multiPivotConfig.timeframes[0];
        const knownPrimaryPivots = this.timeframeKnownPivots.get(primaryTimeframe.interval) || [];
        
        if (knownPrimaryPivots.length === 0) return;
        
        // Check only recent pivots that haven't been processed yet
        const recentPivots = knownPrimaryPivots.slice(-5); // Check last 5 known pivots
        
        for (const primaryPivot of recentPivots) {
            // Create unique key for this pivot
            const pivotKey = `${primaryPivot.time}_${primaryPivot.signal}_${primaryPivot.price}`;
            
            // Skip if we've already processed this pivot
            if (this.processedPivots.has(pivotKey)) {
                continue;
            }
            
            // Check for TIME-PROGRESSIVE cascade confirmation (no future look)
            const cascadeResult = this.checkTimeProgressiveCascadeConfirmation(primaryPivot);
            
            if (cascadeResult) {
                this.cascadeCounter++;
                
                // Mark this pivot as processed
                this.processedPivots.add(pivotKey);
                
                // Add to recent cascades
                const cascadeInfo = {
                    id: this.cascadeCounter,
                    primaryPivot,
                    cascadeResult,
                    timestamp: Date.now()
                };
                
                this.recentCascades.push(cascadeInfo);
                
                // Keep only recent cascades
                if (this.recentCascades.length > fronttesterconfig.maxRecentCascades) {
                    this.recentCascades.shift();
                }
                
                this.displayCascadeDetection(cascadeInfo);
                
                // Execute trade if in trade mode
                if (fronttesterconfig.executionMode === 'trade') {
                    this.executeTrade(cascadeInfo);
                }
            }
        }
    }

    // TIME-PROGRESSIVE PIVOT DETECTION - Only check for NEW pivots at current simulation time
    updateKnownPivotsUpToCurrentTime() {
        // Only check for pivots that could be detected at the CURRENT simulation time
        // This simulates real-time detection where you only know about pivots as they form
        
        for (const timeframe of multiPivotConfig.timeframes) {
            const candles = this.detector.timeframeData.get(timeframe.interval) || [];
            const currentKnownPivots = this.timeframeKnownPivots.get(timeframe.interval) || [];
            
            // Find the candle that corresponds to current simulation time for this timeframe
            const currentCandleIndex = candles.findIndex(candle => 
                Math.abs(candle.time - this.currentSimulationTime) <= this.getTimeframeToleranceMs(timeframe.interval)
            );
            
            if (currentCandleIndex === -1 || currentCandleIndex < timeframe.lookback) {
                continue; // No matching candle or not enough history
            }
            
            // Check if we already detected a pivot at this time
            const alreadyDetected = currentKnownPivots.some(pivot => 
                Math.abs(pivot.time - candles[currentCandleIndex].time) <= this.getTimeframeToleranceMs(timeframe.interval)
            );
            
            if (alreadyDetected) {
                continue; // Already processed this timeframe at this time
            }
            
            // Only check for pivot at the CURRENT candle index
            const pivot = this.detectPivotAtIndex(candles, currentCandleIndex, timeframe);
            if (pivot) {
                pivot.timeframe = timeframe.interval;
                currentKnownPivots.push(pivot);
                
                if (fronttesterconfig.showDebug) {
                    const time12 = new Date(pivot.time).toLocaleString();
                    const time24 = new Date(pivot.time).toLocaleTimeString('en-GB', { hour12: false });
                    console.log(`${colors.cyan}[${timeframe.interval}] NEW PIVOT: ${pivot.signal.toUpperCase()} @ ${pivot.price} at ${time12} (${time24})${colors.reset}`);
                }
                
                this.timeframeKnownPivots.set(timeframe.interval, currentKnownPivots);
            }
        }
    }
    
    // Get tolerance for timeframe matching (in milliseconds)
    getTimeframeToleranceMs(interval) {
        const unit = interval.slice(-1);
        const value = parseInt(interval.slice(0, -1));
        
        switch(unit) {
            case 'm': return value * 60 * 1000;
            case 'h': return value * 60 * 60 * 1000;
            case 'd': return value * 24 * 60 * 60 * 1000;
            default: return 60 * 1000; // Default 1 minute
        }
    }
    
    // Detect pivot at specific candle index (no future look)
    detectPivotAtIndex(candles, index, timeframe) {
        if (index < timeframe.lookback || index >= candles.length) {
            return null;
        }
        
        const currentCandle = candles[index];
        const currentPrice = pivotDetectionMode === 'extreme' ? 
            { high: currentCandle.high, low: currentCandle.low } : 
            { high: currentCandle.close, low: currentCandle.close };
        
        // Check for high pivot
        let isHighPivot = true;
        for (let j = 1; j <= timeframe.lookback; j++) {
            if (index - j < 0) {
                isHighPivot = false;
                break;
            }
            const compareCandle = candles[index - j];
            const comparePrice = pivotDetectionMode === 'extreme' ? compareCandle.high : compareCandle.close;
            if (comparePrice >= currentPrice.high) {
                isHighPivot = false;
                break;
            }
        }
        
        // Check for low pivot
        let isLowPivot = true;
        for (let j = 1; j <= timeframe.lookback; j++) {
            if (index - j < 0) {
                isLowPivot = false;
                break;
            }
            const compareCandle = candles[index - j];
            const comparePrice = pivotDetectionMode === 'extreme' ? compareCandle.low : compareCandle.close;
            if (comparePrice <= currentPrice.low) {
                isLowPivot = false;
                break;
            }
        }
        
        // Apply minimum swing percentage and leg bars if configured
        if (isHighPivot || isLowPivot) {
            const knownPivots = this.timeframeKnownPivots.get(timeframe.interval) || [];
            if (knownPivots.length > 0) {
                const lastPivot = knownPivots[knownPivots.length - 1];
                const priceDiff = Math.abs(currentCandle.close - lastPivot.price);
                const percentChange = (priceDiff / lastPivot.price) * 100;
                
                if (percentChange < timeframe.minSwingPct) {
                    return null; // Not enough price movement
                }
                
                const timeDiff = currentCandle.time - lastPivot.time;
                const candlesDiff = Math.floor(timeDiff / (60 * 1000)); // Assuming 1-minute candles
                if (candlesDiff < timeframe.minLegBars) {
                    return null; // Not enough time between pivots
                }
            }
        }
        
        if (isHighPivot) {
            return {
                time: currentCandle.time,
                price: currentPrice.high,
                signal: 'short', // High pivot suggests short signal
                type: 'high',
                candle: currentCandle
            };
        } else if (isLowPivot) {
            return {
                time: currentCandle.time,
                price: currentPrice.low,
                signal: 'long', // Low pivot suggests long signal
                type: 'low',
                candle: currentCandle
            };
        }
        
        return null;
    }
    
    // TIME-PROGRESSIVE cascade confirmation - only uses data up to current time
    checkTimeProgressiveCascadeConfirmation(primaryPivot) {
        const { timeframes, cascadeSettings } = multiPivotConfig;
        
        // Only check confirmations that could have occurred by current simulation time
        const maxWaitMinutes = Math.max(...Object.values(cascadeSettings.confirmationWindow));
        const timeElapsedSincePrimary = (this.currentSimulationTime - primaryPivot.time) / (1000 * 60);
        
        if (timeElapsedSincePrimary < 1) {
            return null; // Not enough time has passed for any confirmations
        }
        
        const confirmations = [];
        let totalWeight = 0;
        
        // Check each timeframe for confirmations (excluding primary)
        for (let i = 1; i < timeframes.length; i++) {
            const tf = timeframes[i];
            const knownPivots = this.timeframeKnownPivots.get(tf.interval) || [];
            
            // Look for pivots of same signal type within confirmation window
            const confirmationWindow = cascadeSettings.confirmationWindow[tf.interval] || 60;
            const windowStart = primaryPivot.time;
            const windowEnd = Math.min(primaryPivot.time + (confirmationWindow * 60 * 1000), this.currentSimulationTime);
            
            const confirmingPivots = knownPivots.filter(pivot => 
                pivot.signal === primaryPivot.signal &&
                pivot.time >= windowStart &&
                pivot.time <= windowEnd
            );
            
            if (confirmingPivots.length > 0) {
                const latestConfirming = confirmingPivots[confirmingPivots.length - 1];
                confirmations.push({
                    timeframe: tf.interval,
                    pivot: latestConfirming,
                    weight: tf.weight || 1
                });
                totalWeight += tf.weight || 1;
            }
        }
        
        // Check if we have minimum required confirmations
        const requiredConfirmations = cascadeSettings.minConfirmations || 1;
        if (confirmations.length < requiredConfirmations) {
            return null;
        }
        
        // Calculate strength based on confirmed timeframes
        const maxPossibleWeight = timeframes.slice(1).reduce((sum, tf) => sum + (tf.weight || 1), 0);
        const strength = totalWeight / maxPossibleWeight;
        
        // Find execution time (latest confirmation time)
        const confirmationTimes = [primaryPivot.time, ...confirmations.map(c => c.pivot.time)];
        const executionTime = Math.max(...confirmationTimes);
        
        // Get execution price from 1-minute data at execution time
        const oneMinuteCandles = this.detector.timeframeData.get('1m') || [];
        const executionCandle = oneMinuteCandles.find(c => c.time >= executionTime && c.time <= this.currentSimulationTime);
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

    displayCascadeDetection(cascadeInfo) {
        const { id, primaryPivot, cascadeResult } = cascadeInfo;
        
        // Play beep for cascade detection
        if (fronttesterconfig.beepOnCascade) {
            playBeep(fronttesterconfig.beepVolume);
        }
        
        console.log(`\n${colors.green}🎯 CASCADE #${id} DETECTED: ${primaryPivot.signal.toUpperCase()}${colors.reset}`);
        console.log(`${colors.cyan}${'─'.repeat(50)}${colors.reset}`);
        
        const primaryTime12 = new Date(primaryPivot.time).toLocaleString();
        const primaryTime24Only = new Date(primaryPivot.time).toLocaleTimeString('en-GB', { hour12: false });
        const executionTime12 = new Date(cascadeResult.executionTime).toLocaleString();
        const executionTime24Only = new Date(cascadeResult.executionTime).toLocaleTimeString('en-GB', { hour12: false });
        const confirmingTFs = cascadeResult.confirmations.map(c => c.timeframe).join(', ');
        
        console.log(`${colors.cyan}Primary Time:    ${primaryTime12} (${primaryTime24Only})${colors.reset}`);
        console.log(`${colors.cyan}Execution Time:  ${executionTime12} (${executionTime24Only}) (+${cascadeResult.minutesAfterPrimary}min)${colors.reset}`);
        console.log(`${colors.cyan}Entry Price:     $${formatNumberWithCommas(cascadeResult.executionPrice)}${colors.reset}`);
        console.log(`${colors.cyan}Strength:        ${(cascadeResult.strength * 100).toFixed(0)}%${colors.reset}`);
        console.log(`${colors.cyan}Confirming TFs:  ${confirmingTFs}${colors.reset}`);
        console.log(`${colors.cyan}${'─'.repeat(50)}${colors.reset}`);
        
        // Display recent cascades summary
        this.displayRecentCascades();
    }

    displayRecentCascades() {
        if (this.recentCascades.length === 0) return;
        
        console.log(`\n${colors.magenta}┌─ Recent Cascades (${this.recentCascades.length}/${fronttesterconfig.maxRecentCascades}) ${'─'.repeat(30)}${colors.reset}`);
        
        this.recentCascades.forEach((cascade, index) => {
            const { id, primaryPivot, cascadeResult } = cascade;
            const time = new Date(primaryPivot.time).toLocaleTimeString();
            const signal = primaryPivot.signal.toUpperCase();
            const strength = (cascadeResult.strength * 100).toFixed(0);
            const price = formatNumberWithCommas(cascadeResult.executionPrice);
            
            console.log(`${colors.magenta}│${colors.reset} ${colors.yellow}[${id.toString().padStart(3)}] ${time.padEnd(11)} | ${signal.padEnd(5)} | ${strength.padStart(2)}% | $${price}${colors.reset}`);
        });
        
        console.log(`${colors.magenta}└${'─'.repeat(60)}${colors.reset}\n`);
    }

    executeTrade(cascadeInfo) {
        const { primaryPivot, cascadeResult } = cascadeInfo;
        
        // Determine trade type based on configuration
        let shouldOpenTrade = false;
        let tradeType = null;
        
        if (primaryPivot.signal === 'long') {
            if (tradeConfig.direction === 'buy' || tradeConfig.direction === 'both') {
                shouldOpenTrade = true;
                tradeType = 'long';
            } else if (tradeConfig.direction === 'alternate') {
                shouldOpenTrade = true;
                tradeType = 'short';
            }
        } else if (primaryPivot.signal === 'short') {
            if (tradeConfig.direction === 'sell' || tradeConfig.direction === 'both') {
                shouldOpenTrade = true;
                tradeType = 'short';
            } else if (tradeConfig.direction === 'alternate') {
                shouldOpenTrade = true;
                tradeType = 'long';
            }
        }
        
        if (shouldOpenTrade && this.capital > 0) {
            if (this.openTrades.length < tradeConfig.maxConcurrentTrades) {
                const usedCapital = this.openTrades.reduce((sum, trade) => sum + trade.size, 0);
                const availableCapital = this.capital - usedCapital;
                
                let tradeSize = 0;
                if (tradeConfig.positionSizingMode === 'fixed' && tradeConfig.amountPerTrade) {
                    tradeSize = Math.min(tradeConfig.amountPerTrade, availableCapital);
                } else if (tradeConfig.positionSizingMode === 'minimum' && tradeConfig.minimumTradeAmount) {
                    const percentageAmount = availableCapital * (tradeConfig.riskPerTrade / 100);
                    tradeSize = Math.max(percentageAmount, Math.min(tradeConfig.minimumTradeAmount, availableCapital));
                } else {
                    tradeSize = availableCapital * (tradeConfig.riskPerTrade / 100);
                }
                
                if (tradeSize > 0) {
                    const trade = this.createTrade(tradeType, cascadeResult, tradeSize);
                    this.openTrades.push(trade);
                    
                    // Play beep for trade execution
                    if (fronttesterconfig.beepOnTrade) {
                        playBeep(fronttesterconfig.beepVolume + 1); // Slightly louder for trades
                    }
                    
                    console.log(`${colors.brightGreen}💰 [TRADE] ${tradeType.toUpperCase()} opened @ ${formatNumberWithCommas(trade.entryPrice)} | Size: ${formatNumberWithCommas(trade.size)}${colors.reset}`);
                    console.log(`${colors.cyan}   TP: ${formatNumberWithCommas(trade.takeProfitPrice)} | SL: ${formatNumberWithCommas(trade.stopLossPrice)}${colors.reset}`);
                }
            }
        }
    }

    createTrade(type, cascadeResult, tradeSize) {
        const entryPrice = cascadeResult.executionPrice;
        
        const takeProfitPrice = type === 'long'
            ? entryPrice * (1 + (tradeConfig.takeProfit / 100))
            : entryPrice * (1 - (tradeConfig.takeProfit / 100));
            
        const stopLossPrice = type === 'long'
            ? entryPrice * (1 - (tradeConfig.stopLoss / 100))
            : entryPrice * (1 + (tradeConfig.stopLoss / 100));

        return {
            type,
            entryPrice,
            entryTime: cascadeResult.executionTime,
            size: tradeSize,
            status: 'open',
            takeProfitPrice,
            stopLossPrice,
            cascade: cascadeResult
        };
    }

    displayFinalSummary() {
        console.log(`\n${colors.cyan}=== FRONTTESTING SUMMARY ===${colors.reset}`);
        console.log(`${colors.cyan}${'─'.repeat(40)}${colors.reset}`);
        console.log(`${colors.yellow}Total Cascades Detected: ${colors.green}${this.cascadeCounter}${colors.reset}`);
        console.log(`${colors.yellow}Execution Mode:          ${colors.green}${fronttesterconfig.executionMode.toUpperCase()}${colors.reset}`);
        
        if (fronttesterconfig.executionMode === 'trade' && this.trades.length > 0) {
            const totalPnl = this.trades.reduce((sum, t) => sum + (t.pnl || 0), 0);
            const winningTrades = this.trades.filter(t => (t.pnl || 0) > 0);
            const winRate = ((winningTrades.length / this.trades.length) * 100).toFixed(1);
            
            console.log(`${colors.yellow}Total Trades:            ${colors.green}${this.trades.length}${colors.reset}`);
            console.log(`${colors.yellow}Win Rate:                ${colors.green}${winRate}%${colors.reset}`);
            console.log(`${colors.yellow}Total P&L:               ${totalPnl >= 0 ? colors.green : colors.red}${formatNumberWithCommas(totalPnl)} USDT${colors.reset}`);
            console.log(`${colors.yellow}Final Capital:           ${this.capital >= 0 ? colors.green : colors.red}${formatNumberWithCommas(this.capital)} USDT${colors.reset}`);
        }
        console.log(`${colors.cyan}${'─'.repeat(40)}${colors.reset}`);
        
        if (this.recentCascades.length > 0) {
            console.log(`\n${colors.magenta}Final Recent Cascades:${colors.reset}`);
            this.displayRecentCascades();
        }
    }

    stop() {
        this.isRunning = false;
        
        if (this.ws) {
            this.ws.close();
        }
        
        console.log(`\n${colors.yellow}🛑 Fronttester stopped${colors.reset}`);
        this.displayFinalSummary();
    }
}

// Main execution
async function main() {
    const fronttester = new MultiPivotFronttester();
    
    try {
        await fronttester.initialize();
        
        // Handle graceful shutdown
        process.on('SIGINT', () => {
            console.log(`\n${colors.yellow}Received SIGINT, shutting down gracefully...${colors.reset}`);
            fronttester.stop();
            process.exit(0);
        });
        
        process.on('SIGTERM', () => {
            console.log(`\n${colors.yellow}Received SIGTERM, shutting down gracefully...${colors.reset}`);
            fronttester.stop();
            process.exit(0);
        });
        
    } catch (error) {
        console.error(`${colors.red}Error starting fronttester:${colors.reset}`, error);
        process.exit(1);
    }
}

// Run the fronttester
main().catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
});
