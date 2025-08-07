// checkPivotCounts.js
// Quick check of pivot counts for all timeframes

import { MultiTimeframePivotDetector } from '../utils/multiTimeframePivotDetector.js';
import { multiPivotConfig } from '../config/multiPivotConfig.js';

const colors = {
    reset: '\x1b[0m',
    cyan: '\x1b[36m',
    yellow: '\x1b[33m',
    green: '\x1b[32m',
    magenta: '\x1b[35m'
};

async function checkPivotCounts() {
    console.log(`${colors.cyan}=== Multi-Timeframe Pivot Count Check ===${colors.reset}`);
    
    const detector = new MultiTimeframePivotDetector('BTCUSDT', multiPivotConfig);
    
    try {
        await detector.initializeAllTimeframes(true);
        
        console.log(`\\n${colors.cyan}=== PIVOT COUNTS ===${colors.reset}`);
        
        for (const timeframe of multiPivotConfig.timeframes) {
            const pivots = detector.pivotHistory.get(timeframe.interval) || [];
            const highPivots = pivots.filter(p => p.type === 'high').length;
            const lowPivots = pivots.filter(p => p.type === 'low').length;
            
            console.log(`${colors.yellow}${timeframe.interval.padEnd(4)}${colors.reset}: ${colors.green}${pivots.length.toString().padStart(4)}${colors.reset} pivots (${colors.magenta}${timeframe.minSwingPct}%/${timeframe.minLegBars}/${timeframe.lookback}${colors.reset}) - ${highPivots}H/${lowPivots}L`);
        }
        
        const totalPivots = multiPivotConfig.timeframes.reduce((sum, tf) => {
            const pivots = detector.pivotHistory.get(tf.interval) || [];
            return sum + pivots.length;
        }, 0);
        
        console.log(`\\n${colors.cyan}Total: ${colors.yellow}${totalPivots}${colors.reset} pivots across all timeframes`);
        
    } catch (error) {
        console.error('Error:', error);
    }
}

checkPivotCounts().catch(console.error);
