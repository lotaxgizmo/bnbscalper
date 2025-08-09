import { getCandles } from './apis/bybit.js';
import { symbol, pivotDetectionMode } from './config/config.js';
import { multiPivotConfig } from './config/multiPivotConfig.js';
import fs from 'fs';
import path from 'path';

// Scanner Configuration
const scannerConfig = {
    useHistoricalMode: true,        // true = CSV data, false = live API
    historicalSettings: {
        minutesBack: 1458,           // How many 1m candles back from CSV end (24 hours)
        // minutesBack: 39698,           // How many 1m candles back from CSV end (24 hours)
        simulateRealTime: true,      // Simulate as if it's happening "now"
        showActualTimestamp: true   // Show real historical time vs simulated
    },
    displaySettings: {
        useHumanReadableTime: true,  // If true, shows time as "2d 5h 30m" instead of "3050min ago"
        showTimeFormats: true       // If true, shows both 12h and 24h time formats
    }
};

// Enhanced colors for console output
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
    brightRed: '\x1b[91m',
    bold: '\x1b[1m',
    dim: '\x1b[2m'
};

class LivePivotScanner {
    constructor() {
        this.timeframeCandles = new Map(); // Raw candle data for each timeframe
        this.timeframePivots = new Map();  // Discovered pivots for each timeframe
        this.lastPivots = new Map();       // Track last pivot per timeframe for swing filtering
        this.activeWindows = new Map();    // Track active cascade windows
        this.windowCounter = 0;            // Counter for window IDs
        this.currentTime = Date.now();     // Current snapshot time
    }
    
    // Format time difference in a human-readable way
    formatTimeDifference(milliseconds) {
        // If human-readable time is disabled, just return minutes
        if (!scannerConfig.displaySettings?.useHumanReadableTime) {
            return `${Math.round(milliseconds / (60 * 1000))}min ago`;
        }
        
        const seconds = Math.floor(milliseconds / 1000);
        
        if (seconds < 60) {
            return `${seconds}s ago`;
        }
        
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) {
            return `${minutes}m ago`;
        }
        
        const hours = Math.floor(minutes / 60);
        if (hours < 24) {
            const remainingMinutes = minutes % 60;
            return remainingMinutes > 0 ? 
                `${hours}h ${remainingMinutes}m ago` : 
                `${hours}h ago`;
        }
        
        const days = Math.floor(hours / 24);
        const remainingHours = hours % 24;
        
        if (remainingHours === 0) {
            return `${days}d ago`;
        }
        
        return `${days}d ${remainingHours}h ago`;
    }

    async scanMarket() {
        console.log(`${colors.cyan}=== LIVE PIVOT SCANNER ===${colors.reset}`);
        console.log(`${colors.yellow}Symbol: ${symbol}${colors.reset}`);
        console.log(`${colors.yellow}Snapshot Time: ${new Date(this.currentTime).toLocaleString()}${colors.reset}`);
        console.log(`${colors.yellow}Detection Mode: ${pivotDetectionMode}${colors.reset}`);
        console.log(`${'='.repeat(60)}\n`);

        try {
            // Step 1: Load sufficient candle data for all timeframes
            await this.loadTimeframeData();
            
            // Step 2: Initialize pivot tracking
            this.initializePivotTracking();
            
            // Step 3: Detect current pivots
            await this.detectCurrentPivots();
            
            // Step 4: Analyze cascade opportunities
            this.analyzeCascadeOpportunities();
            
            console.log(`\n${colors.green}🎯 Market Scan Complete!${colors.reset}`);
            
        } catch (error) {
            console.error(`${colors.red}❌ Scan Failed:${colors.reset}`, error.message);
            console.log(`${colors.yellow}💡 Check your internet connection and API configuration${colors.reset}`);
        }
    }

    async loadTimeframeData() {
        const dataSource = scannerConfig.useHistoricalMode ? 'CSV historical data' : 'live API data';
        console.log(`${colors.cyan}📊 Loading candle data for pivot analysis (${dataSource})...${colors.reset}`);
        
        if (scannerConfig.useHistoricalMode) {
            await this.loadHistoricalData();
        } else {
            await this.loadLiveData();
        }
        
        console.log('');
    }

    async loadLiveData() {
        for (const tf of multiPivotConfig.timeframes) {
            // Calculate required candles: lookback + buffer for analysis
            const requiredCandles = tf.lookback + 20; // Extra buffer for reliable detection
            
            console.log(`${colors.yellow}[${tf.interval}] Loading ${requiredCandles} candles (lookback: ${tf.lookback})...${colors.reset}`);
            
            try {
                // Force API usage for live data (forceLocal = false)
                const candles = await getCandles(symbol, tf.interval, requiredCandles, null, false);
                
                if (candles && candles.length > 0) {
                    this.timeframeCandles.set(tf.interval, candles);
                    
                    const last = candles[candles.length - 1];
                    const lastCandleAge = Math.round((this.currentTime - last.time) / (60 * 1000));
                    
                    console.log(`${colors.green}[${tf.interval.padEnd(4)}] ✅ Loaded ${candles.length.toString().padStart(3)} candles | Latest: $${last.close.toFixed(1)} (${lastCandleAge}min ago)${colors.reset}`);
                } else {
                    console.log(`${colors.red}[${tf.interval.padEnd(4)}] ❌ No candles received${colors.reset}`);
                    this.timeframeCandles.set(tf.interval, []);
                }
            } catch (error) {
                console.error(`${colors.red}[${tf.interval}] Error loading candles:${colors.reset}`, error.message);
                this.timeframeCandles.set(tf.interval, []);
            }
        }
    }

    async loadHistoricalData() {
        // Load 1m CSV data first
        const oneMinCandles = this.loadCsvData('1m');
        if (oneMinCandles.length === 0) {
            console.log(`${colors.red}❌ No 1m CSV data found${colors.reset}`);
            return;
        }

        // Calculate the simulated current time (minutesBack from the last candle)
        const lastCandle = oneMinCandles[oneMinCandles.length - 1];
        const simulatedCurrentTime = lastCandle.time - (scannerConfig.historicalSettings.minutesBack * 60 * 1000);
        this.currentTime = simulatedCurrentTime;

        console.log(`${colors.yellow}📅 Simulating scanner at: ${new Date(simulatedCurrentTime).toLocaleString()}${colors.reset}`);
        console.log(`${colors.yellow}📅 (${scannerConfig.historicalSettings.minutesBack} minutes back from CSV end: ${new Date(lastCandle.time).toLocaleString()})${colors.reset}`);

        // Filter 1m candles up to simulated current time
        const filteredOneMin = oneMinCandles.filter(c => c.time <= simulatedCurrentTime);
        
        // Calculate how many 1m candles we need to ensure sufficient higher timeframe candles
        const maxTimeframeLookback = Math.max(...multiPivotConfig.timeframes.map(tf => tf.lookback + 20));
        
        // Find the largest timeframe and calculate required 1m candles
        let maxIntervalMinutes = 1;
        let maxRequiredCandles = 24;
        
        for (const tf of multiPivotConfig.timeframes) {
            const intervalMinutes = this.parseIntervalToMinutes(tf.interval);
            const requiredCandles = tf.lookback + 20;
            
            if (intervalMinutes > maxIntervalMinutes) {
                maxIntervalMinutes = intervalMinutes;
                maxRequiredCandles = requiredCandles;
            }
        }
        
        // For the largest timeframe, we need at least maxRequiredCandles * intervalMinutes of 1m data
        const requiredOneMinForLargest = maxRequiredCandles * maxIntervalMinutes;
        const requiredOneMin = Math.max(requiredOneMinForLargest, maxTimeframeLookback * 60, 2000);
        
        const largestInterval = multiPivotConfig.timeframes.find(tf => this.parseIntervalToMinutes(tf.interval) === maxIntervalMinutes)?.interval || '1h';
        console.log(`${colors.dim}📊 Taking ${requiredOneMin} 1m candles to ensure ${maxRequiredCandles} ${largestInterval} candles${colors.reset}`);
        
        const oneMinForAnalysis = filteredOneMin.slice(-requiredOneMin);
        
        // Process each timeframe
        for (const tf of multiPivotConfig.timeframes) {
            const requiredCandles = tf.lookback + 20;
            
            let candles = [];
            if (tf.interval === '1m') {
                candles = oneMinForAnalysis;
            } else {
                // Dynamic aggregation based on interval
                const intervalMinutes = this.parseIntervalToMinutes(tf.interval);
                candles = this.aggregateCandles(oneMinForAnalysis, intervalMinutes);
                console.log(`${colors.dim}  → Aggregated ${oneMinForAnalysis.length} 1m candles to ${candles.length} ${tf.interval} candles${colors.reset}`);
            }
            
            // Take only the required number of candles
            const finalCandles = candles.slice(-requiredCandles);
            this.timeframeCandles.set(tf.interval, finalCandles);
            
            if (finalCandles.length > 0) {
                const last = finalCandles[finalCandles.length - 1];
                const lastCandleAge = Math.round((this.currentTime - last.time) / (60 * 1000));
                
                console.log(`${colors.green}[${tf.interval.padEnd(4)}] ✅ Loaded ${finalCandles.length.toString().padStart(3)} candles | Latest: $${last.close.toFixed(1)} (${lastCandleAge}min ago)${colors.reset}`);
            } else {
                console.log(`${colors.red}[${tf.interval.padEnd(4)}] ❌ No historical candles available${colors.reset}`);
            }
        }
    }

    loadCsvData(interval) {
        const csvPath = path.join(process.cwd(), 'data', 'historical', symbol, `${interval}.csv`);
        
        if (!fs.existsSync(csvPath)) {
            console.log(`${colors.red}❌ CSV file not found: ${csvPath}${colors.reset}`);
            return [];
        }
        
        try {
            const fileContent = fs.readFileSync(csvPath, 'utf8');
            const lines = fileContent
                .split('\n')
                .map(line => line.trim())
                .filter(line => line && line !== 'timestamp,open,high,low,close,volume');
            
            const candles = [];
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
            
            return candles.sort((a, b) => a.time - b.time);
        } catch (error) {
            console.error(`${colors.red}Error loading CSV ${csvPath}:${colors.reset}`, error.message);
            return [];
        }
    }

    aggregateCandles(oneMinCandles, intervalMinutes) {
        const aggregated = [];
        const intervalMs = intervalMinutes * 60 * 1000;
        
        for (let i = 0; i < oneMinCandles.length; i++) {
            const candle = oneMinCandles[i];
            const intervalStart = Math.floor(candle.time / intervalMs) * intervalMs;
            
            // Find existing aggregated candle for this interval or create new one
            let aggCandle = aggregated.find(c => c.time === intervalStart);
            if (!aggCandle) {
                aggCandle = {
                    time: intervalStart,
                    open: candle.open,
                    high: candle.high,
                    low: candle.low,
                    close: candle.close,
                    volume: candle.volume
                };
                aggregated.push(aggCandle);
            } else {
                // Update high, low, close, volume
                aggCandle.high = Math.max(aggCandle.high, candle.high);
                aggCandle.low = Math.min(aggCandle.low, candle.low);
                aggCandle.close = candle.close; // Last close in the interval
                aggCandle.volume += candle.volume;
            }
        }
        
        return aggregated.sort((a, b) => a.time - b.time);
    }

    parseIntervalToMinutes(interval) {
        const match = interval.match(/(\d+)([mhd])/);
        if (!match) {
            console.log(`${colors.red}❌ Unknown interval format: ${interval}${colors.reset}`);
            return 1; // Default to 1 minute
        }
        
        const [, number, unit] = match;
        const num = parseInt(number);
        
        switch (unit) {
            case 'm': return num;           // minutes
            case 'h': return num * 60;      // hours to minutes
            case 'd': return num * 60 * 24; // days to minutes
            default: return 1;
        }
    }

    initializePivotTracking() {
        for (const tf of multiPivotConfig.timeframes) {
            this.timeframePivots.set(tf.interval, []);
            this.lastPivots.set(tf.interval, { type: null, price: null, time: null, index: 0 });
        }
    }

    async detectCurrentPivots() {
        console.log(`${colors.cyan}🎯 Analyzing current pivot formations...${colors.reset}`);
        
        let totalPivotsFound = 0;
        
        for (const tf of multiPivotConfig.timeframes) {
            const candles = this.timeframeCandles.get(tf.interval) || [];
            if (candles.length < tf.lookback + 5) {
                console.log(`${colors.red}[${tf.interval}] ❌ Insufficient candles for analysis (need ${tf.lookback + 5}, have ${candles.length})${colors.reset}`);
                continue;
            }
            
            // Analyze recent candles for pivots (last 10 candles)
            const startIndex = Math.max(tf.lookback, candles.length - 10);
            let pivotsFound = 0;
            
            for (let i = startIndex; i < candles.length; i++) {
                const pivot = this.detectPivotAtCandle(candles, i, tf);
                if (pivot) {
                    const pivots = this.timeframePivots.get(tf.interval) || [];
                    pivots.push(pivot);
                    this.timeframePivots.set(tf.interval, pivots);
                    pivotsFound++;
                    totalPivotsFound++;
                }
            }
            
            const pivots = this.timeframePivots.get(tf.interval) || [];
            const latestPivot = pivots.length > 0 ? pivots[pivots.length - 1] : null;
            
            if (latestPivot) {
                const pivotAgeMs = this.currentTime - latestPivot.time;
                const pivotAgeMin = Math.round(pivotAgeMs / (60 * 1000)); // Keep minutes for window status check
                const roleColor = tf.role === 'primary' ? colors.brightYellow : tf.role === 'confirmation' ? colors.brightCyan : colors.white;
                
                // Check window status for all timeframes with hierarchical logic
                let windowStatus = this.getWindowStatus(tf, pivotAgeMin);
                
                // Show cascade-relevant pivot info if different from latest
                let cascadeInfo = this.getCascadeRelevantPivotInfo(tf, pivots);
                
                // Format time in both 12h and 24h formats
                const pivotTime12 = new Date(latestPivot.time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
                const pivotTime24 = new Date(latestPivot.time).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
                
                // Format the time display based on configuration
                const timeDisplay = this.formatTimeDifference(pivotAgeMs);
                
                // Conditionally include time formats based on configuration
                const timeFormats = scannerConfig.displaySettings?.showTimeFormats ? 
                    ` | ${pivotTime12} | ${pivotTime24}` : '';
                
                console.log(`${colors.green}[${tf.interval.padEnd(4)}] ✅ ${pivots.length} pivots | Latest: ${roleColor}${latestPivot.signal.toUpperCase()}${colors.reset} @ $${latestPivot.price.toFixed(1)} (${timeDisplay}${timeFormats}) ${windowStatus}${cascadeInfo}`);
            } else {
                console.log(`${colors.dim}[${tf.interval.padEnd(4)}] ⚪ No recent pivots detected${colors.reset}`);
            }
        }
        
        console.log(`${colors.yellow}\n📈 Total Recent Pivots Found: ${totalPivotsFound}${colors.reset}\n`);
    }

    getWindowStatus(timeframe, pivotAge) {
        if (timeframe.role === 'primary') {
            // Primary timeframes have their own confirmation windows
            const confirmationWindow = multiPivotConfig.cascadeSettings.confirmationWindow[timeframe.interval];
            const isWithinWindow = pivotAge <= confirmationWindow;
            return isWithinWindow ? 
                `${colors.brightGreen}(Within Window)${colors.reset}` : 
                `${colors.red}(Outside Window)${colors.reset}`;
        } else {
            // For confirmation/execution timeframes, check if they can be useful
            // They need a primary timeframe to be within window to be useful
            const primaryTimeframes = multiPivotConfig.timeframes.filter(tf => tf.role === 'primary');
            let hasActivePrimary = false;
            
            for (const primaryTf of primaryTimeframes) {
                const primaryPivots = this.timeframePivots.get(primaryTf.interval) || [];
                if (primaryPivots.length > 0) {
                    const latestPrimary = primaryPivots[primaryPivots.length - 1];
                    const primaryAge = Math.round((this.currentTime - latestPrimary.time) / (60 * 1000));
                    const primaryWindow = multiPivotConfig.cascadeSettings.confirmationWindow[primaryTf.interval];
                    
                    if (primaryAge <= primaryWindow) {
                        hasActivePrimary = true;
                        break;
                    }
                }
            }
            
            // Check signal alignment with active primary signals
            const activePrimarySignals = this.getActivePrimarySignals();
            const pivots = this.timeframePivots.get(timeframe.interval) || [];
            const latestPivot = pivots.length > 0 ? pivots[pivots.length - 1] : null;
            
            // Check if latest pivot aligns with any active primary signal
            const isAligned = latestPivot && activePrimarySignals.includes(latestPivot.signal.toLowerCase());
            
            // For confirmation timeframes
            if (timeframe.role === 'confirmation') {
                if (!hasActivePrimary) {
                    return `${colors.yellow}(Ready, awaiting Primary)${colors.reset}`;
                }
                
                return isAligned ? 
                    `${colors.brightGreen}(Aligned for Cascade)${colors.reset}` : 
                    `${colors.red}(Signal Conflict - ${latestPivot?.signal.toUpperCase() || 'None'} vs Primary)${colors.reset}`;
                    
            } else if (timeframe.role === 'execution') {
                if (!hasActivePrimary) {
                    return `${colors.dim}(Idle, no Active Primary)${colors.reset}`;
                }
                
                if (!isAligned) {
                    return `${colors.red}(Signal Conflict - ${latestPivot?.signal.toUpperCase() || 'None'} vs Primary)${colors.reset}`;
                }
                
                // Check if we have enough aligned timeframes for cascade execution
                const alignedTimeframes = this.countAlignedTimeframes(activePrimarySignals);
                const minRequired = multiPivotConfig.cascadeSettings.minTimeframesRequired || 3;
                
                if (alignedTimeframes < minRequired) {
                    return `${colors.yellow}(Aligned but Insufficient - ${alignedTimeframes}/${minRequired} timeframes)${colors.reset}`;
                }
                
                // For execution timeframes, check if we have immediate execution pivots available
                // Look for immediate execution pivots (0-1 minutes old)
                let hasImmediateExecution = false;
                for (const pivot of pivots) {
                    const pivotAge = Math.round((this.currentTime - pivot.time) / (60 * 1000));
                    if (activePrimarySignals.includes(pivot.signal.toLowerCase()) && pivotAge <= 1) {
                        hasImmediateExecution = true;
                        break;
                    }
                }
                
                return hasImmediateExecution ? 
                    `${colors.brightGreen}(Ready for Execution)${colors.reset}` : 
                    `${colors.red}(Not Ready - No Immediate Signal)${colors.reset}`;
            }
        }
        
        return '';
    }

    getActivePrimarySignals() {
        const primaryTimeframes = multiPivotConfig.timeframes.filter(tf => tf.role === 'primary');
        let activePrimarySignals = [];
        
        for (const primaryTf of primaryTimeframes) {
            const primaryPivots = this.timeframePivots.get(primaryTf.interval) || [];
            if (primaryPivots.length > 0) {
                const latestPrimary = primaryPivots[primaryPivots.length - 1];
                const primaryAge = Math.round((this.currentTime - latestPrimary.time) / (60 * 1000));
                const primaryWindow = multiPivotConfig.cascadeSettings.confirmationWindow[primaryTf.interval];
                
                if (primaryAge <= primaryWindow) {
                    activePrimarySignals.push(latestPrimary.signal.toLowerCase());
                }
            }
        }
        
        return activePrimarySignals;
    }

    countAlignedTimeframes(activePrimarySignals) {
        let alignedCount = 0;
        
        for (const tf of multiPivotConfig.timeframes) {
            const pivots = this.timeframePivots.get(tf.interval) || [];
            if (pivots.length > 0) {
                const latestPivot = pivots[pivots.length - 1];
                
                // For primary timeframes, check if they're within window
                if (tf.role === 'primary') {
                    const pivotAge = Math.round((this.currentTime - latestPivot.time) / (60 * 1000));
                    const confirmationWindow = multiPivotConfig.cascadeSettings.confirmationWindow[tf.interval];
                    
                    if (pivotAge <= confirmationWindow && activePrimarySignals.includes(latestPivot.signal.toLowerCase())) {
                        alignedCount++;
                    }
                } else {
                    // For confirmation/execution timeframes, check signal alignment
                    if (activePrimarySignals.includes(latestPivot.signal.toLowerCase())) {
                        alignedCount++;
                    }
                }
            }
        }
        
        return alignedCount;
    }

    getCascadeRelevantPivotInfo(timeframe, pivots) {
        // For primary timeframes, no additional info needed
        if (timeframe.role === 'primary') {
            return '';
        }
        
        // Use helper method to get active primary signals
        const activePrimarySignals = this.getActivePrimarySignals();
        
        if (activePrimarySignals.length === 0) {
            return '';
        }
        
        // Find the most recent pivot that matches any active primary signal
        const latestPivot = pivots[pivots.length - 1];
        let relevantPivot = null;
        
        // For EXECUTION timeframes (1m), we need IMMEDIATE confirmation (0-1 minutes old)
        if (timeframe.role === 'execution') {
            // Look for pivots that match active primary signals AND are very recent
            for (let i = pivots.length - 1; i >= 0; i--) {
                const pivot = pivots[i];
                const pivotAge = Math.round((this.currentTime - pivot.time) / (60 * 1000));
                
                // For execution, only accept pivots that are 0-1 minutes old for market orders
                if (activePrimarySignals.includes(pivot.signal.toLowerCase()) && pivotAge <= 1) {
                    relevantPivot = pivot;
                    break;
                }
            }
            
            // If no immediate execution pivot found, show warning with historical info
            if (!relevantPivot) {
                // Look for the most recent matching pivot (even if too old) for informational purposes
                let lastMatchingPivot = null;
                let matchingPivotCount = 0;
                
                for (let i = pivots.length - 1; i >= 0; i--) {
                    const pivot = pivots[i];
                    if (activePrimarySignals.includes(pivot.signal.toLowerCase())) {
                        if (!lastMatchingPivot) {
                            lastMatchingPivot = pivot;
                        }
                        matchingPivotCount++;
                    }
                }
                
                if (lastMatchingPivot) {
                    const lastAge = Math.round((this.currentTime - lastMatchingPivot.time) / (60 * 1000));
                    const signalColor = lastMatchingPivot.signal.toLowerCase() === 'long' ? colors.brightGreen : colors.brightRed;
                    const windowInfo = matchingPivotCount === 1 ? 'first window' : `${matchingPivotCount} windows total`;
                    
                    return `\n${colors.dim}                    → ${colors.red}⚠️  No immediate execution pivot (need 0-1min old)${colors.reset}\n${colors.dim}                    → Last available: ${signalColor}${lastMatchingPivot.signal.toUpperCase()}${colors.reset} @ $${lastMatchingPivot.price.toFixed(1)} ${colors.dim}(${lastAge}min ago - ${windowInfo})${colors.reset}`;
                } else {
                    return `\n${colors.dim}                    → ${colors.red}⚠️  No immediate execution pivot (need 0-1min old for market orders)${colors.reset}`;
                }
            }
        } else {
            // For confirmation timeframes, allow older pivots (up to 5 minutes)
            for (let i = pivots.length - 1; i >= 0; i--) {
                const pivot = pivots[i];
                const pivotAge = Math.round((this.currentTime - pivot.time) / (60 * 1000));
                
                if (activePrimarySignals.includes(pivot.signal.toLowerCase()) && pivotAge <= 5) {
                    relevantPivot = pivot;
                    break;
                }
            }
        }
        
        // For execution timeframes, always show window information when we have matching pivots
        if (timeframe.role === 'execution' && activePrimarySignals.length > 0) {
            // Count all matching pivots for window information
            let matchingPivotCount = 0;
            for (let i = pivots.length - 1; i >= 0; i--) {
                const pivot = pivots[i];
                if (activePrimarySignals.includes(pivot.signal.toLowerCase())) {
                    matchingPivotCount++;
                }
            }
            
            if (matchingPivotCount > 0) {
                const windowInfo = matchingPivotCount === 1 ? 'first window' : `${matchingPivotCount} windows total`;
                
                // If we have an immediate execution pivot, show it with window info
                if (relevantPivot && relevantPivot !== latestPivot) {
                    const relevantAge = Math.round((this.currentTime - relevantPivot.time) / (60 * 1000));
                    const signalColor = relevantPivot.signal.toLowerCase() === 'long' ? colors.brightGreen : colors.brightRed;
                    
                    if (relevantAge <= 1) {
                        return `\n${colors.dim}                    → ${colors.brightGreen}🚀 IMMEDIATE EXECUTION: ${signalColor}${relevantPivot.signal.toUpperCase()}${colors.reset} @ $${relevantPivot.price.toFixed(1)} ${colors.brightGreen}(${relevantAge}min ago - ${windowInfo})${colors.reset}`;
                    }
                }
                
                // If the latest pivot is the matching one and it's immediate, show window info
                if (relevantPivot === latestPivot || (!relevantPivot && activePrimarySignals.includes(latestPivot?.signal.toLowerCase()))) {
                    const pivotToCheck = relevantPivot || latestPivot;
                    const pivotAge = Math.round((this.currentTime - pivotToCheck.time) / (60 * 1000));
                    
                    if (pivotAge <= 1) {
                        const signalColor = pivotToCheck.signal.toLowerCase() === 'long' ? colors.brightGreen : colors.brightRed;
                        return `\n${colors.dim}                    → ${colors.brightGreen}🚀 IMMEDIATE EXECUTION: ${signalColor}${pivotToCheck.signal.toUpperCase()}${colors.reset} @ $${pivotToCheck.price.toFixed(1)} ${colors.brightGreen}(${pivotAge}min ago - ${windowInfo})${colors.reset}`;
                    }
                }
            }
        }
        
        // If the latest pivot doesn't match active primaries, show the relevant one (for non-execution timeframes)
        if (relevantPivot && relevantPivot !== latestPivot && timeframe.role !== 'execution') {
            const relevantAge = Math.round((this.currentTime - relevantPivot.time) / (60 * 1000));
            const signalColor = relevantPivot.signal.toLowerCase() === 'long' ? colors.brightGreen : colors.brightRed;
            
            return `\n${colors.dim}                    → Cascade-relevant: ${signalColor}${relevantPivot.signal.toUpperCase()}${colors.reset} @ $${relevantPivot.price.toFixed(1)} ${colors.dim}(${relevantAge}min ago)${colors.reset}`;
        }
        
        return '';
    }

    detectPivotAtCandle(candles, index, timeframe) {
        if (index < timeframe.lookback) return null;
        
        const currentCandle = candles[index];
        const { minSwingPct, minLegBars } = timeframe;
        const swingThreshold = minSwingPct / 100;
        
        // Get last pivot for this timeframe (for swing filtering)
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
            
            // Apply swing filtering (matches backtester logic)
            if ((isFirstPivot || Math.abs(swingPct) >= swingThreshold) && (index - lastPivot.index) >= minLegBars) {
                const pivot = {
                    time: currentCandle.time,
                    price: pivotPrice,
                    signal: 'long',  // INVERTED: High pivot = LONG signal
                    type: 'high',
                    timeframe: timeframe.interval,
                    index: index,
                    swingPct: swingPct * 100,
                    role: timeframe.role
                };
                
                // Update last pivot for this timeframe
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
            
            // Apply swing filtering (matches backtester logic)
            if ((isFirstPivot || Math.abs(swingPct) >= swingThreshold) && (index - lastPivot.index) >= minLegBars) {
                const pivot = {
                    time: currentCandle.time,
                    price: pivotPrice,
                    signal: 'short', // INVERTED: Low pivot = SHORT signal
                    type: 'low',
                    timeframe: timeframe.interval,
                    index: index,
                    swingPct: swingPct * 100,
                    role: timeframe.role
                };
                
                // Update last pivot for this timeframe
                this.lastPivots.set(timeframe.interval, pivot);
                return pivot;
            }
        }
        
        return null;
    }

    analyzeCascadeOpportunities() {
        console.log(`${colors.cyan}🔄 Analyzing cascade opportunities...${colors.reset}`);
        
        // Find primary timeframes
        const primaryTimeframes = multiPivotConfig.timeframes.filter(tf => tf.role === 'primary');
        
        if (primaryTimeframes.length === 0) {
            console.log(`${colors.red}❌ No primary timeframes configured${colors.reset}`);
            return;
        }
        
        let cascadeOpportunities = 0;
        
        for (const primaryTf of primaryTimeframes) {
            const primaryPivots = this.timeframePivots.get(primaryTf.interval) || [];
            
            if (primaryPivots.length === 0) {
                console.log(`${colors.dim}[${primaryTf.interval}] No primary pivots for cascade analysis${colors.reset}`);
                continue;
            }
            
            // Check recent primary pivots (last 3)
            const recentPrimary = primaryPivots.slice(-3);
            
            for (const primaryPivot of recentPrimary) {
                const ageMinutes = (this.currentTime - primaryPivot.time) / (1000 * 60);
                const maxAge = multiPivotConfig.cascadeSettings.confirmationWindow[primaryTf.interval];
                
                // Only analyze pivots within confirmation window
                if (ageMinutes > maxAge || ageMinutes < 0) continue;
                
                const cascadeResult = this.checkCascadeConfirmation(primaryPivot);
                if (cascadeResult) {
                    cascadeOpportunities++;
                    this.displayCascadeOpportunity(primaryPivot, cascadeResult, ageMinutes);
                }
            }
        }
        
        if (cascadeOpportunities === 0) {
            console.log(`${colors.yellow}⚪ No active cascade opportunities detected at this time${colors.reset}`);
            console.log(`${colors.dim}   • Check back in a few minutes for new formations${colors.reset}`);
            console.log(`${colors.dim}   • Primary pivots need confirmation timeframes within window${colors.reset}`);
        } else {
            console.log(`${colors.brightGreen}\n🎯 Found ${cascadeOpportunities} active cascade opportunit${cascadeOpportunities === 1 ? 'y' : 'ies'}!${colors.reset}`);
        }
    }

    checkCascadeConfirmation(primaryPivot) {
        const confirmations = [];
        const confirmationWindow = multiPivotConfig.cascadeSettings.confirmationWindow[primaryPivot.timeframe];
        const windowStart = primaryPivot.time;
        const windowEnd = primaryPivot.time + (confirmationWindow * 60 * 1000);
        
        // Check each confirming timeframe
        for (const tf of multiPivotConfig.timeframes) {
            if (tf.interval === primaryPivot.timeframe) continue; // Skip primary itself
            
            const pivots = this.timeframePivots.get(tf.interval) || [];
            
            // Look for confirming pivots of same signal within time window
            let confirmingPivots = pivots.filter(p => 
                p.signal === primaryPivot.signal &&
                p.time >= windowStart &&
                p.time <= Math.min(windowEnd, this.currentTime) // Don't look into future
            );
            
            // For EXECUTION timeframes (1m), apply stricter timing requirements
            if (tf.role === 'execution') {
                // Only accept execution pivots that are 0-1 minutes old (immediate execution)
                confirmingPivots = confirmingPivots.filter(p => {
                    const pivotAge = (this.currentTime - p.time) / (60 * 1000);
                    return pivotAge <= 1; // Must be within 1 minute for market order execution
                });
            }
            
            // Debug: Show what we're checking (remove this later)
            // if (pivots.length > 0) {
            //     const latestPivot = pivots[pivots.length - 1];
            //     console.log(`${colors.dim}    [${tf.interval}] Latest pivot: ${latestPivot.signal} @ ${new Date(latestPivot.time).toLocaleTimeString()} | Primary: ${primaryPivot.signal} | Match: ${latestPivot.signal === primaryPivot.signal} | Confirming: ${confirmingPivots.length}${colors.reset}`);
            // }
            
            if (confirmingPivots.length > 0) {
                const latest = confirmingPivots[confirmingPivots.length - 1];
                confirmations.push({
                    timeframe: tf.interval,
                    pivot: latest,
                    weight: tf.weight,
                    role: tf.role
                });
            }
        }
        
        // Check if we have enough confirmations
        const totalConfirmed = 1 + confirmations.length; // +1 for primary
        const minRequired = multiPivotConfig.cascadeSettings.minTimeframesRequired || 2;
        
        if (totalConfirmed < minRequired) return null;
        
        // Check hierarchical requirements
        const hasConfirmation = confirmations.some(c => c.role === 'confirmation');
        const hasExecution = confirmations.some(c => c.role === 'execution');
        
        // Apply hierarchical validation if enabled
        const requireHierarchical = multiPivotConfig.cascadeSettings.requireHierarchicalValidation !== false;
        if (requireHierarchical && hasExecution && !hasConfirmation) {
            return null; // Door is closed when hierarchical validation is enabled
        }
        
        // Calculate strength based on total timeframes
        const totalTimeframes = multiPivotConfig.timeframes.length;
        const strength = totalConfirmed / totalTimeframes;
        
        // Find execution details
        const allTimes = [primaryPivot.time, ...confirmations.map(c => c.pivot.time)];
        const executionTime = Math.max(...allTimes);
        const executionPivot = confirmations.find(c => c.pivot.time === executionTime)?.pivot || primaryPivot;
        
        return {
            signal: primaryPivot.signal,
            strength,
            confirmations,
            executionTime,
            executionPrice: executionPivot.price,
            minutesAfterPrimary: Math.round((executionTime - primaryPivot.time) / (1000 * 60)),
            totalConfirmed,
            minRequired,
            hasConfirmation,
            hasExecution
        };
    }

    displayCascadeOpportunity(primaryPivot, cascadeResult, ageMinutes) {
        console.log(`\n${colors.brightGreen}🎯 LIVE CASCADE OPPORTUNITY DETECTED!${colors.reset}`);
        console.log(`${colors.cyan}${'═'.repeat(60)}${colors.reset}`);
        
        // Primary pivot info
        const primaryTime = new Date(primaryPivot.time).toLocaleString();
        const primaryTime24 = new Date(primaryPivot.time).toLocaleTimeString('en-GB', { hour12: false });
        
        console.log(`${colors.yellow}📊 PRIMARY SIGNAL: ${primaryPivot.timeframe.toUpperCase()} ${primaryPivot.signal.toUpperCase()} PIVOT${colors.reset}`);
        console.log(`${colors.cyan}   Time: ${primaryTime} (${primaryTime24})${colors.reset}`);
        console.log(`${colors.cyan}   Price: $${primaryPivot.price.toFixed(1)}${colors.reset}`);
        // Format the age using the human-readable time function
        const pivotAge = this.currentTime - primaryPivot.time;
        const formattedAge = this.formatTimeDifference(pivotAge);
        console.log(`${colors.cyan}   Age: ${formattedAge}${colors.reset}`);
        
        // Cascade strength and confirmations
        const strengthPercent = (cascadeResult.strength * 100).toFixed(0);
        const strengthColor = cascadeResult.strength >= 0.75 ? colors.brightGreen : 
                             cascadeResult.strength >= 0.5 ? colors.yellow : colors.cyan;
        
        console.log(`\n${colors.yellow}⚡ CASCADE ANALYSIS:${colors.reset}`);
        console.log(`${colors.cyan}   Signal Strength: ${strengthColor}${strengthPercent}%${colors.reset} (${cascadeResult.totalConfirmed}/${multiPivotConfig.timeframes.length} timeframes)`);
        console.log(`${colors.cyan}   Confirmations: ${cascadeResult.confirmations.length}/${cascadeResult.minRequired - 1} required${colors.reset}`);
        
        // Hierarchical status
        const hierarchyStatus = [];
        if (cascadeResult.hasConfirmation) hierarchyStatus.push(`${colors.brightCyan}CONFIRMATION✅${colors.reset}`);
        if (cascadeResult.hasExecution) hierarchyStatus.push(`${colors.white}EXECUTION✅${colors.reset}`);
        if (hierarchyStatus.length > 0) {
            console.log(`${colors.cyan}   Hierarchy: ${hierarchyStatus.join(' + ')}${colors.reset}`);
        }
        
        // Execution details
        if (cascadeResult.executionTime !== primaryPivot.time) {
            const executionTime = new Date(cascadeResult.executionTime).toLocaleString();
            const executionTime24 = new Date(cascadeResult.executionTime).toLocaleTimeString('en-GB', { hour12: false });
            console.log(`\n${colors.yellow}🚀 EXECUTION DETAILS:${colors.reset}`);
            console.log(`${colors.cyan}   Execution Time: ${executionTime} (${executionTime24})${colors.reset}`);
            console.log(`${colors.cyan}   Execution Price: $${cascadeResult.executionPrice.toFixed(1)}${colors.reset}`);
            // Format the delay using human-readable time if enabled
            const delayMs = cascadeResult.minutesAfterPrimary * 60 * 1000;
            const formattedDelay = scannerConfig.displaySettings?.useHumanReadableTime ?
                this.formatTimeDifference(delayMs).replace(' ago', '') : // Remove 'ago' suffix
                `${cascadeResult.minutesAfterPrimary} minutes`;
            console.log(`${colors.cyan}   Delay: +${formattedDelay} after primary${colors.reset}`);
        }
        
        // Confirming timeframes breakdown
        if (cascadeResult.confirmations.length > 0) {
            console.log(`\n${colors.yellow}📋 CONFIRMING TIMEFRAMES:${colors.reset}`);
            cascadeResult.confirmations.forEach(conf => {
                const confTime = new Date(conf.pivot.time).toLocaleTimeString();
                const confTime24 = new Date(conf.pivot.time).toLocaleTimeString('en-GB', { hour12: false });
                const roleColor = conf.role === 'confirmation' ? colors.brightCyan : 
                                conf.role === 'execution' ? colors.white : colors.yellow;
                console.log(`${colors.cyan}   • ${conf.timeframe}: ${roleColor}${conf.role.toUpperCase()}${colors.reset} @ $${conf.pivot.price.toFixed(1)} (${confTime} / ${confTime24})`);
            });
        }
        
        // Trading recommendation
        const recommendationColor = cascadeResult.strength >= 0.75 ? colors.brightGreen : colors.yellow;
        const recommendationText = cascadeResult.strength >= 0.75 ? 'STRONG SIGNAL - CONSIDER ENTRY' : 
                                 cascadeResult.strength >= 0.5 ? 'MODERATE SIGNAL - PROCEED WITH CAUTION' : 
                                 'WEAK SIGNAL - WAIT FOR MORE CONFIRMATIONS';
        
        console.log(`\n${recommendationColor}💡 RECOMMENDATION: ${recommendationText}${colors.reset}`);
        console.log(`${colors.cyan}${'═'.repeat(60)}${colors.reset}`);
    }
}

// Main execution function
async function scanLivePivots() {
    const scanner = new LivePivotScanner();
    await scanner.scanMarket();
}

// Run the scanner
scanLivePivots().catch(console.error);
 