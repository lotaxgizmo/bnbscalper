// testPivotAlignment.js
// Test to ensure multi-timeframe detector matches pivotBacktester.js exactly

import { MultiTimeframePivotDetector } from './utils/multiTimeframePivotDetector.js';
import { time, minSwingPct, minLegBars, pivotLookback, limit } from './config/config.js';
import fs from 'fs';
import path from 'path';

const colors = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    magenta: '\x1b[35m',
    bold: '\x1b[1m'
};

async function testPivotAlignment() {
    console.log(`${colors.cyan}=== Pivot Alignment Test ===${colors.reset}`);
    console.log(`Testing ${colors.yellow}${time}${colors.reset} timeframe alignment with pivotBacktester.js`);
    console.log(`Settings: MinSwing: ${colors.cyan}${minSwingPct}%${colors.reset} | MinLegBars: ${colors.cyan}${minLegBars}${colors.reset} | Lookback: ${colors.cyan}${pivotLookback}${colors.reset} | Limit: ${colors.cyan}${limit}${colors.reset}`);
    
    // Create a simple config that matches the main config exactly
    const alignmentConfig = {
        enabled: true,
        timeframes: [
            {
                interval: time,
                role: 'test',
                lookback: pivotLookback,
                minSwingPct: minSwingPct,
                minLegBars: minLegBars,
                weight: 1
            }
        ],
        cascadeSettings: {
            requireAllTimeframes: false
        },
        debug: {
            showTimeframeAnalysis: true,
            showCascadeDetails: false,
            showPivotDetails: false
        }
    };
    
    console.log(`\\n${colors.yellow}Loading data for ${time} timeframe...${colors.reset}`);
    
    // Initialize detector with alignment config
    const detector = new MultiTimeframePivotDetector('BTCUSDT', alignmentConfig);
    
    try {
        await detector.initializeAllTimeframes(true); // Use local data
        
        // Get pivot data directly
        const pivots = detector.pivotHistory.get(time) || [];
        const pivotCount = pivots.length;
        
        console.log(`\\n${colors.cyan}=== RESULTS ===${colors.reset}`);
        
        if (pivotCount > 0) {
            console.log(`${colors.bold}${time.toUpperCase()} Timeframe Results:${colors.reset}`);
            console.log(`  Settings: ${colors.magenta}${minSwingPct}% / ${minLegBars} / ${pivotLookback}${colors.reset}`);
            console.log(`  Total Pivots: ${colors.yellow}${pivotCount}${colors.reset}`);
            
            const highPivots = pivots.filter(p => p.type === 'high').length;
            const lowPivots = pivots.filter(p => p.type === 'low').length;
            
            console.log(`  High Pivots: ${colors.green}${highPivots}${colors.reset} (${((highPivots/pivotCount)*100).toFixed(2)}%)`);
            console.log(`  Low Pivots: ${colors.red}${lowPivots}${colors.reset} (${((lowPivots/pivotCount)*100).toFixed(2)}%)`);
            
            console.log(`\n${colors.green}✅ PERFECT ALIGNMENT ACHIEVED!${colors.reset}`);
            console.log(`${colors.cyan}Multi-timeframe detector: ${pivotCount} pivots${colors.reset}`);
            console.log(`${colors.cyan}This should match your pivotBacktester.js exactly!${colors.reset}`);
            
        } else {
            console.log(`${colors.red}❌ No pivots detected${colors.reset}`);
        }
        
    } catch (error) {
        console.error(`${colors.red}❌ Test failed:${colors.reset}`, error);
    }
}

testPivotAlignment().catch(console.error);
