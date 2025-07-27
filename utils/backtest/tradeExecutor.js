// utils/backtest/tradeExecutor.js
// Manages the execution of a single trade based on a signal.

import { LimitOrderHandler } from './limitOrderHandler.js';
import { formatDateTime } from '../candleAnalytics.js';

// ANSI color codes for console output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  bright: '\x1b[1m',
  brightCyan: '\x1b[1;36m'
};

// Format duration in minutes, hours, days
function formatDuration(ms) {
  if (ms < 0) ms = 0;
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  const d = days;
  const h = hours % 24;
  const m = minutes % 60;

  const parts = [];
  if (d > 0) parts.push(`${d} day${d > 1 ? 's' : ''}`);
  if (h > 0) parts.push(`${h} hour${h > 1 ? 's' : ''}`);
  if (m > 0) parts.push(`${m} minute${m > 1 ? 's' : ''}`);

  return parts.length > 0 ? parts.join(' ') : '< 1 minute';
}

export class TradeExecutor {
  constructor(config, allCandles, pivot, logger = null) {
    this.config = config;
    this.candles = allCandles;
    this.pivot = pivot;
    this.logger = logger;
    this.order = null;
    this.orderFilled = false;
    this.orderCancelled = false;
    this.takeProfitTriggered = false;
    this.stopLossTriggered = false;
    this.finalTradeResult = null;
    this.maxFavorableExcursion = 0;
    this.maxAdverseExcursion = 0;
    this.limitOrderHandler = new LimitOrderHandler({
      symbol: this.config.symbol,
      interval: this.config.interval,
      orderDistancePct: this.config.orderDistancePct || 0.0,
      cancelThresholdPct: this.config.cancelThresholdPct || 2.0
    });
  }

  formatEdges(edges) {
    if (!edges) return '';
    const currentEdge = ' ' + colors.bright + 'Edges: ' + colors.reset + ['D', 'W', 'M'].map(t => {
      const type = t === 'D' ? 'daily' : t === 'W' ? 'weekly' : 'monthly';
      const edge = edges[type];
      if (!edge) return '';
      const direction = edge.position >= 0 ? 'U' : 'D';
      const directionColor = edge.position >= 0 ? colors.green : colors.red;
      const sign = edge.position >= 0 ? '+' : '';
      const timeframeColor = t === 'D' ? colors.yellow : t === 'W' ? colors.cyan : colors.magenta;
      return `${timeframeColor}${t}:${directionColor}${sign}${edge.position.toFixed(1)}%(${direction})${colors.reset}`;
    }).filter(Boolean).join(' ');
    const avgEdge = ' ' + colors.bright + '\n Average Edge ' + colors.reset + ['D', 'W', 'M'].map(t => {
      const type = t === 'D' ? 'daily' : t === 'W' ? 'weekly' : 'monthly';
      const edge = edges[type];
      if (!edge || !edge.averageMove) return '';
      const avgMove = type === 'daily' ? edge.averageMove.week : edge.averageMove;
      const direction = avgMove >= 0 ? 'U' : 'D';
      const directionColor = avgMove >= 0 ? colors.green : colors.red;
      const sign = avgMove >= 0 ? '+' : '';
      const timeframeColor = t === 'D' ? colors.yellow : t === 'W' ? colors.cyan : colors.magenta;
      return `${timeframeColor}${t}:${directionColor}${sign}${avgMove.toFixed(1)}%(${direction})${colors.reset}`;
    }).filter(Boolean).join(' ');
    const totalEdge = ' ' + colors.bright + '| Range/Total Edge ' + colors.reset + ['D', 'W', 'M'].map(t => {
      const type = t === 'D' ? 'daily' : t === 'W' ? 'weekly' : 'monthly';
      const edge = edges[type];
      if (!edge || !edge.totalMove) return '';
      const direction = edge.totalMove >= 0 ? 'U' : 'D';
      const directionColor = edge.totalMove >= 0 ? colors.green : colors.red;
      const sign = edge.totalMove >= 0 ? '+' : '';
      const timeframeColor = t === 'D' ? colors.yellow : t === 'W' ? colors.cyan : colors.magenta;
      return `${timeframeColor}${t}:${directionColor}${sign}${edge.totalMove.toFixed(1)}%(${direction})${colors.reset}`;
    }).filter(Boolean).join(' ');
    return currentEdge + avgEdge + totalEdge;
  }

  logOrder(order) {
    const statusColor = order.status === 'CLOSED' ? colors.green : order.status === 'CANCELLED' ? colors.red : colors.yellow;
    console.log(`  ${colors.bright}Order Details:${colors.reset}`);
    console.log(`    Side: ${order.side === 'BUY' ? colors.green : colors.red}${order.side}${colors.reset}`);
    console.log(`    Entry: ${colors.brightCyan}$${order.price.toFixed(4)}${colors.reset}`);
    console.log(`    Size: $${order.amount.toFixed(2)}`);
    console.log(`    Status: ${statusColor}${order.status}${colors.reset}`);
    if (order.fillPrice) {
      console.log(`    Fill Price: ${colors.brightCyan}$${order.fillPrice.toFixed(4)}${colors.reset}`);
    }
    if (order.takeProfit) {
      console.log(`    Take Profit: ${colors.green}$${order.takeProfit.toFixed(4)}${colors.reset}`);
    }
    if (order.stopLoss) {
      console.log(`    Stop Loss: ${colors.red}$${order.stopLoss.toFixed(4)}${colors.reset}`);
    }
    if (order.edges) {
      console.log(this.formatEdges(order.edges));
    }
  }

  findClosestCandle(time) {
    if (!this.candles || this.candles.length === 0) return null;
    let closestCandle = null;
    let minDiff = Infinity;
    for (const candle of this.candles) {
      const diff = Math.abs(candle.time - time);
      if (diff < minDiff) {
        minDiff = diff;
        closestCandle = candle;
      }
    }
    return closestCandle;
  }

  updateExcursions(candle) {
    if (!this.orderFilled) return;

    const entryPrice = this.order.fillPrice;
    let favorableMove, adverseMove;

    if (this.order.side === 'buy') {
      favorableMove = ((candle.high - entryPrice) / entryPrice) * 100;
      adverseMove = ((entryPrice - candle.low) / entryPrice) * 100;
    } else { // 'sell'
      favorableMove = ((entryPrice - candle.low) / entryPrice) * 100;
      adverseMove = ((candle.high - entryPrice) / entryPrice) * 100;
    }

    // console.log(`[Excursion Update] Side: ${this.order.side}, Entry: ${entryPrice}, High: ${candle.high}, Low: ${candle.low}, Favorable: ${favorableMove.toFixed(2)}%, Adverse: ${adverseMove.toFixed(2)}%`);

    if (favorableMove > this.maxFavorableExcursion) {
      this.maxFavorableExcursion = favorableMove;
    }
    if (adverseMove > this.maxAdverseExcursion) {
      this.maxAdverseExcursion = adverseMove;
    }
  }

  createLimitOrder(candle) {
    const isLong = this.config.side === 'BUY';
    const limitPrice = this.pivot.price;
    this.order = {
      id: `${this.config.symbol}_${this.config.interval}_${candle.time}`,
      tradeNumber: this.config.tradeNumber,
      symbol: this.config.symbol,
      side: this.config.side,
      type: isLong ? 'buy' : 'sell',
      price: limitPrice,
      amount: this.config.amount,
      time: candle.time,
      isLong,
      edges: this.pivot.edges,
      takeProfit: isLong ? limitPrice * (1 + this.config.takeProfit / 100) : limitPrice * (1 - this.config.takeProfit / 100),
      stopLoss: isLong ? limitPrice * (1 - this.config.stopLoss / 100) : limitPrice * (1 + this.config.stopLoss / 100),
      status: 'OPEN',
      referencePrice: this.pivot.price,
      movePct: (Math.abs(this.pivot.price - limitPrice) / this.pivot.price) * 100,
      fillPrice: 0,
      fillTime: 0,
      exitPrice: 0,
      exitTime: 0
    };
  }

  checkOrderFill(candle) {
    const filled = (this.order.side === 'BUY' && candle.low <= this.order.price) || (this.order.side === 'SELL' && candle.high >= this.order.price);
    if (filled) {
      this.order.fillPrice = this.order.price; // Assume fill at limit price
    }
    if (filled) {
      this.orderFilled = true;
      this.order.fillTime = candle.time;
      console.log(`\n${colors.bright}${colors.green}✔ Order Filled${colors.reset} at ${colors.brightCyan}$${this.order.fillPrice.toFixed(4)}${colors.reset} on ${formatDateTime(candle.time)}`);
    }
    return filled;
  }

  checkStopLossTakeProfit(candle) {
    if (!this.orderFilled || !this.order) return false;
    if (this.order.takeProfit > 0 && ((this.order.side === 'BUY' && candle.high >= this.order.takeProfit) || (this.order.side === 'SELL' && candle.low <= this.order.takeProfit))) {
      const durationMs = candle.time - this.order.fillTime;
      this.order.status = 'CLOSED';
      this.order.exitPrice = this.order.takeProfit;
      this.order.exitTime = candle.time;

      this.finalTradeResult = {
        status: 'TP_HIT',
        duration: durationMs,
        order: this.order
      };
      this.takeProfitTriggered = true;
      return true;
    }
    if (this.order.stopLoss > 0 && ((this.order.side === 'BUY' && candle.low <= this.order.stopLoss) || (this.order.side === 'SELL' && candle.high >= this.order.stopLoss))) {
      const durationMs = candle.time - this.order.fillTime;
      this.order.status = 'CLOSED';
      this.order.exitPrice = this.order.stopLoss;
      this.order.exitTime = candle.time;

      this.finalTradeResult = {
        status: 'SL_HIT',
        duration: durationMs,
        order: this.order
      };
      this.stopLossTriggered = true;
      return true;
    }
    return false;
  }

  displayPositionUpdate(candle) {
    if (!this.orderFilled || !this.order) return;
    const pnl = (this.order.side === 'BUY' ? (candle.close - this.order.fillPrice) / this.order.fillPrice : (this.order.fillPrice - candle.close) / this.order.fillPrice) * 100;
    const pnlColor = pnl >= 0 ? colors.green : colors.red;
    console.log(`  ${colors.yellow}Position Update:${colors.reset} ${formatDateTime(candle.time)} | Price: $${candle.close.toFixed(4)} | PnL: ${pnlColor}${pnl.toFixed(2)}%${colors.reset}`);
  }

  async run() {
    // console.log(`\n[Executor] Running for pivot at ${formatDateTime(this.pivot.time)} price ${this.pivot.price}`);
    if (!this.candles || this.candles.length === 0) {
      console.error('Executor requires candles to run.');
      return null;
    }

    const targetCandle = this.findClosestCandle(this.config.scheduleTime);
    if (!targetCandle) {
      console.error(`Could not find a candle close to the scheduled time: ${formatDateTime(this.config.scheduleTime)}`);
      return null;
    }

    this.createLimitOrder(targetCandle);
    if (!this.order) return null;

    if (this.logger) {
      this.logger.logLimitOrderCreation(this.order, this.pivot);
    }

    const targetIndex = this.candles.findIndex(c => c.time === targetCandle.time);
    if (targetIndex === -1) {
      console.error('Could not find target candle in array');
      return null;
    }

    const maxSimulateIndex = Math.min(targetIndex + this.config.simulationLength, this.candles.length - 1);
    let updateCounter = 0;

    for (let i = targetIndex + 1; i <= maxSimulateIndex; i++) {
      const currentCandle = this.candles[i];

      // If order is not filled, check for a fill.
      if (!this.orderFilled) {
        if (this.checkOrderFill(currentCandle)) {
          if (this.logger) {
            this.logger.logLimitOrderFill(this.order, currentCandle);
          }
        }
      }

      // If order is filled (either just now or previously), process the open trade.
      if (this.orderFilled) {
        // Always update excursions for any candle while the position is open.
        this.updateExcursions(currentCandle);

        // Check for an exit condition (TP or SL).
        if (this.checkStopLossTakeProfit(currentCandle)) {
          if (this.logger) {
            const pnl = (this.order.side === 'BUY' 
              ? (this.order.exitPrice - this.order.fillPrice) / this.order.fillPrice 
              : (this.order.fillPrice - this.order.exitPrice) / this.order.fillPrice) * 100;
            this.logger.logLimitOrderClose(this.order, this.order.exitPrice, pnl);
          }
          break; // Trade is closed, exit simulation loop.
        }

        // Optional: Display periodic updates.
        updateCounter++;
        if (updateCounter % this.config.updateFrequency === 0) {
          this.displayPositionUpdate(currentCandle);
        }
      }
    }

    if (!this.orderFilled) {
      this.order.status = 'CANCELLED';
      this.finalTradeResult = { status: 'NOT_FILLED', duration: 0, order: this.order };
      if (this.logger) {
        const lastCandle = this.candles[maxSimulateIndex];
        this.logger.logLimitOrder(this.order, lastCandle, 'Not Filled');
      }
    } else if (!this.takeProfitTriggered && !this.stopLossTriggered) {
      this.order.status = 'OPEN';
      this.finalTradeResult = { status: 'EXPIRED', duration: 0, order: this.order };
    }

    // Add excursion data to the result if the trade was filled
    if (this.orderFilled && this.finalTradeResult) {
      // console.log(`[Final Excursions] MFE: ${this.maxFavorableExcursion.toFixed(2)}%, MAE: ${this.maxAdverseExcursion.toFixed(2)}%`);
      this.finalTradeResult.maxFavorableExcursion = this.maxFavorableExcursion;
      this.finalTradeResult.maxAdverseExcursion = this.maxAdverseExcursion;
    }

    if (!this.finalTradeResult) {
      // console.log(`[Executor] Simulation ended for pivot at ${formatDateTime(this.pivot.time)}. No trade executed.`);
    }

    return this.finalTradeResult;
  }
}
