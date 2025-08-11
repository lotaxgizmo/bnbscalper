// multiPivotBacktesterClean.js
// Clean multi-timeframe pivot detection backtester with cascade confirmation system

import {
    symbol,
    time as interval,
    useLocalData,
    api,
    pivotDetectionMode
} from '../config/config.js';

import { tradeConfig } from '../config/tradeconfig.js';
import { multiPivotConfig } from '../config/multiPivotConfig.js';
import { MultiTimeframePivotDetector } from '../utils/multiTimeframePivotDetector.js';
import { formatNumber } from '../utils/formatters.js';

const colors = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    magenta: '\x1b[35m',
    blue: '\x1b[34m',
    brightGreen: '\x1b[92m',
    brightYellow: '\x1b[93m',
    brightCyan: '\x1b[96m',
    bold: '\x1b[1m'
};

async function runMultiTimeframeBacktest() {
    console.log(`${colors.cyan}=== MULTI-TIMEFRAME PIVOT BACKTESTER ===${colors.reset}`);
    console.log(`${colors.yellow}Symbol: ${symbol}${colors.reset}`);
    console.log(`${colors.yellow}Detection Mode: ${pivotDetectionMode === 'extreme' ? 'Extreme (High/Low)' : 'Close'}${colors.reset}`);
    console.log(`${colors.yellow}Data Source: ${useLocalData ? 'Local CSV' : 'Live API'}${colors.reset}\n`);

    // Display trade configuration
    console.log(`${colors.cyan}--- Trade Configuration ---${colors.reset}`);
    console.log(`Direction: ${tradeConfig.direction}`);
    console.log(`Take Profit: ${tradeConfig.takeProfit}%`);
    console.log(`Stop Loss: ${tradeConfig.stopLoss}%`);
    console.log(`Leverage: ${tradeConfig.leverage}x`);
    console.log(`Initial Capital: ${tradeConfig.initialCapital} USDT\n`);

    // Initialize multi-timeframe pivot detection system
    console.log(`${colors.cyan}=== INITIALIZING MULTI-TIMEFRAME PIVOT SYSTEM ===${colors.reset}`);
    const detector = new MultiTimeframePivotDetector(symbol, multiPivotConfig);
    
    try {
        await detector.initializeAllTimeframes(useLocalData);
        console.log(`${colors.green}✅ Multi-timeframe system initialized successfully${colors.reset}`);
        
        // Get summary for display
        const totalPivots = multiPivotConfig.timeframes.reduce((sum, tf) => {
            const pivots = detector.pivotHistory.get(tf.interval) || [];
            return sum + pivots.length;
        }, 0);
        
        console.log(`${colors.cyan}Total pivots detected across all timeframes: ${colors.yellow}${totalPivots}${colors.reset}`);
        
        // Display pivot breakdown
        multiPivotConfig.timeframes.forEach(tf => {
            const pivots = detector.pivotHistory.get(tf.interval) || [];
            console.log(`  ${colors.yellow}${tf.interval.padEnd(4)}${colors.reset}: ${colors.green}${pivots.length.toString().padStart(4)}${colors.reset} pivots (${colors.magenta}${tf.minSwingPct}%/${tf.minLegBars}/${tf.lookback}${colors.reset})`);
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

    // Start backtesting with cascade confirmation
    console.log(`\n${colors.cyan}=== STARTING MULTI-TIMEFRAME BACKTESTING ===${colors.reset}`);
    
    let totalSignals = 0;
    let confirmedSignals = 0;
    let cascadeNumber = 0; // Sequential numbering for visual tracking
    
    // Get all pivots from the primary timeframe (largest timeframe triggers signals)
    const primaryTimeframe = multiPivotConfig.timeframes[0]; // First timeframe is primary
    const primaryPivots = detector.pivotHistory.get(primaryTimeframe.interval) || [];
    
    console.log(`${colors.yellow}Processing ${primaryPivots.length} primary signals from ${primaryTimeframe.interval} timeframe${colors.reset}`);
    
    // Process each primary pivot for cascade confirmation
    for (const primaryPivot of primaryPivots) {
        totalSignals++;
        
        // Check for forward-looking cascade confirmation (realistic market order timing)
        const cascadeResult = detector.checkForwardCascadeConfirmation(primaryPivot, oneMinuteCandles);
        
        // Get logging settings
        const logging = multiPivotConfig.debug.cascadeLogging;
        
        if (cascadeResult) {
            confirmedSignals++;
            cascadeNumber++;
            
            // Check if we should show this confirmed cascade
            const confirmationCount = cascadeResult.confirmations.length + 1; // +1 for primary
            const shouldShow = logging.enabled && 
                              confirmationCount >= logging.minConfirmationsToShow &&
                              logging.filterByConfirmations[`show${confirmationCount}Confirmations`] !== false;
            
            if (shouldShow && logging.showDetails.confirmedSignalSummary) {
                const primaryTime12 = new Date(primaryPivot.time).toLocaleString();
                const primaryTime24Only = new Date(primaryPivot.time).toLocaleTimeString('en-GB', { hour12: false });
                const executionTime12 = new Date(cascadeResult.executionTime).toLocaleString();
                const executionTime24Only = new Date(cascadeResult.executionTime).toLocaleTimeString('en-GB', { hour12: false });
                const confirmingTFs = cascadeResult.confirmations.map(c => c.timeframe).join(', ');
                
                console.log(`${colors.green}🎯 CASCADE #${cascadeNumber} CONFIRMED: ${primaryPivot.signal.toUpperCase()}${colors.reset}`);
                console.log(`${colors.cyan}   Primary: ${primaryTime12} (${primaryTime24Only}) | Execution: ${executionTime12} (${executionTime24Only}) (+${cascadeResult.minutesAfterPrimary}min)${colors.reset}`);
                console.log(`${colors.cyan}   Entry Price: ${cascadeResult.executionPrice} | Strength: ${(cascadeResult.strength * 100).toFixed(0)}% | Confirming TFs: ${confirmingTFs}${colors.reset}`);
                
                // Show detailed breakdown for all confirmed cascades if enabled
                if (logging.showDetails.confirmationBreakdown) {
                    cascadeResult.allResults.forEach(result => {
                        const status = result.confirmed ? `${colors.green}✓ ${result.timeframe}: Confirmed${colors.reset}` : `${colors.red}✗ ${result.timeframe}: ${result.reason}${colors.reset}`;
                        console.log(`    ${status}`);
                    });
                }
            }
        } else {
            // Always increment cascade number for tracking, even if failed
            cascadeNumber++;
            
            if (logging.enabled && logging.showAllCascades) {
                // Show failed cascade if showAllCascades is true
                const failedTime12 = new Date(primaryPivot.time).toLocaleString();
                const failedTime24Only = new Date(primaryPivot.time).toLocaleTimeString('en-GB', { hour12: false });
                console.log(`${colors.red}✗ CASCADE #${cascadeNumber} FAILED: ${primaryPivot.signal} from ${primaryTimeframe.interval} at ${failedTime12} (${failedTime24Only})${colors.reset}`);
            }
        }
        
        // Progress indicator (respects logging settings)
        if (logging.showProgress && (totalSignals % logging.showProgressEvery === 0 || totalSignals <= 10)) {
            const progress = ((totalSignals / primaryPivots.length) * 100).toFixed(1);
            console.log(`${colors.cyan}Progress: ${progress}% (${totalSignals}/${primaryPivots.length} primary signals processed)${colors.reset}`);
        }
    }

    // Display results summary
    console.log(`\n${colors.cyan}=== BACKTESTING RESULTS SUMMARY ===${colors.reset}`);
    console.log(`${colors.yellow}Total Primary Signals: ${colors.green}${totalSignals}${colors.reset}`);
    console.log(`${colors.yellow}Confirmed Cascade Signals: ${colors.green}${confirmedSignals}${colors.reset}`);
    
    if (totalSignals > 0) {
        const confirmationRate = ((confirmedSignals / totalSignals) * 100).toFixed(1);
        console.log(`${colors.yellow}Cascade Confirmation Rate: ${colors.green}${confirmationRate}%${colors.reset}`);
    }
    
    // Calculate signal frequency based on data timespan
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
