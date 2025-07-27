// utils/live/paperTradeManager.js
// Manages the lifecycle of a single simulated trade using live data.

export class PaperTradeManager {
    constructor(tradeConfig, pivot) {
        this.config = tradeConfig;
        this.pivot = pivot;
        this.tradeActive = true;

        this.order = {
            price: pivot.price,
            side: pivot.type === 'high' ? 'SELL' : 'BUY',
            status: 'PENDING', // PENDING -> FILLED -> CLOSED
            takeProfit: 0,
            stopLoss: 0,
            fillTime: null,
            fillPrice: null,
            exitTime: null,
            exitPrice: null,
            pnl: 0,
            result: null // WIN/LOSS
        };

        this.initializeOrder();
        console.log(`[PaperTradeManager] Initialized for ${this.order.side} at ${this.order.price}.`);
    }

    initializeOrder() {
        const price = this.order.price;
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

        // 1. Check for order fill if it's pending
        if (this.order.status === 'PENDING') {
            const filled = (this.order.side === 'BUY' && candle.low <= this.order.price) ||
                           (this.order.side === 'SELL' && candle.high >= this.order.price);

            if (filled) {
                this.order.status = 'FILLED';
                this.order.fillTime = candle.time;
                this.order.fillPrice = this.order.price; // Assume exact fill for simulation
                console.log(`[PaperTradeManager] ${this.order.side} Order FILLED at ${this.order.fillPrice}`);
            }
        }

        // 2. If filled, check for TP/SL
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
                console.log(`[PaperTradeManager] Trade CLOSED. Result: ${this.order.result}, Exit Price: ${this.order.exitPrice}`);
            }
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
}
