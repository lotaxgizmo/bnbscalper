// utils/live/paperTradeManager.js
// Manages the lifecycle of a single simulated trade using live data.

export class PaperTradeManager {
    constructor(tradeConfig, pivot, confirmationCandle) {
        this.config = tradeConfig;
        this.pivot = pivot;
        this.tradeActive = true;

        // Market Order Logic: Fill immediately at the close of the confirmation candle
        const fillPrice = confirmationCandle.close;

        this.order = {
            price: pivot.price, // The pivot price that triggered the trade
            side: pivot.type === 'high' ? 'SELL' : 'BUY',
            status: 'FILLED', // Immediately filled
            takeProfit: 0,
            stopLoss: 0,
            fillTime: confirmationCandle.time, // Fill time is the confirmation candle's time
            fillPrice: fillPrice, // Fill price is the confirmation candle's close
            exitTime: null,
            exitPrice: null,
            pnl: 0,
            result: null // WIN/LOSS
        };

        this.initializeOrder(fillPrice);
    }

    initializeOrder(price) {
        if (this.order.side === 'BUY') {
            this.order.takeProfit = price * (1 + this.config.takeProfit / 100);
            this.order.stopLoss = price * (1 - this.config.stopLoss / 100);
        } else { // SELL
            this.order.takeProfit = price * (1 - this.config.takeProfit / 100);
            this.order.stopLoss = price * (1 + this.config.stopLoss / 100);
        }
    }

    // This method will be called for each new candle from the WebSocket
    update(candle) {
        if (!this.tradeActive) return;

        try {
            // If filled, check for TP/SL
            if (this.order.status === 'FILLED') {
                let closed = false;
                if (this.order.side === 'BUY') {
                    if (candle.high >= this.order.takeProfit) {
                        this.order.result = 'WIN';
                        this.order.exitPrice = this.order.takeProfit;
                        closed = true;
                    } else if (candle.low <= this.order.stopLoss) {
                        this.order.result = 'LOSS';
                        this.order.exitPrice = this.order.stopLoss;
                        closed = true;
                    }
                } else { // SELL
                    if (candle.low <= this.order.takeProfit) {
                        this.order.result = 'WIN';
                        this.order.exitPrice = this.order.takeProfit;
                        closed = true;
                    } else if (candle.high >= this.order.stopLoss) {
                        this.order.result = 'LOSS';
                        this.order.exitPrice = this.order.stopLoss;
                        closed = true;
                    }
                }

                if (closed) {
                    this.order.status = 'CLOSED';
                    this.order.exitTime = candle.time;
                    this.tradeActive = false;
                }
            }
        } catch (error) {
            console.error('[PaperTradeManager] CRITICAL ERROR in update():', error);
            console.error('CRASHING CANDLE:', JSON.stringify(candle, null, 2));
            console.error('CURRENT ORDER STATE:', JSON.stringify(this.order, null, 2));
            this.tradeActive = false; // Stop processing to prevent further errors
        }
    }

    // Returns the final trade result
    getResult() {
        if (this.tradeActive) return null;
        return this.order;
    }

    isActive() {
        return this.tradeActive;
    }

    forceClose(candle) {
        if (!this.tradeActive || this.order.status !== 'FILLED') return;

        this.order.status = 'CLOSED';
        this.order.exitTime = candle.time;
        this.order.exitPrice = candle.close; // Close at the candle's closing price

        if (this.order.side === 'BUY') {
            this.order.result = this.order.exitPrice >= this.order.fillPrice ? 'WIN' : 'LOSS';
        } else { // SELL
            this.order.result = this.order.exitPrice <= this.order.fillPrice ? 'WIN' : 'LOSS';
        }

        this.tradeActive = false;
    }
}
