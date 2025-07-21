// backtestEngine.js
import PivotTracker from '../pivotTracker.js';
import { colors } from '../formatters.js';

export class BacktestEngine {
  constructor(config, tradeConfig, logger) {
    this.config = config;
    this.tradeConfig = tradeConfig;
    this.trades = [];
    this.currentCapital = tradeConfig.initialCapital;
    this.pivotTracker = new PivotTracker(config);
    this.logger = logger;
    
    // Custom strategy handlers
    this.entryRules = [];
    this.exitRules = [];
    this.positionRules = [];
  }

  // Strategy customization methods
  addEntryRule(rule) {
    this.entryRules.push(rule);
  }

  addExitRule(rule) {
    this.exitRules.push(rule);
  }

  addPositionRule(rule) {
    this.positionRules.push(rule);
  }

  calculatePnL(entryPrice, exitPrice, isLong) {
    const { leverage, totalMakerFee } = this.tradeConfig;
    const rawPnL = isLong 
      ? (exitPrice - entryPrice) / entryPrice * 100
      : (entryPrice - exitPrice) / entryPrice * 100;
    
    const pnlAfterFees = rawPnL - totalMakerFee;
    return pnlAfterFees * leverage;
  }

  canEnterAtPrice(price, candle) {
    // Run through all custom entry rules
    return this.entryRules.length === 0 || 
           this.entryRules.every(rule => rule(price, candle, this));
  }

  calculateExitLevels(entry, candle) {
    let tp = this.tradeConfig.takeProfit;
    let sl = this.tradeConfig.stopLoss;

    // Apply custom exit rules
    this.exitRules.forEach(rule => {
      const levels = rule(entry, candle, this);
      if (levels) {
        tp = levels.takeProfit || tp;
        sl = levels.stopLoss || sl;
      }
    });

    return { tp, sl };
  }

  handleActiveTrade(trade, candle) {
    const { entry, isLong } = trade;
    const { tp, sl } = this.calculateExitLevels(entry, candle);
    
    const hitTakeProfit = isLong 
      ? candle.high >= entry * (1 + tp/100)
      : candle.low <= entry * (1 - tp/100);
    
    const hitStopLoss = isLong
      ? candle.low <= entry * (1 - sl/100)
      : candle.high >= entry * (1 + sl/100);

    // Track excursions
    const currentFavorableExcursion = isLong
      ? (candle.high - entry) / entry * 100
      : (entry - candle.low) / entry * 100;
    
    const currentAdverseExcursion = isLong
      ? (entry - candle.low) / entry * 100
      : (candle.high - entry) / entry * 100;

    trade.maxFavorableExcursion = Math.max(
      trade.maxFavorableExcursion || 0,
      currentFavorableExcursion
    );
    
    trade.maxAdverseExcursion = Math.max(
      trade.maxAdverseExcursion || 0,
      currentAdverseExcursion
    );

    if (hitTakeProfit || hitStopLoss) {
      const exitPrice = hitTakeProfit
        ? entry * (1 + (isLong ? 1 : -1) * tp/100)
        : entry * (1 + (isLong ? -1 : 1) * sl/100);
      
      const pnl = this.calculatePnL(entry, exitPrice, isLong);
      const capitalChange = this.currentCapital * (pnl / 100);
      this.currentCapital += capitalChange;

      const completedTrade = {
        ...trade,
        exit: exitPrice,
        exitTime: candle.time, // Already in seconds
        pnl,
        capitalBefore: this.currentCapital - capitalChange,
        capitalAfter: this.currentCapital,
        maxFavorableExcursion: trade.maxFavorableExcursion || 0,
        maxAdverseExcursion: trade.maxAdverseExcursion || 0,
        result: hitTakeProfit ? 'WIN' : 'LOSS'
      };

      return { closed: true, trade: completedTrade };
    }

    return { closed: false };
  }

  handleActiveOrder(order, candle) {
    const avgSwing = this.pivotTracker.getAverageSwing();
    const cancelThreshold = avgSwing * (this.tradeConfig.cancelThresholdPct / 100);
    
    if (avgSwing === 0) return { cancelled: false, filled: false };
    
    // Check cancellation conditions
    if (order.isLong) {
      if (candle.close > order.price * (1 + cancelThreshold/100)) {
        this.logger?.logLimitOrder(order, candle, 'Price moved too far up');
        return { cancelled: true, filled: false };
      }
    } else {
      if (candle.close < order.price * (1 - cancelThreshold/100)) {
        this.logger?.logLimitOrder(order, candle, 'Price moved too far down');
        return { cancelled: true, filled: false };
      }
    }

    // Check fill conditions
    const { price, isLong } = order;
    const filled = isLong 
      ? candle.low <= price
      : candle.high >= price;

    if (filled) {
      // Log the fill
      this.logger?.logLimitOrderFill(order, candle);

      const trade = {
        entry: price,
        entryTime: candle.time, // Already in seconds
        isLong,
        orderTime: order.time // Already in milliseconds from handlePivotSignal
      };
      return { cancelled: false, filled: true, trade };
    }

    return { cancelled: false, filled: false };
  }

  handlePivotSignal(pivot, candle) {
    const isBuySetup = this.tradeConfig.direction === 'buy' && pivot.type === 'high';
    const isSellSetup = this.tradeConfig.direction === 'sell' && pivot.type === 'low';
    
    if (isBuySetup || isSellSetup) {
      const avgMove = this.pivotTracker.avgShort;
      

      if (avgMove > 0) {
        const isLong = this.tradeConfig.direction === 'buy';
        const limitPrice = isLong
          ? pivot.price * (1 - avgMove * this.tradeConfig.orderDistancePct/100)
          : pivot.price * (1 + avgMove * this.tradeConfig.orderDistancePct/100);

        // Check if we can enter at this price
        if (!this.canEnterAtPrice(limitPrice, candle)) {
          return null;
        }
            
        const movePct = avgMove * this.tradeConfig.orderDistancePct/100;
        const order = {
          type: isLong ? 'buy' : 'sell',
          price: limitPrice,
          time: pivot.time, // Already in milliseconds from PivotTracker
          isLong,
          pivotPrice: pivot.price,
          edges: pivot.edges, // Pass edge data to order
          referencePrice: pivot.price, // For edge logger
          movePct
        };

        // Log limit order creation
        this.logger?.logLimitOrderCreation(order, pivot, avgMove);

        return order;
      }
    }
    
    return null;
  }

  async runBacktest(candles) {
    let activeOrder = null;
    let activeTrade = null;

    for (const candle of candles) {
      const pivot = this.pivotTracker.update(candle);
      
      // Log pivot if detected
      if (pivot) {
        this.logger?.logPivot(pivot, candle);
      }
      
      // Handle active trade
      if (activeTrade) {
        const result = this.handleActiveTrade(activeTrade, candle);
        if (result.closed) {
          this.trades.push(result.trade);
          activeTrade = null;
          activeOrder = null;
        }
      }

      // Handle active order
      if (activeOrder && !activeTrade) {
        const result = this.handleActiveOrder(activeOrder, candle);
        if (result.filled) {
          activeTrade = result.trade;
        }
        if (result.cancelled) {
          activeOrder = null;
        }
      }

      // Handle new pivot signals
      if (pivot && (this.tradeConfig.enterAll || (!activeOrder && !activeTrade))) {
        const order = this.handlePivotSignal(pivot, candle);
        if (order) activeOrder = order;
      }
    }

    return {
      trades: this.trades,
      finalCapital: this.currentCapital,
      startTime: candles[0].time,
      endTime: candles[candles.length - 1].time
    };
  }
}
