// multiPivotBacktesterWithTrades_FronttesterAlgorithm.js
// Complete multi-timeframe pivot backtester that trades confirmed cascades with full trade execution
// MODIFIED: Uses fronttester's cascade confirmation algorithm for quality check comparison

import {
    symbol,
    time as interval,
    useLocalData,
    api,
    pivotDetectionMode
} from './config/config.js';

import { tradeConfig } from './config/tradeconfig.js';
import { multiPivotConfig } from './config/multiPivotConfig.js';
import { MultiTimeframePivotDetector } from './utils/multiTimeframePivotDetector.js';
import { formatNumber } from './utils/formatters.js';
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

// FRONTTESTER CASCADE CONFIRMATION ALGORITHM
const checkFronttesterCascadeConfirmation = (primaryPivot, currentTime, detector) => {
    const confirmations = [];
    let totalWeight = 0;
    
    // Check each confirming timeframe (skip primary)
    for (let i = 1; i < multiPivotConfig.timeframes.length; i++) {
        const tf = multiPivotConfig.timeframes[i];
        const pivots = detector.pivotHistory.get(tf.interval) || [];
        
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
    
    // Find the execution price from 1-minute candles
    const oneMinuteCandles = detector.timeframeData.get('1m') || [];
    const executionCandle = oneMinuteCandles.find(c => Math.abs(c.time - executionTime) <= 30000);
    const executionPrice = executionCandle ? executionCandle.close : primaryPivot.price;
    
    return {
        signal: primaryPivot.signal,
        strength,
        confirmations,
        executionTime,
        executionPrice,
        minutesAfterPrimary: Math.round((executionTime - primaryPivot.time) / (1000 * 60)),
        primaryPivot
    };
};

async function runMultiTimeframeBacktest() {
    console.log(`${colors.cyan}=== MULTI-TIMEFRAME PIVOT BACKTESTER WITH TRADES (FRONTTESTER ALGORITHM) ===${colors.reset}`);
    console.log(`${colors.yellow}Symbol: ${symbol}${colors.reset}`);
    console.log(`${colors.yellow}Detection Mode: ${pivotDetectionMode === 'extreme' ? 'Extreme (High/Low)' : 'Close'}${colors.reset}`);
    console.log(`${colors.yellow}Data Source: ${useLocalData ? 'Local CSV' : 'Live API'}${colors.reset}`);
    console.log(`${colors.brightMagenta}ALGORITHM: Using Fronttester's Cascade Confirmation Logic${colors.reset}\n`);

    // Display trade configuration
    console.log(`${colors.cyan}--- Trade Configuration ---${colors.reset}`);
    let directionDisplay = tradeConfig.direction;
    if (tradeConfig.direction === 'alternate') {
        directionDisplay = 'alternate (LONG at highs, SHORT at lows)';
    }
    console.log(`Direction: ${colors.yellow}${directionDisplay}${colors.reset}`);
    console.log(`Take Profit: ${colors.green}${tradeConfig.takeProfit}%${colors.reset}`);
    console.log(`Stop Loss: ${colors.red}${tradeConfig.stopLoss}%${colors.reset}`);
    console.log(`Leverage: ${colors.yellow}${tradeConfig.leverage}x${colors.reset}`);
    console.log(`Initial Capital: ${colors.yellow}${tradeConfig.initialCapital} USDT${colors.reset}`);

    // Initialize multi-timeframe pivot detection system
    console.log(`\n${colors.cyan}=== INITIALIZING MULTI-TIMEFRAME PIVOT SYSTEM ===${colors.reset}`);
    const detector = new MultiTimeframePivotDetector(symbol, multiPivotConfig);
    
    try {
        await detector.initializeAllTimeframes(useLocalData);
        console.log(`${colors.green}✅ Multi-timeframe system initialized successfully${colors.reset}`);
        
        const totalPivots = multiPivotConfig.timeframes.reduce((sum, tf) => {
            const pivots = detector.pivotHistory.get(tf.interval) || [];
            return sum + pivots.length;
        }, 0);
        
        console.log(`${colors.cyan}Total pivots detected across all timeframes: ${colors.yellow}${totalPivots}${colors.reset}`);
        
        multiPivotConfig.timeframes.forEach(tf => {
            const pivots = detector.pivotHistory.get(tf.interval) || [];
            console.log(`  ${colors.yellow}${tf.interval.padEnd(4)}${colors.reset}: ${colors.green}${pivots.length.toString().padStart(4)}${colors.reset} pivots`);
        });
        
    } catch (error) {
        console.error(`${colors.red}Failed to initialize multi-timeframe system:${colors.reset}`, error);
        process.exit(1);
    }

    // Get 1-minute candles for trade execution
    const oneMinuteCandles = detector.timeframeData.get('1m') || [];
    if (oneMinuteCandles.length === 0) {
        console.error(`${colors.red}No 1-minute candles available for trade execution${colors.reset}`);
        process.exit(1);
    }

    console.log(`${colors.green}Successfully loaded ${oneMinuteCandles.length} 1-minute candles for trade execution${colors.reset}`);

    // Start backtesting with cascade confirmation and trade execution
    console.log(`\n${colors.cyan}=== STARTING MULTI-TIMEFRAME BACKTESTING WITH TRADES ===${colors.reset}`);
    
    let totalSignals = 0;
    let confirmedSignals = 0;
    let cascadeNumber = 0;
    
    // Trade state initialization
    let capital = tradeConfig.initialCapital;
    const trades = [];
    
    // Get all pivots from the primary timeframe
    const primaryTimeframe = multiPivotConfig.timeframes[0];
    const primaryPivots = detector.pivotHistory.get(primaryTimeframe.interval) || [];
    
    console.log(`Processing ${primaryPivots.length} primary signals from ${primaryTimeframe.interval} timeframe`);
    
    // Process each primary pivot for cascade confirmation
    for (let i = 0; i < primaryPivots.length; i++) {
        const primaryPivot = primaryPivots[i];
        totalSignals++;
        
        // Show progress
        const progress = ((i + 1) / primaryPivots.length * 100).toFixed(1);
        console.log(`Progress: ${progress}% (${i + 1}/${primaryPivots.length} primary signals processed)`);
        
        // Use fronttester's cascade confirmation algorithm
        const cascadeResult = checkFronttesterCascadeConfirmation(primaryPivot, primaryPivot.time + (4 * 60 * 60 * 1000), detector);
        
        if (cascadeResult) {
            confirmedSignals++;
            cascadeNumber++;
            
            // Display cascade confirmation
            const primaryTime = new Date(primaryPivot.time).toLocaleString();
            const primaryTime24 = new Date(primaryPivot.time).toLocaleTimeString('en-GB', { hour12: false });
            const executionTime = new Date(cascadeResult.executionTime).toLocaleString();
            const executionTime24 = new Date(cascadeResult.executionTime).toLocaleTimeString('en-GB', { hour12: false });
            const confirmingTFs = cascadeResult.confirmations.map(c => c.timeframe).join(', ');
            
            console.log(`🎯 CASCADE #${cascadeNumber} CONFIRMED: ${primaryPivot.signal.toUpperCase()}`);
            console.log(`   Primary: ${primaryTime} (${primaryTime24}) | Execution: ${executionTime} (${executionTime24}) (+${cascadeResult.minutesAfterPrimary}min)`);
            console.log(`   Entry Price: ${formatNumberWithCommas(cascadeResult.executionPrice)} | Strength: ${(cascadeResult.strength * 100).toFixed(0)}% | Confirming TFs: ${confirmingTFs}`);
        }
    }

    // Display results summary
    console.log(`\n${colors.cyan}=== BACKTESTING RESULTS SUMMARY (FRONTTESTER ALGORITHM) ===${colors.reset}`);
    console.log(`${colors.yellow}Total Primary Signals: ${colors.green}${totalSignals}${colors.reset}`);
    console.log(`${colors.yellow}Confirmed Cascade Signals: ${colors.green}${confirmedSignals}${colors.reset}`);
    
    if (totalSignals > 0) {
        const confirmationRate = ((confirmedSignals / totalSignals) * 100).toFixed(1);
        console.log(`${colors.yellow}Cascade Confirmation Rate: ${colors.green}${confirmationRate}%${colors.reset}`);
    }
   
    const dataStartTime = oneMinuteCandles[0].time;
    const dataEndTime = oneMinuteCandles[oneMinuteCandles.length - 1].time;
    const totalHours = (dataEndTime - dataStartTime) / (1000 * 60 * 60);
    const signalsPerDay = totalSignals > 0 ? ((totalSignals / totalHours) * 24).toFixed(2) : '0';
    const confirmedSignalsPerDay = confirmedSignals > 0 ? ((confirmedSignals / totalHours) * 24).toFixed(2) : '0';
    
    console.log(`${colors.yellow}Primary Signal Frequency: ${colors.green}${signalsPerDay} signals/day${colors.reset}`);
    console.log(`${colors.yellow}Confirmed Signal Frequency: ${colors.green}${confirmedSignalsPerDay} confirmed/day${colors.reset}`);
    
    const dataSpanDays = (totalHours / 24).toFixed(1);
    console.log(`${colors.cyan}Data Timespan: ${dataSpanDays} days${colors.reset}`);

    console.log(`\n${colors.cyan}--- Multi-Timeframe Backtesting Complete ---${colors.reset}`);
}

// Run the backtester
(async () => {
    try {
        await runMultiTimeframeBacktest();
    } catch (err) {
        console.error('\nAn error occurred during backtesting:', err);
        process.exit(1);
    }
})();
