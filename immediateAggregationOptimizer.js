// immediateAggregationOptimizer.js
// Comprehensive parameter optimization for immediate aggregation backtester
// Tests all parameter combinations to find optimal settings

// ===== OPTIMIZATION CONFIGURATION =====
const OPTIMIZATION_CONFIG = {
    // Parameter ranges to test
    takeProfitRange: { start: 0.9, end: 0.9, step: 0.1 },
    stopLossRange: { start: 0.4, end: 0.4, step: 0.1 },
    leverageRange: { start: 1, end: 1, step: 1 },
    minimumTimeframes: 1,
     
    tradingModes: ['pivot'],  
     
    maxCandles: 20160, // 14 days of 1m candles 
    
    // Timeframe combinations to test
    timeframeCombinations: [ 
        [
            {
                interval: '4h',
                role: 'primary',
                minSwingPctRange: { start: 0.1, end: 0.4, step: 0.1 },
                lookbackRange: { start: 1, end: 1, step: 1 },
                minLegBarsRange: { start: 1, end: 1, step: 1 },               
                weight: 1,
                oppositeRange: [false]
            }
        ]
    ]
};

import { Worker } from 'worker_threads';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

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
    dim: '\x1b[2m',
    bold: '\x1b[1m'
};

// Generate all parameter combinations
function generateParameterCombinations() {
    const combinations = [];
    
    // Generate TP/SL/Leverage combinations
    const tpValues = [];
    for (let tp = OPTIMIZATION_CONFIG.takeProfitRange.start; tp <= OPTIMIZATION_CONFIG.takeProfitRange.end; tp += OPTIMIZATION_CONFIG.takeProfitRange.step) {
        tpValues.push(parseFloat(tp.toFixed(3)));
    }
    
    const slValues = [];
    for (let sl = OPTIMIZATION_CONFIG.stopLossRange.start; sl <= OPTIMIZATION_CONFIG.stopLossRange.end; sl += OPTIMIZATION_CONFIG.stopLossRange.step) {
        slValues.push(parseFloat(sl.toFixed(3)));
    }
    
    const leverageValues = [];
    for (let lev = OPTIMIZATION_CONFIG.leverageRange.start; lev <= OPTIMIZATION_CONFIG.leverageRange.end; lev += OPTIMIZATION_CONFIG.leverageRange.step) {
        leverageValues.push(lev);
    }
    
    // Generate timeframe parameter combinations
    for (const tfCombination of OPTIMIZATION_CONFIG.timeframeCombinations) {
        const timeframeParamCombinations = generateTimeframeParameterCombinations(tfCombination);
        
        // Combine with TP/SL/Leverage
        for (const tp of tpValues) {
            for (const sl of slValues) {
                for (const leverage of leverageValues) {
                    for (const mode of OPTIMIZATION_CONFIG.tradingModes) {
                        for (const tfParams of timeframeParamCombinations) {
                            combinations.push({
                                takeProfit: tp,
                                stopLoss: sl,
                                leverage: leverage,
                                tradingMode: mode,
                                timeframes: tfParams,
                                maxCandles: OPTIMIZATION_CONFIG.maxCandles,
                                minimumTimeframes: OPTIMIZATION_CONFIG.minimumTimeframes
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

// Run backtester with specific parameters
async function runBacktestWithParameters(params) {
    return new Promise((resolve, reject) => {
        const worker = new Worker(path.join(__dirname, 'immediateAggregationWorker.js'), {
            workerData: params
        });
        
        worker.on('message', (result) => {
            resolve(result);
        });
        
        worker.on('error', (error) => {
            console.error(`${colors.red}Worker error:${colors.reset}`, error);
            reject(error);
        });
        
        worker.on('exit', (code) => {
            if (code !== 0) {
                reject(new Error(`Worker stopped with exit code ${code}`));
            }
        });
    });
}

// Format number with commas
function formatNumber(num) {
    if (typeof num !== 'number') return num;
    return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Main optimization function
async function runOptimization() {
    const startTime = Date.now();
    
    console.log(`${colors.cyan}=== IMMEDIATE AGGREGATION OPTIMIZER ===${colors.reset}`);
    console.log(`${colors.yellow}Generating parameter combinations...${colors.reset}`);
    
    try {
        const combinations = generateParameterCombinations();
        const totalCombinations = combinations.length;
        
        console.log(`${colors.green}Generated ${formatNumber(totalCombinations)} parameter combinations${colors.reset}`);
        console.log(`${colors.yellow}Estimated time: ${Math.round(totalCombinations * 0.5 / 60)} minutes (assuming 0.5s per combination)${colors.reset}`);
        
        // Create results directory
        const resultsDir = path.join(__dirname, 'optimization_results');
        if (!fs.existsSync(resultsDir)) {
            fs.mkdirSync(resultsDir);
        }
        
        // Create CSV file with headers
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const csvPath = path.join(resultsDir, `immediate_aggregation_optimization_${timestamp}.csv`);
        
        const csvHeaders = [
            'combination_id',
            'take_profit',
            'stop_loss', 
            'leverage',
            'trading_mode',
            'max_candles',
            'minimum_timeframes',
            'tf1_interval',
            'tf1_role',
            'tf1_min_swing_pct',
            'tf1_lookback',
            'tf1_min_leg_bars',
            'tf1_weight',
            'tf1_opposite',
            'initial_capital',
            'final_capital',
            'total_return_pct',
            'total_trades',
            'winning_trades',
            'losing_trades',
            'win_rate_pct',
            'total_signals',
            'confirmed_signals',
            'confirmation_rate_pct',
            'execution_rate_pct',
            'signals_per_day',
            'trades_per_day',
            'avg_trade_duration_hours',
            'max_drawdown_pct',
            'sharpe_ratio',
            'profit_factor',
            'avg_win_pct',
            'avg_loss_pct',
            'largest_win_pct',
            'largest_loss_pct',
            'consecutive_wins',
            'consecutive_losses',
            'total_fees',
            'net_profit',
            'roi_annualized_pct',
            'execution_time_ms',
            'error_message'
        ];
        
        fs.writeFileSync(csvPath, csvHeaders.join(',') + '\n');
        
        console.log(`${colors.green}Results will be saved to: ${csvPath}${colors.reset}`);
        console.log(`${colors.cyan}Starting optimization...${colors.reset}\n`);
        
        // Process combinations sequentially for better stability and progress tracking
        let completedCount = 0;
        let errorCount = 0;
        
        console.log(`${colors.yellow}Processing combinations sequentially...${colors.reset}\n`);
        
        for (let i = 0; i < totalCombinations; i++) {
            const params = combinations[i];
            const combinationId = i + 1;
            const execStartTime = Date.now();
            
            // Show progress for every combination
            const progress = ((i / totalCombinations) * 100).toFixed(1);
            console.log(`${colors.cyan}[${combinationId}/${totalCombinations}] ${progress}% - Processing...${colors.reset}`);
            console.log(`${colors.yellow}TP=${params.takeProfit}% SL=${params.stopLoss}% Lev=${params.leverage}x | TF=${params.timeframes[0].interval}(${params.timeframes[0].minSwingPct}%,${params.timeframes[0].lookback},${params.timeframes[0].minLegBars})${colors.reset}`);
            
            try {
                const result = await runBacktestWithParameters(params);
                const execTime = Date.now() - execStartTime;
                
                // Create CSV row
                const csvRow = [
                    combinationId,
                    params.takeProfit,
                    params.stopLoss,
                    params.leverage,
                    params.tradingMode,
                    params.maxCandles,
                    params.minimumTimeframes,
                    params.timeframes[0].interval,
                    params.timeframes[0].role,
                    params.timeframes[0].minSwingPct,
                    params.timeframes[0].lookback,
                    params.timeframes[0].minLegBars,
                    params.timeframes[0].weight,
                    params.timeframes[0].opposite,
                    result.initialCapital || 100,
                    result.finalCapital || 0,
                    result.totalReturnPct || 0,
                    result.totalTrades || 0,
                    result.winningTrades || 0,
                    result.losingTrades || 0,
                    result.winRatePct || 0,
                    result.totalSignals || 0,
                    result.confirmedSignals || 0,
                    result.confirmationRatePct || 0,
                    result.executionRatePct || 0,
                    result.signalsPerDay || 0,
                    result.tradesPerDay || 0,
                    result.avgTradeDurationHours || 0,
                    result.maxDrawdownPct || 0,
                    result.sharpeRatio || 0,
                    result.profitFactor || 0,
                    result.avgWinPct || 0,
                    result.avgLossPct || 0,
                    result.largestWinPct || 0,
                    result.largestLossPct || 0,
                    result.consecutiveWins || 0,
                    result.consecutiveLosses || 0,
                    result.totalFees || 0,
                    result.netProfit || 0,
                    result.roiAnnualizedPct || 0,
                    execTime,
                    ''
                ];
                
                // Append to CSV file
                fs.appendFileSync(csvPath, csvRow.join(',') + '\n');
                
                completedCount++;
                
                // Show result
                if (result.totalTrades > 0) {
                    const returnColor = result.totalReturnPct >= 0 ? colors.green : colors.red;
                    console.log(`${colors.green}✓ Result: ${returnColor}${result.totalReturnPct.toFixed(2)}%${colors.reset} ${colors.dim}return | ${result.totalTrades} trades | ${result.winRatePct.toFixed(1)}% win rate | ${execTime}ms${colors.reset}`);
                } else {
                    console.log(`${colors.yellow}✓ Result: No trades executed | ${execTime}ms${colors.reset}`);
                }
                
                // Show summary every 10 combinations
                if (completedCount % 10 === 0 || completedCount === totalCombinations) {
                    const elapsed = (Date.now() - startTime) / 1000;
                    const rate = completedCount / elapsed;
                    const eta = (totalCombinations - completedCount) / rate;
                    
                    console.log(`${colors.magenta}--- Summary: ${completedCount}/${totalCombinations} completed (${((completedCount / totalCombinations) * 100).toFixed(1)}%) ---${colors.reset}`);
                    console.log(`${colors.cyan}Rate: ${rate.toFixed(2)} combinations/sec | ETA: ${Math.round(eta/60)} minutes${colors.reset}\n`);
                }
                
            } catch (error) {
                errorCount++;
                
                // Log error to CSV
                const errorRow = [
                    combinationId,
                    params.takeProfit,
                    params.stopLoss,
                    params.leverage,
                    params.tradingMode,
                    params.maxCandles,
                    params.minimumTimeframes,
                    params.timeframes[0].interval,
                    params.timeframes[0].role,
                    params.timeframes[0].minSwingPct,
                    params.timeframes[0].lookback,
                    params.timeframes[0].minLegBars,
                    params.timeframes[0].weight,
                    params.timeframes[0].opposite,
                    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
                    Date.now() - execStartTime,
                    `"${error.message.replace(/"/g, '""')}"`
                ];
                
                fs.appendFileSync(csvPath, errorRow.join(',') + '\n');
                
                console.error(`${colors.red}✗ Error in combination ${combinationId}: ${error.message}${colors.reset}`);
            }
        }
        
        const endTime = Date.now();
        const totalTime = (endTime - startTime) / 1000;
        
        console.log(`\n${colors.cyan}=== OPTIMIZATION COMPLETE ===${colors.reset}`);
        console.log(`${colors.green}Total combinations processed: ${formatNumber(completedCount)}${colors.reset}`);
        console.log(`${colors.red}Errors encountered: ${formatNumber(errorCount)}${colors.reset}`);
        console.log(`${colors.yellow}Total time: ${Math.round(totalTime/60)} minutes (${totalTime.toFixed(1)} seconds)${colors.reset}`);
        console.log(`${colors.yellow}Average rate: ${(completedCount/totalTime).toFixed(2)} combinations/second${colors.reset}`);
        console.log(`${colors.cyan}Results saved to: ${csvPath}${colors.reset}`);
        
        console.log(`\n${colors.magenta}=== NEXT STEPS ===${colors.reset}`);
        console.log(`${colors.yellow}1. Open the CSV file in Excel or similar tool${colors.reset}`);
        console.log(`${colors.yellow}2. Sort by 'total_return_pct' (descending) to find best performers${colors.reset}`);
        console.log(`${colors.yellow}3. Filter by minimum trade count (e.g., total_trades >= 10)${colors.reset}`);
        console.log(`${colors.yellow}4. Analyze win_rate_pct, max_drawdown_pct, and sharpe_ratio${colors.reset}`);
        console.log(`${colors.yellow}5. Look for parameter patterns in top performers${colors.reset}`);
        
    } catch (error) {
        console.error(`${colors.red}Optimization failed: ${error.message}${colors.reset}`);
        console.error(`${colors.red}Stack trace: ${error.stack}${colors.reset}`);
    }
}

// Start optimization
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    runOptimization().catch(console.error);
}

export { runOptimization, generateParameterCombinations };
