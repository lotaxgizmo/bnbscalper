// multiPivotFronttesterLive.js
// DUAL MODE: HISTORICAL SIMULATION + LIVE WEBSOCKET TRADING

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
import WebSocket from 'ws';
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

class LiveMultiPivotFronttester {
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
        
        // WebSocket properties for live mode
        this.isLiveMode = !fronttesterconfig.pastMode; // Detect live mode from config
        this.ws = null;
        this.currentPrice = 0;
        this.lastPriceUpdate = 0;
        this.lastCandleCheck = 0;
        this.candleCheckInterval = (fronttesterconfig.candleCheckInterval || 20) * 1000; // Configurable candle check interval
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 1000; // Start with 1 second
        
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
        
        const slippagePercent = calculateSlippage(tradeConfig.amountPerTrade, tradeConfig);
        const entryPrice = applySlippage(candle.close, signal.direction, slippagePercent);
        
        let positionSize;
        switch (tradeConfig.amountPerTradeMode) {
            case 'fixed':
                positionSize = tradeConfig.amountPerTrade;
                break;
            case 'percentage':
                positionSize = this.capital * (tradeConfig.initialCapital / 100);
                break;
            case 'minimum':
                positionSize = Math.max(tradeConfig.amountPerTrade, this.capital * (tradeConfig.initialCapital / 100));
                break;
            default:
                positionSize = tradeConfig.amountPerTrade;
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
            ? entryPrice * (1 - tradeConfig.stopLoss / 100)
            : entryPrice * (1 + tradeConfig.stopLoss / 100);
            
        const takeProfitPrice = signal.direction === 'long'
            ? entryPrice * (1 + tradeConfig.takeProfit / 100)
            : entryPrice * (1 - tradeConfig.takeProfit / 100);
        
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
        const operatingMode = this.isLiveMode ? 'LIVE WEBSOCKET' : 'HISTORICAL SIMULATION';
        const dataSource = this.isLiveMode ? 'WebSocket + API' : (useLocalData ? 'CSV Files (Local)' : `${api.toUpperCase()} API`);
        
        console.log(`${colors.cyan}=== LIVE MULTI-PIVOT FRONTTESTER ===${colors.reset}`);
        console.log(`${colors.yellow}Symbol: ${symbol}${colors.reset}`);
        console.log(`${colors.yellow}Operating Mode: ${colors.brightCyan}${operatingMode}${colors.reset}`);
        console.log(`${colors.yellow}Data Source: ${dataSource}${colors.reset}`);
        
        if (this.isLiveMode) {
            console.log(`${colors.yellow}Method: Real-time WebSocket + Live pivot detection${colors.reset}`);
        } else {
            console.log(`${colors.yellow}Method: Step-by-step minute progression${colors.reset}`);
        }
        
        // Display trading configuration
        if (fronttesterconfig.enableTrading) {
            console.log(`\n${colors.cyan}💰 TRADING CONFIGURATION${colors.reset}`);
            console.log(`${colors.yellow}Trading: ${colors.green}ENABLED${colors.reset}`);
            console.log(`${colors.yellow}Direction: ${tradeConfig.direction.toUpperCase()}${colors.reset}`);
            console.log(`${colors.yellow}Initial Capital: $${formatNumberWithCommas(tradeConfig.initialCapital)}${colors.reset}`);
            const sizeMode = tradeConfig.amountPerTradeMode || 'percentage';
            const sizeDisplay = sizeMode === 'fixed' 
                ? `$${formatNumberWithCommas(tradeConfig.amountPerTrade || 100)}` 
                : `${tradeConfig.initialCapital || tradeConfig.riskPerTrade || 100}%`;
            console.log(`${colors.yellow}Position Size: ${sizeMode} (${sizeDisplay})${colors.reset}`);
            console.log(`${colors.yellow}Leverage: ${tradeConfig.leverage}x${colors.reset}`);
            console.log(`${colors.yellow}Stop Loss: ${tradeConfig.stopLoss || tradeConfig.stopLoss}% | Take Profit: ${tradeConfig.takeProfit || tradeConfig.takeProfit}%${colors.reset}`);
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

        if (this.isLiveMode) {
            // Live mode: Load initial data and setup WebSocket
            await this.initializeLiveMode();
        } else {
            // Past mode: Load historical data for simulation
            await this.initializeHistoricalMode();
        }
        
        console.log(`${colors.green}✅ System initialized successfully${colors.reset}`);
        console.log(`${colors.cyan}📊 Ready for ${this.isLiveMode ? 'live trading' : 'simulation'}${colors.reset}\n`);
    }

    async initializeLiveMode() {
        console.log(`${colors.cyan}=== INITIALIZING LIVE MODE ===${colors.reset}`);
        
        // Load recent historical data for all timeframes to build context
        await this.loadRecentHistoricalData();
        
        // Initialize pivot tracking
        for (const tf of multiPivotConfig.timeframes) {
            this.timeframePivots.set(tf.interval, []);
            this.lastPivots.set(tf.interval, { type: null, price: null, time: null, index: 0 });
        }
        
        // Analyze initial pivots from historical data
        await this.analyzeInitialPivots();
        
        // Connect to WebSocket for live price feed
        await this.connectWebSocket();
        
        console.log(`${colors.green}✅ Live mode initialized${colors.reset}`);
    }
    
    async initializeHistoricalMode() {
        console.log(`${colors.cyan}=== INITIALIZING HISTORICAL MODE ===${colors.reset}`);
        
        // Load raw candle data for all timeframes
        await this.loadAllTimeframeData();
        
        // Initialize pivot tracking
        for (const tf of multiPivotConfig.timeframes) {
            this.timeframePivots.set(tf.interval, []);
            // Initialize last pivot tracking for swing filtering
            this.lastPivots.set(tf.interval, { type: null, price: null, time: null, index: 0 });
        }
        
        console.log(`${colors.green}✅ Historical mode initialized${colors.reset}`);
    }
    
    async loadRecentHistoricalData() {
        console.log(`${colors.cyan}Loading recent historical data for context...${colors.reset}`);
        
        // Import API function directly to bypass MultiTimeframePivotDetector limits
        const { getCandles } = await import('./apis/bybit.js');
        
        for (const tf of multiPivotConfig.timeframes) {
            // Load minimal recent data for live mode context
            const contextLimit = this.getContextLimit(tf.interval);
            
            try {
                console.log(`${colors.yellow}[${tf.interval}] Loading ${contextLimit} recent candles...${colors.reset}`);
                // FORCE API usage in live mode (forceLocal = false)
                const candles = await getCandles(symbol, tf.interval, contextLimit, null, false);
                
                if (candles && candles.length > 0) {
                    this.timeframeCandles.set(tf.interval, candles);
                    console.log(`${colors.green}[${tf.interval.padEnd(4)}] Loaded ${candles.length.toString().padStart(3)} recent candles for context${colors.reset}`);
                } else {
                    console.log(`${colors.red}[${tf.interval.padEnd(4)}] No candles received${colors.reset}`);
                    this.timeframeCandles.set(tf.interval, []);
                }
            } catch (error) {
                console.error(`${colors.red}Error loading ${tf.interval} candles:${colors.reset}`, error);
                this.timeframeCandles.set(tf.interval, []);
            }
        }
    }
    
    getContextLimit(interval) {
        // Return minimal context needed for each timeframe in live mode
        const contextLimits = {
            '1m': 100,    // 100 minutes = 1.7 hours of context
            '5m': 60,     // 300 minutes = 5 hours of context  
            '15m': 40,    // 600 minutes = 10 hours of context
            '30m': 24,    // 720 minutes = 12 hours of context
            '1h': 24,     // 24 hours = 1 day of context
            '4h': 12,     // 48 hours = 2 days of context
            '1d': 7       // 7 days of context
        };
        
        return contextLimits[interval] || 50; // Default to 50 if interval not found
    }
    
    async analyzeInitialPivots() {
        console.log(`${colors.cyan}Analyzing initial pivots from historical data...${colors.reset}`);
        
        for (const tf of multiPivotConfig.timeframes) {
            const candles = this.timeframeCandles.get(tf.interval) || [];
            if (candles.length < tf.lookback + 10) continue;
            
            // Analyze last portion of historical data for existing pivots
            for (let i = tf.lookback; i < candles.length; i++) {
                const pivot = this.detectPivotAtCandle(candles, i, tf);
                if (pivot) {
                    const pivots = this.timeframePivots.get(tf.interval) || [];
                    pivots.push(pivot);
                    this.timeframePivots.set(tf.interval, pivots);
                }
            }
            
            const pivotCount = this.timeframePivots.get(tf.interval).length;
            console.log(`${colors.yellow}[${tf.interval.padEnd(4)}] Found ${pivotCount.toString().padStart(2)} initial pivots${colors.reset}`);
        }
        
        // CRITICAL: Check for existing primary windows that should be active
        this.checkForExistingPrimaryWindows();
    }
    
    checkForExistingPrimaryWindows() {
        // This method displays existing active windows for monitoring (like backtester)
        // Shows context of what windows are currently open, but doesn't execute old trades
        
        const currentTime = Date.now();
        
        // Find primary timeframes
        const primaryTimeframes = multiPivotConfig.timeframes.filter(tf => tf.role === 'primary');
        
        for (const primaryTf of primaryTimeframes) {
            const pivots = this.timeframePivots.get(primaryTf.interval) || [];
            if (pivots.length === 0) continue;
            
            // Check recent pivots to see if any should have active windows
            const recentPivots = pivots.slice(-5); // Check last 5 pivots
            
            for (const pivot of recentPivots) {
                const confirmationWindow = multiPivotConfig.cascadeSettings.confirmationWindow[primaryTf.interval] || 60;
                const windowEndTime = pivot.time + (confirmationWindow * 60 * 1000);
                
                // If this pivot's window is still active, show it for monitoring
                if (currentTime <= windowEndTime) {
                    const timeRemaining = Math.round((windowEndTime - currentTime) / (60 * 1000));
                    console.log(`${colors.cyan}🔄 ACTIVE WINDOW: ${primaryTf.interval} ${pivot.signal.toUpperCase()} pivot from ${new Date(pivot.time).toLocaleTimeString()} (${timeRemaining}min remaining)${colors.reset}`);
                    
                    // Open window for monitoring but mark it as historical (no execution)
                    this.openPrimaryWindow(pivot, currentTime, true); // true = historical mode
                }
            }
        }
    }
    
    // REMOVED: checkExistingConfirmations method
    // Live mode should not execute trades based on historical confirmations
    // Only new live pivots should trigger confirmations and executions
    
    displayActiveWindows() {
        // Display all currently active windows (like backtester does on each candle)
        const currentTime = Date.now();
        const activeWindows = Array.from(this.activeWindows.values()).filter(w => 
            w.status === 'active' && currentTime <= w.windowEndTime
        );
        
        if (activeWindows.length > 0) {
            console.log(`${colors.cyan}📊 ACTIVE WINDOWS (${activeWindows.length}):${colors.reset}`);
            for (const window of activeWindows) {
                const timeRemaining = Math.round((window.windowEndTime - currentTime) / (60 * 1000));
                const confirmationCount = window.confirmations.length;
                const status = window.isHistorical ? 'MONITORING' : 'LIVE';
                console.log(`   ${window.id}: ${window.primaryPivot.timeframe} ${window.primaryPivot.signal.toUpperCase()} | ${confirmationCount} confirmations | ${timeRemaining}min left | ${status}`);
            }
        }
    }
    
    async connectWebSocket() {
        console.log(`${colors.cyan}Connecting to Bybit WebSocket...${colors.reset}`);
        
        const wsUrl = 'wss://stream.bybit.com/v5/public/linear';
        this.ws = new WebSocket(wsUrl);
        
        this.ws.on('open', () => {
            console.log(`${colors.green}✅ WebSocket connected${colors.reset}`);
            
            // Subscribe to ticker updates
            const subscribeMsg = {
                op: 'subscribe',
                args: [`tickers.${symbol}`]
            };
            
            this.ws.send(JSON.stringify(subscribeMsg));
            console.log(`${colors.yellow}📡 Subscribed to ${symbol} ticker updates${colors.reset}`);
            
            // Start heartbeat
            this.startHeartbeat();
            
            // Reset reconnect attempts
            this.reconnectAttempts = 0;
        });
        
        this.ws.on('message', (data) => {
            try {
                const message = JSON.parse(data.toString());
                this.handleWebSocketMessage(message);
            } catch (error) {
                console.error(`${colors.red}WebSocket message parse error:${colors.reset}`, error);
            }
        });
        
        this.ws.on('error', (error) => {
            console.error(`${colors.red}WebSocket error:${colors.reset}`, error);
        });
        
        this.ws.on('close', () => {
            console.log(`${colors.yellow}⚠️  WebSocket disconnected${colors.reset}`);
            this.stopHeartbeat();
            
            if (this.isRunning) {
                this.attemptReconnect();
            }
        });
    }
    
    handleWebSocketMessage(message) {
        if (message.topic && message.topic.startsWith('tickers.')) {
            const ticker = message.data;
            if (ticker && ticker.lastPrice) {
                this.currentPrice = parseFloat(ticker.lastPrice);
                this.lastPriceUpdate = Date.now();
                
                // Rate limit candle checking - only check every 30 seconds
                if (Date.now() - this.lastCandleCheck >= this.candleCheckInterval) {
                    this.lastCandleCheck = Date.now();
                    this.checkForNewCandles();
                }
            }
        }
    }
    
    async checkForNewCandles() {
        // This method will check if any timeframe has completed a new candle
        // and fetch the latest candle data from API
        const currentTime = Date.now();
        let newCandlesFound = 0;
        
        for (const tf of multiPivotConfig.timeframes) {
            const intervalMs = this.getIntervalInMs(tf.interval);
            const candles = this.timeframeCandles.get(tf.interval) || [];
            
            if (candles.length === 0) continue;
            
            const lastCandle = candles[candles.length - 1];
            const nextCandleTime = lastCandle.time + intervalMs;
            
            // Check if we should have a new candle by now
            if (currentTime >= nextCandleTime + 5000) { // 5 second buffer
                const hadNewCandle = await this.fetchLatestCandle(tf.interval);
                if (hadNewCandle) newCandlesFound++;
            }
        }
        
        // Check for expired windows
        this.checkExpiredWindows(currentTime);
        
        // Display active windows for monitoring (like backtester)
        this.displayActiveWindows();
        
        // Single success message
        if (newCandlesFound === 0) {
            console.log(`${colors.dim}✅ Candle check complete - No new candles${colors.reset}`);
        }
    }
    
    async fetchLatestCandle(interval) {
        try {
            // Import the API function dynamically
            const { getCandles } = await import('./apis/bybit.js');
            
            // Fetch the latest candle - FORCE API usage in live mode (forceLocal = false)
            const newCandles = await getCandles(symbol, interval, 1, null, false);
            
            if (newCandles && newCandles.length > 0) {
                const newCandle = newCandles[0];
                const existingCandles = this.timeframeCandles.get(interval) || [];
                
                // Check if this is actually a new candle
                const lastCandle = existingCandles[existingCandles.length - 1];
                if (!lastCandle || newCandle.time > lastCandle.time) {
                    // Add new candle
                    existingCandles.push(newCandle);
                    
                    // Keep only recent candles (last 200)
                    if (existingCandles.length > 200) {
                        existingCandles.shift();
                    }
                    
                    this.timeframeCandles.set(interval, existingCandles);
                    
                    console.log(`${colors.green}🕯️  New ${interval} candle: $${newCandle.close.toFixed(1)} at ${new Date(newCandle.time).toLocaleTimeString()}${colors.reset}`);
                    
                    // Check for new pivot at this candle
                    this.checkForNewPivot(interval, existingCandles.length - 1);
                    
                    return true; // New candle found
                }
            }
            return false; // No new candle
        } catch (error) {
            console.error(`${colors.red}Error fetching latest ${interval} candle:${colors.reset}`, error);
            return false;
        }
    }
    
    checkForNewPivot(interval, candleIndex) {
        const tf = multiPivotConfig.timeframes.find(t => t.interval === interval);
        if (!tf) return;
        
        const candles = this.timeframeCandles.get(interval) || [];
        if (candleIndex < tf.lookback) return;
        
        const pivot = this.detectPivotAtCandle(candles, candleIndex, tf);
        if (pivot) {
            const pivots = this.timeframePivots.get(interval) || [];
            pivots.push(pivot);
            this.timeframePivots.set(interval, pivots);
            
            console.log(`${colors.brightYellow}🎯 NEW ${pivot.signal.toUpperCase()} PIVOT: ${interval} @ $${pivot.price.toFixed(1)}${colors.reset}`);
            
            // Handle pivot based on role - SAME LOGIC AS PAST MODE
            if (tf.role === 'primary') {
                this.openPrimaryWindow(pivot, Date.now());
            } else {
                // Check if this pivot confirms any active windows
                this.checkWindowConfirmations(pivot, tf, Date.now());
            }
        }
    }
    
    getIntervalInMs(interval) {
        const timeMap = {
            '1m': 60 * 1000,
            '5m': 5 * 60 * 1000,
            '15m': 15 * 60 * 1000,
            '30m': 30 * 60 * 1000,
            '1h': 60 * 60 * 1000,
            '4h': 4 * 60 * 60 * 1000,
            '1d': 24 * 60 * 60 * 1000
        };
        return timeMap[interval] || 60 * 1000;
    }
    
    startHeartbeat() {
        this.heartbeatInterval = setInterval(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.ping();
                
                if (fronttesterconfig.showHeartbeat) {
                    const timeSinceUpdate = Date.now() - this.lastPriceUpdate;
                    console.log(`${colors.cyan}💓 Live: $${this.currentPrice.toFixed(1)} (${Math.floor(timeSinceUpdate/1000)}s ago)${colors.reset}`);
                }
            }
        }, 30000); // 30 second heartbeat
    }
    
    stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }
    
    attemptReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.log(`${colors.red}❌ Max reconnection attempts reached. Stopping.${colors.reset}`);
            this.stop();
            return;
        }
        
        this.reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
        
        console.log(`${colors.yellow}🔄 Attempting reconnection ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay/1000}s...${colors.reset}`);
        
        setTimeout(() => {
            this.connectWebSocket();
        }, delay);
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

        // Ensure 1m candles are available for time progression/trade tracking even if not configured for cascade
        let oneMinute = this.timeframeCandles.get('1m') || [];
        if (oneMinute.length === 0) {
            try {
                console.log(`${colors.cyan}[1m] Loading 1-minute candles for trade tracking${colors.reset}`);
                await detector.loadTimeframeData({ interval: '1m' }, useLocalData, fronttesterconfig.dataLimit || configLimit);
                oneMinute = detector.timeframeData.get('1m') || [];
                this.timeframeCandles.set('1m', oneMinute);
                console.log(`${colors.green}[1m] Loaded ${oneMinute.length} 1-minute candles for trade tracking${colors.reset}`);
            } catch (e) {
                console.warn(`${colors.yellow}[WARN] Failed to load 1m candles for trade tracking. Simulation will proceed using available data.${colors.reset}`);
            }
        }

        // Get 1-minute candles for time progression
        this.oneMinuteCandles = oneMinute;
        console.log(`${colors.green}Time progression: ${this.oneMinuteCandles.length} minutes${colors.reset}`);
    }

    startSimulation() {
        this.isRunning = true;
        
        if (this.isLiveMode) {
            this.startLiveMode();
        } else {
            this.startHistoricalMode();
        }
    }
    
    startLiveMode() {
        console.log(`${colors.cyan}🚀 Starting live WebSocket mode...${colors.reset}\n`);
        console.log(`${colors.green}🟢 LIVE MODE ACTIVE - Monitoring real-time market data${colors.reset}`);
        console.log(`${colors.yellow}Waiting for live pivots and cascade confirmations...${colors.reset}\n`);
        
        // In live mode, everything is event-driven through WebSocket
        // The system will automatically detect new pivots as candles complete
        // and execute trades when cascades are confirmed
        
        // Monitor open trades every minute
        this.liveTradeMonitor = setInterval(() => {
            if (this.openTrades.length > 0) {
                // Create a mock candle with current price for trade monitoring
                const mockCandle = {
                    time: Date.now(),
                    close: this.currentPrice,
                    high: this.currentPrice,
                    low: this.currentPrice,
                    open: this.currentPrice
                };
                this.monitorTrades(mockCandle);
            }
        }, 60000); // Check every minute
        
        // Periodic candle check every 2 minutes (backup to WebSocket rate limiting)
        this.candleCheckTimer = setInterval(() => {
            this.checkForNewCandles();
        }, 120000); // Check every 2 minutes
        
        // CRITICAL: Check for expired windows every minute (same as past mode)
        this.windowCheckTimer = setInterval(() => {
            this.checkExpiredWindows(Date.now());
        }, 60000); // Check every minute
    }
    
    startHistoricalMode() {
        if (this.oneMinuteCandles.length === 0) {
            console.error(`${colors.red}No 1-minute candles for simulation${colors.reset}`);
            return;
        }

        console.log(`${colors.cyan}🚀 Starting historical simulation...${colors.reset}\n`);
        
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
            
            // Step 2: Check for expired windows
            this.checkExpiredWindows(currentTime);
            
            // Step 3: Monitor and manage open trades
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

    openPrimaryWindow(primaryPivot, currentTime, isHistorical = false) {
        this.windowCounter++;
        const windowId = `W${this.windowCounter}`;
        const confirmationWindow = multiPivotConfig.cascadeSettings.confirmationWindow[primaryPivot.timeframe];
        const windowEndTime = primaryPivot.time + (confirmationWindow * 60 * 1000);
        
        const window = {
            id: windowId,
            primaryPivot,
            openTime: currentTime,
            windowEndTime,
            confirmations: [],
            status: 'active',
            isHistorical: isHistorical  // Mark if this is from historical data
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
            
            // Updated hierarchical validation: do not block execution timeframe confirmations here.
            // Role requirements are enforced later in checkHierarchicalExecution().
            
            // Add confirmation
            window.confirmations.push({
                timeframe: timeframe.interval,
                pivot,
                confirmTime: pivot.time // CRITICAL FIX: Use actual pivot time, not processing time!
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
                    // CRITICAL: Do not execute trades for historical windows
                    if (window.isHistorical) {
                        if (fronttesterconfig.showWindow) {
                            console.log(`${colors.yellow}   ⚠️ HISTORICAL CASCADE - Not executing (historical data)${colors.reset}`);
                        }
                        window.status = 'historical_complete';
                        return; // Do not execute historical cascades
                    }
                    
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
        // Gather confirmed timeframes (primary + confirmations)
        const confirmedTimeframes = [
            window.primaryPivot.timeframe,
            ...window.confirmations.map(c => c.timeframe)
        ];

        const minRequired = multiPivotConfig.cascadeSettings.minTimeframesRequired || 3;
        if (confirmedTimeframes.length < minRequired) return false;

        // Primary enforcement (optional)
        const primaryTF = multiPivotConfig.timeframes.find(tf => tf.role === 'primary')?.interval;
        const requirePrimary = !!multiPivotConfig.cascadeSettings.requirePrimaryTimeframe;
        const hasPrimary = primaryTF ? confirmedTimeframes.includes(primaryTF) : false;

        // Execution enforcement (only if execution role exists in config)
        const executionTF = multiPivotConfig.timeframes.find(tf => tf.role === 'execution')?.interval;
        const executionRoleExists = !!executionTF;
        if (executionRoleExists && !confirmedTimeframes.includes(executionTF)) return false;

        if (requirePrimary && !hasPrimary) return false;

        return true;
    }
    
    executeWindow(window, currentTime) {
        // EXACT BACKTESTER LOGIC: Use backtester's checkWindowBasedCascade logic
        const confirmationWindow = multiPivotConfig.cascadeSettings.confirmationWindow[window.primaryPivot.timeframe] || 60;
        const windowEndTime = window.primaryPivot.time + (confirmationWindow * 60 * 1000);
        const minRequiredTFs = multiPivotConfig.cascadeSettings.minTimeframesRequired || 3;
        
        // DEBUG: Enabled for investigation
        const isFirstFew = true;
        
        // Find all confirming timeframes (exclude primary)
        const confirmingTimeframes = multiPivotConfig.timeframes.slice(1); // Skip primary (first)
        const confirmations = [];
        
        // Collect all confirmations within window
        const allConfirmations = [...window.confirmations].sort((a, b) => a.confirmTime - b.confirmTime);
        
        // Find the earliest time when we have minimum required confirmations
        let executionTime = window.primaryPivot.time;
        let executionPrice = window.primaryPivot.price;
        const confirmedTimeframes = new Set(['4h']); // Primary timeframe
        
        for (const confirmation of allConfirmations) {
            confirmedTimeframes.add(confirmation.timeframe);
            
            if (isFirstFew) {
                console.log(`   ✅ ${confirmation.timeframe} confirms at ${new Date(confirmation.confirmTime).toISOString()} ($${confirmation.pivot.price})`);
            }
            
            // Check if we now have minimum required confirmations
            if (confirmedTimeframes.size >= minRequiredTFs) {
                // EXACT BACKTESTER LOGIC: Build final confirmations list first
                confirmations.length = 0;
                const usedTimeframes = new Set();
                for (const conf of allConfirmations) {
                    if (conf.confirmTime <= confirmation.confirmTime && !usedTimeframes.has(conf.timeframe)) {
                        confirmations.push(conf);
                        usedTimeframes.add(conf.timeframe);
                    }
                }
                
                // CRITICAL FIX: Use EARLIEST execution time when minimum confirmations are met
                // This is the confirmation time of the CURRENT confirmation that met the threshold
                // This matches backtester behavior which executes as soon as minimum confirmations are met
                executionTime = confirmation.confirmTime;
                
                // EXACT BACKTESTER LOGIC: Use 1-minute candle close price at execution time
                const executionCandle = this.oneMinuteCandles.find(c => Math.abs(c.time - executionTime) <= 30000);
                executionPrice = executionCandle ? executionCandle.close : window.primaryPivot.price;
                
                // Store the execution candle for later use in trade creation
                this.lastExecutionCandle = executionCandle || null;
                
                if (isFirstFew) {
                    console.log(`   ⏰ EXECUTION: ${confirmedTimeframes.size}/${minRequiredTFs} confirmations met at ${new Date(executionTime).toISOString()} ($${executionPrice})`);
                }
                
                break; // CRITICAL: Break immediately like backtester
            }
        }
        
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
            
            // Flip-on-opposite-signal: close opposite trades at execution time, ignore same-direction duplicates
            if (fronttesterconfig.enableTrading) {
                // Determine execution candle/price for accurate flip exit
                const execCandle = this.lastExecutionCandle || { time: executionTime, close: executionPrice, high: executionPrice, low: executionPrice, open: executionPrice };
                const flipExitPriceRaw = execCandle.close;

                if (tradeConfig.switchOnOppositeSignal) {
                    const oppositeDir = tradeSignal.direction === 'long' ? 'short' : 'long';
                    // Close all opposite open trades
                    for (let i = this.openTrades.length - 1; i >= 0; i--) {
                        const t = this.openTrades[i];
                        if (t.direction !== oppositeDir) continue;
                        this.closeTrade(t, flipExitPriceRaw, execCandle.time, 'flip');
                        this.openTrades.splice(i, 1);
                    }
                }

                // If a same-direction trade is already open, ignore this signal
                const hasSameDirectionOpen = this.openTrades.some(t => t.direction === tradeSignal.direction);
                if (!hasSameDirectionOpen) {
                    // Use the stored execution candle or create a synthetic one
                    const trade = this.createTrade(tradeSignal, execCandle);
                    if (trade) {
                        cascadeInfo.tradeId = trade.id;
                    }
                } else if (fronttesterconfig.showTrades) {
                    console.log(`${colors.yellow}↪ Ignored duplicate ${tradeSignal.direction.toUpperCase()} signal: same-direction trade already open${colors.reset}`);
                }
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
        // Cleanup live mode resources
        this.cleanupLiveMode();
        
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
    
    cleanupLiveMode() {
        if (this.isLiveMode) {
            // Close WebSocket connection
            if (this.ws) {
                this.ws.close();
                this.ws = null;
            }
            
            // Clear all timers
            if (this.liveTradeMonitor) {
                clearInterval(this.liveTradeMonitor);
                this.liveTradeMonitor = null;
            }
            
            if (this.candleCheckTimer) {
                clearInterval(this.candleCheckTimer);
                this.candleCheckTimer = null;
            }
            
            if (this.windowCheckTimer) {
                clearInterval(this.windowCheckTimer);
                this.windowCheckTimer = null;
            }
            
            if (this.heartbeatInterval) {
                clearInterval(this.heartbeatInterval);
                this.heartbeatInterval = null;
            }
            
            console.log(`${colors.yellow}🧹 Live mode resources cleaned up${colors.reset}`);
        }
    }

    stop() {
        this.isRunning = false;
        
        // Clean up WebSocket connection
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        
        // Clean up intervals
        this.stopHeartbeat();
        if (this.liveTradeMonitor) {
            clearInterval(this.liveTradeMonitor);
            this.liveTradeMonitor = null;
        }
        if (this.candleCheckTimer) {
            clearInterval(this.candleCheckTimer);
            this.candleCheckTimer = null;
        }
        if (this.windowCheckTimer) {
            clearInterval(this.windowCheckTimer);
            this.windowCheckTimer = null;
        }
        
        const modeText = this.isLiveMode ? 'Live trading' : 'Simulation';
        console.log(`${colors.yellow}🛑 ${modeText} stopped${colors.reset}`);
    }
}

// Main execution
async function main() {
    const fronttester = new LiveMultiPivotFronttester();
    
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
