// multiPivotFronttesterV2.js
// CLEAN TIME-PROGRESSIVE CASCADE DETECTION - NO FUTURE LOOK BIAS

import {
    symbol,
    time as interval,
    useLocalData,
    api,
    pivotDetectionMode,
    limit as configLimit
} from './config/config.js';

import { tradeConfig } from './config/tradeconfig.js';
import { multiPivotConfig } from './config/multiPivotConfig.js';
import { fronttesterconfig } from './config/fronttesterconfig.js';
import { MultiTimeframePivotDetector } from './utils/multiTimeframePivotDetector.js';
import { formatNumber } from './utils/formatters.js';
import telegramNotifier from './utils/telegramNotifier.js';
import fs from 'fs';
import path from 'path';

const colors = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    magenta: '\x1b[35m',
    blue: '\x1b[34m',
    white: '\x1b[37m',
    brightGreen: '\x1b[92m',
    brightYellow: '\x1b[93m',
    brightCyan: '\x1b[96m',
    bold: '\x1b[1m'
};

// Helper function to format numbers with commas
const formatNumberWithCommas = (num) => {
    return num.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
};

// Helper function to calculate slippage
const calculateSlippage = (tradeSize, tradeConfig) => {
    if (!tradeConfig.enableSlippage) return 0;
    
    let slippagePercent = 0;
    
    switch (tradeConfig.slippageMode) {
        case 'fixed':
            slippagePercent = tradeConfig.slippagePercent;
            break;
        case 'variable':
            const range = tradeConfig.variableSlippageMax - tradeConfig.variableSlippageMin;
            slippagePercent = tradeConfig.variableSlippageMin + (Math.random() * range);
            break;
        case 'market_impact':
            const marketImpact = (tradeSize / 1000) * tradeConfig.marketImpactFactor;
            slippagePercent = tradeConfig.slippagePercent + marketImpact;
            break;
        default:
            slippagePercent = tradeConfig.slippagePercent;
    }
    
    return slippagePercent / 100;
};

// Helper function to calculate funding rate cost
const calculateFundingRate = (tradeConfig, currentTime, entryTime, positionSize, leverage) => {
    if (!tradeConfig.enableFundingRate) return 0;
    
    const tradeDurationMs = currentTime - entryTime;
    const tradeDurationHours = tradeDurationMs / (1000 * 60 * 60);
    const fundingPeriods = Math.floor(tradeDurationHours / tradeConfig.fundingRateHours);
    
    if (fundingPeriods <= 0) return 0;
    
    let fundingRatePercent = 0;
    
    switch (tradeConfig.fundingRateMode) {
        case 'fixed':
            fundingRatePercent = tradeConfig.fundingRatePercent;
            break;
        case 'variable':
            const range = tradeConfig.variableFundingMax - tradeConfig.variableFundingMin;
            fundingRatePercent = tradeConfig.variableFundingMin + (Math.random() * range);
            break;
        default:
            fundingRatePercent = tradeConfig.fundingRatePercent;
    }
    
    const totalFundingCost = positionSize * leverage * (fundingRatePercent / 100) * fundingPeriods;
    return totalFundingCost;
};

// Helper function to apply slippage to price
const applySlippage = (price, tradeType, slippagePercent) => {
    if (slippagePercent === 0) return price;
    
    if (tradeType === 'long') {
        return price * (1 + slippagePercent); // Long trades pay higher (worse fill)
    } else {
        return price * (1 - slippagePercent); // Short trades get lower (worse fill)
    }
};

class CleanTimeProgressiveFronttester {
    constructor() {
        this.timeframeCandles = new Map(); // Raw candle data for each timeframe
        this.timeframePivots = new Map();  // Discovered pivots for each timeframe
        this.currentMinute = 0;            // Current 1-minute index we're processing
        this.oneMinuteCandles = [];        // 1-minute candles for time progression
        this.cascadeCounter = 0;
        this.recentCascades = [];      // Limited to 3 for live display
        this.allCascades = [];         // Store ALL cascades for final summary
        this.isRunning = false;
        this.lastLoggedTime = null;        // Track last logged time for progression
        this.activeWindows = new Map();    // Track active cascade windows
        this.windowCounter = 0;            // Counter for window IDs
        
        // Pivot tracking for swing filtering (matches backtester)
        this.lastPivots = new Map();       // Track last pivot per timeframe for swing filtering
        
        // Trading variables
        this.capital = tradeConfig.initialCapital;
        this.trades = [];
        this.openTrades = [];
        
        // Initialize Telegram notifier with initial capital
        telegramNotifier.setInitialCapital(tradeConfig.initialCapital);
    }

    // Create a new trade
    createTrade(signal, candle) {
        // Check for single trade mode - prevent concurrent trades
        if (tradeConfig.singleTradeMode && this.openTrades.length > 0) {
            console.log(`${colors.yellow}⏸️  Single trade mode: Skipping new trade while trade #${this.openTrades[0].id} is open${colors.reset}`);
            return null;
        }
        
        const slippagePercent = calculateSlippage(tradeConfig.positionSize, tradeConfig);
        const entryPrice = applySlippage(candle.close, signal.direction, slippagePercent);
        
        let positionSize;
        switch (tradeConfig.positionSizeMode) {
            case 'fixed':
                positionSize = tradeConfig.positionSize;
                break;
            case 'percentage':
                positionSize = this.capital * (tradeConfig.positionSizePercent / 100);
                break;
            case 'minimum':
                positionSize = Math.max(tradeConfig.positionSize, this.capital * (tradeConfig.positionSizePercent / 100));
                break;
            default:
                positionSize = tradeConfig.positionSize;
        }
        
        // Check if we have enough capital
        if (positionSize > this.capital) {
            console.log(`${colors.red}❌ Insufficient capital: Need $${formatNumberWithCommas(positionSize)}, Have $${formatNumberWithCommas(this.capital)}${colors.reset}`);
            return null;
        }
        
        const leverage = tradeConfig.leverage;
        const notionalValue = positionSize * leverage;
        
        // Calculate stop loss and take profit
        const stopLossPrice = signal.direction === 'long' 
            ? entryPrice * (1 - tradeConfig.stopLossPercent / 100)
            : entryPrice * (1 + tradeConfig.stopLossPercent / 100);
            
        const takeProfitPrice = signal.direction === 'long'
            ? entryPrice * (1 + tradeConfig.takeProfitPercent / 100)
            : entryPrice * (1 - tradeConfig.takeProfitPercent / 100);
        
        const trade = {
            id: this.trades.length + 1,
            direction: signal.direction,
            entryTime: candle.time,
            entryPrice: entryPrice,
            positionSize: positionSize,
            leverage: leverage,
            notionalValue: notionalValue,
            stopLossPrice: stopLossPrice,
            takeProfitPrice: takeProfitPrice,
            slippagePercent: slippagePercent * 100,
            status: 'open',
            bestPrice: entryPrice,
            trailingStopPrice: null,
            trailingStopActivated: false,
            exitTime: null,
            exitPrice: null,
            pnl: 0,
            pnlPercent: 0,
            fundingCost: 0,
            totalCost: positionSize * slippagePercent, // Initial slippage cost
            signal: signal
        };
        
        // Deduct position size from capital
        this.capital -= positionSize;
        
        this.trades.push(trade);
        this.openTrades.push(trade);
        
        if (fronttesterconfig.showTrades) {
            console.log(`\n ${colors.green}🚀 TRADE OPENED: ${trade.direction.toUpperCase()} #${trade.id}${colors.reset}`);
            console.log(`   Entry: $${formatNumberWithCommas(entryPrice)} | Size: $${formatNumberWithCommas(positionSize)} | Leverage: ${leverage}x`);
            console.log(`   SL: $${formatNumberWithCommas(stopLossPrice)} | TP: $${formatNumberWithCommas(takeProfitPrice)}`);
            console.log(`   Capital Remaining: $${formatNumberWithCommas(this.capital)}`);
        }
        
        // Send Telegram notification for trade opened
        if (fronttesterconfig.showTelegramTrades) {
            telegramNotifier.notifyTradeOpened(trade);
        }
        
        return trade;
    }

    // Monitor and manage open trades
    monitorTrades(currentCandle) {
        if (this.openTrades.length === 0) return;
        
        const tradesToClose = [];
        
        for (const trade of this.openTrades) {
            const currentPrice = currentCandle.close;
            const currentTime = currentCandle.time;
            
            // Calculate current PnL
            let currentPnL = 0;
            if (trade.direction === 'long') {
                currentPnL = (currentPrice - trade.entryPrice) * (trade.notionalValue / trade.entryPrice);
            } else {
                currentPnL = (trade.entryPrice - currentPrice) * (trade.notionalValue / trade.entryPrice);
            }
            
            // Update best price achieved
            if (trade.direction === 'long' && currentPrice > trade.bestPrice) {
                trade.bestPrice = currentPrice;
            } else if (trade.direction === 'short' && currentPrice < trade.bestPrice) {
                trade.bestPrice = currentPrice;
            }
            
            // Check for trailing stop activation
            if (tradeConfig.enableTrailingStop && !trade.trailingStopActivated) {
                const profitPercent = trade.direction === 'long' 
                    ? ((currentPrice - trade.entryPrice) / trade.entryPrice) * 100
                    : ((trade.entryPrice - currentPrice) / trade.entryPrice) * 100;
                    
                if (profitPercent >= tradeConfig.trailingStopActivationPercent) {
                    trade.trailingStopActivated = true;
                    trade.trailingStopPrice = trade.direction === 'long'
                        ? currentPrice * (1 - tradeConfig.trailingStopPercent / 100)
                        : currentPrice * (1 + tradeConfig.trailingStopPercent / 100);
                    if (fronttesterconfig.showTrades) {
                        console.log(`${colors.cyan}📈 Trailing stop activated for trade #${trade.id} at $${formatNumberWithCommas(trade.trailingStopPrice)}${colors.reset}`);
                    }
                }
            }
            
            // Update trailing stop price
            if (trade.trailingStopActivated) {
                const newTrailingStop = trade.direction === 'long'
                    ? trade.bestPrice * (1 - tradeConfig.trailingStopPercent / 100)
                    : trade.bestPrice * (1 + tradeConfig.trailingStopPercent / 100);
                    
                if (trade.direction === 'long' && newTrailingStop > trade.trailingStopPrice) {
                    trade.trailingStopPrice = newTrailingStop;
                } else if (trade.direction === 'short' && newTrailingStop < trade.trailingStopPrice) {
                    trade.trailingStopPrice = newTrailingStop;
                }
            }
            
            // Check exit conditions
            let exitReason = null;
            let exitPrice = currentPrice;
            
            // Check take profit
            if ((trade.direction === 'long' && currentPrice >= trade.takeProfitPrice) ||
                (trade.direction === 'short' && currentPrice <= trade.takeProfitPrice)) {
                exitReason = 'take_profit';
                exitPrice = trade.takeProfitPrice;
            }
            // Check stop loss
            else if ((trade.direction === 'long' && currentPrice <= trade.stopLossPrice) ||
                     (trade.direction === 'short' && currentPrice >= trade.stopLossPrice)) {
                exitReason = 'stop_loss';
                exitPrice = trade.stopLossPrice;
            }
            // Check trailing stop
            else if (trade.trailingStopActivated &&
                     ((trade.direction === 'long' && currentPrice <= trade.trailingStopPrice) ||
                      (trade.direction === 'short' && currentPrice >= trade.trailingStopPrice))) {
                exitReason = 'trailing_stop';
                exitPrice = trade.trailingStopPrice;
            }
            // Check maximum trade time
            else if (tradeConfig.maxTradeTimeMinutes > 0) {
                const tradeDurationMinutes = (currentTime - trade.entryTime) / (1000 * 60);
                if (tradeDurationMinutes >= tradeConfig.maxTradeTimeMinutes) {
                    exitReason = 'max_time';
                    exitPrice = currentPrice;
                }
            }
            
            if (exitReason) {
                this.closeTrade(trade, exitPrice, currentTime, exitReason);
                tradesToClose.push(trade);
            }
        }
        
        // Remove closed trades from open trades array
        for (const closedTrade of tradesToClose) {
            const index = this.openTrades.indexOf(closedTrade);
            if (index > -1) {
                this.openTrades.splice(index, 1);
            }
        }
    }

    // Close a trade
    closeTrade(trade, exitPrice, exitTime, exitReason) {
        // Apply exit slippage
        const exitSlippagePercent = calculateSlippage(trade.positionSize, tradeConfig);
        const finalExitPrice = applySlippage(exitPrice, trade.direction === 'long' ? 'short' : 'long', exitSlippagePercent);
        
        // Calculate funding costs
        const fundingCost = calculateFundingRate(tradeConfig, exitTime, trade.entryTime, trade.positionSize, trade.leverage);
        
        // Calculate final PnL
        let grossPnL = 0;
        if (trade.direction === 'long') {
            grossPnL = (finalExitPrice - trade.entryPrice) * (trade.notionalValue / trade.entryPrice);
        } else {
            grossPnL = (trade.entryPrice - finalExitPrice) * (trade.notionalValue / trade.entryPrice);
        }
        
        const exitSlippageCost = trade.positionSize * exitSlippagePercent;
        const totalCosts = trade.totalCost + exitSlippageCost + fundingCost;
        const netPnL = grossPnL - totalCosts;
        const pnlPercent = (netPnL / trade.positionSize) * 100;
        
        // Update trade object
        trade.exitTime = exitTime;
        trade.exitPrice = finalExitPrice;
        trade.pnl = netPnL;
        trade.pnlPercent = pnlPercent;
        trade.fundingCost = fundingCost;
        trade.totalCost = totalCosts;
        trade.status = 'closed';
        trade.exitReason = exitReason;
        
        // Return capital plus/minus PnL
        this.capital += trade.positionSize + netPnL;
        
        // Display trade closure with improved formatting
        const durationMs = exitTime - trade.entryTime;
        const formatDuration = (ms) => {
            const totalMinutes = Math.floor(ms / (1000 * 60));
            const days = Math.floor(totalMinutes / (24 * 60));
            const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
            const minutes = totalMinutes % 60;
            
            if (days > 0) {
                return `${days} days, ${hours} hours, ${minutes} minutes`;
            } else if (hours > 0) {
                return `${hours} hours, ${minutes} minutes`;
            } else {
                return `${minutes} minutes`;
            }
        };
        const durationStr = formatDuration(durationMs);
        
        // Format dates to be more readable
        const entryDate = new Date(trade.entryTime);
        const exitDate = new Date(exitTime);
        const entryTime12 = entryDate.toLocaleTimeString();
        const entryTime24Only = entryDate.toLocaleTimeString('en-GB', { hour12: false });
        const exitTime12 = exitDate.toLocaleTimeString();
        const exitTime24Only = exitDate.toLocaleTimeString('en-GB', { hour12: false });
        const entryDateStr = `${entryDate.toLocaleDateString('en-US', { weekday: 'short' })} ${entryDate.toLocaleDateString()} ${entryTime12} (${entryTime24Only})`;
        const exitDateStr = `${exitDate.toLocaleDateString('en-US', { weekday: 'short' })} ${exitDate.toLocaleDateString()} ${exitTime12} (${exitTime24Only})`;
        
        // Determine result text and color
        const resultColor = netPnL >= 0 ? colors.green : colors.red;
        const resultText = netPnL >= 0 ? 'WIN' : 'LOSS';
        const pnlPct = pnlPercent.toFixed(2);
        
        // Map exit reasons to result codes
        const resultCode = {
            'take_profit': 'TP',
            'stop_loss': 'SL', 
            'trailing_stop': 'TRAIL',
            'max_time': 'EOB'
        }[exitReason] || exitReason.toUpperCase();
        
        if (fronttesterconfig.showTrades) {
            console.log('--------------------------------------------------------------------------------');
            // Format the trade header - entire line in result color
            console.log(`\n${resultColor}[TRADE ${trade.id.toString().padStart(2, ' ')}] ${trade.direction.toUpperCase()} | P&L: ${pnlPct}% | ${resultText} | Result: ${resultCode}${colors.reset}`);
            console.log();
            console.log(`${colors.cyan}  Entry: ${entryDateStr} at $${formatNumberWithCommas(trade.entryPrice)}${colors.reset}`);
            console.log(`${colors.cyan}  Exit:  ${exitDateStr} at $${formatNumberWithCommas(finalExitPrice)}${colors.reset}`);
            console.log(`${colors.cyan}  Duration: ${durationStr}${colors.reset}`);
            
            // Add trade amount, profit/loss, and remainder information
            const tradeAmount = trade.positionSize;
            const tradeRemainder = tradeAmount + netPnL; // Original amount + P&L = what's left
            
            console.log(`${colors.yellow}  Trade Amount: $${formatNumberWithCommas(tradeAmount)}${colors.reset}`);
            
            // Add TRADE PROFIT/LOSS line
            if (netPnL >= 0) {
                console.log(`${colors.green}  Trade Profit: $${formatNumberWithCommas(netPnL)}${colors.reset}`);
            } else {
                console.log(`${colors.red}  Trade Loss: $${formatNumberWithCommas(Math.abs(netPnL))}${colors.reset}`);
            }
            
            console.log(`${colors.cyan}  Trade Remainder: $${formatNumberWithCommas(tradeRemainder)}${colors.reset}`);
            console.log(`${colors.yellow}  Capital: $${formatNumberWithCommas(this.capital)}${colors.reset}`);
            console.log('--------------------------------------------------------------------------------');
        }
        
        // Send Telegram notification for trade closed
        if (fronttesterconfig.showTelegramTrades) {
            const tradeWithFinalCapital = { ...trade, finalCapital: this.capital };
            telegramNotifier.notifyTradeClosed(tradeWithFinalCapital);
        }
        
        return trade;
    }

    // Check if we should create a trade based on direction settings
    shouldCreateTrade(signal) {
        if (!fronttesterconfig.enableTrading) return false;
        
        switch (tradeConfig.direction) {
            case 'buy':
                return signal === 'long';
            case 'sell':
                return signal === 'short';
            case 'both':
                return true;
            case 'alternate':
                // For alternate mode, we need to track the last trade direction
                if (this.trades.length === 0) {
                    return signal === 'long'; // Start with long for alternate mode
                }
                const lastTrade = this.trades[this.trades.length - 1];
                return signal !== lastTrade.direction;
            default:
                return false;
        }
    }

    // Display comprehensive trading statistics
    displayTradingStatistics() {
        const closedTrades = this.trades.filter(t => t.status === 'closed');
        const openTrades = this.trades.filter(t => t.status === 'open');
        
        if (this.trades.length === 0) {
            console.log(`\n${colors.yellow}--- Trading Performance ---${colors.reset}`);
            console.log(`${colors.red}No trades executed${colors.reset}`);
            return;
        }
        
        // Display all trades taken
        if (fronttesterconfig.showAllTrades) {
            console.log(`\n${colors.cyan}--- All Trades Taken (${this.trades.length}) ---${colors.reset}`);
        
            this.trades.forEach((trade, index) => {
            if (trade.status === 'closed') {
                // Format dates to be more readable
                const entryDate = new Date(trade.entryTime);
                const exitDate = new Date(trade.exitTime);
                const entryTime12 = entryDate.toLocaleTimeString();
                const entryTime24Only = entryDate.toLocaleTimeString('en-GB', { hour12: false });
                const exitTime12 = exitDate.toLocaleTimeString();
                const exitTime24Only = exitDate.toLocaleTimeString('en-GB', { hour12: false });
                const entryDateStr = `${entryDate.toLocaleDateString('en-US', { weekday: 'short' })} ${entryDate.toLocaleDateString()} ${entryTime12} (${entryTime24Only})`;
                const exitDateStr = `${exitDate.toLocaleDateString('en-US', { weekday: 'short' })} ${exitDate.toLocaleDateString()} ${exitTime12} (${exitTime24Only})`;
                
                // Calculate duration
                const durationMs = trade.exitTime - trade.entryTime;
                const formatDuration = (ms) => {
                    const totalMinutes = Math.floor(ms / (1000 * 60));
                    const days = Math.floor(totalMinutes / (24 * 60));
                    const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
                    const minutes = totalMinutes % 60;
                    
                    if (days > 0) {
                        return `${days} days, ${hours} hours, ${minutes} minutes`;
                    } else if (hours > 0) {
                        return `${hours} hours, ${minutes} minutes`;
                    } else {
                        return `${minutes} minutes`;
                    }
                };
                const durationStr = formatDuration(durationMs);
                
                // Determine result text and color
                const resultColor = trade.pnl >= 0 ? colors.green : colors.red;
                const resultText = trade.pnl >= 0 ? 'WIN' : 'LOSS';
                const pnlPct = trade.pnlPercent.toFixed(2);
                
                // Map exit reasons to result codes
                const resultCode = {
                    'take_profit': 'TP',
                    'stop_loss': 'SL', 
                    'trailing_stop': 'TRAIL',
                    'max_time': 'EOB'
                }[trade.exitReason] || trade.exitReason?.toUpperCase() || 'CLOSED';
                
                // Trade amount and remainder calculations
                const tradeAmount = trade.positionSize;
                const tradeRemainder = tradeAmount + trade.pnl; // Original amount + P&L = what's left
                
                console.log('--------------------------------------------------------------------------------');
                // Format the trade header - entire line in result color
                console.log(`\n${resultColor}[TRADE ${trade.id.toString().padStart(2, ' ')}] ${trade.direction.toUpperCase()} | P&L: ${pnlPct}% | ${resultText} | Result: ${resultCode}${colors.reset}`);
                console.log();
                console.log(`${colors.cyan}  Entry: ${entryDateStr} at $${formatNumberWithCommas(trade.entryPrice)}${colors.reset}`);
                console.log(`${colors.cyan}  Exit:  ${exitDateStr} at $${formatNumberWithCommas(trade.exitPrice)}${colors.reset}`);
                console.log(`${colors.cyan}  Duration: ${durationStr}${colors.reset}`);
                
                console.log(`${colors.yellow}  Trade Amount: $${formatNumberWithCommas(tradeAmount)}${colors.reset}`);
                
                // Add TRADE PROFIT/LOSS line
                if (trade.pnl >= 0) {
                    console.log(`${colors.green}  Trade Profit: $${formatNumberWithCommas(trade.pnl)}${colors.reset}`);
                } else {
                    console.log(`${colors.red}  Trade Loss: $${formatNumberWithCommas(Math.abs(trade.pnl))}${colors.reset}`);
                }
                
                console.log(`${colors.cyan}  Trade Remainder: $${formatNumberWithCommas(tradeRemainder)}${colors.reset}`);
                console.log(`${colors.yellow}  Capital: $${formatNumberWithCommas(this.capital)}${colors.reset}`);
                console.log('--------------------------------------------------------------------------------');
                
            } else {
                // Display open trades in simplified format
                const entryDate = new Date(trade.entryTime);
                const entryTime12 = entryDate.toLocaleTimeString();
                const entryTime24 = entryDate.toLocaleTimeString('en-GB', { hour12: false });
                const entryDateStr = `${entryDate.toLocaleDateString('en-US', { weekday: 'short' })} ${entryDate.toLocaleDateString()}`;
                
                console.log('--------------------------------------------------------------------------------');
                console.log(`\n${colors.yellow}[TRADE ${trade.id.toString().padStart(2, ' ')}] ${trade.direction.toUpperCase()} | OPEN${colors.reset}`);
                console.log();
                console.log(`${colors.cyan}  Entry: ${entryDateStr} ${entryTime12} (${entryTime24}) at $${formatNumberWithCommas(trade.entryPrice)}${colors.reset}`);
                console.log(`${colors.yellow}  Trade Amount: $${formatNumberWithCommas(trade.positionSize)}${colors.reset}`);
                console.log(`${colors.cyan}  Stop Loss: $${formatNumberWithCommas(trade.stopLossPrice)}${colors.reset}`);
                console.log(`${colors.cyan}  Take Profit: $${formatNumberWithCommas(trade.takeProfitPrice)}${colors.reset}`);
                console.log(`${colors.yellow}  Capital: $${formatNumberWithCommas(this.capital)}${colors.reset}`);
                console.log('--------------------------------------------------------------------------------');
            }
            
                if (index < this.trades.length - 1) {
                    console.log(''); // Add spacing between trades
                }
            });
        }
        
        console.log(`\n${colors.cyan}--- Trading Performance ---${colors.reset}`);
        
        // Basic statistics
        const totalTrades = this.trades.length;
        const winningTrades = closedTrades.filter(t => t.pnl > 0).length;
        const losingTrades = closedTrades.filter(t => t.pnl < 0).length;
        const winRate = closedTrades.length > 0 ? (winningTrades / closedTrades.length) * 100 : 0;
        
        console.log(`${colors.yellow}Total Trades: ${colors.brightYellow}${totalTrades}${colors.reset}`);
        console.log(`${colors.yellow}Winning Trades: ${colors.green}${winningTrades}${colors.reset}`);
        console.log(`${colors.yellow}Losing Trades: ${colors.red}${losingTrades}${colors.reset}`);
        console.log(`${colors.yellow}Win Rate: ${colors.cyan}${winRate.toFixed(1)}%${colors.reset}`);
        
        // Capital and PnL
        const totalPnL = closedTrades.reduce((sum, t) => sum + t.pnl, 0);
        const totalPnLPercent = ((totalPnL / tradeConfig.initialCapital) * 100);
        const finalCapital = this.capital + openTrades.reduce((sum, t) => sum + t.positionSize, 0);
        
        const pnlColor = totalPnL >= 0 ? colors.green : colors.red;
        const returnColor = totalPnLPercent >= 0 ? colors.green : colors.red;
        
        console.log(`${colors.yellow}Initial Capital: ${colors.cyan}${formatNumberWithCommas(tradeConfig.initialCapital)} USDT${colors.reset}`);
        console.log(`${colors.yellow}Total P&L: ${pnlColor}${formatNumberWithCommas(totalPnL)} USDT${colors.reset}`);
        console.log(`${colors.yellow}Total Return: ${returnColor}${formatNumberWithCommas(parseFloat(totalPnLPercent.toFixed(2)))}%${colors.reset}`);
        console.log(`${colors.yellow}Final Capital: ${colors.brightYellow}${formatNumberWithCommas(finalCapital)} USDT${colors.reset}`);
        
        // Add cascade statistics
        console.log(`\n${colors.cyan}=== BACKTESTING RESULTS SUMMARY ===${colors.reset}`);
        console.log(`${colors.yellow}Total Primary Signals: ${colors.brightYellow}${this.cascadeCounter}${colors.reset}`);
        console.log(`${colors.yellow}Confirmed Cascade Signals: ${colors.brightYellow}${this.allCascades.length}${colors.reset}`);
        const confirmationRate = this.cascadeCounter > 0 ? (this.allCascades.length / this.cascadeCounter) * 100 : 0;
        console.log(`${colors.yellow}Cascade Confirmation Rate: ${colors.cyan}${confirmationRate.toFixed(1)}%${colors.reset}`);
        
        // Calculate timespan if we have data
        if (this.oneMinuteCandles.length > 0) {
            const startTime = this.oneMinuteCandles[0].time;
            const endTime = this.oneMinuteCandles[this.oneMinuteCandles.length - 1].time;
            const timespanDays = (endTime - startTime) / (1000 * 60 * 60 * 24);
            const signalsPerDay = timespanDays > 0 ? this.cascadeCounter / timespanDays : 0;
            const confirmedPerDay = timespanDays > 0 ? this.allCascades.length / timespanDays : 0;
            
            console.log(`${colors.yellow}Primary Signal Frequency: ${colors.cyan}${signalsPerDay.toFixed(2)} signals/day${colors.reset}`);
            console.log(`${colors.yellow}Confirmed Signal Frequency: ${colors.cyan}${confirmedPerDay.toFixed(2)} confirmed/day${colors.reset}`);
            console.log(`${colors.yellow}Data Timespan: ${colors.cyan}${timespanDays.toFixed(1)} days${colors.reset}`);
        }
        
        console.log(`${colors.cyan}${'═'.repeat(50)}${colors.reset}`);
        
        // Send Telegram trading summary
        const tradingStats = {
            totalTrades,
            winningTrades,
            losingTrades,
            initialCapital: tradeConfig.initialCapital,
            totalPnL,
            finalCapital,
            winRate,
            totalReturn: totalPnLPercent
        };
        telegramNotifier.sendTradingSummary(tradingStats);
    }

    async initialize() {
        const dataSource = useLocalData ? 'CSV Files (Local)' : `${api.toUpperCase()} API (Live)`;
        const dataMode = useLocalData ? 'Historical Simulation' : 'Live Market Data';
        
        console.log(`${colors.cyan}=== CLEAN TIME-PROGRESSIVE FRONTTESTER V2 ===${colors.reset}`);
        console.log(`${colors.yellow}Symbol: ${symbol}${colors.reset}`);
        console.log(`${colors.yellow}Data Source: ${dataSource}${colors.reset}`);
        console.log(`${colors.yellow}Mode: ${dataMode}${colors.reset}`);
        console.log(`${colors.yellow}Method: Step-by-step minute progression${colors.reset}`);
        
        // Display trading configuration
        if (fronttesterconfig.enableTrading) {
            console.log(`\n${colors.cyan}💰 TRADING CONFIGURATION${colors.reset}`);
            console.log(`${colors.yellow}Trading: ${colors.green}ENABLED${colors.reset}`);
            console.log(`${colors.yellow}Direction: ${tradeConfig.direction.toUpperCase()}${colors.reset}`);
            console.log(`${colors.yellow}Initial Capital: $${formatNumberWithCommas(tradeConfig.initialCapital)}${colors.reset}`);
            const sizeMode = tradeConfig.positionSizeMode || 'percentage';
            const sizeDisplay = sizeMode === 'fixed' 
                ? `$${formatNumberWithCommas(tradeConfig.positionSize || 100)}` 
                : `${tradeConfig.positionSizePercent || tradeConfig.riskPerTrade || 100}%`;
            console.log(`${colors.yellow}Position Size: ${sizeMode} (${sizeDisplay})${colors.reset}`);
            console.log(`${colors.yellow}Leverage: ${tradeConfig.leverage}x${colors.reset}`);
            console.log(`${colors.yellow}Stop Loss: ${tradeConfig.stopLossPercent || tradeConfig.stopLoss}% | Take Profit: ${tradeConfig.takeProfitPercent || tradeConfig.takeProfit}%${colors.reset}`);
            if (tradeConfig.enableTrailingStop) {
                console.log(`${colors.yellow}Trailing Stop: ${tradeConfig.trailingStopPercent}% (activates at ${tradeConfig.trailingStopActivationPercent}%)${colors.reset}`);
            }
            if (tradeConfig.maxTradeTimeMinutes > 0) {
                console.log(`${colors.yellow}Max Trade Time: ${tradeConfig.maxTradeTimeMinutes} minutes${colors.reset}`);
            }
        } else {
            console.log(`\n${colors.yellow}Trading: ${colors.red}DISABLED (Signal Detection Only)${colors.reset}`);
        }
        
        console.log(`${'='.repeat(60)}\n`);

        // Load raw candle data for all timeframes
        await this.loadAllTimeframeData();
        
        // Initialize pivot tracking
        for (const tf of multiPivotConfig.timeframes) {
            this.timeframePivots.set(tf.interval, []);
            // Initialize last pivot tracking for swing filtering
            this.lastPivots.set(tf.interval, { type: null, price: null, time: null, index: 0 });
        }
        
        console.log(`${colors.green}✅ Clean system initialized successfully${colors.reset}`);
        console.log(`${colors.cyan}📊 Ready for time-progressive simulation${colors.reset}\n`);
    }

    async loadAllTimeframeData() {
        const dataSourceType = useLocalData ? 'CSV FILES' : `${api.toUpperCase()} API`;
        console.log(`${colors.cyan}=== LOADING RAW CANDLE DATA FROM ${dataSourceType} ===${colors.reset}`);
        
        const detector = new MultiTimeframePivotDetector(symbol, multiPivotConfig);
        
        for (const tf of multiPivotConfig.timeframes) {
            await detector.loadTimeframeData(tf, useLocalData, fronttesterconfig.dataLimit || configLimit);
            const candles = detector.timeframeData.get(tf.interval) || [];
            this.timeframeCandles.set(tf.interval, candles);
            
            const sourceIndicator = useLocalData ? 'CSV' : 'API';
            console.log(`${colors.yellow}[${tf.interval.padEnd(4)}] Loaded ${candles.length.toString().padStart(4)} candles from ${sourceIndicator}${colors.reset}`);
        }
        
        // Get 1-minute candles for time progression
        this.oneMinuteCandles = this.timeframeCandles.get('1m') || [];
        console.log(`${colors.green}Time progression: ${this.oneMinuteCandles.length} minutes${colors.reset}`);
    }

    startSimulation() {
        if (this.oneMinuteCandles.length === 0) {
            console.error(`${colors.red}No 1-minute candles for simulation${colors.reset}`);
            return;
        }

        console.log(`${colors.cyan}🚀 Starting clean time-progressive simulation...${colors.reset}\n`);
        
        this.isRunning = true;
        this.currentMinute = 0;
        
        const simulationLoop = () => {
            if (!this.isRunning || this.currentMinute >= this.oneMinuteCandles.length) {
                this.finishSimulation();
                return;
            }
            
            const currentCandle = this.oneMinuteCandles[this.currentMinute];
            const currentTime = currentCandle.time;
            
            // Log time progression (configurable interval)
            this.logHourlyProgression(currentTime);
            
            // Step 1: Check for new pivots at current time
            this.detectNewPivotsAtCurrentTime(currentTime);
            
            // Step 2: Check for cascade confirmations (DISABLED - using window-based system instead)
            // this.checkForCascadeAtCurrentTime(currentTime);
            
            // Step 3: Check for expired windows
            this.checkExpiredWindows(currentTime);
            
            // Step 4: Monitor and manage open trades
            this.monitorTrades(currentCandle);
            
            // Progress
            if (this.currentMinute % 100 === 0 && this.currentMinute > 0 && !fronttesterconfig.hideProgressDisplay) {
                const progress = ((this.currentMinute / this.oneMinuteCandles.length) * 100).toFixed(1);
                console.log(`${colors.cyan}Progress: ${progress}% (${this.currentMinute}/${this.oneMinuteCandles.length})${colors.reset}`);
            }
            
            this.currentMinute++;
            
            // Continue simulation
            const delay = Math.max(1, Math.floor(1000 / fronttesterconfig.speedMultiplier));
            setTimeout(simulationLoop, delay);
        };
        
        simulationLoop();
    }

    logHourlyProgression(currentTime) {
        const currentDate = new Date(currentTime);
        const intervalMinutes = fronttesterconfig.timeLoggingInterval || 10;
        
        // Calculate time slot based on interval
        const totalMinutes = currentDate.getHours() * 60 + currentDate.getMinutes();
        const timeSlot = Math.floor(totalMinutes / intervalMinutes);
        const currentDay = currentDate.getDate();
        const timeKey = `${currentDay}-${timeSlot}`; // Unique key for day-timeslot combination
        
        if (this.lastLoggedTime !== timeKey) {
            this.lastLoggedTime = timeKey;
            
            const timeString12 = currentDate.toLocaleString('en-US', {
                weekday: 'short',
                month: 'short', 
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                hour12: true
            });
            
            const timeString24 = currentDate.toLocaleTimeString('en-GB', { hour12: false });
            
            const price = this.oneMinuteCandles[this.currentMinute]?.close || 0;
            const progress = ((this.currentMinute / this.oneMinuteCandles.length) * 100).toFixed(1);
            
            if (!fronttesterconfig.hideTimeDisplay) {
                console.log(`${colors.brightCyan}⏰ ${timeString12} (${timeString24}) | BTC: $${price.toFixed(1)} | Progress: ${progress}% (${this.currentMinute}/${this.oneMinuteCandles.length})${colors.reset}`);
            }
        }
    }

    detectNewPivotsAtCurrentTime(currentTime) {
        for (const tf of multiPivotConfig.timeframes) {
            const candles = this.timeframeCandles.get(tf.interval) || [];
            const knownPivots = this.timeframePivots.get(tf.interval) || [];
            
            // REAL-TIME FIX: Only analyze candles that are completed (time <= currentTime)
            // Find the latest completed candle for this timeframe
            let latestCandleIndex = -1;
            for (let i = candles.length - 1; i >= 0; i--) {
                if (candles[i].time <= currentTime) {
                    latestCandleIndex = i;
                    break;
                }
            }
            
            if (latestCandleIndex === -1 || latestCandleIndex < tf.lookback) continue;
            
            // Check if we already detected a pivot at this candle
            const candleTime = candles[latestCandleIndex].time;
            const alreadyExists = knownPivots.some(p => p.time === candleTime);
            if (alreadyExists) continue;
            
            // Detect pivot at this candle (only using data up to currentTime)
            const pivot = this.detectPivotAtCandle(candles, latestCandleIndex, tf);
            if (pivot) {
                // REAL-TIME FIX: Only allow pivots that occur during simulation (not before start)
                const simulationStartTime = this.oneMinuteCandles[0]?.time || 0;
                if (pivot.time < simulationStartTime) {
                    // Skip pivots that occurred before simulation started
                    continue;
                }
                
                knownPivots.push(pivot);
                this.timeframePivots.set(tf.interval, knownPivots);
                
                // Check if this is a primary timeframe pivot - open cascade window
                if (tf.role === 'primary') {
                    this.openPrimaryWindow(pivot, currentTime);
                } else {
                    // Check if this pivot confirms any active windows
                    this.checkWindowConfirmations(pivot, tf, currentTime);
                }
                
                if (fronttesterconfig.showDebug) {
                    console.log(`${colors.yellow}[${tf.interval}] New ${pivot.signal.toUpperCase()} pivot @ $${pivot.price.toFixed(1)} at ${new Date(pivot.time).toLocaleTimeString()}${colors.reset}`);
                }
            }
        }
    }



    detectPivotAtCandle(candles, index, timeframe) {
        if (index < timeframe.lookback) return null;
        
        const currentCandle = candles[index];
        const { minSwingPct, minLegBars } = timeframe;
        const swingThreshold = minSwingPct / 100;
        
        // Get last pivot for this timeframe (for swing filtering)
        const lastPivot = this.lastPivots.get(timeframe.interval) || { type: null, price: null, time: null, index: 0 };
        
        // Check for high pivot (LONG signal - CONTRARIAN)
        let isHighPivot = true;
        for (let j = 1; j <= timeframe.lookback; j++) {
            const compareCandle = candles[index - j];
            const comparePrice = pivotDetectionMode === 'extreme' ? compareCandle.high : compareCandle.close;
            const currentPrice = pivotDetectionMode === 'extreme' ? currentCandle.high : currentCandle.close;
            if (comparePrice >= currentPrice) {
                isHighPivot = false;
                break;
            }
        }
        
        if (isHighPivot) {
            const pivotPrice = pivotDetectionMode === 'extreme' ? currentCandle.high : currentCandle.close;
            const swingPct = lastPivot.price ? (pivotPrice - lastPivot.price) / lastPivot.price : 0;
            const isFirstPivot = lastPivot.type === null;
            
            // Apply swing filtering (matches backtester logic)
            if ((isFirstPivot || Math.abs(swingPct) >= swingThreshold) && (index - lastPivot.index) >= minLegBars) {
                const pivot = {
                    time: currentCandle.time,
                    price: pivotPrice,
                    signal: 'long',  // INVERTED: High pivot = LONG signal
                    type: 'high',
                    timeframe: timeframe.interval,
                    index: index,
                    swingPct: swingPct * 100
                };
                
                // Update last pivot for this timeframe
                this.lastPivots.set(timeframe.interval, pivot);
                return pivot;
            }
        }
        
        // Check for low pivot (SHORT signal - CONTRARIAN)
        let isLowPivot = true;
        for (let j = 1; j <= timeframe.lookback; j++) {
            const compareCandle = candles[index - j];
            const comparePrice = pivotDetectionMode === 'extreme' ? compareCandle.low : compareCandle.close;
            const currentPrice = pivotDetectionMode === 'extreme' ? currentCandle.low : currentCandle.close;
            if (comparePrice <= currentPrice) {
                isLowPivot = false;
                break;
            }
        }
        
        if (isLowPivot) {
            const pivotPrice = pivotDetectionMode === 'extreme' ? currentCandle.low : currentCandle.close;
            const swingPct = lastPivot.price ? (pivotPrice - lastPivot.price) / lastPivot.price : 0;
            const isFirstPivot = lastPivot.type === null;
            
            // Apply swing filtering (matches backtester logic)
            if ((isFirstPivot || Math.abs(swingPct) >= swingThreshold) && (index - lastPivot.index) >= minLegBars) {
                const pivot = {
                    time: currentCandle.time,
                    price: pivotPrice,
                    signal: 'short', // INVERTED: Low pivot = SHORT signal
                    type: 'low',
                    timeframe: timeframe.interval,
                    index: index,
                    swingPct: swingPct * 100
                };
                
                // Update last pivot for this timeframe
                this.lastPivots.set(timeframe.interval, pivot);
                return pivot;
            }
        }
        
        return null;
    }

    openPrimaryWindow(primaryPivot, currentTime) {
        this.windowCounter++;
        const windowId = `W${this.windowCounter}`;
        const confirmationWindow = multiPivotConfig.cascadeSettings.confirmationWindow[primaryPivot.timeframe] || 240;
        const windowEndTime = primaryPivot.time + (confirmationWindow * 60 * 1000);
        
        const window = {
            id: windowId,
            primaryPivot,
            openTime: currentTime,
            windowEndTime,
            confirmations: [],
            status: 'active'
        };
        
        this.activeWindows.set(windowId, window);
        
        const timeString12 = new Date(primaryPivot.time).toLocaleString();
        const time24 = new Date(primaryPivot.time).toLocaleTimeString('en-GB', { hour12: false });
        const minRequired = multiPivotConfig.cascadeSettings.minTimeframesRequired || 3;
        
        if (fronttesterconfig.showWindow) {
            console.log(`\n${colors.brightYellow}🟡 PRIMARY WINDOW OPENED [${windowId}]: ${primaryPivot.timeframe} ${primaryPivot.signal.toUpperCase()} pivot detected${colors.reset}`);
            console.log(`${colors.yellow}   Time: ${timeString12} (${time24}) | Price: $${primaryPivot.price.toFixed(1)}${colors.reset}`);
            console.log(`${colors.yellow}   Waiting for confirmations within ${confirmationWindow}min window...${colors.reset}`);
            
            // Get confirmation and execution timeframes from config
            const confirmationTFs = multiPivotConfig.timeframes.filter(tf => tf.role === 'confirmation').map(tf => tf.interval);
            const executionTFs = multiPivotConfig.timeframes.filter(tf => tf.role === 'execution').map(tf => tf.interval);
            
            console.log(`${colors.yellow}   Hierarchical Requirements:${colors.reset}`);
            console.log(`${colors.yellow}   • Primary: ${primaryPivot.timeframe} ✅${colors.reset}`);
            console.log(`${colors.yellow}   • Confirmations: ${confirmationTFs.join(', ')} (need any ${minRequired-1})${colors.reset}`);
            if (executionTFs.length > 0) {
                console.log(`${colors.yellow}   • Execution: ${executionTFs.join(', ')} (optional but preferred)${colors.reset}`);
            }
            console.log(`${colors.yellow}   • Total Required: ${minRequired}/${multiPivotConfig.timeframes.length} timeframes${colors.reset}`);
        }
    }
    
    checkWindowConfirmations(pivot, timeframe, currentTime) {
        // Check all active windows for potential confirmations
        for (const [windowId, window] of this.activeWindows) {
            if (window.status !== 'active') continue;
            if (window.primaryPivot.signal !== pivot.signal) continue; // Must match signal
            if (pivot.time < window.primaryPivot.time) continue; // Must be after primary
            if (currentTime > window.windowEndTime) {
                // Window expired
                window.status = 'expired';
                continue;
            }
            
            // Check if this timeframe already confirmed this window
            const alreadyConfirmed = window.confirmations.some(c => c.timeframe === timeframe.interval);
            if (alreadyConfirmed) continue;
            
            // CRITICAL VALIDATION: Execution timeframe (1m) can ONLY confirm if at least one confirmation timeframe is already present
            const timeframeRole = multiPivotConfig.timeframes.find(tf => tf.interval === timeframe.interval)?.role;
            if (timeframeRole === 'execution') {
                // Check if we have any confirmation timeframes already
                const hasConfirmation = window.confirmations.some(c => {
                    const role = multiPivotConfig.timeframes.find(tf => tf.interval === c.timeframe)?.role;
                    return role === 'confirmation';
                });
                
                if (!hasConfirmation) {
                    // Block execution timeframe from confirming without confirmation timeframes
                    // console.log(`${colors.red}   🚫 BLOCKED: ${timeframe.interval} execution cannot confirm without confirmation timeframes (1h or 15m)${colors.reset}`);
                    continue; // Skip this confirmation
                }
            }
            
            // Add confirmation
            window.confirmations.push({
                timeframe: timeframe.interval,
                pivot,
                confirmTime: currentTime
            });
            
            const minRequiredTFs = multiPivotConfig.cascadeSettings.minTimeframesRequired || 3;
            const totalConfirmed = 1 + window.confirmations.length; // +1 for primary
            const timeString = new Date(pivot.time).toLocaleString();
            const time24 = new Date(pivot.time).toLocaleTimeString('en-GB', { hour12: false });
            
            if (fronttesterconfig.showWindow) {
                console.log(`${colors.brightGreen}🟢 CONFIRMATION WINDOW [${windowId}]: ${timeframe.interval} ${pivot.signal.toUpperCase()} pivot detected${colors.reset}`);
                console.log(`${colors.cyan}   Time: ${timeString} (${time24}) | Price: $${pivot.price.toFixed(1)}${colors.reset}`);
                console.log(`${colors.cyan}   Confirmations: ${totalConfirmed}/${minRequiredTFs} (${[window.primaryPivot.timeframe, ...window.confirmations.map(c => c.timeframe)].join(' + ')})${colors.reset}`);
            }
            
            // HIERARCHICAL EXECUTION LOGIC
            if (totalConfirmed >= minRequiredTFs && window.status !== 'executed') {
                const canExecute = this.checkHierarchicalExecution(window);
                if (canExecute) {
                    if (fronttesterconfig.showWindow) {
                        console.log(`${colors.brightGreen}   ✅ EXECUTING CASCADE - Hierarchical confirmation complete!${colors.reset}`);
                    }
                    window.status = 'ready';
                    this.executeWindow(window, currentTime);
                } else {
                    // Show why execution is blocked
                    if (fronttesterconfig.showWindow) {
                        const confirmedTFs = [window.primaryPivot.timeframe, ...window.confirmations.map(c => c.timeframe)];
                        const roles = confirmedTFs.map(tf => {
                            const role = multiPivotConfig.timeframes.find(t => t.interval === tf)?.role || 'unknown';
                            return `${tf}(${role})`;
                        });
                        console.log(`${colors.yellow}   ⏳ WAITING - Hierarchical requirements not met: ${roles.join(' + ')}${colors.reset}`);
                    }
                }
            }
        }
    }
    
    checkHierarchicalExecution(window) {
        // Get all confirmed timeframes (primary + confirmations)
        const confirmedTimeframes = [window.primaryPivot.timeframe, ...window.confirmations.map(c => c.timeframe)];
        
        // Get timeframe roles from config
        const timeframeRoles = new Map();
        multiPivotConfig.timeframes.forEach(tf => {
            timeframeRoles.set(tf.interval, tf.role);
        });
        
        // Count confirmations and execution timeframes
        let hasExecution = false;
        let confirmationCount = 0;
        const confirmationTFs = [];
        const executionTFs = [];
        
        for (const tf of confirmedTimeframes) {
            const role = timeframeRoles.get(tf);
            if (role === 'execution') {
                hasExecution = true;
                executionTFs.push(tf);
            } else if (role === 'confirmation') {
                confirmationCount++;
                confirmationTFs.push(tf);
            }
            // Primary is always counted (role === 'primary')
        }
        
        const minRequired = multiPivotConfig.cascadeSettings.minTimeframesRequired || 3;
        
        // CRITICAL RULE: Execution timeframe (1m) can ONLY execute if there's at least one confirmation timeframe
        if (hasExecution && confirmationCount === 0) {
            // 1m cannot execute without confirmation timeframes (1h or 15m)
            return false; // Door is closed without confirmation
        }
        
        // EXECUTION RULES:
        // 1. If we have execution timeframe + at least one confirmation -> EXECUTE
        // 2. If no execution but we have all confirmation timeframes -> EXECUTE
        // 3. Must have at least minRequired total timeframes
        
        if (confirmedTimeframes.length >= minRequired) {
            // Rule 1: Has execution timeframe AND at least one confirmation
            if (hasExecution && confirmationCount >= 1) {
                return true; // Execute with execution + confirmation(s)
            }
            
            // Rule 2: No execution, but has all confirmation timeframes
            const totalConfirmationTFs = multiPivotConfig.timeframes.filter(tf => tf.role === 'confirmation').length;
            if (!hasExecution && confirmationCount >= totalConfirmationTFs) {
                return true; // Execute on lowest available timeframe (all confirmations present)
            }
        }
        
        return false; // Not ready for execution
    }
    
    executeWindow(window, currentTime) {
        // Find execution time and price
        const allTimes = [window.primaryPivot.time, ...window.confirmations.map(c => c.pivot.time)];
        const executionTime = Math.max(...allTimes);
        const executionCandle = this.oneMinuteCandles.find(c => Math.abs(c.time - executionTime) <= 30000);
        const executionPrice = executionCandle ? executionCandle.close : window.primaryPivot.price;
        const minutesAfterPrimary = Math.round((executionTime - window.primaryPivot.time) / (1000 * 60));
        
        const cascadeResult = {
            signal: window.primaryPivot.signal,
            strength: (1 + window.confirmations.length) / multiPivotConfig.timeframes.length,
            confirmations: window.confirmations,
            executionTime,
            executionPrice,
            minutesAfterPrimary
        };
        
        this.cascadeCounter++;
        const cascadeInfo = {
            id: this.cascadeCounter,
            primaryPivot: window.primaryPivot,
            cascadeResult,
            timestamp: currentTime,
            windowId: window.id
        };
        
        // Store in both arrays
        this.recentCascades.push(cascadeInfo);
        this.allCascades.push(cascadeInfo);  // Keep ALL cascades for final summary
        
        // Limit recent cascades to 3 for live display
        if (this.recentCascades.length > 3) {
            this.recentCascades.shift();
        }
        
        // Enhanced execution logging - removed duplicate display (displayCascade shows detailed info)
        
        // Create trade if trading is enabled and direction matches
        if (this.shouldCreateTrade(cascadeResult.signal)) {
            const tradeSignal = {
                direction: cascadeResult.signal,
                strength: cascadeResult.strength,
                confirmations: cascadeResult.confirmations
            };
            
            const trade = this.createTrade(tradeSignal, executionCandle || {
                time: executionTime,
                close: executionPrice,
                high: executionPrice,
                low: executionPrice,
                open: executionPrice
            });
            
            if (trade) {
                cascadeInfo.tradeId = trade.id;
            }
        }
        
        this.displayCascade(cascadeInfo);
        window.status = 'executed';
    }
    
    checkExpiredWindows(currentTime) {
        for (const [windowId, window] of this.activeWindows) {
            if (window.status === 'active' && currentTime > window.windowEndTime) {
                window.status = 'expired';
                const timeString12 = new Date(window.windowEndTime).toLocaleString();
                const time24 = new Date(window.windowEndTime).toLocaleTimeString('en-GB', { hour12: false });
                const totalConfirmed = 1 + window.confirmations.length;
                const minRequiredTFs = multiPivotConfig.cascadeSettings.minTimeframesRequired || 3;
                
                if (fronttesterconfig.showWindow) {
                    console.log(`\n${colors.red}❌ PRIMARY WINDOW EXPIRED [${windowId}]: ${window.primaryPivot.timeframe} ${window.primaryPivot.signal.toUpperCase()}${colors.reset}`);
                    console.log(`${colors.red}   Expired at: ${timeString12} (${time24})${colors.reset}`);
                    console.log(`${colors.red}   Final confirmations: ${totalConfirmed}/${minRequiredTFs} (insufficient for execution)${colors.reset}`);
                }
            }
        }
    }

    checkForCascadeAtCurrentTime(currentTime) {
        // Get primary timeframe (first in config)
        const primaryTf = multiPivotConfig.timeframes[0];
        const primaryPivots = this.timeframePivots.get(primaryTf.interval) || [];
        
        if (primaryPivots.length === 0) return;
        
        // Check recent primary pivots for cascade confirmation
        const recentPrimary = primaryPivots.slice(-3); // Check last 3 pivots
        
        for (const primaryPivot of recentPrimary) {
            // Skip if too old or already processed
            const ageMinutes = (currentTime - primaryPivot.time) / (1000 * 60);
            if (ageMinutes > 240 || ageMinutes < 1) continue; // 1-240 minutes old
            
            // Check if already processed
            const alreadyProcessed = this.recentCascades.some(c => 
                c.primaryPivot.time === primaryPivot.time && 
                c.primaryPivot.timeframe === primaryPivot.timeframe
            );
            if (alreadyProcessed) continue;
            
            // Check for cascade confirmation
            const cascadeResult = this.checkCascadeConfirmation(primaryPivot, currentTime);
            if (cascadeResult) {
                this.cascadeCounter++;
                
                const cascadeInfo = {
                    id: this.cascadeCounter,
                    primaryPivot,
                    cascadeResult,
                    timestamp: currentTime
                };
                
                this.recentCascades.push(cascadeInfo);
                if (this.recentCascades.length > 3) {
                    this.recentCascades.shift();
                }
                
                this.displayCascade(cascadeInfo);
            }
        }
    }

    checkCascadeConfirmation(primaryPivot, currentTime) {
        const confirmations = [];
        let totalWeight = 0;
        
        // Check each confirming timeframe (skip primary)
        for (let i = 1; i < multiPivotConfig.timeframes.length; i++) {
            const tf = multiPivotConfig.timeframes[i];
            const pivots = this.timeframePivots.get(tf.interval) || [];
            
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
        const executionCandle = this.oneMinuteCandles.find(c => Math.abs(c.time - executionTime) <= 30000);
        const executionPrice = executionCandle ? executionCandle.close : primaryPivot.price;
        
        return {
            signal: primaryPivot.signal,
            strength,
            confirmations,
            executionTime,
            executionPrice,
            minutesAfterPrimary: Math.round((executionTime - primaryPivot.time) / (1000 * 60))
        };
    }

    displayCascade(cascadeInfo) {
        const { id, primaryPivot, cascadeResult } = cascadeInfo;
        
        console.log(`\n${colors.green}🎯 CASCADE #${id} DETECTED: ${primaryPivot.signal.toUpperCase()}${colors.reset}`);
        console.log(`${colors.cyan}${'─'.repeat(50)}${colors.reset}`);
        
        const primaryTime = new Date(primaryPivot.time).toLocaleString();
        const primaryTime24 = new Date(primaryPivot.time).toLocaleTimeString('en-GB', { hour12: false });
        const executionTime = new Date(cascadeResult.executionTime).toLocaleString();
        const executionTime24 = new Date(cascadeResult.executionTime).toLocaleTimeString('en-GB', { hour12: false });
        const confirmingTFs = cascadeResult.confirmations.map(c => c.timeframe).join(', ');
        
        console.log(`${colors.cyan}Primary Time:    ${primaryTime} (${primaryTime24})${colors.reset}`);
        console.log(`${colors.cyan}Execution Time:  ${executionTime} (${executionTime24}) (+${cascadeResult.minutesAfterPrimary}min)${colors.reset}`);
        console.log(`${colors.cyan}Entry Price:     $${cascadeResult.executionPrice.toFixed(1)}${colors.reset}`);
        console.log(`${colors.cyan}Strength:        ${(cascadeResult.strength * 100).toFixed(0)}%${colors.reset}`);
        console.log(`${colors.cyan}Confirming TFs:  ${confirmingTFs}${colors.reset}`);
        console.log(`${colors.cyan}${'─'.repeat(50)}${colors.reset}`);
        
        // Send Telegram notification for cascade confirmed
        if (fronttesterconfig.showTelegramCascades) {
            const cascadeForTelegram = {
                signal: cascadeResult.signal,
                strength: cascadeResult.strength,
                price: cascadeResult.executionPrice,
                time: cascadeResult.executionTime
            };
            telegramNotifier.notifyCascadeConfirmed(cascadeForTelegram);
        }
        
        this.displayRecentCascades();
    }

    displayRecentCascades() {
        if (!fronttesterconfig.showRecentCascades || this.recentCascades.length === 0) return;
        
        console.log(`\n${colors.magenta}┌─ Recent Cascades (${this.recentCascades.length}/3) ${'─'.repeat(30)}${colors.reset}`);
        
        this.recentCascades.forEach(cascade => {
            const { id, primaryPivot, cascadeResult } = cascade;
            const executionDate = new Date(cascadeResult.executionTime);
            const dateStr = executionDate.toLocaleDateString('en-US', { 
                weekday: 'short', 
                month: 'short', 
                day: 'numeric' 
            });
            const time = executionDate.toLocaleTimeString();
            const time24 = executionDate.toLocaleTimeString('en-GB', { hour12: false });
            const signal = primaryPivot.signal.toUpperCase();
            const strength = (cascadeResult.strength * 100).toFixed(0);
            const price = cascadeResult.executionPrice.toFixed(1);
            
            console.log(`${colors.magenta}│${colors.reset} ${colors.yellow}[${id.toString().padStart(3)}] ${dateStr} ${time.padEnd(11)} (${time24}) | ${signal.padEnd(5)} | ${strength.padStart(2)}% | $${price}${colors.reset}`);
        });
        
        console.log(`${colors.magenta}└${'─'.repeat(60)}${colors.reset}\n`);
    }

    displayAllCascades() {
        if (this.allCascades.length === 0) return;
        
        console.log(`\n${colors.magenta}┌─ All Cascades (${this.allCascades.length}/${this.cascadeCounter}) ${'─'.repeat(30)}${colors.reset}`);
        
        this.allCascades.forEach(cascade => {
            const { id, primaryPivot, cascadeResult } = cascade;
            const executionDate = new Date(cascadeResult.executionTime);
            const dateStr = executionDate.toLocaleDateString('en-US', { 
                weekday: 'short', 
                month: 'short', 
                day: 'numeric' 
            });
            const time = executionDate.toLocaleTimeString();
            const time24 = executionDate.toLocaleTimeString('en-GB', { hour12: false });
            const signal = primaryPivot.signal.toUpperCase();
            const strength = (cascadeResult.strength * 100).toFixed(0);
            const price = cascadeResult.executionPrice.toFixed(1);
            
            console.log(`${colors.magenta}│${colors.reset} ${colors.yellow}[${id.toString().padStart(3)}] ${dateStr} ${time.padEnd(11)} (${time24}) | ${signal.padEnd(5)} | ${strength.padStart(2)}% | $${price}${colors.reset}`);
        });
        
        console.log(`${colors.magenta}└${'─'.repeat(60)}${colors.reset}\n`);
    }

    finishSimulation() {
        // Move final summary to the very bottom with colors
        // console.log(`\n${colors.green}🏁 Clean simulation completed!${colors.reset}`);
        // console.log(`${colors.cyan}${'─'.repeat(40)}${colors.reset}`);
        // console.log(`${colors.yellow}Total Cascades Detected: ${colors.green}${this.cascadeCounter}${colors.reset}`);
        // console.log(`${colors.yellow}Minutes Processed:       ${colors.green}${this.currentMinute}${colors.reset}`);
        // console.log(`${colors.cyan}${'─'.repeat(40)}${colors.reset}`);

        if (this.allCascades.length > 0) {
            console.log(`\nFinal Cascades:`);
            this.displayAllCascades();
        }

        // Display trading statistics first
        if (fronttesterconfig.enableTrading && this.trades.length > 0) {
            this.displayTradingStatistics();
        }
        
        
    }

    stop() {
        this.isRunning = false;
        console.log(`${colors.yellow}🛑 Simulation stopped${colors.reset}`);
    }
}

// Main execution
async function main() {
    const fronttester = new CleanTimeProgressiveFronttester();
    
    try {
        await fronttester.initialize();
        fronttester.startSimulation();
        
        // Handle graceful shutdown
        process.on('SIGINT', () => {
            console.log(`\n${colors.yellow}🛑 Ctrl+C detected - Shutting down gracefully...${colors.reset}`);
            fronttester.stop();
            
            // Display final trading statistics before exit
            console.log(`\n${colors.cyan}=== FINAL SUMMARY (Interrupted) ===${colors.reset}`);
            
            // Display trading statistics if any trades were made
            if (fronttester.trades.length > 0) {
                fronttester.displayTradingStatistics();
            } else {
                console.log(`${colors.yellow}No trades executed during session${colors.reset}`);
                
                // Still send basic summary to Telegram
                const basicStats = {
                    totalTrades: 0,
                    winningTrades: 0,
                    losingTrades: 0,
                    initialCapital: tradeConfig.initialCapital,
                    totalPnL: 0,
                    finalCapital: tradeConfig.initialCapital,
                    winRate: 0,
                    totalReturn: 0
                };
                telegramNotifier.sendTradingSummary(basicStats);
            }
            
            console.log(`\n${colors.green}✅ Session ended gracefully${colors.reset}`);
            setTimeout(() => process.exit(0), 1000); // Give time for Telegram messages to send
        });
        
    } catch (error) {
        console.error(`${colors.red}Error:${colors.reset}`, error);
        process.exit(1);
    }
}

main().catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
});
