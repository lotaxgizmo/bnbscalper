// telegramNotifier.js
// Utility for sending notifications to Telegram

import { telegramConfig, validateTelegramConfig } from '../config/telegramConfig.js';
import fetch from 'node-fetch';
import { fmtDateTime, fmtTime24 } from './formatters.js';

class TelegramNotifier {
    constructor() {
        this.token = telegramConfig.token;
        this.chatIds = Array.isArray(telegramConfig.chatIds) ? telegramConfig.chatIds : [telegramConfig.chatIds];
        this.baseUrl = `https://api.telegram.org/bot${this.token}`;
        this.isConfigValid = validateTelegramConfig();
        this.messageQueue = [];
        this.isProcessing = false;
        this.tradeSummary = {
            totalTrades: 0,
            winningTrades: 0,
            losingTrades: 0,
            totalPnL: 0,
            initialCapital: 0,
            finalCapital: 0
        };
    }
    

    // Send message to Telegram
    async sendMessage(message) {
        if (!this.isConfigValid) {
            console.error('Cannot send Telegram message: Invalid configuration');
            return false;
        }
        
        // Add to queue
        this.messageQueue.push(message);
        
        // Process queue if not already processing
        if (!this.isProcessing) {
            await this.processQueue();
        }
    }
    
    // Process message queue with rate limiting
    async processQueue() {
        if (this.messageQueue.length === 0) {
            this.isProcessing = false;
            return;
        }
        
        this.isProcessing = true;
        const message = this.messageQueue.shift();
        
        try {
            const url = `${this.baseUrl}/sendMessage`;
            
            // Send message to all chat IDs
            const promises = this.chatIds.map(async (chatId) => {
                const params = {
                    chat_id: chatId,
                    text: message,
                    parse_mode: 'Markdown'
                };
                
                const response = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(params)
                });
                
                const data = await response.json();
                
                if (!data.ok) {
                    console.error(`Telegram API error for chat ${chatId}: ${data.description}`);
                    return false;
                } else {
                    return true;
                }
            });
            
            const results = await Promise.all(promises);
            const successCount = results.filter(r => r).length;
            
            if (successCount === 0) {
                // All failed, put message back in queue for retry
                this.messageQueue.unshift(message);
            }
        } catch (error) {
            console.error(`Error sending Telegram message: ${error.message}`);
            
            // Put message back in queue for retry
            this.messageQueue.unshift(message);
        }
        
        // Rate limiting - wait 1 second before processing next message
        setTimeout(() => this.processQueue(), 1000);
    }
    
    // Format date for messages
    formatDate(timestamp) {
        // Use timezone-aware helpers (config.timezone)
        const full = fmtDateTime(timestamp);
        const t24 = fmtTime24(timestamp);
        return `${full} (${t24})`;
    }
    
    // Format price for messages (no commas for prices)
    formatPrice(price) {
        return price.toFixed(2);
    }
    
    // Format numbers with commas (for amounts, not prices)
    formatNumber(num) {
        return num.toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    }
    
    // Notify when a cascade is confirmed
    async notifyCascadeConfirmed(cascade) {
        if (!telegramConfig.notifications.cascadeConfirmed) return;
        
        const { signal, strength, price, time } = cascade;
        const emoji = signal === 'long' ? '🟢' : '🔴';
        const direction = signal === 'long' ? 'LONG' : 'SHORT';
        const timeFormatted = this.formatDate(time);
        
        const message = `${emoji} *CASCADE CONFIRMED: ${direction}*\n\n` +
            `💪 Strength: ${strength * 100}%\n` +
            `💰 Price: $${this.formatPrice(price)}\n` +
            `⏰ Time: ${timeFormatted}\n`;
            
        await this.sendMessage(message);
    }
    
    // Notify when a trade is opened
    async notifyTradeOpened(trade) {
        if (!telegramConfig.notifications.tradeOpen) return;
        
        const emoji = trade.direction === 'long' ? '🟢⬆️' : '🔴⬇️';
        const emoji2 = trade.direction === 'long' ? '⬆️🟢' : '⬇️🔴';
        const direction = trade.direction === 'long' ? 'LONG' : 'SHORT';
        const timeFormatted = this.formatDate(trade.entryTime);
        
        const stopLossText = trade.stopLossPrice ? `🛑 *Stop Loss:* $${this.formatPrice(trade.stopLossPrice)}\n` : '';
        const takeProfitText = trade.takeProfitPrice ? `🎯 *Take Profit:* $${this.formatPrice(trade.takeProfitPrice)}\n` : '';
        
        // Debug log to check capitalUsed value
        console.log('DEBUG: Trade data for Telegram:', {
            capitalUsed: trade.capitalUsed,
            positionSize: trade.positionSize,
            leverage: trade.leverage
        });
        
        const capitalText = trade.capitalUsed ? `💼 *Capital Used:* $${this.formatNumber(trade.capitalUsed)}\n` : '';
        
        const message = `${emoji} *TRADE OPENED: ${direction} #${trade.id} ${emoji2}*\n` +
        `------------------------------------------\n` +
        `------------------------------------------\n` +
            `💰 *Entry:* $${this.formatPrice(trade.entryPrice)}\n` +
            `💵 *Size:* $${this.formatNumber(trade.positionSize)}\n` +
            capitalText +
            `⚡ *Leverage:* ${trade.leverage}x\n` +
            stopLossText +
            takeProfitText +
            `⏰ *Time:* ${timeFormatted}\n`;
            
        await this.sendMessage(message);
    }
    
    // Notify when a trade is closed
    async notifyTradeClosed(trade) {
        if (!telegramConfig.notifications.tradeClose) return;
        
        const isWin = trade.pnl >= 0;
        const emoji = isWin ? '✅' : '❌';
        const resultText = isWin ? 'WIN' : 'LOSS';
        const direction = trade.direction === 'long' ? 'LONG' : 'SHORT';
        
        // Map exit reasons to result codes
        const resultCode = {
            'take_profit': 'TP',
            'stop_loss': 'SL', 
            'trailing_stop': 'TRAIL',
            'max_time': 'EOB'
        }[trade.exitReason] || trade.exitReason?.toUpperCase() || 'CLOSED';
        
        const entryTimeFormatted = this.formatDate(trade.entryTime);
        const exitTimeFormatted = this.formatDate(trade.exitTime);
        
        // Calculate duration
        const durationMs = trade.exitTime - trade.entryTime;
        const totalMinutes = Math.floor(durationMs / (1000 * 60));
        const days = Math.floor(totalMinutes / (24 * 60));
        const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
        const minutes = totalMinutes % 60;
        
        let durationStr = '';
        if (days > 0) {
            durationStr = `${days}d ${hours}h ${minutes}m`;
        } else if (hours > 0) {
            durationStr = `${hours}h ${minutes}m`;
        } else {
            durationStr = `${minutes}m`;
        }
        
        const message = `${emoji} *TRADE CLOSED: ${direction} #${trade.id}*\n\n` +
            `📊 *Result:* ${resultText} (${resultCode})\n` +
            `💰 *Entry:* $${this.formatPrice(trade.entryPrice)}\n` +
            `💰 *Exit:* $${this.formatPrice(trade.exitPrice)}\n` +
            `⏱ *Duration:* ${durationStr}\n` +
            `💵 *P&L:* ${isWin ? '+' : ''}$${this.formatNumber(Math.abs(trade.pnl))} (${trade.pnlPercent.toFixed(2)}%)\n` +
            `💼 *Capital:* $${this.formatNumber(trade.finalCapital)}\n` +
            `⏰ *Time:* ${exitTimeFormatted}\n`;
            
        await this.sendMessage(message);
        
        // Update trade summary
        this.tradeSummary.totalTrades++;
        if (isWin) {
            this.tradeSummary.winningTrades++;
        } else {
            this.tradeSummary.losingTrades++;
        }
        this.tradeSummary.totalPnL += trade.pnl;
        this.tradeSummary.finalCapital = trade.finalCapital;
    }
    
    // Send final trading summary
    async sendTradingSummary(tradingStats) {
        if (!telegramConfig.notifications.tradeSummary) return;
        
        const {
            totalTrades,
            winningTrades,
            losingTrades,
            initialCapital,
            totalPnL,
            finalCapital,
            winRate,
            totalReturn
        } = tradingStats;
        
        const message = `📊 *TRADING SUMMARY*\n\n` +
            `📈 *Total Trades:* ${totalTrades.toLocaleString()}\n` +
            `✅ *Winning Trades:* ${winningTrades.toLocaleString()}\n` +
            `❌ *Losing Trades:* ${losingTrades.toLocaleString()}\n` +
            `🎯 *Win Rate:* ${winRate.toFixed(1)}%\n\n` +
            `💰 *Initial Capital:* $${this.formatNumber(initialCapital)}\n` +
            `💵 *Total P&L:* ${totalPnL >= 0 ? '+' : ''}$${this.formatNumber(Math.abs(totalPnL))}\n` +
            `📊 *Total Return:* ${totalReturn >= 0 ? '+' : ''}${totalReturn.toFixed(2)}%\n` +
            `💼 *Final Capital:* $${this.formatNumber(finalCapital)}\n`;
            
        await this.sendMessage(message);
    }
    
    // Set initial capital for summary
    setInitialCapital(capital) {
        this.tradeSummary.initialCapital = capital;
    }
}

// Create and export a singleton instance
const telegramNotifier = new TelegramNotifier();
export default telegramNotifier;
