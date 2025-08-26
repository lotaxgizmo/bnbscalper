// immediateAggregationWorker.js
// Worker thread for running immediate aggregation backtester with specific parameters

import { parentPort, workerData } from 'worker_threads';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import necessary functions (we'll need to modify the backtester to export these)
import { getCandles } from './apis/bybit.js';

// ===== UTILITY FUNCTIONS =====
function parseTimeframeToMinutes(timeframe) {
    const tf = timeframe.toLowerCase();
    
    if (tf.endsWith('m')) {
        return parseInt(tf.replace('m', ''));
    } else if (tf.endsWith('h')) {
        return parseInt(tf.replace('h', '')) * 60;
    } else if (tf.endsWith('d')) {
        return parseInt(tf.replace('d', '')) * 60 * 24;
    } else if (tf.endsWith('w')) {
        return parseInt(tf.replace('w', '')) * 60 * 24 * 7;
    } else {
        return parseInt(tf);
    }
}

function formatDualTime(timestamp) {
    const date = new Date(timestamp);
    const dateStr = date.toLocaleDateString('en-US', {
        month: '2-digit',
        day: '2-digit', 
        year: 'numeric'
    });
    const time12 = date.toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit',
        second: '2-digit',
        hour12: true 
    });
    const time24 = date.toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit',
        second: '2-digit',
        hour12: false 
    });
    return `${dateStr} ${time12} | ${time24}`;
}

// ===== DATA LOADING =====
async function load1mCandles(symbol, maxCandles, useLocalData = false) {
    if (!useLocalData) {
        const candles = await getCandles(symbol, '1m', maxCandles);
        return candles.sort((a, b) => a.time - b.time);
    } else {
        const csvPath = path.join(__dirname, 'data', 'historical', symbol, '1m.csv');
        if (!fs.existsSync(csvPath)) {
            throw new Error(`Local 1m data not found: ${csvPath}`);
        }
        
        const csvData = fs.readFileSync(csvPath, 'utf8');
        const lines = csvData.trim().split('\n').slice(1); // Skip header
        
        const candles = lines.map(line => {
            const [timestamp, open, high, low, close, volume] = line.split(',');
            return {
                time: parseInt(timestamp),
                open: parseFloat(open),
                high: parseFloat(high),
                low: parseFloat(low),
                close: parseFloat(close),
                volume: parseFloat(volume)
            };
        }).sort((a, b) => a.time - b.time);
        
        return candles.slice(-maxCandles);
    }
}

// ===== PIVOT DETECTION =====
function detectPivot(candles, index, config, pivotDetectionMode = 'close') {
    const { lookback, minSwingPct, minLegBars } = config;
    
    if (lookback === 0 && index === 0) return null;
    if (index < lookback || index >= candles.length) return null;
    
    const currentCandle = candles[index];
    const currentHigh = pivotDetectionMode === 'close' ? currentCandle.close : currentCandle.high;
    const currentLow = pivotDetectionMode === 'close' ? currentCandle.close : currentCandle.low;
    
    // Check for high pivot
    let isHighPivot = true;
    if (lookback > 0) {
        for (let j = 1; j <= lookback; j++) {
            if (index - j < 0) {
                isHighPivot = false;
                break;
            }
            const compareHigh = pivotDetectionMode === 'close' ? candles[index - j].close : candles[index - j].high;
            if (currentHigh <= compareHigh) {
                isHighPivot = false;
                break;
            }
        }
    }
    
    // Check for low pivot
    let isLowPivot = true;
    if (lookback > 0) {
        for (let j = 1; j <= lookback; j++) {
            if (index - j < 0) {
                isLowPivot = false;
                break;
            }
            const compareLow = pivotDetectionMode === 'close' ? candles[index - j].close : candles[index - j].low;
            if (currentLow >= compareLow) {
                isLowPivot = false;
                break;
            }
        }
    }

    // Special handling when lookback = 0
    if (lookback === 0) {
        const prev = candles[index - 1];
        const prevHigh = pivotDetectionMode === 'close' ? prev.close : prev.high;
        const prevLow = pivotDetectionMode === 'close' ? prev.close : prev.low;
        isHighPivot = currentHigh > prevHigh;
        isLowPivot = currentLow < prevLow;

        if (isHighPivot && isLowPivot) {
            const upExcursion = Math.abs(currentHigh - prevHigh);
            const downExcursion = Math.abs(prevLow - currentLow);
            if (upExcursion >= downExcursion) {
                isLowPivot = false;
            } else {
                isHighPivot = false;
            }
        }
    }
    
    if (!isHighPivot && !isLowPivot) return null;
    
    const pivotType = isHighPivot ? 'high' : 'low';
    const pivotPrice = isHighPivot ? currentHigh : currentLow;
    
    // Calculate swing percentage
    let maxSwingPct = 0;
    
    if (minSwingPct > 0) {
        const upper = lookback === 0 ? 1 : lookback;
        for (let j = 1; j <= upper; j++) {
            if (index - j < 0) break;
            
            const compareCandle = candles[index - j];
            const comparePrice = pivotDetectionMode === 'close' ? compareCandle.close : 
                                (pivotType === 'high' ? compareCandle.low : compareCandle.high);
            
            const swingPct = Math.abs((pivotPrice - comparePrice) / comparePrice * 100);
            maxSwingPct = Math.max(maxSwingPct, swingPct);
        }
        
        if (maxSwingPct < minSwingPct) {
            return null;
        }
    }
    
    return {
        type: pivotType,
        price: pivotPrice,
        time: currentCandle.time,
        index: index,
        signal: pivotType === 'high' ? 'short' : 'long',
        swingPct: maxSwingPct
    };
}

// ===== IMMEDIATE AGGREGATION =====
function buildImmediateAggregatedCandles(oneMinCandles, timeframeMinutes) {
    const aggregatedCandles = [];
    const bucketSizeMs = timeframeMinutes * 60 * 1000;
    
    const buckets = new Map();
    
    for (const candle of oneMinCandles) {
        const bucketEnd = Math.ceil(candle.time / bucketSizeMs) * bucketSizeMs;
        
        if (!buckets.has(bucketEnd)) {
            buckets.set(bucketEnd, []);
        }
        buckets.get(bucketEnd).push(candle);
    }
    
    for (const [bucketEnd, candlesInBucket] of buckets.entries()) {
        if (candlesInBucket.length === timeframeMinutes) {
            const sortedCandles = candlesInBucket.sort((a, b) => a.time - b.time);
            
            const aggregatedCandle = {
                time: bucketEnd,
                open: sortedCandles[0].open,
                high: Math.max(...sortedCandles.map(c => c.high)),
                low: Math.min(...sortedCandles.map(c => c.low)),
                close: sortedCandles[sortedCandles.length - 1].close,
                volume: sortedCandles.reduce((sum, c) => sum + c.volume, 0)
            };
            
            aggregatedCandles.push(aggregatedCandle);
        }
    }
    
    return aggregatedCandles.sort((a, b) => a.time - b.time);
}

// ===== TRADE MANAGEMENT =====
function createTrade(signal, pivot, tradeSize, currentTime, timeframe, entryPrice, tradeConfig) {
    const isLong = signal === 'long';
    
    // Calculate TP and SL
    const tpDistance = entryPrice * (tradeConfig.takeProfit / 100);
    const slDistance = entryPrice * (tradeConfig.stopLoss / 100);
    
    const takeProfitPrice = isLong ? entryPrice + tpDistance : entryPrice - tpDistance;
    const stopLossPrice = isLong ? entryPrice - slDistance : entryPrice + slDistance;
    
    return {
        id: Date.now() + Math.random(),
        type: signal,
        timeframe: timeframe,
        entryPrice: entryPrice,
        entryTime: currentTime,
        tradeSize: tradeSize,
        takeProfitPrice: takeProfitPrice,
        stopLossPrice: stopLossPrice,
        leverage: tradeConfig.leverage,
        status: 'open',
        exitPrice: null,
        exitTime: null,
        exitReason: '',
        pnl: 0,
        pnlPct: 0,
        pivot: pivot,
        bestPrice: entryPrice
    };
}

function updateTrade(trade, currentCandle) {
    const currentPrice = currentCandle.close;
    const isLong = trade.type === 'long';
    
    // Update best price achieved
    if (isLong) {
        if (currentPrice > trade.bestPrice) {
            trade.bestPrice = currentPrice;
        }
    } else {
        if (currentPrice < trade.bestPrice) {
            trade.bestPrice = currentPrice;
        }
    }
    
    // Check for exit conditions
    let shouldClose = false;
    let exitReason = '';
    
    if (isLong) {
        if (currentPrice >= trade.takeProfitPrice) {
            shouldClose = true;
            exitReason = 'TP';
        } else if (currentPrice <= trade.stopLossPrice) {
            shouldClose = true;
            exitReason = 'SL';
        }
    } else {
        if (currentPrice <= trade.takeProfitPrice) {
            shouldClose = true;
            exitReason = 'TP';
        } else if (currentPrice >= trade.stopLossPrice) {
            shouldClose = true;
            exitReason = 'SL';
        }
    }
    
    if (shouldClose) {
        trade.status = 'closed';
        trade.exitPrice = currentPrice;
        trade.exitTime = currentCandle.time;
        trade.exitReason = exitReason;
        
        // Calculate P&L
        const priceChange = isLong ? (trade.exitPrice - trade.entryPrice) : (trade.entryPrice - trade.exitPrice);
        trade.pnl = (priceChange / trade.entryPrice) * trade.tradeSize * trade.leverage;
        trade.pnlPct = (priceChange / trade.entryPrice) * 100 * trade.leverage;
        
        // Apply fees (simplified)
        const totalFees = trade.tradeSize * 0.001 * 2; // 0.1% entry + exit
        trade.pnl -= totalFees;
    }
    
    return shouldClose;
}

// ===== MAIN BACKTESTING FUNCTION =====
async function runBacktestWithParameters(params) {
    try {
        const symbol = 'BTCUSDT'; // Fixed symbol for now
        const pivotDetectionMode = 'close'; // Fixed mode for now
        
        // Create trade config from parameters
        const tradeConfig = {
            takeProfit: params.takeProfit,
            stopLoss: params.stopLoss,
            leverage: params.leverage,
            initialCapital: 100, // Fixed initial capital
            amountPerTrade: 100, // Fixed trade size for simplicity
            direction: 'both' // Fixed direction for now
        };
        
        // Load 1m candles from local CSV (much faster than API)
        const oneMinuteCandles = await load1mCandles(symbol, params.maxCandles, true);
        
        // Build aggregated candles for all timeframes
        const timeframeData = {};
        const allTimeframePivots = {};
        
        for (const tfConfig of params.timeframes) {
            const tf = tfConfig.interval;
            const timeframeMinutes = parseTimeframeToMinutes(tf);
            
            const aggregatedCandles = buildImmediateAggregatedCandles(oneMinuteCandles, timeframeMinutes);
            timeframeData[tf] = {
                candles: aggregatedCandles,
                config: tfConfig
            };
            
            // Detect all pivots for this timeframe
            const pivots = [];
            let lastAcceptedPivotIndex = null;
            for (let i = tfConfig.lookback; i < aggregatedCandles.length; i++) {
                const pivot = detectPivot(aggregatedCandles, i, {
                    lookback: tfConfig.lookback,
                    minSwingPct: tfConfig.minSwingPct,
                    minLegBars: tfConfig.minLegBars
                }, pivotDetectionMode);

                if (!pivot) continue;

                // Enforce minimum bars between consecutive pivots
                if (lastAcceptedPivotIndex !== null) {
                    const barsSinceLast = i - lastAcceptedPivotIndex;
                    if (typeof tfConfig.minLegBars === 'number' && barsSinceLast < tfConfig.minLegBars) {
                        continue;
                    }
                }

                pivots.push(pivot);
                lastAcceptedPivotIndex = i;
            }
            
            allTimeframePivots[tf] = pivots;
        }
        
        // Get primary timeframe for main loop
        const primaryTf = params.timeframes.find(tf => tf.role === 'primary');
        if (!primaryTf) {
            throw new Error('No primary timeframe configured');
        }
        
        const primaryCandles = timeframeData[primaryTf.interval].candles;
        const primaryPivots = allTimeframePivots[primaryTf.interval];
        
        // Trading simulation
        let capital = tradeConfig.initialCapital;
        let openTrades = [];
        let allTrades = [];
        let totalSignals = 0;
        
        // Create a map of 1-minute candle times for quick lookup
        const oneMinuteTimeMap = new Map();
        oneMinuteCandles.forEach((candle, index) => {
            oneMinuteTimeMap.set(candle.time, index);
        });
        
        // Process each primary timeframe candle
        for (let i = 0; i < primaryCandles.length; i++) {
            const currentCandle = primaryCandles[i];
            const currentTime = currentCandle.time;
            
            // Find the corresponding 1-minute candle range for this primary candle
            const primaryTfMinutes = parseTimeframeToMinutes(primaryTf.interval);
            const startTime = currentTime - (primaryTfMinutes * 60 * 1000);
            
            // Find all 1-minute candles that fall within this primary candle's time range
            const minuteCandlesInRange = [];
            for (let j = 0; j < oneMinuteCandles.length; j++) {
                const minuteCandle = oneMinuteCandles[j];
                if (minuteCandle.time > startTime && minuteCandle.time <= currentTime) {
                    minuteCandlesInRange.push(minuteCandle);
                }
            }
            
            // Update existing trades with each 1-minute candle in the range
            for (const minuteCandle of minuteCandlesInRange) {
                for (let j = openTrades.length - 1; j >= 0; j--) {
                    const trade = openTrades[j];
                    
                    if (minuteCandle.time >= trade.entryTime) {
                        const shouldClose = updateTrade(trade, minuteCandle);
                        
                        if (shouldClose) {
                            capital += trade.pnl;
                            openTrades.splice(j, 1);
                        }
                    }
                }
            }
            
            // Check for new pivot signals
            const currentPivot = primaryPivots.find(p => p.time === currentTime);
            if (currentPivot) {
                totalSignals++;
                
                // For pivot mode, trade every signal
                if (params.tradingMode === 'pivot') {
                    // Determine trade type based on pivot signal and opposite setting
                    let tradeSignal = currentPivot.signal;
                    if (primaryTf.opposite) {
                        tradeSignal = currentPivot.signal === 'long' ? 'short' : 'long';
                    }
                    
                    // Simple direction filtering
                    let shouldTrade = true;
                    if (tradeConfig.direction === 'buy' && tradeSignal === 'short') shouldTrade = false;
                    if (tradeConfig.direction === 'sell' && tradeSignal === 'long') shouldTrade = false;
                    
                    if (shouldTrade && capital > 0 && openTrades.length === 0) {
                        const trade = createTrade(
                            tradeSignal,
                            currentPivot,
                            tradeConfig.amountPerTrade,
                            currentTime,
                            primaryTf.interval,
                            currentPivot.price,
                            tradeConfig
                        );
                        
                        openTrades.push(trade);
                        allTrades.push(trade);
                    }
                }
            }
        }
        
        // Close any remaining open trades
        for (const trade of openTrades) {
            const lastCandle = primaryCandles[primaryCandles.length - 1];
            updateTrade(trade, lastCandle);
            capital += trade.pnl;
        }
        
        // Calculate statistics
        const winningTrades = allTrades.filter(t => t.pnl > 0).length;
        const losingTrades = allTrades.filter(t => t.pnl < 0).length;
        const winRate = allTrades.length > 0 ? (winningTrades / allTrades.length) * 100 : 0;
        const totalReturn = ((capital - tradeConfig.initialCapital) / tradeConfig.initialCapital) * 100;
        
        const dataStartTime = oneMinuteCandles[0].time;
        const dataEndTime = oneMinuteCandles[oneMinuteCandles.length - 1].time;
        const totalHours = (dataEndTime - dataStartTime) / (1000 * 60 * 60);
        const signalsPerDay = totalSignals > 0 ? (totalSignals / totalHours) * 24 : 0;
        const tradesPerDay = allTrades.length > 0 ? (allTrades.length / totalHours) * 24 : 0;
        
        // Calculate additional metrics
        const wins = allTrades.filter(t => t.pnl > 0);
        const losses = allTrades.filter(t => t.pnl < 0);
        const avgWin = wins.length > 0 ? wins.reduce((sum, t) => sum + t.pnlPct, 0) / wins.length : 0;
        const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((sum, t) => sum + t.pnlPct, 0) / losses.length) : 0;
        const largestWin = wins.length > 0 ? Math.max(...wins.map(t => t.pnlPct)) : 0;
        const largestLoss = losses.length > 0 ? Math.min(...losses.map(t => t.pnlPct)) : 0;
        
        const profitFactor = losses.length > 0 ? 
            wins.reduce((sum, t) => sum + Math.abs(t.pnl), 0) / losses.reduce((sum, t) => sum + Math.abs(t.pnl), 0) : 
            (wins.length > 0 ? 999 : 0);
        
        // Calculate trade durations
        const tradeDurations = allTrades.filter(t => t.exitTime).map(t => (t.exitTime - t.entryTime) / (1000 * 60 * 60)); // hours
        const avgTradeDuration = tradeDurations.length > 0 ? tradeDurations.reduce((sum, d) => sum + d, 0) / tradeDurations.length : 0;
        
        return {
            initialCapital: tradeConfig.initialCapital,
            finalCapital: capital,
            totalReturnPct: totalReturn,
            totalTrades: allTrades.length,
            winningTrades: winningTrades,
            losingTrades: losingTrades,
            winRatePct: winRate,
            totalSignals: totalSignals,
            confirmedSignals: totalSignals, // In pivot mode, all signals are confirmed
            confirmationRatePct: 100,
            executionRatePct: allTrades.length > 0 ? (allTrades.length / totalSignals) * 100 : 0,
            signalsPerDay: signalsPerDay,
            tradesPerDay: tradesPerDay,
            avgTradeDurationHours: avgTradeDuration,
            maxDrawdownPct: 0, // TODO: Calculate drawdown
            sharpeRatio: 0, // TODO: Calculate Sharpe ratio
            profitFactor: profitFactor,
            avgWinPct: avgWin,
            avgLossPct: avgLoss,
            largestWinPct: largestWin,
            largestLossPct: largestLoss,
            consecutiveWins: 0, // TODO: Calculate consecutive wins/losses
            consecutiveLosses: 0,
            totalFees: 0, // TODO: Calculate total fees
            netProfit: capital - tradeConfig.initialCapital,
            roiAnnualizedPct: totalReturn * (365 * 24 / totalHours) // Annualized return
        };
        
    } catch (error) {
        throw new Error(`Backtest failed: ${error.message}`);
    }
}

// Worker thread main execution
if (workerData) {
    runBacktestWithParameters(workerData)
        .then(result => {
            parentPort.postMessage(result);
        })
        .catch(error => {
            parentPort.postMessage({ error: error.message });
        });
}
