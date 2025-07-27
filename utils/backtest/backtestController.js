// utils/backtest/backtestController.js
import { TradeExecutor } from './tradeExecutor.js';

export class BacktestController {
  constructor(config, candles, pivots, logger) {
    this.config = config;
    this.candles = candles;
    this.pivots = pivots;
    this.logger = logger;
    this.allTrades = [];
  }

  async run() {
    for (const pivot of this.pivots) {
      const pivotCandle = this.candles.find(c => c.time === pivot.time);
      if (this.logger && pivotCandle) {
        this.logger.logPivot(pivot, pivotCandle);
      }

      // Determine potential trade side from pivot and check if it's allowed by config
      const potentialSide = pivot.type === 'high' ? 'SELL' : 'BUY';
      const allowedDirection = (this.config.direction || 'both').toLowerCase();

      if (allowedDirection !== 'both' && allowedDirection !== potentialSide.toLowerCase()) {
        continue; // Skip this pivot if the direction is not allowed
      }

      const tradeConfigForPivot = this.createTradeConfigForPivot(pivot);
      const executor = new TradeExecutor(tradeConfigForPivot, this.candles, pivot);
      const tradeResult = await executor.run();

      // Log order creation
      if (this.logger && tradeResult && tradeResult.order) {
        this.logger.logLimitOrderCreation(tradeResult.order, pivot);
      }

      if (tradeResult && tradeResult.order.status === 'CLOSED') {
        // Log fill and close
        if (this.logger) {
          const fillCandle = this.candles.find(c => c.time === tradeResult.order.fillTime);
          if(fillCandle) this.logger.logLimitOrderFill(tradeResult.order, fillCandle);

          const pnl = (tradeResult.order.side === 'BUY' 
              ? (tradeResult.order.exitPrice - tradeResult.order.fillPrice) / tradeResult.order.fillPrice 
              : (tradeResult.order.fillPrice - tradeResult.order.exitPrice) / tradeResult.order.fillPrice) * 100;
          this.logger.logLimitOrderClose(tradeResult.order, tradeResult.order.exitPrice, pnl);
        }

        const formattedTrade = this.formatTradeResult(tradeResult, pivot);
        this.allTrades.push(formattedTrade);


      } else if (tradeResult && tradeResult.order.status === 'CANCELLED') {
        if (this.logger) {
            const lastCandle = this.candles[this.candles.length - 1]; // Or a more precise candle
            this.logger.logLimitOrder(tradeResult.order, lastCandle, 'Not Filled');
        }
      }
    }
    return { trades: this.allTrades };
  }

  createTradeConfigForPivot(pivot) {
    return {
      ...this.config,
      scheduleTime: pivot.time,
      price: pivot.price,
      side: pivot.type === 'high' ? 'SELL' : 'BUY',
      amount: 100, // Default amount
      takeProfit: this.config.takeProfit,
      stopLoss: this.config.stopLoss,
      orderDistancePct: 0.0, // Exact price
      updateFrequency: 1000, // Candle updates
      simulationLength: 10000 // Max candles to wait for closure
    };
  }

  formatTradeResult(tradeResult, pivot) {
    const pnlRatio = tradeResult.order.side === 'BUY'
      ? (tradeResult.order.exitPrice - tradeResult.order.fillPrice) / tradeResult.order.fillPrice
      : (tradeResult.order.fillPrice - tradeResult.order.exitPrice) / tradeResult.order.fillPrice;

    const pnlPercentage = pnlRatio * 100 * (this.config.leverage || 1);

    const grossPnlValue = pnlRatio * (tradeResult.order.amount || this.config.initialCapital * (this.config.riskPerTrade / 100)) * (this.config.leverage || 1);

    // Calculate and deduct trading fees
    const tradeAmount = (tradeResult.order.amount || this.config.initialCapital * (this.config.riskPerTrade / 100));
    const leveragedAmount = tradeAmount * (this.config.leverage || 1);
    const fee = leveragedAmount * (this.config.totalMakerFee / 100);

    const pnlValue = grossPnlValue - fee;

    return {
      entryTime: tradeResult.order.fillTime,
      entryPrice: tradeResult.order.fillPrice,
      exitTime: tradeResult.order.exitTime,
      exitPrice: tradeResult.order.exitPrice,
      side: tradeResult.order.side,
      pnl: pnlPercentage,
      duration: tradeResult.duration, // ms
      maxFavorableExcursion: tradeResult.maxFavorableExcursion,
      maxAdverseExcursion: tradeResult.maxAdverseExcursion,
      edges: pivot.edges, // Carry over the edge data from the pivot
      result: pnlPercentage >= 0 ? 'WIN' : 'LOSS',
      pnlValue
    };
  }
}
