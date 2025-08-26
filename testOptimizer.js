// testOptimizer.js
// Simple test version with limited parameters to verify the system works

import { Worker } from 'worker_threads';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Minimal test configuration - just a few combinations
const TEST_CONFIG = {
    takeProfitRange: { start: 0.5, end: 0.9, step: 0.2 }, // 3 values: 0.5, 0.7, 0.9
    stopLossRange: { start: 0.2, end: 0.3, step: 0.1 },   // 2 values: 0.2, 0.3
    leverageRange: { start: 50, end: 100, step: 50 },     // 2 values: 50, 100
    tradingModes: ['pivot'],
    maxCandles: 1440, // Just 1 day for testing
    
    timeframeCombinations: [
        [
            {
                interval: '2h',
                role: 'primary',
                minSwingPctRange: { start: 0.1, end: 0.2, step: 0.1 }, // 2 values
                lookbackRange: { start: 1, end: 2, step: 1 },          // 2 values
                minLegBarsRange: { start: 1, end: 2, step: 1 },        // 2 values
                weight: 1,
                oppositeRange: [true]
            },
            {
                interval: '4h',
                role: 'secondary',
                minSwingPctRange: { start: 0.1, end: 0.2, step: 0.1 }, // 2 values
                lookbackRange: { start: 1, end: 2, step: 1 },          // 2 values
                minLegBarsRange: { start: 1, end: 2, step: 1 },        // 2 values
                weight: 1,
                oppositeRange: [false]
            }
        ]
    ]
};

const colors = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    magenta: '\x1b[35m'
};

function generateParameterCombinations() {
    const combinations = [];
    
    // Generate TP/SL/Leverage combinations
    const tpValues = [];
    for (let tp = TEST_CONFIG.takeProfitRange.start; tp <= TEST_CONFIG.takeProfitRange.end; tp += TEST_CONFIG.takeProfitRange.step) {
        tpValues.push(parseFloat(tp.toFixed(3)));
    }
    
    const slValues = [];
    for (let sl = TEST_CONFIG.stopLossRange.start; sl <= TEST_CONFIG.stopLossRange.end; sl += TEST_CONFIG.stopLossRange.step) {
        slValues.push(parseFloat(sl.toFixed(3)));
    }
    
    const leverageValues = [];
    for (let lev = TEST_CONFIG.leverageRange.start; lev <= TEST_CONFIG.leverageRange.end; lev += TEST_CONFIG.leverageRange.step) {
        leverageValues.push(lev);
    }
    
    // Generate timeframe parameter combinations
    for (const tfCombination of TEST_CONFIG.timeframeCombinations) {
        const timeframeParamCombinations = generateTimeframeParameterCombinations(tfCombination);
        
        // Combine with TP/SL/Leverage
        for (const tp of tpValues) {
            for (const sl of slValues) {
                for (const leverage of leverageValues) {
                    for (const mode of TEST_CONFIG.tradingModes) {
                        for (const tfParams of timeframeParamCombinations) {
                            combinations.push({
                                takeProfit: tp,
                                stopLoss: sl,
                                leverage: leverage,
                                tradingMode: mode,
                                timeframes: tfParams,
                                maxCandles: TEST_CONFIG.maxCandles
                            });
                        }
                    }
                }
            }
        }
    }
    
    return combinations;
}

function generateTimeframeParameterCombinations(timeframeConfigs) {
    const combinations = [];
    
    function generateCombinationsRecursive(configIndex, currentCombination) {
        if (configIndex >= timeframeConfigs.length) {
            combinations.push([...currentCombination]);
            return;
        }
        
        const config = timeframeConfigs[configIndex];
        
        // Generate all parameter values for this timeframe
        const minSwingPctValues = [];
        for (let pct = config.minSwingPctRange.start; pct <= config.minSwingPctRange.end; pct += config.minSwingPctRange.step) {
            minSwingPctValues.push(parseFloat(pct.toFixed(3)));
        }
        
        const lookbackValues = [];
        for (let lb = config.lookbackRange.start; lb <= config.lookbackRange.end; lb += config.lookbackRange.step) {
            lookbackValues.push(lb);
        }
        
        const minLegBarsValues = [];
        for (let mlb = config.minLegBarsRange.start; mlb <= config.minLegBarsRange.end; mlb += config.minLegBarsRange.step) {
            minLegBarsValues.push(mlb);
        }
        
        // Combine all parameter values for this timeframe
        for (const minSwingPct of minSwingPctValues) {
            for (const lookback of lookbackValues) {
                for (const minLegBars of minLegBarsValues) {
                    for (const opposite of config.oppositeRange) {
                        const timeframeConfig = {
                            interval: config.interval,
                            role: config.role,
                            minSwingPct: minSwingPct,
                            lookback: lookback,
                            minLegBars: minLegBars,
                            weight: config.weight,
                            opposite: opposite
                        };
                        
                        currentCombination.push(timeframeConfig);
                        generateCombinationsRecursive(configIndex + 1, currentCombination);
                        currentCombination.pop();
                    }
                }
            }
        }
    }
    
    generateCombinationsRecursive(0, []);
    return combinations;
}

async function runBacktestWithParameters(params) {
    return new Promise((resolve, reject) => {
        const worker = new Worker(path.join(__dirname, 'immediateAggregationWorker.js'), {
            workerData: params
        });
        
        const timeout = setTimeout(() => {
            worker.terminate();
            reject(new Error('Worker timeout after 30 seconds'));
        }, 30000);
        
        worker.on('message', (result) => {
            clearTimeout(timeout);
            resolve(result);
        });
        
        worker.on('error', (error) => {
            clearTimeout(timeout);
            reject(error);
        });
        
        worker.on('exit', (code) => {
            clearTimeout(timeout);
            if (code !== 0) {
                reject(new Error(`Worker stopped with exit code ${code}`));
            }
        });
    });
}

async function runTest() {
    console.log(`${colors.cyan}=== OPTIMIZER TEST ===${colors.reset}`);
    
    const combinations = generateParameterCombinations();
    console.log(`${colors.green}Generated ${combinations.length} test combinations${colors.reset}`);
    
    // Expected: 3 TP × 2 SL × 2 Lev × 1 mode × (2×2×2 × 2×2×2) = 3×2×2×1×64 = 768 combinations
    console.log(`${colors.yellow}Expected: 3 TP × 2 SL × 2 Lev × 1 mode × 64 TF combinations = 768 total${colors.reset}`);
    
    // Test first few combinations
    console.log(`\n${colors.cyan}Testing first 3 combinations:${colors.reset}`);
    
    for (let i = 0; i < Math.min(3, combinations.length); i++) {
        const params = combinations[i];
        console.log(`\n${colors.yellow}[${i+1}] Testing: TP=${params.takeProfit}% SL=${params.stopLoss}% Lev=${params.leverage}x${colors.reset}`);
        console.log(`${colors.dim}    TF1: ${params.timeframes[0].interval} (swing=${params.timeframes[0].minSwingPct}%, lookback=${params.timeframes[0].lookback}, legs=${params.timeframes[0].minLegBars}, opp=${params.timeframes[0].opposite})${colors.reset}`);
        console.log(`${colors.dim}    TF2: ${params.timeframes[1].interval} (swing=${params.timeframes[1].minSwingPct}%, lookback=${params.timeframes[1].lookback}, legs=${params.timeframes[1].minLegBars}, opp=${params.timeframes[1].opposite})${colors.reset}`);
        
        try {
            const startTime = Date.now();
            const result = await runBacktestWithParameters(params);
            const execTime = Date.now() - startTime;
            
            if (result.error) {
                console.log(`${colors.red}    ERROR: ${result.error}${colors.reset}`);
            } else {
                console.log(`${colors.green}    SUCCESS: ${result.totalReturnPct.toFixed(2)}% return | ${result.totalTrades} trades | ${result.winRatePct.toFixed(1)}% win rate | ${execTime}ms${colors.reset}`);
            }
        } catch (error) {
            console.log(`${colors.red}    FAILED: ${error.message}${colors.reset}`);
        }
    }
    
    console.log(`\n${colors.green}✅ Test complete! If successful, you can run the full optimizer.${colors.reset}`);
}

runTest().catch(console.error);
