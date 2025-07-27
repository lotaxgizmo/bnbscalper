// testScheduledLimitOrder.js
// Test file to create a limit order at a specific time with configurable take profit/stop loss

import fs from 'fs';
import path from 'path';

// Import configuration
import { symbol, time as interval } from '../config/config.js';
import { tradeConfig } from '../config/tradeconfig.js';

// Import required utilities
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
import { LimitOrderHandler } from '../utils/backtest/limitOrderHandler.js';
import { fetchCandles } from '../utils/candleAnalytics.js';
import { formatDateTime } from '../utils/candleAnalytics.js';

// Format duration in minutes, hours, days
function formatDuration(ms) {
  const minutes = Math.floor(ms / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  const d = days;
  const h = hours % 24;
  const m = minutes % 60;

  const parts = [];
  if (d > 0) parts.push(`${d} day${d > 1 ? 's' : ''}`);
  if (h > 0) parts.push(`${h} hour${h > 1 ? 's' : ''}`);
  if (m > 0) parts.push(`${m} minute${m > 1 ? 's' : ''}`);

  return parts.join(' ') || '0 minutes';
}

class ScheduledLimitOrderExecutor {
  constructor(config) {
    this.config = config;
    this.candles = [];
    this.order = null;
    this.orderFilled = false;
    this.orderCancelled = false;
    this.takeProfitTriggered = false;
    this.stopLossTriggered = false;
    this.finalTradeResult = null;
    this.limitOrderHandler = new LimitOrderHandler({
      symbol: this.config.symbol,
      interval: this.config.interval,
      orderDistancePct: this.config.orderDistancePct || 0.0, // 0% for limit at exact price
      cancelThresholdPct: this.config.cancelThresholdPct || 2.0 // 2% cancellation threshold
    });
  }
  
  // Format edge data for console output
  formatEdges(edges) {
    if (!edges) return '';
  
    // Format current edge data
    const currentEdge = ' ' + colors.bright + 'Edges: ' + colors.reset + ['D', 'W', 'M'].map(t => {
      const type = t === 'D' ? 'daily' : t === 'W' ? 'weekly' : 'monthly';
      const edge = edges[type];
      if (!edge) return '';
    
      // Direction should match sign - positive is up, negative is down
      const direction = edge.position >= 0 ? 'U' : 'D';
      const directionColor = edge.position >= 0 ? colors.green : colors.red;
      const sign = edge.position >= 0 ? '+' : '';  // Negative sign is already included in the number
      const timeframeColor = t === 'D' ? colors.yellow : t === 'W' ? colors.cyan : colors.magenta;
      
      return `${timeframeColor}${t}:${directionColor}${sign}${edge.position.toFixed(1)}%(${direction})${colors.reset}`;
    }).filter(Boolean).join(' ');

    // Format average edge data
    const avgEdge = ' ' + colors.bright + '\n Average Edge ' + colors.reset + ['D', 'W', 'M'].map(t => {
      const type = t === 'D' ? 'daily' : t === 'W' ? 'weekly' : 'monthly';
      const edge = edges[type];
      if (!edge || !edge.averageMove) return '';
    
      const avgMove = type === 'daily' 
        ? edge.averageMove.week  // Use weekly average for daily
        : edge.averageMove;      // Use direct average for weekly/monthly
    
      // Direction should match sign - positive is up, negative is down
      const direction = avgMove >= 0 ? 'U' : 'D';
      const directionColor = avgMove >= 0 ? colors.green : colors.red;
      const sign = avgMove >= 0 ? '+' : '';  // Negative sign is already included in the number
      const timeframeColor = t === 'D' ? colors.yellow : t === 'W' ? colors.cyan : colors.magenta;
      
      return `${timeframeColor}${t}:${directionColor}${sign}${avgMove.toFixed(1)}%(${direction})${colors.reset}`;
    }).filter(Boolean).join(' ');

    // Format total/range edge data
    const totalEdge = ' ' + colors.bright + '| Range/Total Edge ' + colors.reset + ['D', 'W', 'M'].map(t => {
      const type = t === 'D' ? 'daily' : t === 'W' ? 'weekly' : 'monthly';
      const edge = edges[type];
      if (!edge || !edge.move) return '';
    
      // Direction should match sign - positive is up, negative is down
      const direction = edge.move >= 0 ? 'U' : 'D';
      const directionColor = edge.move >= 0 ? colors.green : colors.red;
      const sign = edge.move >= 0 ? '+' : '';  // Negative sign is already included in the number
      const timeframeColor = t === 'D' ? colors.yellow : t === 'W' ? colors.cyan : colors.magenta;
      
      return `${timeframeColor}${t}:${directionColor}${sign}${edge.move.toFixed(1)}%(${direction})${colors.reset}`;
    }).filter(Boolean).join(' ');

    return currentEdge + avgEdge + totalEdge;
  }

  // Log order information
  logOrder(order) {
    // Skip if no order or no edges
    if (!order || !order.edges) return;
  
    // Log basic order info
    console.log(`${colors.bright}╔════════════════════════════════════════════════════════════════╗${colors.reset}`);
    
    // If this is displaying current price, show that it's the current price
    if (order.displayCurrentPrice) {
      const priceColor = order.price >= order.referencePrice ? colors.green : colors.red;
      console.log(`${colors.bright}║${colors.reset} ${colors.yellow}[ORDER]${colors.reset} ${order.type.toUpperCase()} @ ${order.originalPrice.toFixed(2)} | ` +
        `Current: ${priceColor}${order.price.toFixed(2)}${colors.reset} | ` +
        `Reference: ${order.referencePrice.toFixed(2)} | ` +
        `Move: ${order.movePct.toFixed(2)}% ${colors.bright}║${colors.reset}`);
    } else {
      console.log(`${colors.bright}║${colors.reset} ${colors.yellow}[ORDER]${colors.reset} ${order.type.toUpperCase()} @ ${order.price.toFixed(2)} | ` +
        `Reference: ${order.referencePrice.toFixed(2)} | ` +
        `Move: ${order.movePct.toFixed(2)}% ${colors.bright}║${colors.reset}`);
    }
    
    // Log edge data with structure
    console.log(`${colors.bright}╠════════════════════════════════════════════════════════════════╣${colors.reset}`);
    console.log(`${colors.bright}║${colors.reset}${this.formatEdges(order.edges)}${colors.bright} ║${colors.reset}`);
    console.log(`${colors.bright}╚════════════════════════════════════════════════════════════════╝${colors.reset}`);
  }
  
  // Find the closest candle to the scheduled time
  findClosestCandle(time) {
    if (!this.candles || this.candles.length === 0) {
      return null;
    }
    
    // Find the closest candle to the scheduled time
    let closestCandle = null;
    let minTimeDiff = Number.MAX_SAFE_INTEGER;
    
    for (const candle of this.candles) {
      const timeDiff = Math.abs(candle.time - time);
      if (timeDiff < minTimeDiff) {
        minTimeDiff = timeDiff;
        closestCandle = candle;
      }
    }
    
    return closestCandle;
  }
  
  // Create a limit order
  createLimitOrder(candle) {
    // Determine the order price - either the specified price or the candle close
    const orderPrice = this.config.price || candle.close;
    
    // Calculate quantity based on amount
    const quantity = this.config.amount / orderPrice;
    
    // Create the limit order
    this.order = {
      id: `LIMIT-${candle.time}-${this.config.side}`,
      type: 'LIMIT',
      side: this.config.side,
      price: orderPrice,
      quantity: quantity,
      time: candle.time,
      status: 'NEW',
      // Add properties required for edge data
      referencePrice: candle.close,
      movePct: ((orderPrice - candle.close) / candle.close) * 100,
      // Add take profit and stop loss levels if configured
      takeProfit: this.config.takeProfit > 0 ? 
        (this.config.side === 'BUY' ? orderPrice * (1 + this.config.takeProfit / 100) : orderPrice * (1 - this.config.takeProfit / 100)) : 0,
      stopLoss: this.config.stopLoss > 0 ? 
        (this.config.side === 'BUY' ? orderPrice * (1 - this.config.stopLoss / 100) : orderPrice * (1 + this.config.stopLoss / 100)) : 0
    };
    
    // Update the order with edge data
    this.order = this.limitOrderHandler.updateOrderEdgeData(this.order, candle);
    
    // Log the order creation
    console.log(`\n${colors.bright}▶ Created ${this.config.side} LIMIT Order at ${formatDateTime(candle.time)}${colors.reset}`);
    console.log(`${colors.cyan}Price: ${orderPrice.toFixed(2)} | Amount: $${this.config.amount.toFixed(2)} | Quantity: ${quantity.toFixed(8)}${colors.reset}`);
    
    if (this.order.takeProfit > 0) {
      console.log(`${colors.green}Take Profit: ${this.order.takeProfit.toFixed(2)} (${this.config.takeProfit}%)${colors.reset}`);
    } else {
      console.log(`${colors.yellow}Take Profit: Not set${colors.reset}`);
    }
    
    if (this.order.stopLoss > 0) {
      console.log(`${colors.red}Stop Loss: ${this.order.stopLoss.toFixed(2)} (${this.config.stopLoss}%)${colors.reset}`);
    } else {
      console.log(`${colors.yellow}Stop Loss: Not set${colors.reset}`);
    }
    
    this.logOrder(this.order);
  }
  
  // Check if the order can be filled
  checkOrderFill(candle) {
    if (!this.order || this.orderFilled || this.orderCancelled) {
      return false;
    }
    
    // For a BUY order, it fills if the price goes below or equal to the limit price
    // For a SELL order, it fills if the price goes above or equal to the limit price
    let isFilled = false;
    
    if (this.order.side === 'BUY') {
      isFilled = candle.low <= this.order.price;
    } else { // SELL
      isFilled = candle.high >= this.order.price;
    }
    
    if (isFilled) {
      this.order.status = 'FILLED';
      this.order.fillTime = candle.time;
      this.orderFilled = true;
      
      console.log(`\n${colors.bright}${colors.green}▶ LIMIT Order FILLED at ${formatDateTime(candle.time)}${colors.reset}`);
      
      // Update the order with the latest edge data
      this.order = this.limitOrderHandler.updateOrderEdgeData(this.order, candle);
      this.logOrder(this.order);
    }
    
    return isFilled;
  }
  
  // Check if stop loss or take profit is triggered
  checkStopLossTakeProfit(candle) {
    if (!this.orderFilled || this.takeProfitTriggered || this.stopLossTriggered) {
      return false;
    }
    
    // Check take profit
    if (this.order.takeProfit > 0) {
      if (
        (this.order.side === 'BUY' && candle.high >= this.order.takeProfit) || 
        (this.order.side === 'SELL' && candle.low <= this.order.takeProfit)
      ) {
        this.takeProfitTriggered = true;
        const tradeDuration = candle.time - this.order.fillTime;
        
        // Update the order with the latest edge data
        const updatedOrder = {
          ...this.order,
          status: 'CLOSED',
          closeTime: candle.time,
          closePrice: this.order.takeProfit,
          pnl: this.config.amount * (this.config.takeProfit / 100),
          closeReason: 'TAKE_PROFIT'
        };
        
        this.order = this.limitOrderHandler.updateOrderEdgeData(updatedOrder, candle);

        // Store final result to log at the end
        this.finalTradeResult = {
          message: `\n${colors.bright}${colors.green}▶ TAKE PROFIT triggered at ${formatDateTime(candle.time)}${colors.reset}`,
          details: `${colors.green}Price: ${this.order.closePrice.toFixed(2)} | Profit: $${this.order.pnl.toFixed(2)}${colors.reset}`,
          duration: `${colors.cyan}Duration: ${formatDuration(tradeDuration)}${colors.reset}`,
          order: this.order
        };
        return true;
      }
    }
    
    // Check stop loss
    if (this.order.stopLoss > 0) {
      if (
        (this.order.side === 'BUY' && candle.low <= this.order.stopLoss) || 
        (this.order.side === 'SELL' && candle.high >= this.order.stopLoss)
      ) {
        this.stopLossTriggered = true;
        const tradeDuration = candle.time - this.order.fillTime;

        // Update the order with the latest edge data
        const updatedOrder = {
          ...this.order,
          status: 'CLOSED',
          closeTime: candle.time,
          closePrice: this.order.stopLoss,
          pnl: -1 * this.config.amount * (this.config.stopLoss / 100),
          closeReason: 'STOP_LOSS'
        };
        
        this.order = this.limitOrderHandler.updateOrderEdgeData(updatedOrder, candle);

        // Store final result to log at the end
        this.finalTradeResult = {
          message: `\n${colors.bright}${colors.red}▶ STOP LOSS triggered at ${formatDateTime(candle.time)}${colors.reset}`,
          details: `${colors.red}Price: ${this.order.closePrice.toFixed(2)} | Loss: $${this.order.pnl.toFixed(2)}${colors.reset}`,
          duration: `${colors.cyan}Duration: ${formatDuration(tradeDuration)}${colors.reset}`,
          order: this.order
        };
        return true;
      }
    }
    
    return false;
  }
  
  // Display price and edge updates for an active position
  displayPositionUpdate(candle) {
    if (!this.orderFilled || this.takeProfitTriggered || this.stopLossTriggered) {
      return;
    }
    
    // Calculate current PnL
    const currentPrice = candle.close;
    const entryPrice = this.order.price;
    const pnlPct = this.order.side === 'BUY' ? 
      ((currentPrice - entryPrice) / entryPrice) * 100 : 
      ((entryPrice - currentPrice) / entryPrice) * 100;
    const pnlAmount = this.config.amount * (pnlPct / 100);
    
    // Update the order with the latest edge data
    const updatedOrder = {
      ...this.order,
      currentPrice: currentPrice,
      pnlPct: pnlPct,
      pnl: pnlAmount
    };
    
    const updatedOrderWithEdges = this.limitOrderHandler.updateOrderEdgeData(updatedOrder, candle);
    
    // Display current position status
    console.log(`\n${colors.bright}▶ Position Update at ${formatDateTime(candle.time)}${colors.reset}`);
    
    const pnlColor = pnlPct >= 0 ? colors.green : colors.red;
    console.log(`${colors.cyan}Entry: ${entryPrice.toFixed(2)} | Current: ${currentPrice.toFixed(2)} | PnL: ${pnlColor}${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}% ($${pnlAmount.toFixed(2)})${colors.reset}`);
    
    // Display edge data
    this.logOrder({
      ...updatedOrderWithEdges,
      displayCurrentPrice: true,
      originalPrice: entryPrice,
      price: currentPrice
    });
  }
  
  // Run the simulation
  async run() {
    console.log(`
▶ Testing Scheduled Limit Order for ${this.config.symbol} [${this.config.interval}]
`);
    
    // 1. Load recent candles
    console.log(`Loading historical candles...`);
    this.candles = await fetchCandles(this.config.symbol, this.config.interval, 274115);
    if (!this.candles || this.candles.length === 0) {
      console.error('Failed to load candles');
      return;
    }
    
    this.candles.sort((a, b) => a.time - b.time);
    console.log(`Loaded ${this.candles.length} candles for testing`);
    
    // 2. Find the closest candle to the scheduled time
    const targetCandle = this.findClosestCandle(this.config.scheduleTime);
    if (!targetCandle) {
      console.error(`Could not find a candle close to the scheduled time: ${formatDateTime(this.config.scheduleTime)}`);
      return;
    }
    
    console.log(`\nFound candle at ${formatDateTime(targetCandle.time)} (closest to scheduled time: ${formatDateTime(this.config.scheduleTime)})`);
    
    // 3. Create the limit order
    this.createLimitOrder(targetCandle);
    
    // 4. Simulate the order execution
    console.log(`\n${colors.bright}▶ Simulating order execution...${colors.reset}`);
    
    // Find the index of the target candle
    const targetIndex = this.candles.findIndex(c => c.time === targetCandle.time);
    if (targetIndex === -1) {
      console.error('Could not find target candle in array');
      return;
    }
    
    // Simulate for the configured number of candles or until the end of the array
    const maxSimulateIndex = Math.min(targetIndex + this.config.simulationLength, this.candles.length - 1);
    
    // Track if we need to provide position updates (every 10 candles after fill)
    let updateCounter = 0;
    
    // Run the simulation
    for (let i = targetIndex + 1; i <= maxSimulateIndex; i++) {
      const currentCandle = this.candles[i];
      
      // Check if the order is filled
      if (!this.orderFilled && this.checkOrderFill(currentCandle)) {
        // Order was just filled
      }
      
      // If order is filled, check stop loss and take profit
      if (this.orderFilled) {
        if (this.checkStopLossTakeProfit(currentCandle)) {
          // Position closed, end simulation
          break;
        }
        
        // Provide periodic position updates
        updateCounter++;
        if (updateCounter % this.config.updateFrequency === 0) {
          this.displayPositionUpdate(currentCandle);
        }
      }
    }
    
    // Final status check
    if (!this.orderFilled) {
      console.log(`\n${colors.bright}${colors.yellow}▶ Simulation Complete${colors.reset}`);
      console.log('Order was not filled within the simulation period');
    } else if (!this.takeProfitTriggered && !this.stopLossTriggered) {
      console.log(`\n${colors.bright}${colors.yellow}▶ Simulation Complete${colors.reset}`);
      console.log('Position was not closed by TP/SL within the simulation period');
      this.displayPositionUpdate(this.candles[maxSimulateIndex]);
    }

    // Display the final result at the very end
    if (this.finalTradeResult) {
      console.log(this.finalTradeResult.message);
      console.log(this.finalTradeResult.details);
      this.logOrder(this.finalTradeResult.order);
      console.log(this.finalTradeResult.duration);
    }
    
    console.log('\nTest completed successfully.');
  }
}

// Example usage
async function runTest() {
  // Configure the scheduled order
  const config = {
    symbol,
    interval,
    scheduleTime: new Date('2025-04-09T02:04:00').getTime(), // Schedule time as timestamp
    price: 0,                // 0 means use market price at the time
    amount: 100,             // $100
    side: 'BUY',             // BUY or SELL
    takeProfit: 10.0,         // 1% take profit (0 means no take profit)
    stopLoss: 5,             // 5% stop loss (0 means no stop loss)
    orderDistancePct: 0.0,   // 0% for exact price
    updateFrequency: 10000,   // Position updates every X candles
    simulationLength: 1000000   // Number of candles to simulate
  };
  
  // Create and run the executor
  const executor = new ScheduledLimitOrderExecutor(config);
  await executor.run();
}

// Run the test
runTest().catch(error => {
  console.error('Error running test:', error);
});
