// pivotOptimizer.js
// Runs multiple backtests using different TP/SL combinations from optimizerConfig.js

import {
    symbol,
    time as interval,
    limit,
    minSwingPct,
    pivotLookback,
    minLegBars,
    useEdges
} from './config/config.js'; 
import { tradeConfig } from './config/tradeconfig.js';
import { optimizerConfig } from './config/optimizerConfig.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get the directory name in a way that works with ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Paths for data sources
const CANDLES_WITH_EDGES_FILE = path.join(__dirname, 'data', 'BTCUSDT_1m_40320_candles_with_edges.json');
const CSV_DATA_FILE = path.join(__dirname, 'data', 'historical', symbol, `${interval}.csv`);

// Ensure optimization directory exists
const OPTIMIZATION_DIR = path.join(__dirname, 'data', 'optimization');
if (!fs.existsSync(OPTIMIZATION_DIR)) {
    fs.mkdirSync(OPTIMIZATION_DIR, { recursive: true });
    console.log(`Created optimization directory: ${OPTIMIZATION_DIR}`);
}

const RESULTS_CSV_FILE = path.join(OPTIMIZATION_DIR, `optimization_results_${symbol}_${interval}_${new Date().toISOString().replace(/:/g, '-')}.csv`);

const colors = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    magenta: '\x1b[35m'
};

// Function to convert interval string to milliseconds
const intervalToMs = (interval) => {
    const unit = interval.slice(-1);
    const value = parseInt(interval.slice(0, -1));
    
    switch(unit) {
        case 'm': return value * 60 * 1000;             // minutes
        case 'h': return value * 60 * 60 * 1000;        // hours
        case 'd': return value * 24 * 60 * 60 * 1000;   // days
        case 'w': return value * 7 * 24 * 60 * 60 * 1000; // weeks
        default: return value * 60 * 1000;              // default to minutes
    }
};

// Get the candle duration based on the interval
const candleDurationMs = intervalToMs(interval);

// Function to load candles with pre-computed edges from JSON file
const loadCandlesWithEdges = (filePath) => {
    try {
        // Read the JSON file
        const jsonData = fs.readFileSync(filePath, 'utf8');
        const data = JSON.parse(jsonData);
        
        // Check if the data is an array (direct candles) or has a candles property
        let candles = Array.isArray(data) ? data : (data.candles || []);
        
        // Apply limit from config if available
        if (limit > 0 && candles.length > limit) {
            console.log(`Limiting to ${limit} most recent candles out of ${candles.length} available`);
            candles = candles.slice(-limit); // Take the most recent candles based on limit
        }
        
        console.log(`Loaded ${candles.length} candles with pre-computed edges from ${filePath}`);
        
        // Extract edges if available or use an empty object
        const edges = Array.isArray(data) ? {} : (data.edges || {});
        
        // Return both candles and edges
        return {
            candles: candles,
            edges: edges
        };
    } catch (error) {
        console.error(`Failed to load candles with edges from ${filePath}:`, error);
        process.exit(1);
    }
};

// Function to load candles from CSV file
const loadCandlesFromCSV = (filePath) => {
    try {
        // Check if the file exists
        if (!fs.existsSync(filePath)) {
            console.error(`CSV file not found: ${filePath}`);
            process.exit(1);
        }
        
        // Read the CSV file
        const fileContent = fs.readFileSync(filePath, 'utf8');
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
            
            // Validate the candle data
            if (!isNaN(candle.time) && 
                !isNaN(candle.open) && 
                !isNaN(candle.high) && 
                !isNaN(candle.low) && 
                !isNaN(candle.close)) {
                candles.push(candle);
            }
        }
        
        // Apply limit from config if available
        let filteredCandles = candles;
        if (limit > 0 && filteredCandles.length > limit) {
            console.log(`Limiting to ${limit} most recent candles out of ${filteredCandles.length} available`);
            filteredCandles = filteredCandles.slice(-limit); // Take the most recent candles
        }
        
        // Sort by timestamp to ensure chronological order
        filteredCandles.sort((a, b) => a.time - b.time);
        
        console.log(`Loaded ${filteredCandles.length} candles from CSV file: ${filePath}`);
        
        // Return candles and empty edges object
        return {
            candles: filteredCandles,
            edges: {}
        };
    } catch (error) {
        console.error(`Failed to load candles from CSV file ${filePath}:`, error);
        process.exit(1);
    }
};

// Helper function to detect pivots
const detectPivot = (candles, i, pivotLookback, pivotType) => {
    let isPivot = true;
    
    for (let j = 1; j <= pivotLookback; j++) {
        if (pivotType === 'high') {
            if (candles[i].high <= candles[i - j].high) {
                isPivot = false;
                break;
            }
        } else { // low pivot
            if (candles[i].low >= candles[i - j].low) {
                isPivot = false;
                break;
            }
        }
    }
    
    return isPivot;
};

// Helper function to create a trade
const createTrade = (type, currentCandle, pivotData, i, tradeSize, tradeConfig) => {
    const entryPrice = type === 'long' ? currentCandle.low : currentCandle.high;
    // Use the provided trade size directly instead of calculating from capital
    const size = tradeSize;
    
    // Calculate TP/SL differently based on trade type
    const takeProfitPrice = type === 'long'
        ? entryPrice * (1 + (tradeConfig.takeProfit / 100))
        : entryPrice * (1 - (tradeConfig.takeProfit / 100));
        
    const stopLossPrice = type === 'long'
        ? entryPrice * (1 - (tradeConfig.stopLoss / 100))
        : entryPrice * (1 + (tradeConfig.stopLoss / 100));

    return {
        type,
        entryPrice,
        entryTime: currentCandle.time,
        entryIndex: i,
        size,
        status: 'open',
        takeProfitPrice,
        stopLossPrice,
        pivot: { ...pivotData },  // Create a copy to avoid reference issues
        maxFavorable: 0,  // Track maximum favorable price movement
        maxUnfavorable: 0  // Track maximum unfavorable price movement
    };
};

// Function to get edge data for a current price from pre-computed data
const getCurrentEdgeData = (currentPrice, candle, edges, timeframes) => {
    // Check if the candle already has pre-computed edge data
    if (candle && candle.edges) {
        return candle.edges;
    }
    
    // If no pre-computed edges, return empty result
    return {};
};

// Main function to run a single backtest with specific TP/SL values
async function runBacktest(takeProfit, stopLoss) {
    // Create a copy of the trade config with the specific TP/SL values
    const testConfig = {
        ...tradeConfig,
        takeProfit: takeProfit,
        stopLoss: stopLoss,
        // Disable console output for individual backtests
        showCandle: false,
        showPivot: false,
        showTradeDetails: false
    };
    
    // Load candles based on useEdges configuration
    const { candles, edges } = useEdges 
        ? loadCandlesWithEdges(CANDLES_WITH_EDGES_FILE)
        : loadCandlesFromCSV(CSV_DATA_FILE);

    // Ensure there are enough candles for the lookback on both sides
    if (!candles || candles.length < (pivotLookback * 2 + 1)) {
        console.error(`Not enough historical data. Need at least ${pivotLookback * 2 + 1} candles for lookback of ${pivotLookback}.`);
        return null;
    }

    // Define timeframes for edge detection
    const timeframes = ['daily', 'weekly', 'biweekly', 'monthly'];
    
    let lastPivot = { type: null, price: null, time: null, index: 0 };
    const swingThreshold = minSwingPct / 100;
    let pivotCounter = 0;
    let highPivotCount = 0;
    let lowPivotCount = 0;

    // --- Trade State Initialization ---
    let capital = testConfig.initialCapital;
    const trades = [];
    const openTrades = [];
    let tradeMaxDrawdown = 0;
    let tradeMaxProfit = 0;

    // Iterate, leaving enough space for lookback on either side
    for (let i = pivotLookback; i < candles.length; i++) {
        const currentCandle = candles[i];
        let pivotType = null;

        // --- Active Trade Management ---
        // Process all open trades
        for (let j = openTrades.length - 1; j >= 0; j--) {
            const trade = openTrades[j];
            let tradeClosed = false;
            let exitPrice = null;
            let result = '';
            
            // Track maximum favorable and unfavorable price movements
            if (trade.type === 'long') {
                const currentFavorable = (currentCandle.high - trade.entryPrice) / trade.entryPrice * 100;
                const currentUnfavorable = (currentCandle.low - trade.entryPrice) / trade.entryPrice * 100;
                
                trade.maxFavorable = Math.max(trade.maxFavorable, currentFavorable);
                trade.maxUnfavorable = Math.min(trade.maxUnfavorable, currentUnfavorable);
            } else { // short
                const currentFavorable = (trade.entryPrice - currentCandle.low) / trade.entryPrice * 100;
                const currentUnfavorable = (trade.entryPrice - currentCandle.high) / trade.entryPrice * 100;
                
                trade.maxFavorable = Math.max(trade.maxFavorable, currentFavorable);
                trade.maxUnfavorable = Math.min(trade.maxUnfavorable, currentUnfavorable);
            }

            // Check for trade timeout if maxTradeTimeMinutes is enabled
            if (testConfig.maxTradeTimeMinutes > 0) {
                const tradeTimeMs = currentCandle.time - trade.entryTime;
                const tradeTimeMinutes = tradeTimeMs / (1000 * 60);
                
                if (tradeTimeMinutes >= testConfig.maxTradeTimeMinutes) {
                    tradeClosed = true;
                    exitPrice = currentCandle.close;
                    result = 'TIMEOUT';
                }
            }

            if (!tradeClosed) { // Only check TP/SL if not already closed due to timeout
                if (trade.type === 'long') {
                    if (currentCandle.high >= trade.takeProfitPrice) {
                        tradeClosed = true;
                        exitPrice = trade.takeProfitPrice;
                        result = 'TP';
                    } else if (currentCandle.low <= trade.stopLossPrice) {
                        tradeClosed = true;
                        exitPrice = trade.stopLossPrice;
                        result = 'SL';
                    }
                } else { // short
                    if (currentCandle.low <= trade.takeProfitPrice) {
                        tradeClosed = true;
                        exitPrice = trade.takeProfitPrice;
                        result = 'TP';
                    } else if (currentCandle.high >= trade.stopLossPrice) {
                        tradeClosed = true;
                        exitPrice = trade.stopLossPrice;
                        result = 'SL';
                    }
                }
            }

            if (tradeClosed) {
                const pnlPct = (trade.type === 'long' ? (exitPrice - trade.entryPrice) / trade.entryPrice : (trade.entryPrice - exitPrice) / trade.entryPrice) * testConfig.leverage;
                const grossPnl = trade.size * pnlPct;
                const fee = (trade.size * testConfig.leverage * (testConfig.totalMakerFee / 100));
                const pnl = grossPnl - fee;
                
                capital += pnl;

                trades.push({
                    ...trade,
                    exitPrice,
                    exitTime: currentCandle.time,
                    exitIndex: i,
                    status: 'closed',
                    result,
                    grossPnl,
                    pnl,
                    fee,
                    capitalAfter: capital
                });
                
                // Remove this trade from openTrades array
                openTrades.splice(j, 1);
            }
        }

        // Process high pivots
        const isHighPivot = detectPivot(candles, i, pivotLookback, 'high');
        
        if (isHighPivot) {
            const swingPct = lastPivot.price ? (currentCandle.high - lastPivot.price) / lastPivot.price : 0;
            const isFirstPivot = lastPivot.type === null;
            
            if ((isFirstPivot || Math.abs(swingPct) >= swingThreshold) && (i - lastPivot.index) >= minLegBars) {
                pivotType = 'high';
                pivotCounter++;
                highPivotCount++;
                
                // Get edge data for this pivot from pre-computed data
                const pivotEdgeData = getCurrentEdgeData(currentCandle.high, currentCandle, edges, timeframes);
                
                // Store pivot data
                lastPivot = { 
                    type: 'high', 
                    price: currentCandle.high, 
                    time: currentCandle.time, 
                    index: i,
                    edges: pivotEdgeData
                };
                
                // --- Open Short Trade ---
                if (!isFirstPivot && (testConfig.direction === 'sell' || testConfig.direction === 'both')) {
                    // Check if we can open a new trade based on maxConcurrentTrades
                    if (openTrades.length < testConfig.maxConcurrentTrades) {
                        // Calculate available capital for this trade
                        const usedCapital = openTrades.reduce((sum, trade) => sum + trade.size, 0);
                        const availableCapital = capital - usedCapital;
                        
                        // Determine trade size based on positionSizingMode
                        let tradeSize = 0;
                        if (testConfig.positionSizingMode === 'fixed' && testConfig.amountPerTrade) {
                            // Use fixed amount, but check against available capital
                            tradeSize = Math.min(testConfig.amountPerTrade, availableCapital);
                        } else {
                            // Use percentage of total capital
                            tradeSize = capital * (testConfig.riskPerTrade / 100);
                        }
                        
                        // Ensure we have enough capital and the trade size is valid
                        if (tradeSize > 0 && tradeSize <= availableCapital) {
                            const shortTrade = createTrade('short', currentCandle, lastPivot, i, tradeSize, testConfig);
                            openTrades.push(shortTrade);
                        }
                    }
                }
            }
        }

        // Process low pivots
        const isLowPivot = detectPivot(candles, i, pivotLookback, 'low');
        
        if (isLowPivot) {
            const swingPct = lastPivot.price ? (currentCandle.low - lastPivot.price) / lastPivot.price : 0;
            const isFirstPivot = lastPivot.type === null;
            
            if ((isFirstPivot || Math.abs(swingPct) >= swingThreshold) && (i - lastPivot.index) >= minLegBars) {
                pivotType = 'low';
                pivotCounter++;
                lowPivotCount++;
                
                // Get edge data for this pivot from pre-computed data
                const pivotEdgeData = getCurrentEdgeData(currentCandle.low, currentCandle, edges, timeframes);
                
                // Store pivot data
                lastPivot = { 
                    type: 'low', 
                    price: currentCandle.low, 
                    time: currentCandle.time, 
                    index: i,
                    edges: pivotEdgeData
                };
                
                // --- Open Long Trade ---
                if (!isFirstPivot && (testConfig.direction === 'buy' || testConfig.direction === 'both')) {
                    // Check if we can open a new trade based on maxConcurrentTrades
                    if (openTrades.length < testConfig.maxConcurrentTrades) {
                        // Calculate available capital for this trade
                        const usedCapital = openTrades.reduce((sum, trade) => sum + trade.size, 0);
                        const availableCapital = capital - usedCapital;
                        
                        // Determine trade size based on positionSizingMode
                        let tradeSize = 0;
                        if (testConfig.positionSizingMode === 'fixed' && testConfig.amountPerTrade) {
                            // Use fixed amount, but check against available capital
                            tradeSize = Math.min(testConfig.amountPerTrade, availableCapital);
                        } else {
                            // Use percentage of total capital
                            tradeSize = capital * (testConfig.riskPerTrade / 100);
                        }
                        
                        // Ensure we have enough capital and the trade size is valid
                        if (tradeSize > 0 && tradeSize <= availableCapital) {
                            const longTrade = createTrade('long', currentCandle, lastPivot, i, tradeSize, testConfig);
                            openTrades.push(longTrade);
                        }
                    }
                }
            }
        }
    }

    // Close any remaining open trades at the last candle's close price
    const lastCandle = candles[candles.length - 1];
    for (const trade of openTrades) {
        const exitPrice = lastCandle.close;
        const pnlPct = (trade.type === 'long' ? (exitPrice - trade.entryPrice) / trade.entryPrice : (trade.entryPrice - exitPrice) / trade.entryPrice) * testConfig.leverage;
        const grossPnl = trade.size * pnlPct;
        const fee = (trade.size * testConfig.leverage * (testConfig.totalMakerFee / 100));
        const pnl = grossPnl - fee;
        
        capital += pnl;

        trades.push({
            ...trade,
            exitPrice,
            exitTime: lastCandle.time,
            exitIndex: candles.length - 1,
            status: 'closed',
            result: 'EOB', // End Of Backtest - matching pivotBacktester.js naming
            grossPnl,
            pnl,
            fee,
            capitalAfter: capital
        });
    }

    // Calculate trade statistics
    const closedTrades = trades.filter(t => t.status === 'closed');
    // Filter out EOB trades to match pivotBacktester.js behavior
    const regularTrades = closedTrades.filter(t => t.result !== 'EOB');
    const eobTrades = closedTrades.filter(t => t.result === 'EOB');
    // Use regularTrades instead of closedTrades to exclude EOB trades
    const tpTrades = regularTrades.filter(t => t.result === 'TP');
    const slTrades = regularTrades.filter(t => t.result === 'SL');
    const timeoutTrades = regularTrades.filter(t => t.result === 'TIMEOUT');
    
    // Calculate rates based on regularTrades (excluding EOB trades)
    const tpRate = regularTrades.length > 0 ? (tpTrades.length / regularTrades.length) * 100 : 0;
    const slRate = regularTrades.length > 0 ? (slTrades.length / regularTrades.length) * 100 : 0;
    const timeoutRate = regularTrades.length > 0 ? (timeoutTrades.length / regularTrades.length) * 100 : 0;
    
    // Calculate profit metrics based on regularTrades (excluding EOB trades)
    const totalPnl = regularTrades.reduce((sum, trade) => sum + trade.pnl, 0);
    const profitableTrades = regularTrades.filter(t => t.pnl > 0);
    const unprofitableTrades = regularTrades.filter(t => t.pnl <= 0);
    
    const winRate = regularTrades.length > 0 ? (profitableTrades.length / regularTrades.length) * 100 : 0;
    const totalProfit = profitableTrades.reduce((sum, trade) => sum + trade.pnl, 0);
    const totalLoss = unprofitableTrades.reduce((sum, trade) => sum + trade.pnl, 0);
    
    const avgWin = profitableTrades.length > 0 ? totalProfit / profitableTrades.length : 0;
    const avgLoss = unprofitableTrades.length > 0 ? totalLoss / unprofitableTrades.length : 0;
    
    const profitFactor = Math.abs(totalLoss) > 0 ? Math.abs(totalProfit / totalLoss) : Infinity;
    
    // Calculate net gains
    const initialCapital = testConfig.initialCapital;
    
    // Adjust final capital by removing the impact of EOB trades (to match pivotBacktester.js)
    const eobPnl = eobTrades.reduce((acc, t) => acc + t.pnl, 0);
    const adjustedFinalCapital = capital - eobPnl;
    
    // Use the adjusted final capital for calculations
    const netGain = adjustedFinalCapital - initialCapital;
    const netGainPct = (netGain / initialCapital) * 100;
    
    // Return the backtest results
    return {
        takeProfit,
        stopLoss,
        totalTrades: regularTrades.length, // Only count non-EOB trades
        winRate,
        tpRate,
        slRate,
        timeoutRate,
        // endRate removed as EOB trades are now excluded from metrics
        profitFactor,
        netGain,
        netGainPct,
        initialCapital,
        finalCapital: adjustedFinalCapital,
        avgWin,
        avgLoss
    };
}

// Main function to run the optimizer
async function runOptimizer() {
    console.log(`${colors.cyan}=== Pivot Optimizer ===${colors.reset}`);
    console.log(`Symbol: ${symbol}, Interval: ${interval}`);
    console.log(`Take Profit Range: ${optimizerConfig.takeProfitRange.start} to ${optimizerConfig.takeProfitRange.end} with step ${optimizerConfig.takeProfitRange.step}`);
    console.log(`Stop Loss Range: ${optimizerConfig.stopLossRange.start} to ${optimizerConfig.stopLossRange.end} with step ${optimizerConfig.stopLossRange.step}`);
    console.log(`Direction: ${tradeConfig.direction}, Leverage: ${tradeConfig.leverage}x`);
    console.log();
    
    // Create header for CSV file
    const csvHeader = 'takeProfit,stopLoss,totalTrades,winRate,tpRate,slRate,timeoutRate,profitFactor,netGain,netGainPct,initialCapital,finalCapital,avgWin,avgLoss\n';
    fs.writeFileSync(RESULTS_CSV_FILE, csvHeader);
    
    const results = [];
    let totalCombinations = 0;
    let completedCombinations = 0;
    
    // Calculate total combinations
    for (let tp = optimizerConfig.takeProfitRange.start; tp <= optimizerConfig.takeProfitRange.end; tp += optimizerConfig.takeProfitRange.step) {
        for (let sl = optimizerConfig.stopLossRange.start; sl <= optimizerConfig.stopLossRange.end; sl += optimizerConfig.stopLossRange.step) {
            totalCombinations++;
        }
    }
    
    console.log(`Total combinations to test: ${totalCombinations}`);
    
    // Run tests for all combinations
    for (let tp = optimizerConfig.takeProfitRange.start; tp <= optimizerConfig.takeProfitRange.end; tp += optimizerConfig.takeProfitRange.step) {
        for (let sl = optimizerConfig.stopLossRange.start; sl <= optimizerConfig.stopLossRange.end; sl += optimizerConfig.stopLossRange.step) {
            completedCombinations++;
            const progress = (completedCombinations / totalCombinations * 100).toFixed(2);
            
            console.log(`Testing TP: ${tp.toFixed(2)}%, SL: ${sl.toFixed(2)}% [${completedCombinations}/${totalCombinations} - ${progress}%]`);
            
            const result = await runBacktest(tp, sl);
            if (result) {
                results.push(result);
                
                // Format the result for CSV
                const csvLine = `${result.takeProfit},${result.stopLoss},${result.totalTrades},${result.winRate.toFixed(2)},${result.tpRate.toFixed(2)},${result.slRate.toFixed(2)},${result.timeoutRate.toFixed(2)},${result.profitFactor.toFixed(2)},${result.netGain.toFixed(2)},${result.netGainPct.toFixed(2)},${result.initialCapital},${result.finalCapital.toFixed(2)},${result.avgWin.toFixed(2)},${result.avgLoss.toFixed(2)}\n`;
                fs.appendFileSync(RESULTS_CSV_FILE, csvLine);
                
                // Display current result
                console.log(`  Total Trades: ${result.totalTrades}, Win Rate: ${result.winRate.toFixed(2)}%, Profit Factor: ${result.profitFactor.toFixed(2)}, Net Gain: ${result.netGainPct.toFixed(2)}% ($${result.netGain.toFixed(2)}), Capital: $${result.finalCapital.toFixed(2)}`);
            }
        }
    }
    
    // Sort results by net gain percentage
    results.sort((a, b) => b.netGainPct - a.netGainPct);
    
    // Display top 5 results
    console.log(`\n${colors.green}=== Top 5 Combinations ====${colors.reset}`);
    for (let i = 0; i < Math.min(5, results.length); i++) {
        const r = results[i];
        console.log(`${i+1}. TP: ${r.takeProfit.toFixed(2)}%, SL: ${r.stopLoss.toFixed(2)}% - Trades: ${r.totalTrades}, Win Rate: ${r.winRate.toFixed(2)}%, Net Gain: ${r.netGainPct.toFixed(2)}% ($${r.netGain.toFixed(2)}), Capital: $${r.finalCapital.toFixed(2)}, Profit Factor: ${r.profitFactor.toFixed(2)}`);
    }
    
    console.log(`\n${colors.green}Complete optimization results saved to: ${RESULTS_CSV_FILE}${colors.reset}`);
}

// Run the optimizer
runOptimizer();
