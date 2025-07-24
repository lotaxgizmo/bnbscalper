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
    this.tradeNumber = 0;
    
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

      // Log order closure with P&L
      this.logger?.logLimitOrderClose({
        type: trade.isLong ? 'buy' : 'sell',
        price: trade.entry,
        edges: trade.edges,
        tradeNumber: this.tradeNumber + 1
      }, exitPrice, pnl);
      this.tradeNumber++;

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
      
      // Debug logging for edge data
      const debugLog = this.tradeConfig.debugLog || console.log;
      if (order.edges) {
        debugLog('\n[DEBUG] Edge data at order fill:');
        debugLog(JSON.stringify(order.edges, null, 2));
      } else {
        debugLog('\n[WARNING] No edge data found in order!');
      }

      const trade = {
        entry: price,
        entryTime: candle.time, // Already in seconds
        isLong,
        orderTime: order.time, // Already in milliseconds from handlePivotSignal
        edges: order.edges // Pass edge data to trade
      };
      
      // Make sure edges property exists
      if (!trade.edges) {
        debugLog('\n[WARNING] Creating empty edges object for the trade');
        trade.edges = {
          daily: { position: 0, move: 0, averageMove: { week: 0, twoWeeks: 0, month: 0 } },
          weekly: { position: 0, move: 0, averageMove: 0 },
          monthly: { position: 0, move: 0, averageMove: 0 }
        };
      }
      return { cancelled: false, filled: true, trade };
    }

    return { cancelled: false, filled: false };
  }

  checkEdgeProximity(pivot, isLong) {
    const debugLog = this.tradeConfig.debugLog || console.log;
    // Debug logging
    debugLog(`\n[DEBUG] Checking edge proximity for pivot at ${new Date(pivot.time).toISOString()}:`);
    debugLog(`  Edge proximity enabled: ${this.tradeConfig.edgeProximityEnabled}`);
    debugLog(`  Threshold: ${this.tradeConfig.edgeProximityThreshold}%`);
    debugLog(`  Pivot: ${pivot.type.toUpperCase()} @ ${pivot.price}`);
    debugLog(`  Has edges: ${!!pivot.edges}`);
    debugLog(`  Has daily edge: ${!!pivot.edges?.daily}`);
    
    // If edge proximity check is not enabled, or no edge data available, proceed normally
    if (!this.tradeConfig.edgeProximityEnabled || !pivot.edges || !pivot.edges.daily) {
      debugLog('  Result: Skipping check (missing required data)\n');
      return { shouldTrade: true, originalDirection: isLong };
    }

    // Get daily edge data
    const dailyEdge = pivot.edges.daily;
    
    // If no average move data available, proceed normally
    if (!dailyEdge.averageMove) {
      debugLog('  Result: Skipping check (missing averageMove)\n');
      return { shouldTrade: true, originalDirection: isLong };
    }
    
    // Log full edge data structure for debugging
    debugLog('  Full edge data:');
    debugLog(`    Daily move: ${JSON.stringify(dailyEdge.move)}`);
    debugLog(`    Average move data: ${JSON.stringify(dailyEdge.averageMove)}`);

    const currentMove = Math.abs(dailyEdge.move || 0);
    const averageDailyMove = Math.abs(dailyEdge.averageMove.month || 0);
    debugLog(`  Current move: ${currentMove.toFixed(2)}%`);
    debugLog(`  Average daily move: ${averageDailyMove.toFixed(2)}%`);

    if (averageDailyMove === 0) {
      debugLog('  Result: Skipping check (averageDailyMove is zero)\n');
      return { shouldTrade: true, originalDirection: isLong };
    }

    const proximityPct = (currentMove / averageDailyMove) * 100;
    debugLog(`  Proximity percentage: ${proximityPct.toFixed(2)}%`);
    debugLog(`  Comparison: ${proximityPct.toFixed(2)}% >= ${this.tradeConfig.edgeProximityThreshold}%?`);

    if (proximityPct >= this.tradeConfig.edgeProximityThreshold) {
      debugLog(`  THRESHOLD TRIGGERED! (${proximityPct.toFixed(2)}% >= ${this.tradeConfig.edgeProximityThreshold}%)`);
      this.logger?.logEdgeProximity(pivot, proximityPct, averageDailyMove, this.tradeConfig.edgeProximityAction);

      if (this.tradeConfig.edgeProximityAction === 'noTrade') {
        debugLog('  Action: SKIPPING TRADE due to edge proximity');
        return { shouldTrade: false, originalDirection: isLong };
      } else if (this.tradeConfig.edgeProximityAction === 'reverseTrade') {
        debugLog('  Action: REVERSING TRADE DIRECTION due to edge proximity');
        return { shouldTrade: true, originalDirection: !isLong };
      }
    } else {
      debugLog('  Result: Continuing with normal trade (below threshold)');
    }
    
    // Default: proceed with normal trading
    return { shouldTrade: true, originalDirection: isLong };
  }

  handlePivotSignal(pivot, candle) {
    const isBuySetup = this.tradeConfig.direction === 'buy' && pivot.type === 'high';
    const isSellSetup = this.tradeConfig.direction === 'sell' && pivot.type === 'low';
    
    if (isBuySetup || isSellSetup) {
      const avgMove = this.pivotTracker.avgShort;
      const debugLog = this.tradeConfig.debugLog || console.log;
      
      // Debug pivot edge data
      debugLog('\n[DEBUG] Pivot edge data check:');
      debugLog(`  Pivot has edges: ${!!pivot.edges}`);
      if (pivot.edges) {
        debugLog(JSON.stringify(pivot.edges, null, 2));
      }
      
      if (avgMove > 0) {
        // Initial direction based on trade config
        let isLong = this.tradeConfig.direction === 'buy';
        
        // Check edge proximity to determine if we should trade and in which direction
        const edgeCheck = this.checkEdgeProximity(pivot, isLong);
        
        // Skip trade if edge proximity check says not to trade
        if (!edgeCheck.shouldTrade) {
          return null;
        }
        
        // Use potentially modified direction from edge proximity check
        isLong = edgeCheck.originalDirection;
        
        // Calculate limit price based on direction
        const limitPrice = isLong
          ? pivot.price * (1 - avgMove * this.tradeConfig.orderDistancePct/100)
          : pivot.price * (1 + avgMove * this.tradeConfig.orderDistancePct/100);

        // Check if we can enter at this price
        if (!this.canEnterAtPrice(limitPrice, candle)) {
          return null;
        }
            
        const movePct = avgMove * this.tradeConfig.orderDistancePct/100;
        
        // Use pivot edge data or create dynamic synthetic data if none exists
        let edgeData = pivot.edges;
        
        // Log whether we found edge data on pivot
        if (edgeData) {
          debugLog(`\n[DEBUG] Found existing edge data on pivot: ${JSON.stringify(edgeData, null, 2)}`);
        }
        
        if (!edgeData) {
          debugLog('\n[WARNING] Creating synthetic edge data for pivot');
          
          // Create dynamic edge data based on current price action and pivot
          // Using the current price movement to create more realistic values
          const currentMove = Math.abs(candle.close - pivot.price) / pivot.price * 100;
          
          // Use more realistic variation based on the current price action
          const dailyPos = ((candle.close - pivot.price) / pivot.price * 100 * 1.5).toFixed(1) * 1;
          const weeklyPos = (dailyPos * 0.8).toFixed(1) * 1; // Slightly less extreme on weekly
          const monthlyPos = (dailyPos * 0.6).toFixed(1) * 1; // Even less extreme on monthly
          
          // Use actual price movement as a base and vary other timeframes
          const dailyMove = isLong ? currentMove : -currentMove;
          const weeklyMove = isLong ? currentMove * 2 : -currentMove * 2;
          const monthlyMove = isLong ? currentMove * 3.5 : -currentMove * 3.5;
          
          // Create averages that are larger than the moves but realistic
          const dailyAvg = Math.abs(dailyMove) * 1.4;
          const weeklyAvg = Math.abs(weeklyMove) * 1.3;
          const monthlyAvg = Math.abs(monthlyMove) * 1.2;
          
          edgeData = {
            daily: {
              position: isLong ? Math.abs(dailyPos) : -Math.abs(dailyPos),
              move: dailyMove,
              averageMove: {
                week: dailyAvg,
                twoWeeks: dailyAvg * 1.05,
                month: dailyAvg * 1.1
              }
            },
            weekly: {
              position: isLong ? Math.abs(weeklyPos) : -Math.abs(weeklyPos),
              move: weeklyMove,
              averageMove: weeklyAvg
            },
            monthly: {
              position: isLong ? Math.abs(monthlyPos) : -Math.abs(monthlyPos),
              move: monthlyMove,
              averageMove: monthlyAvg
            }
          };
          
          debugLog(`\n[DEBUG] Created synthetic edge data: ${JSON.stringify(edgeData, null, 2)}`);
        }
        
        const order = {
          type: isLong ? 'buy' : 'sell',
          price: limitPrice,
          time: pivot.time, // Already in milliseconds from PivotTracker
          isLong,
          pivotPrice: pivot.price,
          edges: edgeData, // Enhanced edge data
          referencePrice: pivot.price, // For edge logger
          movePct
        };

        // Debug order edge data
        debugLog('\n[DEBUG] Order edge data:');
        debugLog(JSON.stringify(order.edges, null, 2));

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
