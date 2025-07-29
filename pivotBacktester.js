// tests/instantPivotTest.js
// Self-sufficient test file for instant pivot detection using the user's two-step logic.

import {
    symbol,
    time as interval,
    limit,
    minSwingPct,
    pivotLookback,
    minLegBars
} from './config/config.js';
import { getCandles } from './apis/bybit.js';
import { tradeConfig } from './config/tradeconfig.js';

const colors = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
};

const displayCandleInfo = (candle, candleNumber, pivotType = null) => {
    const formattedTime = new Date(candle.time).toLocaleString();
    const o = candle.open.toFixed(2);
    const h = candle.high.toFixed(2);
    const l = candle.low.toFixed(2);
    const c = candle.close.toFixed(2);
    const cColor = c >= o ? colors.green : colors.red;

    let pivotIndicator = '   ';
    if (pivotType) {
        const pivotColor = pivotType === 'high' ? colors.green : colors.red;
        const pivotArrow = pivotType === 'high' ? '▲ H' : '▼ L';
        pivotIndicator = `${pivotColor}${pivotArrow}${colors.reset}`;
    }

    console.log(`  ${(candleNumber).toString().padStart(5, ' ')} | ${pivotIndicator} | ${formattedTime} | O: ${o} H: ${h} L: ${l} C: ${cColor}${c}${colors.reset}`);
};

console.log(`${colors.cyan}--- Instant Pivot Detection Test (No Lookahead) ---${colors.reset}`);

// Display trade configuration at the top
console.log(`${colors.cyan}--- Trade Configuration ---${colors.reset}`);
console.log(`Direction: ${colors.yellow}${tradeConfig.direction}${colors.reset}`);
console.log(`Take Profit: ${colors.green}${tradeConfig.takeProfit}%${colors.reset}`);
console.log(`Stop Loss: ${colors.red}${tradeConfig.stopLoss}%${colors.reset}`);
console.log(`Leverage: ${colors.yellow}${tradeConfig.leverage}x${colors.reset}`);
console.log(`Maker Fee: ${colors.yellow}${tradeConfig.totalMakerFee}%${colors.reset}`);
console.log(`Initial Capital: ${colors.yellow}${tradeConfig.initialCapital} USDT${colors.reset}`);
console.log(`Risk Per Trade: ${colors.yellow}${tradeConfig.riskPerTrade}%${colors.reset}`);


async function runTest() {
    const allLocalCandles = await getCandles(symbol, interval, null, null, true);
    // Ensure there are enough candles for the lookback on both sides
    if (!allLocalCandles || allLocalCandles.length < (pivotLookback * 2 + 1)) {
        console.error(`Not enough historical data. Need at least ${pivotLookback * 2 + 1} candles for lookback of ${pivotLookback}.`);
        return;
    }
    const candles = allLocalCandles.slice(-limit);
    console.log(`Loaded ${candles.length} of ${allLocalCandles.length} available '${interval}' local candles.\n`);

    let lastPivot = { type: null, price: null, time: null, index: 0 };
    const swingThreshold = minSwingPct / 100;
    let pivotCounter = 0;
    let highPivotCount = 0;
    let lowPivotCount = 0;

    // --- Trade State Initialization ---
    let capital = tradeConfig.initialCapital;
    const trades = [];
    let activeTrade = null;
    let tradeMaxDrawdown = 0;
    let tradeMaxProfit = 0;

    // Iterate, leaving enough space for lookback on either side
    for (let i = pivotLookback; i < candles.length; i++) {
        const currentCandle = candles[i];
        let pivotType = null;

        // --- Active Trade Management ---
        if (activeTrade) {
            let tradeClosed = false;
            let exitPrice = null;
            let result = '';
            
            // Track maximum favorable and unfavorable price movements
            if (activeTrade.type === 'long') {
                // For long trades: favorable = price goes up, unfavorable = price goes down
                const currentFavorable = (currentCandle.high - activeTrade.entryPrice) / activeTrade.entryPrice * 100;
                const currentUnfavorable = (currentCandle.low - activeTrade.entryPrice) / activeTrade.entryPrice * 100;
                
                activeTrade.maxFavorable = Math.max(activeTrade.maxFavorable, currentFavorable);
                activeTrade.maxUnfavorable = Math.min(activeTrade.maxUnfavorable, currentUnfavorable);
            } else { // short
                // For short trades: favorable = price goes down, unfavorable = price goes up
                const currentFavorable = (activeTrade.entryPrice - currentCandle.low) / activeTrade.entryPrice * 100;
                const currentUnfavorable = (activeTrade.entryPrice - currentCandle.high) / activeTrade.entryPrice * 100;
                
                activeTrade.maxFavorable = Math.max(activeTrade.maxFavorable, currentFavorable);
                activeTrade.maxUnfavorable = Math.min(activeTrade.maxUnfavorable, currentUnfavorable);
            }

            // Check for trade timeout if maxTradeTimeMinutes is enabled (greater than 0)
            if (tradeConfig.maxTradeTimeMinutes > 0) {
                const tradeTimeMs = currentCandle.time - activeTrade.entryTime;
                const tradeTimeMinutes = tradeTimeMs / (1000 * 60);
                
                if (tradeTimeMinutes >= tradeConfig.maxTradeTimeMinutes) {
                    tradeClosed = true;
                    exitPrice = currentCandle.close; // Use current candle close price for timeout exits
                    result = 'TIMEOUT';
                }
            }

            if (!tradeClosed) { // Only check TP/SL if not already closed due to timeout
                if (activeTrade.type === 'long') {
                    if (currentCandle.high >= activeTrade.takeProfitPrice) {
                        tradeClosed = true;
                        exitPrice = activeTrade.takeProfitPrice;
                        result = 'TP';
                    } else if (currentCandle.low <= activeTrade.stopLossPrice) {
                        tradeClosed = true;
                        exitPrice = activeTrade.stopLossPrice;
                        result = 'SL';
                    }
                } else { // short
                    if (currentCandle.low <= activeTrade.takeProfitPrice) {
                        tradeClosed = true;
                        exitPrice = activeTrade.takeProfitPrice;
                        result = 'TP';
                    } else if (currentCandle.high >= activeTrade.stopLossPrice) {
                        tradeClosed = true;
                        exitPrice = activeTrade.stopLossPrice;
                        result = 'SL';
                    }
                }
            }

            if (tradeClosed) {
                const pnlPct = (activeTrade.type === 'long' ? (exitPrice - activeTrade.entryPrice) / activeTrade.entryPrice : (activeTrade.entryPrice - exitPrice) / activeTrade.entryPrice) * tradeConfig.leverage;
                const grossPnl = activeTrade.size * pnlPct;
                const fee = (activeTrade.size * tradeConfig.leverage * (tradeConfig.totalMakerFee / 100));
                const pnl = grossPnl - fee;
                
                capital += pnl;

                const resultColor = result === 'TP' ? colors.green : colors.red;
                const tradeType = activeTrade.type.toUpperCase();
                const pnlText = `${resultColor}${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}${colors.reset}`;
                // Only log trade details if showTradeDetails is enabled
                if (tradeConfig.showTradeDetails) {
                    console.log(`  \x1b[35;1m└─> [${result}] ${tradeType} trade closed @ ${exitPrice.toFixed(2)}. PnL: ${pnlText}${colors.reset}`);
                }

                trades.push({
                    ...activeTrade,
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
                activeTrade = null;
            }
        }

        // --- High Pivot Logic ---
        let isHighPivot = true;
        for (let j = 1; j <= pivotLookback; j++) {
            if (currentCandle.high <= candles[i - j].high) {
                isHighPivot = false;
                break;
            }
        }

        if (isHighPivot) {
            const swingPct = lastPivot.price ? (currentCandle.high - lastPivot.price) / lastPivot.price : 0;
            const isFirstPivot = lastPivot.type === null;

            // For the first pivot, we don't check swingPct. For subsequent pivots, we do.
            if ((isFirstPivot || Math.abs(swingPct) >= swingThreshold) && (i - lastPivot.index) >= minLegBars) {
                pivotType = 'high';
                pivotCounter++;
                highPivotCount++;
                const barsSinceLast = i - lastPivot.index;
                const movePct = swingPct * 100;
                const formattedTime = new Date(currentCandle.time).toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'medium' });

                let output = `${colors.green}${pivotCounter}.[PIVOT] HIGH @ ${currentCandle.high.toFixed(2)} | Time: ${formattedTime} | Move: +${movePct.toFixed(2)}% | Bars: ${barsSinceLast}${colors.reset}`;

                if (lastPivot.price) {
                    const swingCandles = candles.slice(lastPivot.index, i + 1);
                    const swingATL = Math.min(...swingCandles.map(c => c.low));
                    const swingATH = Math.max(...swingCandles.map(c => c.high));

                    const swingLowPct = ((swingATL - lastPivot.price) / lastPivot.price) * 100;
                    const swingHighPct = ((swingATH - lastPivot.price) / lastPivot.price) * 100;

                    const swingLowText = `${colors.red}${swingATL.toFixed(2)} (${swingLowPct.toFixed(2)}%)${colors.reset}`;
                    const swingHighText = `${colors.green}${swingATH.toFixed(2)} (${swingHighPct.toFixed(2)}%)${colors.reset}`;
                    output += ` | ${colors.cyan}Swing Low:${colors.reset} ${swingLowText} | ${colors.cyan}Swing High:${colors.reset} ${swingHighText}`;
                }
                
                // Only log pivot information if showPivot is enabled
                if (tradeConfig.showPivot) {
                    console.log(output);
                }

                lastPivot = { type: 'high', price: currentCandle.high, time: currentCandle.time, index: i };

                // --- Open Short Trade ---
                if (!isFirstPivot && !activeTrade && (tradeConfig.direction === 'sell' || tradeConfig.direction === 'both')) {
                    const entryPrice = currentCandle.high;
                    const size = capital * (tradeConfig.riskPerTrade / 100);
                    const takeProfitPrice = entryPrice * (1 - (tradeConfig.takeProfit / 100));
                    const stopLossPrice = entryPrice * (1 + (tradeConfig.stopLoss / 100));

                    activeTrade = {
                        type: 'short',
                        entryPrice,
                        entryTime: currentCandle.time,
                        entryIndex: i,
                        size,
                        status: 'open',
                        takeProfitPrice,
                        stopLossPrice,
                        pivot: { ...lastPivot },
                        maxFavorable: 0,  // Track maximum favorable price movement
                        maxUnfavorable: 0  // Track maximum unfavorable price movement
                    };
                    // Only log limit order information if showLimits is enabled
                    if (tradeConfig.showLimits) {
                        console.log(`  ${colors.yellow}└─> [SHORT] Entry: ${entryPrice.toFixed(2)} | Size: ${size.toFixed(2)} | TP: ${takeProfitPrice.toFixed(2)} | SL: ${stopLossPrice.toFixed(2)}${colors.reset}`);
                    }
                }
            }
        }

        // --- Low Pivot Logic ---
        let isLowPivot = true;
        for (let j = 1; j <= pivotLookback; j++) {
            if (currentCandle.low >= candles[i - j].low) {
                isLowPivot = false;
                break;
            }
        }

        if (isLowPivot) {
            const swingPct = lastPivot.price ? (currentCandle.low - lastPivot.price) / lastPivot.price : 0;
            const isFirstPivot = lastPivot.type === null;

            if ((isFirstPivot || Math.abs(swingPct) >= swingThreshold) && (i - lastPivot.index) >= minLegBars) {
                pivotType = 'low';
                pivotCounter++;
                lowPivotCount++;
                const barsSinceLast = i - lastPivot.index;
                const movePct = swingPct * 100;
                const formattedTime = new Date(currentCandle.time).toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'medium' });

                let output = `${colors.red}${pivotCounter}.[PIVOT] LOW  @ ${currentCandle.low.toFixed(2)} | Time: ${formattedTime} | Move: ${movePct.toFixed(2)}% | Bars: ${barsSinceLast}${colors.reset}`;

                if (lastPivot.price) {
                    const swingCandles = candles.slice(lastPivot.index, i + 1);
                    const swingATL = Math.min(...swingCandles.map(c => c.low));
                    const swingATH = Math.max(...swingCandles.map(c => c.high));

                    const swingLowPct = ((swingATL - lastPivot.price) / lastPivot.price) * 100;
                    const swingHighPct = ((swingATH - lastPivot.price) / lastPivot.price) * 100;

                    const swingLowText = `${colors.red}${swingATL.toFixed(2)} (${swingLowPct.toFixed(2)}%)${colors.reset}`;
                    const swingHighText = `${colors.green}${swingATH.toFixed(2)} (${swingHighPct.toFixed(2)}%)${colors.reset}`;
                    output += ` | ${colors.cyan}Swing Low:${colors.reset} ${swingLowText} | ${colors.cyan}Swing High:${colors.reset} ${swingHighText}`;
                }

                // Only log pivot information if showPivot is enabled
                if (tradeConfig.showPivot) {
                    console.log(output);
                }
                
                lastPivot = { type: 'low', price: currentCandle.low, time: currentCandle.time, index: i };

                // --- Open Long Trade ---
                if (!isFirstPivot && !activeTrade && (tradeConfig.direction === 'buy' || tradeConfig.direction === 'both')) {
                    const entryPrice = currentCandle.low;
                    const size = capital * (tradeConfig.riskPerTrade / 100);
                    const takeProfitPrice = entryPrice * (1 + (tradeConfig.takeProfit / 100));
                    const stopLossPrice = entryPrice * (1 - (tradeConfig.stopLoss / 100));

                    activeTrade = {
                        type: 'long',
                        entryPrice,
                        entryTime: currentCandle.time,
                        entryIndex: i,
                        size,
                        status: 'open',
                        takeProfitPrice,
                        stopLossPrice,
                        pivot: { ...lastPivot },
                        maxFavorable: 0,  // Track maximum favorable price movement
                        maxUnfavorable: 0  // Track maximum unfavorable price movement
                    };
                    // Only log limit order information if showLimits is enabled
                    if (tradeConfig.showLimits) {
                        console.log(`  ${colors.yellow}└─> [LONG]  Entry: ${entryPrice.toFixed(2)} | Size: ${size.toFixed(2)} | TP: ${takeProfitPrice.toFixed(2)} | SL: ${stopLossPrice.toFixed(2)}${colors.reset}`);
                    }
                }
            }
        }

        // Display the current candle, highlighting if it's a new pivot
                if (tradeConfig.showCandle) {
            displayCandleInfo(currentCandle, i + 1, pivotType);
        }
    }
    
  

    // --- Final Summary Calculation ---
    const firstPrice = candles[0].open;
    const highestHigh = Math.max(...candles.map(c => c.high));
    const lowestLow = Math.min(...candles.map(c => c.low));

    const totalUpwardChange = ((highestHigh - firstPrice) / firstPrice) * 100;
    const totalDownwardChange = ((lowestLow - firstPrice) / firstPrice) * 100;
    const netPriceRange = ((highestHigh - lowestLow) / lowestLow) * 100;



    // --- Trade Summary --- 
    let finalCapital = capital;
    
    // Close any open trades at the end of backtesting using the last candle's close price
    if (activeTrade) {
        const endPrice = candles[candles.length - 1].close;
        const pnlPct = (activeTrade.type === 'long' ? (endPrice - activeTrade.entryPrice) / activeTrade.entryPrice : (activeTrade.entryPrice - endPrice) / activeTrade.entryPrice) * tradeConfig.leverage;
        const grossPnl = activeTrade.size * pnlPct;
        const fee = (activeTrade.size * tradeConfig.leverage * (tradeConfig.totalMakerFee / 100));
        const pnl = grossPnl - fee;
        
        capital += pnl;
        finalCapital = capital;
        
        // Always show EOB trade closing message, but only show details if showTradeDetails is enabled
        console.log(`
${colors.yellow}Closing open trade at end of backtest.${colors.reset}`)
        if (tradeConfig.showTradeDetails) {
            console.log(`  └─> [EOB] ${activeTrade.type.toUpperCase()} trade closed @ ${endPrice.toFixed(2)}. PnL: ${(pnl >= 0 ? colors.green : colors.red)}${pnl.toFixed(2)}${colors.reset}`);
        }
        
        // Add the closed trade to the trades array
        trades.push({
            ...activeTrade,
            exitPrice: endPrice,
            exitTime: candles[candles.length - 1].time,
            exitIndex: candles.length - 1,
            status: 'closed',
            result: 'EOB', // End Of Backtest
            grossPnl,
            pnl,
            fee,
            capitalAfter: capital
        });
        
        activeTrade = null;
    }

    // Define regularTrades and eobTrades at the top level
    const regularTrades = trades.filter(t => t.result !== 'EOB');
    const eobTrades = trades.filter(t => t.result === 'EOB');
    
    // Only display trade details if showTradeDetails is enabled
    if ((trades.length > 0 || activeTrade) && tradeConfig.showTradeDetails) {
        // Display detailed trade information
        console.log(`\n${colors.cyan}--- Trade Details ---${colors.reset}`);
        console.log('--------------------------------------------------------------------------------');
        
        trades.forEach((trade, index) => {
            // Format dates to be more readable
            const entryDate = new Date(trade.entryTime);
            const exitDate = new Date(trade.exitTime);
            const entryDateStr = `${entryDate.toLocaleDateString('en-US', { weekday: 'short' })} ${entryDate.toLocaleDateString()} ${entryDate.toLocaleTimeString()}`;
            const exitDateStr = `${exitDate.toLocaleDateString('en-US', { weekday: 'short' })} ${exitDate.toLocaleDateString()} ${exitDate.toLocaleTimeString()}`;
            
            // Calculate duration
            const durationMs = trade.exitTime - trade.entryTime;
            const durationDays = Math.floor(durationMs / (1000 * 60 * 60 * 24));
            const durationHours = Math.floor((durationMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            const durationMinutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));
            
            // Format duration string to include days when applicable
            let durationStr = '';
            if (durationDays > 0) {
                durationStr = `${durationDays} days, ${durationHours} hours, ${durationMinutes} minutes`;
            } else {
                durationStr = `${durationHours} hours, ${durationMinutes} minutes`;
            }
            
            // Determine if win or loss
            const resultColor = trade.pnl >= 0 ? colors.green : colors.red;
            const resultText = trade.pnl >= 0 ? 'WIN' : 'LOSS';
            const pnlPct = ((trade.pnl / trade.size) * 100).toFixed(2);
            
            // Determine trade type color
            const typeColor = trade.type === 'long' ? colors.green : colors.red;
            
            // Format the trade header - entire line in result color
            console.log(`${resultColor}[TRADE ${(index + 1).toString().padStart(2, ' ')}] ${trade.type.toUpperCase()} | P&L: ${pnlPct}% | ${resultText} | Result: ${trade.result}${colors.reset}`);
            console.log();
            console.log(`${colors.cyan}  Entry: ${entryDateStr} at $${trade.entryPrice.toFixed(4)}${colors.reset}`);
            console.log(`${colors.cyan}  Exit:  ${exitDateStr} at $${trade.exitPrice.toFixed(4)}${colors.reset}`);
            console.log(`${colors.cyan}  Duration: ${durationStr}${colors.reset}`);
            
            // Display maximum favorable and unfavorable movements
            const favorableColor = trade.maxFavorable >= 0 ? colors.green : colors.red;
            const unfavorableColor = trade.maxUnfavorable >= 0 ? colors.green : colors.red;
            console.log(`  Max Favorable Movement: ${favorableColor}${trade.maxFavorable.toFixed(4)}%${colors.reset}`);
            console.log(`  Max Unfavorable Movement: ${unfavorableColor}${trade.maxUnfavorable.toFixed(4)}%${colors.reset}`);
            
            // Add price movement information
            const priceDiff = trade.exitPrice - trade.entryPrice;
            const priceDiffPct = (priceDiff / trade.entryPrice * 100).toFixed(4);
            const priceColor = priceDiff >= 0 ? colors.green : colors.red;
            console.log(`  Price Movement: ${priceColor}${priceDiff > 0 ? '+' : ''}${priceDiffPct}%${colors.reset} (${priceColor}$${priceDiff.toFixed(4)}${colors.reset})`);
            console.log('--------------------------------------------------------------------------------');
        });
    }
    
      
    // Calculate price movement statistics
    if (regularTrades.length > 0) {
        const favorableMovements = regularTrades.map(t => t.maxFavorable);
        const unfavorableMovements = regularTrades.map(t => t.maxUnfavorable);
        
        const maxFavorable = Math.max(...favorableMovements);
        const minFavorable = Math.min(...favorableMovements);
        const avgFavorable = favorableMovements.reduce((sum, val) => sum + val, 0) / favorableMovements.length;
        
        const maxUnfavorable = Math.max(...unfavorableMovements);
        const minUnfavorable = Math.min(...unfavorableMovements);
        const avgUnfavorable = unfavorableMovements.reduce((sum, val) => sum + val, 0) / unfavorableMovements.length;
        
        console.log(`\n${colors.cyan}--- Price Movement Statistics ---${colors.reset}`);
        console.log(`Favorable Movements (Higher is better):`);
        console.log(`  Highest: ${colors.green}${maxFavorable.toFixed(4)}%${colors.reset}`);
        console.log(`  Lowest:  ${colors.yellow}${minFavorable.toFixed(4)}%${colors.reset}`);
        console.log(`  Average: ${colors.cyan}${avgFavorable.toFixed(4)}%${colors.reset}`);
        
        console.log(`Unfavorable Movements (Higher is better):`);
        console.log(`  Highest: ${colors.green}${maxUnfavorable.toFixed(4)}%${colors.reset}`);
        console.log(`  Lowest:  ${colors.red}${minUnfavorable.toFixed(4)}%${colors.reset}`);
        console.log(`  Average: ${colors.cyan}${avgUnfavorable.toFixed(4)}%${colors.reset}`);
    }



    const totalPivots = highPivotCount + lowPivotCount;
    if (totalPivots > 0) {
        const highPct = ((highPivotCount / totalPivots) * 100).toFixed(2);
        const lowPct = ((lowPivotCount / totalPivots) * 100).toFixed(2);
        console.log(`\n${colors.cyan}--- Pivot Summary ---${colors.reset}`);
        console.log(`${colors.green}High Pivots: ${highPivotCount.toString().padStart(2)} (${highPct}%)${colors.reset}`);
        console.log(`${colors.red}Low Pivots:  ${lowPivotCount.toString().padStart(2)} (${lowPct}%)${colors.reset}`);
        console.log(`Total Pivots: ${totalPivots}`);
    }

   
    console.log(`\n${colors.cyan}--- Market Movement Summary ---${colors.reset}`);
    console.log(`Max Upward Move: ${colors.green}+${totalUpwardChange.toFixed(2)}%${colors.reset} (from start to ATH)`);
    console.log(`Max Downward Move: ${colors.red}${totalDownwardChange.toFixed(2)}%${colors.reset} (from start to ATL)`);
    console.log(`Net Price Range: ${colors.yellow}${netPriceRange.toFixed(2)}%${colors.reset} (from ATL to ATH)`);



    console.log(`\n \n ${colors.yellow}--- TRADE SUMMARY ---${colors.reset}`);
    
    // Calculate statistics excluding EOB trades
    const closedTrades = regularTrades.length;
    const totalTrades = trades.length;
    const wins = regularTrades.filter(t => t.pnl >= 0).length;
    const losses = regularTrades.filter(t => t.pnl < 0).length;
    const timeoutTrades = regularTrades.filter(t => t.result === 'TIMEOUT').length;
    const tpTrades = regularTrades.filter(t => t.result === 'TP').length;
    const slTrades = regularTrades.filter(t => t.result === 'SL').length;
    const winRate = closedTrades > 0 ? (wins / closedTrades * 100).toFixed(2) : 'N/A';
    const totalRealizedPnl = regularTrades.reduce((acc, t) => acc + t.pnl, 0);
    const totalFees = regularTrades.reduce((acc, t) => acc + t.fee, 0);
    
    // Display trade counts with EOB note if applicable
    if (eobTrades.length > 0) {
        console.log(`Total Closed Trades: ${closedTrades} (excluding ${eobTrades.length} EOB trade${eobTrades.length > 1 ? 's' : ''})`);
    } else {
        console.log(`Total Closed Trades: ${closedTrades}`);
    }
    
    // Display trade result breakdown
    if (closedTrades > 0) {
        console.log(`Trade Results: ${colors.green}TP: ${tpTrades}${colors.reset} | ${colors.red}SL: ${slTrades}${colors.reset} | ${colors.yellow}TIMEOUT: ${timeoutTrades}${colors.reset}`);
    }
    
    if(closedTrades > 0) {
        console.log(`Wins: ${colors.green}${wins}${colors.reset} | Losses: ${colors.red}${losses}${colors.reset}`);
        console.log(`Win Rate: ${colors.yellow}${winRate}%${colors.reset}`);
    }
    
    console.log(`Total PnL: ${(totalRealizedPnl > 0 ? colors.green : colors.red)}${totalRealizedPnl.toFixed(2)}${colors.reset} (after ${totalFees.toFixed(2)} in fees)`);
    
    // Calculate capital excluding EOB trades
    const eobPnl = eobTrades.reduce((acc, t) => acc + t.pnl, 0);
    const adjustedFinalCapital = finalCapital - eobPnl;
    
    console.log(`Initial Capital: ${tradeConfig.initialCapital.toFixed(2)}`);
    
    if (eobTrades.length > 0) {
        console.log(`Final Capital: ${colors.yellow}${adjustedFinalCapital.toFixed(2)}${colors.reset} (excluding EOB trades)`);
    } else {
        console.log(`Final Capital: ${colors.yellow}${finalCapital.toFixed(2)}${colors.reset}`);
    }
    
    const profit = ((adjustedFinalCapital - tradeConfig.initialCapital) / tradeConfig.initialCapital) * 100;
    console.log(`Overall Profit: ${(profit > 0 ? colors.green : colors.red)}${profit.toFixed(2)}%${colors.reset}${eobTrades.length > 0 ? ' (excluding EOB trades)' : ''}`);
      

    // Calculate trade duration statistics if there are regular trades
    if (regularTrades.length > 0) {
        // Get durations in milliseconds for each trade
        const tradeDurations = regularTrades.map(trade => trade.exitTime - trade.entryTime);
        
        // Find min, max, and average durations
        const minDurationMs = Math.min(...tradeDurations);
        const maxDurationMs = Math.max(...tradeDurations);
        const avgDurationMs = tradeDurations.reduce((sum, duration) => sum + duration, 0) / tradeDurations.length;
        
        // Format duration strings
        const formatDuration = (ms) => {
            const days = Math.floor(ms / (1000 * 60 * 60 * 24));
            const hours = Math.floor((ms % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
            
            if (days > 0) {
                return `${days} days, ${hours} hours, ${minutes} minutes`;
            } else {
                return `${hours} hours, ${minutes} minutes`;
            }
        };


        
        console.log(`\n${colors.cyan}--- Trade Duration Statistics ---${colors.reset}`);
        console.log(`Shortest Trade: ${colors.yellow}${formatDuration(minDurationMs)}${colors.reset}`);
        console.log(`Longest Trade:  ${colors.yellow}${formatDuration(maxDurationMs)}${colors.reset}`);
        console.log(`Average Trade:  ${colors.cyan}${formatDuration(avgDurationMs)}${colors.reset}`);
    }
    



    if (candles.length > 0) {
        const firstCandleTime = candles[0].time;
        const lastCandleTime = candles[candles.length - 1].time;
        const elapsedMs = lastCandleTime - firstCandleTime;

        const days = Math.floor(elapsedMs / (1000 * 60 * 60 * 24));
        const hours = Math.floor((elapsedMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((elapsedMs % (1000 * 60 * 60)) / (1000 * 60));
        
        console.log(`\nData Time Elapsed: ${days} days, ${hours} hours, ${minutes} minutes.`);
    }

    console.log(`\n${colors.cyan}--- Test Complete ---${colors.reset}`);
}

(async () => {
    try {
        await runTest();
    } catch (err) {
        console.error('\nAn error occurred during the test:', err);
        process.exit(1);
    }
})();
