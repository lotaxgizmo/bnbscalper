// multiPivotSnapshotAnalyzer.js
// SNAPSHOT MODE: Analyze cascade state at a specific point in time

// ===== SNAPSHOT CONFIGURATION =====
const SNAPSHOT_CONFIG = {
    // Target timestamp for analysis (YYYY-MM-DD HH:MM:SS format)
    targetTime: "2025-08-08 02:15:00",
    liveMode: true,

    length: 1440,    
    // Display options
    togglePivots: false,
    toggleCascades: true,
    showRecentPivots: 5,        // Number of recent pivots to show per timeframe
    showRecentCascades: 10      // Number of recent cascades to show
};
// ==================================

import path from 'path';
import fs from 'fs';

import {
    symbol,
    time as interval,
    useLocalData,
    api,
    pivotDetectionMode,
    limit as configLimit
} from './config/config.js';

import { multiPivotConfig } from './config/multiPivotConfig.js';
import { MultiTimeframePivotDetector } from './utils/multiTimeframePivotDetector.js';

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
    bold: '\x1b[1m',
    dim: '\x1b[2m'
};

// Helper function to format time differences in days, hours, minutes
function formatTimeDifference(milliseconds) {
    const totalMinutes = Math.floor(milliseconds / (1000 * 60));
    const days = Math.floor(totalMinutes / (24 * 60));
    const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
    const minutes = totalMinutes % 60;
    
    if (days > 0) {
        return `${days}d ${hours}h ${minutes}m`;
    } else if (hours > 0) {
        return `${hours}h ${minutes}m`;
    } else {
        return `${minutes}m`;
    }
}

class MultiPivotSnapshotAnalyzer {
    constructor(snapshotTime) {
        this.snapshotTime = new Date(snapshotTime).getTime();
        this.timeframeCandles = new Map();
        this.timeframePivots = new Map();
        this.lastPivots = new Map();
        this.activeWindows = new Map();
        this.windowCounter = 0;
        this.cascadeCounter = 0;
        this.allCascades = [];
        
        // Validate snapshot time
        if (isNaN(this.snapshotTime)) {
            throw new Error('Invalid snapshot time format. Use: YYYY-MM-DD HH:MM:SS');
        }
        
        console.log(`${colors.cyan}=== MULTI-PIVOT SNAPSHOT ANALYZER ===${colors.reset}`);
        console.log(`${colors.yellow}Target Time: ${new Date(this.snapshotTime).toLocaleString()}${colors.reset}`);
        console.log(`${colors.yellow}Target Time (24h): ${new Date(this.snapshotTime).toLocaleString('en-GB', { hour12: false })}${colors.reset}`);
        console.log(`${colors.yellow}Symbol: ${symbol}${colors.reset}`);
        console.log(`${colors.cyan}${'='.repeat(60)}${colors.reset}\n`);
    }

    async initialize() {
        console.log(`${colors.cyan}Loading historical data up to snapshot time...${colors.reset}`);
        
        // Load all timeframe data
        await this.loadAllTimeframeData();
        
        // Initialize pivot tracking
        for (const tf of multiPivotConfig.timeframes) {
            this.timeframePivots.set(tf.interval, []);
            this.lastPivots.set(tf.interval, { type: null, price: null, time: null, index: 0 });
        }
        
        console.log(`${colors.green}✅ Data loaded successfully${colors.reset}\n`);
    }

    async loadAllTimeframeData() {
        const dataSourceType = useLocalData ? 'CSV FILES' : `${api.toUpperCase()} API`;
        console.log(`${colors.cyan}Loading data from ${dataSourceType}...${colors.reset}`);
        
        // Calculate time window based on length parameter
        const windowStart = this.snapshotTime - (SNAPSHOT_CONFIG.length * 60 * 1000);
        
        for (const tf of multiPivotConfig.timeframes) {
            let candles = [];
            
            if (useLocalData) {
                // Load directly from CSV with time filtering
                candles = await this.loadTimeframeFromCSV(tf.interval, windowStart, this.snapshotTime);
            } else {
                // Use API loading (fallback to detector for API)
                const detector = new MultiTimeframePivotDetector(symbol, multiPivotConfig);
                await detector.loadTimeframeData(tf, false);
                candles = detector.timeframeData.get(tf.interval) || [];
                // Filter to time window and snapshot time
                candles = candles.filter(candle => candle.time >= windowStart && candle.time <= this.snapshotTime);
            }
            
            this.timeframeCandles.set(tf.interval, candles);
            
            const sourceIndicator = useLocalData ? 'CSV' : 'API';
            const windowInfo = `${SNAPSHOT_CONFIG.length}min window`;
            console.log(`${colors.yellow}[${tf.interval.padEnd(4)}] Loaded ${candles.length.toString().padStart(4)} candles from ${sourceIndicator} (${windowInfo})${colors.reset}`);
        }
    }
    
    async loadTimeframeFromCSV(interval, startTime, endTime) {
        const csvPath = path.join(process.cwd(), 'data', 'historical', symbol, `${interval}.csv`);
        
        if (!fs.existsSync(csvPath)) {
            console.warn(`${colors.yellow}[${interval}] CSV file not found: ${csvPath}${colors.reset}`);
            return [];
        }
        
        const fileContent = fs.readFileSync(csvPath, 'utf8');
        const lines = fileContent
            .split('\n')
            .map(line => line.trim())
            .filter(line => line && line !== 'timestamp,open,high,low,close,volume');
        
        const candles = [];
        
        // Process lines and filter by time window
        for (const line of lines) {
            const [time, open, high, low, close, volume] = line.split(',');
            const candleTime = parseInt(time);
            
            // Skip invalid data
            if (isNaN(candleTime) || isNaN(parseFloat(open))) continue;
            
            // Only include candles within our time window
            if (candleTime >= startTime && candleTime <= endTime) {
                candles.push({
                    time: candleTime,
                    open: parseFloat(open),
                    high: parseFloat(high),
                    low: parseFloat(low),
                    close: parseFloat(close),
                    volume: parseFloat(volume || '0')
                });
            }
        }
        
        // Sort chronologically
        candles.sort((a, b) => a.time - b.time);
        
        return candles;
    }

    analyzeSnapshot() {
        console.log(`${colors.cyan}=== ANALYZING SNAPSHOT STATE ===${colors.reset}\n`);
        
        // Step 1: Process all pivots chronologically up to snapshot time
        this.processHistoricalPivots();
        
        // Step 2: Simulate cascade windows up to snapshot time
        this.simulateCascadeWindows();
        
        // Step 3: Display comprehensive analysis
        this.displaySnapshotAnalysis();
    }

    processHistoricalPivots() {
        console.log(`${colors.cyan}Processing pivot history up to snapshot time...${colors.reset}`);
        
        // Calculate window from snapshot time based on configured length
        const windowStart = this.snapshotTime - (SNAPSHOT_CONFIG.length * 60 * 1000); // length minutes before snapshot
        
        // Process pivots for each timeframe
        for (const tf of multiPivotConfig.timeframes) {
            const candles = this.timeframeCandles.get(tf.interval) || [];
            const pivots = [];
            
            // Detect all pivots up to snapshot time
            for (let i = tf.lookback; i < candles.length; i++) {
                const candle = candles[i];
                if (candle.time > this.snapshotTime) break; // Stop at snapshot time
                
                const pivot = this.detectPivotAtCandle(candles, i, tf);
                if (pivot) {
                    // Only include pivots within the configured window (unless toggles require more)
                    const includeAllPivots = SNAPSHOT_CONFIG.togglePivots || SNAPSHOT_CONFIG.toggleCascades;
                    if (includeAllPivots || pivot.time >= windowStart) {
                        pivots.push(pivot);
                    }
                }
            }
            
            this.timeframePivots.set(tf.interval, pivots);
            const windowInfo = SNAPSHOT_CONFIG.togglePivots || SNAPSHOT_CONFIG.toggleCascades ? 'all historical' : `${SNAPSHOT_CONFIG.length}min window`;
            console.log(`${colors.yellow}[${tf.interval.padEnd(4)}] Found ${pivots.length.toString().padStart(3)} pivots (${windowInfo})${colors.reset}`);
        }
        
        console.log(`${colors.green}✅ Pivot processing complete${colors.reset}\n`);
    }

    simulateCascadeWindows() {
        console.log(`${colors.cyan}Simulating cascade windows up to snapshot time...${colors.reset}`);
        
        // Get all pivots from all timeframes and sort by time
        const allPivots = [];
        for (const [timeframe, pivots] of this.timeframePivots) {
            for (const pivot of pivots) {
                allPivots.push({ ...pivot, timeframe });
            }
        }
        
        // Sort chronologically
        allPivots.sort((a, b) => a.time - b.time);
        
        // Process pivots chronologically to build cascade windows
        for (const pivot of allPivots) {
            if (pivot.time > this.snapshotTime) break;
            
            const tf = multiPivotConfig.timeframes.find(t => t.interval === pivot.timeframe);
            if (!tf) continue;
            
            if (tf.role === 'primary') {
                this.openPrimaryWindow(pivot, pivot.time);
            } else {
                this.checkWindowConfirmations(pivot, tf, pivot.time);
            }
            
            // Check for expired windows at this time
            this.checkExpiredWindows(pivot.time);
        }
        
        // Final check for expired windows at snapshot time
        this.checkExpiredWindows(this.snapshotTime);
        
        console.log(`${colors.green}✅ Cascade simulation complete${colors.reset}\n`);
    }

    openPrimaryWindow(primaryPivot, currentTime) {
        this.windowCounter++;
        const windowId = `W${this.windowCounter}`;
        const confirmationWindow = multiPivotConfig.cascadeSettings.confirmationWindow[primaryPivot.timeframe] || 60;
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
    }

    checkWindowConfirmations(pivot, timeframe, currentTime) {
        for (const [windowId, window] of this.activeWindows) {
            if (window.status !== 'active') continue;
            if (window.primaryPivot.signal !== pivot.signal) continue;
            if (pivot.time < window.primaryPivot.time) continue;
            if (currentTime > window.windowEndTime) {
                window.status = 'expired';
                continue;
            }
            
            // Check if this timeframe already confirmed
            const alreadyConfirmed = window.confirmations.some(c => c.timeframe === timeframe.interval);
            if (alreadyConfirmed) continue;
            
            // Add confirmation
            window.confirmations.push({
                timeframe: timeframe.interval,
                pivot,
                confirmTime: pivot.time
            });
            
            // Check if ready for execution
            const minRequiredTFs = multiPivotConfig.cascadeSettings.minTimeframesRequired || 3;
            const totalConfirmed = 1 + window.confirmations.length;
            
            if (totalConfirmed >= minRequiredTFs && window.status !== 'executed') {
                const canExecute = this.checkHierarchicalExecution(window);
                if (canExecute) {
                    this.executeWindow(window, currentTime);
                }
            }
        }
    }

    checkHierarchicalExecution(window) {
        const confirmedTimeframes = [window.primaryPivot.timeframe, ...window.confirmations.map(c => c.timeframe)];
        const timeframeRoles = new Map();
        multiPivotConfig.timeframes.forEach(tf => {
            timeframeRoles.set(tf.interval, tf.role);
        });
        
        let hasExecution = false;
        let confirmationCount = 0;
        
        for (const tf of confirmedTimeframes) {
            const role = timeframeRoles.get(tf);
            if (role === 'execution') {
                hasExecution = true;
            } else if (role === 'confirmation') {
                confirmationCount++;
            }
        }
        
        const minRequired = multiPivotConfig.cascadeSettings.minTimeframesRequired || 3;
        
        if (hasExecution && confirmationCount === 0) {
            return false; // Door is closed without confirmation
        }
        
        if (confirmedTimeframes.length >= minRequired) {
            if (hasExecution && confirmationCount >= 1) {
                return true;
            }
            
            const totalConfirmationTFs = multiPivotConfig.timeframes.filter(tf => tf.role === 'confirmation').length;
            if (!hasExecution && confirmationCount >= totalConfirmationTFs) {
                return true;
            }
        }
        
        return false;
    }

    executeWindow(window, currentTime) {
        const allConfirmations = [...window.confirmations].sort((a, b) => a.confirmTime - b.confirmTime);
        const minRequiredTFs = multiPivotConfig.cascadeSettings.minTimeframesRequired || 3;
        
        let executionTime = window.primaryPivot.time;
        let executionPrice = window.primaryPivot.price;
        const confirmedTimeframes = new Set([window.primaryPivot.timeframe]);
        
        for (const confirmation of allConfirmations) {
            confirmedTimeframes.add(confirmation.timeframe);
            
            if (confirmedTimeframes.size >= minRequiredTFs) {
                executionTime = confirmation.confirmTime;
                
                // Find execution price from 1-minute candles
                const oneMinuteCandles = this.timeframeCandles.get('1m') || [];
                const executionCandle = oneMinuteCandles.find(c => Math.abs(c.time - executionTime) <= 30000);
                executionPrice = executionCandle ? executionCandle.close : window.primaryPivot.price;
                break;
            }
        }
        
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
        
        this.allCascades.push(cascadeInfo);
        window.status = 'executed';
        window.executionTime = executionTime; // Store execution time for window tracking
    }

    checkExpiredWindows(currentTime) {
        for (const [windowId, window] of this.activeWindows) {
            if (window.status === 'active' && currentTime > window.windowEndTime) {
                window.status = 'expired';
            }
        }
    }

    detectPivotAtCandle(candles, index, timeframe) {
        if (index < timeframe.lookback) return null;
        
        const currentCandle = candles[index];
        const { minSwingPct, minLegBars } = timeframe;
        const swingThreshold = minSwingPct / 100;
        
        const lastPivot = this.lastPivots.get(timeframe.interval) || { type: null, price: null, time: null, index: 0 };
        
        // Check for high pivot (LONG signal - CONTRARIAN)
        let isHighPivot = true;
        for (let j = 1; j <= timeframe.lookback; j++) {
            const compareCandle = candles[index - j];
            const comparePrice = pivotDetectionMode === 'extreme' ? compareCandle.high : compareCandle.close;
            const currentPrice = pivotDetectionMode === 'extreme' ? currentCandle.high : currentCandle.close;
            if (comparePrice >= currentPrice) {
                isHighPivot = false;
                break;
            }
        }
        
        if (isHighPivot) {
            const pivotPrice = pivotDetectionMode === 'extreme' ? currentCandle.high : currentCandle.close;
            const swingPct = lastPivot.price ? (pivotPrice - lastPivot.price) / lastPivot.price : 0;
            const isFirstPivot = lastPivot.type === null;
            
            if ((isFirstPivot || Math.abs(swingPct) >= swingThreshold) && (index - lastPivot.index) >= minLegBars) {
                const pivot = {
                    time: currentCandle.time,
                    price: pivotPrice,
                    signal: 'long',
                    type: 'high',
                    timeframe: timeframe.interval,
                    index: index,
                    swingPct: swingPct * 100
                };
                
                this.lastPivots.set(timeframe.interval, pivot);
                return pivot;
            }
        }
        
        // Check for low pivot (SHORT signal - CONTRARIAN)
        let isLowPivot = true;
        for (let j = 1; j <= timeframe.lookback; j++) {
            const compareCandle = candles[index - j];
            const comparePrice = pivotDetectionMode === 'extreme' ? compareCandle.low : compareCandle.close;
            const currentPrice = pivotDetectionMode === 'extreme' ? currentCandle.low : currentCandle.close;
            if (comparePrice <= currentPrice) {
                isLowPivot = false;
                break;
            }
        }
        
        if (isLowPivot) {
            const pivotPrice = pivotDetectionMode === 'extreme' ? currentCandle.low : currentCandle.close;
            const swingPct = lastPivot.price ? (pivotPrice - lastPivot.price) / lastPivot.price : 0;
            const isFirstPivot = lastPivot.type === null;
            
            if ((isFirstPivot || Math.abs(swingPct) >= swingThreshold) && (index - lastPivot.index) >= minLegBars) {
                const pivot = {
                    time: currentCandle.time,
                    price: pivotPrice,
                    signal: 'short',
                    type: 'low',
                    timeframe: timeframe.interval,
                    index: index,
                    swingPct: swingPct * 100
                };
                
                this.lastPivots.set(timeframe.interval, pivot);
                return pivot;
            }
        }
        
        return null;
    }

    displaySnapshotAnalysis() {
        console.log(`${colors.cyan}=== SNAPSHOT ANALYSIS RESULTS ===${colors.reset}\n`);
        
        // Display recent pivot history (if enabled)
        if (SNAPSHOT_CONFIG.togglePivots) {
            this.displayRecentPivotHistory();
        }
        
        // Display active windows (always shown)
        this.displayActiveWindows();
        
        // Display completed cascades (if enabled)
        if (SNAPSHOT_CONFIG.toggleCascades) {
            this.displayCompletedCascades();
        }
        
        // Display summary statistics (always shown)
        this.displaySummaryStatistics();
    }

    displayRecentPivotHistory() {
        const showCount = SNAPSHOT_CONFIG.showRecentPivots || 5;
        console.log(`${colors.magenta}┌─ Recent Pivot History (Last ${showCount} per timeframe) ${'─'.repeat(20)}${colors.reset}`);
        
        for (const tf of multiPivotConfig.timeframes) {
            const pivots = this.timeframePivots.get(tf.interval) || [];
            const recentPivots = pivots.slice(-showCount); // Last N pivots
            
            console.log(`${colors.magenta}│${colors.reset}`);
            console.log(`${colors.magenta}│${colors.reset} ${colors.cyan}${tf.interval.toUpperCase()} (${tf.role}) - ${recentPivots.length} recent pivots:${colors.reset}`);
            
            if (recentPivots.length === 0) {
                console.log(`${colors.magenta}│${colors.reset}   ${colors.dim}No pivots found${colors.reset}`);
            } else {
                recentPivots.forEach((pivot, index) => {
                    const timeStr = new Date(pivot.time).toLocaleString();
                    const time24 = new Date(pivot.time).toLocaleTimeString('en-GB', { hour12: false });
                    const ageFormatted = formatTimeDifference(this.snapshotTime - pivot.time);
                    const signalColor = pivot.signal === 'long' ? colors.green : colors.red;
                    const swingStr = pivot.swingPct ? ` (${pivot.swingPct.toFixed(2)}%)` : '';
                    
                    console.log(`${colors.magenta}│${colors.reset}   ${signalColor}${pivot.signal.toUpperCase().padEnd(5)}${colors.reset} | $${pivot.price.toFixed(1).padStart(8)} | ${timeStr} (${time24}) | ${ageFormatted} ago${swingStr}`);
                });
            }
        }
        
        console.log(`${colors.magenta}└${'─'.repeat(70)}${colors.reset}\n`);
    }

    displayActiveWindows() {
        const activeWindows = Array.from(this.activeWindows.values()).filter(w => 
            w.status === 'active' && this.snapshotTime <= w.windowEndTime
        );
        
        // Also get recently executed windows (within 5 minutes of snapshot time)
        const recentlyExecutedWindows = Array.from(this.activeWindows.values()).filter(w => 
            w.status === 'executed' && Math.abs(this.snapshotTime - w.executionTime) <= 5 * 60 * 1000
        );
        
        console.log(`${colors.brightYellow}┌─ Cascade Windows at Snapshot Time ${'─'.repeat(25)}${colors.reset}`);
        
        // Show active windows first
        if (activeWindows.length > 0) {
            console.log(`${colors.brightYellow}│${colors.reset} ${colors.bold}ACTIVE WINDOWS:${colors.reset}`);
            this.displayWindowDetails(activeWindows, 'active');
        }
        
        // Show recently executed windows
        if (recentlyExecutedWindows.length > 0) {
            if (activeWindows.length > 0) {
                console.log(`${colors.brightYellow}│${colors.reset}`);
            }
            console.log(`${colors.brightYellow}│${colors.reset} ${colors.bold}RECENTLY EXECUTED WINDOWS (±5min):${colors.reset}`);
            this.displayWindowDetails(recentlyExecutedWindows, 'executed');
        }
        
        if (activeWindows.length === 0 && recentlyExecutedWindows.length === 0) {
            console.log(`${colors.brightYellow}│${colors.reset} ${colors.dim}No active or recently executed windows at snapshot time${colors.reset}`);
        }

        
        console.log(`${colors.brightYellow}└${'─'.repeat(70)}${colors.reset}\n`);
    }
    
    displayWindowDetails(windows, windowType) {
        windows.forEach(window => {
            const confirmationCount = window.confirmations.length;
            const totalConfirmed = 1 + confirmationCount;
            const minRequired = multiPivotConfig.cascadeSettings.minTimeframesRequired || 3;
            
            const primaryTime = new Date(window.primaryPivot.time).toLocaleString();
            const primaryTime24 = new Date(window.primaryPivot.time).toLocaleTimeString('en-GB', { hour12: false });
            const signalColor = window.primaryPivot.signal === 'long' ? colors.green : colors.red;
            
            console.log(`${colors.brightYellow}│${colors.reset}`);
            
            if (windowType === 'executed') {
                const executionTime = new Date(window.executionTime).toLocaleString();
                const executionTime24 = new Date(window.executionTime).toLocaleTimeString('en-GB', { hour12: false });
                const timeDiff = formatTimeDifference(Math.abs(this.snapshotTime - window.executionTime));
                const timing = window.executionTime <= this.snapshotTime ? 'ago' : 'from now';
                
                console.log(`${colors.brightYellow}│${colors.reset} ${colors.bold}Window ${window.id}: ${window.primaryPivot.timeframe} ${signalColor}${window.primaryPivot.signal.toUpperCase()}${colors.reset} ${colors.bold}pivot ${colors.brightGreen}[EXECUTED]${colors.reset}`);
                console.log(`${colors.brightYellow}│${colors.reset}   Primary: ${primaryTime} (${primaryTime24}) @ $${window.primaryPivot.price.toFixed(1)}`);
                console.log(`${colors.brightYellow}│${colors.reset}   Executed: ${executionTime} (${executionTime24}) | ${timeDiff} ${timing}`);
                console.log(`${colors.brightYellow}│${colors.reset}   Final Status: ${totalConfirmed}/${minRequired} confirmations → ${colors.brightGreen}EXECUTED${colors.reset}`);
            } else {
                const timeRemainingMs = window.windowEndTime - this.snapshotTime;
                const timeRemainingFormatted = formatTimeDifference(timeRemainingMs);
                
                console.log(`${colors.brightYellow}│${colors.reset} ${colors.bold}Window ${window.id}: ${window.primaryPivot.timeframe} ${signalColor}${window.primaryPivot.signal.toUpperCase()}${colors.reset} ${colors.bold}pivot ${colors.yellow}[ACTIVE]${colors.reset}`);
                console.log(`${colors.brightYellow}│${colors.reset}   Primary: ${primaryTime} (${primaryTime24}) @ $${window.primaryPivot.price.toFixed(1)}`);
                console.log(`${colors.brightYellow}│${colors.reset}   Status: ${totalConfirmed}/${minRequired} confirmations | ${timeRemainingFormatted} remaining`);
            }
            
            if (window.confirmations.length > 0) {
                console.log(`${colors.brightYellow}│${colors.reset}   Confirmations:`);
                window.confirmations.forEach(conf => {
                    const confTime = new Date(conf.confirmTime).toLocaleString();
                    const confTime24 = new Date(conf.confirmTime).toLocaleTimeString('en-GB', { hour12: false });
                    const timeAfterFormatted = formatTimeDifference(conf.confirmTime - window.primaryPivot.time);
                    console.log(`${colors.brightYellow}│${colors.reset}     • ${conf.timeframe}: ${confTime} (${confTime24}) @ $${conf.pivot.price.toFixed(1)} (+${timeAfterFormatted})`);
                });
            }
            
            if (windowType === 'active') {
                // Check execution readiness for active windows
                const canExecute = this.checkHierarchicalExecution(window);
                if (canExecute) {
                    console.log(`${colors.brightYellow}│${colors.reset}   ${colors.brightGreen}✅ READY FOR EXECUTION${colors.reset}`);
                } else {
                    const confirmedTFs = [window.primaryPivot.timeframe, ...window.confirmations.map(c => c.timeframe)];
                    const roles = confirmedTFs.map(tf => {
                        const role = multiPivotConfig.timeframes.find(t => t.interval === tf)?.role || 'unknown';
                        return `${tf}(${role})`;
                    });
                    console.log(`${colors.brightYellow}│${colors.reset}   ${colors.yellow}⏳ WAITING: ${roles.join(' + ')}${colors.reset}`);
                }
            }
        });
    }

    displayCompletedCascades() {
        console.log(`${colors.brightGreen}┌─ Completed Cascades (Last 10) ${'─'.repeat(30)}${colors.reset}`);
        
        if (this.allCascades.length === 0) {
            console.log(`${colors.brightGreen}│${colors.reset} ${colors.dim}No completed cascades found${colors.reset}`);
        } else {
            const showCount = SNAPSHOT_CONFIG.showRecentCascades || 10;
            const recentCascades = this.allCascades.slice(-showCount); // Last N cascades
            
            recentCascades.forEach(cascade => {
                const { id, primaryPivot, cascadeResult } = cascade;
                const executionDate = new Date(cascadeResult.executionTime);
                const dateStr = executionDate.toLocaleDateString('en-US', { 
                    weekday: 'short', 
                    month: 'short', 
                    day: 'numeric' 
                });
                const time = executionDate.toLocaleTimeString();
                const time24 = executionDate.toLocaleTimeString('en-GB', { hour12: false });
                const signal = primaryPivot.signal.toUpperCase();
                const strength = (cascadeResult.strength * 100).toFixed(0);
                const price = cascadeResult.executionPrice.toFixed(1);
                const signalColor = signal === 'LONG' ? colors.green : colors.red;
                const ageFormatted = formatTimeDifference(this.snapshotTime - cascadeResult.executionTime);
                
                console.log(`${colors.brightGreen}│${colors.reset} ${colors.yellow}[${id.toString().padStart(3)}]${colors.reset} ${dateStr} ${time.padEnd(11)} (${time24}) | ${signalColor}${signal.padEnd(5)}${colors.reset} | ${strength.padStart(2)}% | $${price} | ${ageFormatted} ago`);
            });
        }
        
        console.log(`${colors.brightGreen}└${'─'.repeat(70)}${colors.reset}\n`);
    }

    displaySummaryStatistics() {
        console.log(`${colors.cyan}┌─ Snapshot Summary Statistics ${'─'.repeat(30)}${colors.reset}`);
        
        // Count pivots per timeframe
        let totalPivots = 0;
        for (const [timeframe, pivots] of this.timeframePivots) {
            totalPivots += pivots.length;
            console.log(`${colors.cyan}│${colors.reset} ${timeframe.padEnd(4)}: ${pivots.length.toString().padStart(3)} pivots`);
        }
        
        console.log(`${colors.cyan}│${colors.reset}`);
        console.log(`${colors.cyan}│${colors.reset} Total Pivots: ${totalPivots}`);
        console.log(`${colors.cyan}│${colors.reset} Completed Cascades: ${this.allCascades.length}`);
        
        const activeWindows = Array.from(this.activeWindows.values()).filter(w => 
            w.status === 'active' && this.snapshotTime <= w.windowEndTime
        );
        console.log(`${colors.cyan}│${colors.reset} Active Windows: ${activeWindows.length}`);
        
        const expiredWindows = Array.from(this.activeWindows.values()).filter(w => w.status === 'expired');
        console.log(`${colors.cyan}│${colors.reset} Expired Windows: ${expiredWindows.length}`);
        
        // Calculate timespan
        if (this.timeframeCandles.get('1m')?.length > 0) {
            const oneMinCandles = this.timeframeCandles.get('1m');
            const startTime = oneMinCandles[0].time;
            const timespanHours = (this.snapshotTime - startTime) / (1000 * 60 * 60);
            console.log(`${colors.cyan}│${colors.reset} Analysis Timespan: ${timespanHours.toFixed(1)} hours`);
        }
        
        console.log(`${colors.cyan}└${'─'.repeat(70)}${colors.reset}\n`);
    }
}

// Main execution
async function main() {
    // Use snapshot time from config
    const snapshotTimeArg = SNAPSHOT_CONFIG.targetTime;
    
    if (!snapshotTimeArg) {
        console.log(`${colors.red}❌ Error: No snapshot time configured${colors.reset}`);
        console.log(`${colors.yellow}Please set SNAPSHOT_CONFIG.targetTime at the top of this file${colors.reset}`);
        console.log(`${colors.yellow}Format: "YYYY-MM-DD HH:MM:SS"${colors.reset}`);
        console.log(`${colors.yellow}Example: "2025-08-09 15:30:00"${colors.reset}`);
        process.exit(1);
    }
    
    try {
        console.log(`${colors.cyan}Using configured snapshot time: ${colors.brightYellow}${snapshotTimeArg}${colors.reset}\n`);
        
        const analyzer = new MultiPivotSnapshotAnalyzer(snapshotTimeArg);
        await analyzer.initialize();
        analyzer.analyzeSnapshot();
        
        console.log(`${colors.green}✅ Snapshot analysis complete!${colors.reset}`);
        
    } catch (error) {
        console.error(`${colors.red}❌ Error:${colors.reset}`, error.message);
        process.exit(1);
    }
}

main().catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
});
