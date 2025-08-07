// Multi-timeframe pivot detection test - shows detected pivots across timeframes
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
    bold: '\x1b[1m'
};

async function testMultiTimeframePivots() {
    console.log(`${colors.cyan}=== Multi-Timeframe Pivot Detection Test ===${colors.reset}`);
    console.log(`Configuration: ${multiPivotConfig.enabled ? colors.green + 'ENABLED' : colors.red + 'DISABLED'}${colors.reset}`);
    console.log(`Timeframes: ${colors.yellow}${multiPivotConfig.timeframes.map(tf => `${tf.interval}(${tf.role})`).join(' → ')}${colors.reset}`);
    
    // Display global configuration overview
    console.log(`\n${colors.cyan}=== TIMEFRAME CONFIGURATIONS ===${colors.reset}`);
    multiPivotConfig.timeframes.forEach(tf => {
        console.log(`${colors.yellow}${tf.interval.padEnd(4)}${colors.reset} | MinSwing: ${colors.cyan}${tf.minSwingPct}%${colors.reset} | MinLegBars: ${colors.cyan}${tf.minLegBars}${colors.reset} | Lookback: ${colors.cyan}${tf.lookback}${colors.reset} | Weight: ${colors.cyan}${tf.weight}${colors.reset} | Role: ${colors.magenta}${tf.role}${colors.reset}`);
    });
    console.log('');

    // Initialize detector and load data
    const detector = new MultiTimeframePivotDetector('BTCUSDT', multiPivotConfig);
    
    console.log(`${colors.cyan}Loading historical data for all timeframes...${colors.reset}`);
    await detector.initializeAllTimeframes(true); // Use local CSV data
    
    console.log(`\n${colors.cyan}=== PIVOT DETECTION RESULTS ===${colors.reset}`);
    
    // Get summary with actual pivot data
    const summary = detector.getMultiTimeframeSummary();
    
    // Display detailed pivot information for each timeframe
    for (const timeframe of summary.timeframes) {
        const pivots = detector.pivotHistory.get(timeframe.interval) || [];
        const recentPivots = pivots.slice(-5); // Show last 5 pivots
        
        // Get the timeframe configuration from multiPivotConfig
        const tfConfig = multiPivotConfig.timeframes.find(tf => tf.interval === timeframe.interval);
        
        console.log(`\n${colors.bold}${timeframe.interval.toUpperCase()} Timeframe (${timeframe.role})${colors.reset}`);
        
        // Display configuration parameters
        if (tfConfig) {
            console.log(`${colors.magenta}Config: MinSwing: ${tfConfig.minSwingPct}% | MinLegBars: ${tfConfig.minLegBars} | Lookback: ${tfConfig.lookback} | Weight: ${tfConfig.weight}${colors.reset}`);
        }
        
        console.log(`${colors.cyan}Total Pivots: ${timeframe.pivotCount}${colors.reset}`);
        
        if (recentPivots.length > 0) {
            console.log(`${colors.cyan}Recent Pivots (last ${recentPivots.length}):${colors.reset}`);
            
            recentPivots.forEach((pivot, index) => {
                const pivotColor = pivot.type === 'high' ? colors.green : colors.red;
                const signalColor = pivot.signal === 'long' ? colors.green : colors.red;
                const timeStr = new Date(pivot.time).toLocaleString();
                const swingStr = pivot.swingPct ? `${pivot.swingPct > 0 ? '+' : ''}${pivot.swingPct.toFixed(2)}%` : 'N/A';
                
                console.log(`  ${pivotColor}${pivot.type.toUpperCase()}${colors.reset} @ ${colors.yellow}${pivot.price.toFixed(2)}${colors.reset} | ${timeStr} | Move: ${swingStr} | Signal: ${signalColor}${pivot.signal.toUpperCase()}${colors.reset}`);
            });
        } else {
            console.log(`  ${colors.yellow}No pivots detected${colors.reset}`);
        }
        
        if (timeframe.latestPivot) {
            const latest = timeframe.latestPivot;
            const latestColor = latest.type === 'high' ? colors.green : colors.red;
            console.log(`  ${colors.cyan}Latest:${colors.reset} ${latestColor}${latest.type.toUpperCase()}${colors.reset} ${colors.yellow}${latest.signal.toUpperCase()}${colors.reset} @ ${latest.price} (${latest.time})`);
        }
    }
    
    // Test cascade signal detection
    console.log(`\n${colors.cyan}=== TESTING CASCADE SIGNALS ===${colors.reset}`);
    
    const currentTime = Date.now();
    const cascadeSignal = detector.analyzeCascadeSignals(currentTime);
    
    if (cascadeSignal) {
        console.log(`${colors.green}✅ CASCADE SIGNAL DETECTED!${colors.reset}`);
        console.log(`  Signal: ${colors.bold}${cascadeSignal.signal.toUpperCase()}${colors.reset}`);
        console.log(`  Strength: ${colors.yellow}${(cascadeSignal.strength * 100).toFixed(1)}%${colors.reset}`);
        console.log(`  Primary Pivot: ${cascadeSignal.primaryPivot.type.toUpperCase()} @ ${cascadeSignal.primaryPivot.price} (${cascadeSignal.primaryPivot.timeframe})`);
        console.log(`  Confirmations: ${colors.cyan}${cascadeSignal.confirmations.map(c => c.timeframe).join(', ')}${colors.reset}`);
        
        // Show detailed confirmation results
        console.log(`\n  ${colors.cyan}Detailed Confirmation Results:${colors.reset}`);
        cascadeSignal.allResults.forEach(result => {
            const status = result.confirmed ? `${colors.green}✓ CONFIRMED${colors.reset}` : `${colors.red}✗ FAILED${colors.reset}`;
            const reason = result.confirmed ? '' : ` (${result.reason})`;
            console.log(`    [${result.timeframe}] ${status}${reason}`);
        });
    } else {
        console.log(`${colors.yellow}No cascade signals detected at current time${colors.reset}`);
        console.log(`${colors.yellow}This is normal - cascade signals require specific timing alignment${colors.reset}`);
    }
    
    // Summary statistics
    console.log(`\n${colors.cyan}=== SUMMARY STATISTICS ===${colors.reset}`);
    console.log(`Total Pivots Across All Timeframes: ${colors.yellow}${summary.totalPivots}${colors.reset}`);
    console.log(`Active Signals: ${colors.yellow}${summary.activeSignals}${colors.reset}`);
    
    // Show timeframe breakdown with configuration
    console.log(`\n${colors.cyan}Pivot Breakdown by Timeframe:${colors.reset}`);
    summary.timeframes.forEach(tf => {
        const tfConfig = multiPivotConfig.timeframes.find(config => config.interval === tf.interval);
        const configStr = tfConfig ? `(${tfConfig.minSwingPct}%/${tfConfig.minLegBars}/${tfConfig.lookback})` : '';
        console.log(`  ${colors.yellow}${tf.interval.padEnd(4)}${colors.reset}: ${colors.cyan}${tf.pivotCount.toString().padStart(5)}${colors.reset} pivots ${colors.magenta}${configStr}${colors.reset}`);
    });
    
    // Show cascade configuration
    console.log(`\n${colors.cyan}=== CASCADE CONFIGURATION ===${colors.reset}`);
    console.log(`Require All Timeframes: ${colors.yellow}${multiPivotConfig.cascadeSettings.requireAllTimeframes}${colors.reset}`);
    if (multiPivotConfig.cascadeSettings.confirmationWindow) {
        console.log(`${colors.cyan}Confirmation Windows:${colors.reset}`);
        Object.entries(multiPivotConfig.cascadeSettings.confirmationWindow).forEach(([tf, window]) => {
            console.log(`  ${colors.yellow}${tf.padEnd(4)}${colors.reset}: ${colors.cyan}${window} minutes${colors.reset}`);
        });
    }
    
    console.log(`\n${colors.green}✅ Multi-timeframe pivot detection test completed!${colors.reset}`);
    console.log(`${colors.cyan}Ready for full backtesting with multiPivotBacktester.js${colors.reset}`);
}

// Run the test
(async () => {
    try {
        await testMultiTimeframePivots();
    } catch (error) {
        console.error(`${colors.red}Error during multi-timeframe pivot test:${colors.reset}`, error);
        process.exit(1);
    }
})();
