// testLimitOrderEdgeData.js
// Test file to create random market orders with real edge data using the LimitOrderHandler

import fs from 'fs';
import path from 'path';

// Import configuration
import { symbol, time as interval } from '../config/config.js';
import { tradeConfig } from '../config/tradeconfig.js';

// Import required utilities
// Custom logging functions instead of importing EdgeConsoleLogger
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

// Constants
const NUM_TEST_ORDERS = 5;

async function runTest() {
  console.log(`
▶ Testing Market Order Edge Data for ${symbol} [${interval}]
`);

  // Custom logger functions
  function formatEdges(edges) {
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

  function logOrder(order) {
    // Skip if no order or no edges
    if (!order || !order.edges) return;
  
    // Log basic order info
    console.log(`${colors.bright}╔════════════════════════════════════════════════════════════════╗${colors.reset}`);
    
    // If this is displaying current price (5 minutes later), show that it's the current price
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
    console.log(`${colors.bright}║${colors.reset}${formatEdges(order.edges)}${colors.bright} ║${colors.reset}`);
    console.log(`${colors.bright}╚════════════════════════════════════════════════════════════════╝${colors.reset}`);
  }

  // Initialize LimitOrderHandler with explicit symbol and interval
  const config = {
    symbol,
    interval,
    orderDistancePct: 0.5, // 0.5% away from pivot
    cancelThresholdPct: 2.0 // 2% cancellation threshold
  };
  
  // Initialize without external logger
  const limitOrderHandler = new LimitOrderHandler(config);
  
  // 1. Load recent candles
  console.log(`Loading recent candles for testing...`);
  const candles = await fetchCandles(symbol, interval, 274115);
  if (!candles || candles.length === 0) {
    console.error('Failed to load candles');
    return;
  }
  
  candles.sort((a, b) => a.time - b.time);
  console.log(`Loaded ${candles.length} candles for testing`);
  
  // 2. Create random market orders
  console.log(`
Generating ${NUM_TEST_ORDERS} test market orders...
`);
  
  const testOrders = [];
  
  // We'll use the LimitOrderHandler to calculate edge data for each order
  
  // Select random candles for market orders that are weeks apart
  // Calculate approximately how many candles in a week
  const candlesPerWeek = interval === '1m' ? 60 * 24 * 7 : 
                        interval === '5m' ? 12 * 24 * 7 : 
                        interval === '15m' ? 4 * 24 * 7 :
                        interval === '1h' ? 24 * 7 : 7; // Adjust based on interval
  
  // Ensure we have enough candles to spread across multiple weeks
  if (candles.length < candlesPerWeek * NUM_TEST_ORDERS) {
    console.warn('Warning: Not enough historical data to spread orders across different weeks!');
  }
  
  const weekSpacing = Math.max(Math.floor(candles.length / (NUM_TEST_ORDERS * candlesPerWeek)), 1);
  
  // Start from a safe base index to ensure all orders have valid candles
  const safeLength = Math.floor(candles.length * 0.8); // Use only the first 80% of candles to be safe
  
  // If we don't have enough data for proper spacing, use sequential candles instead
  // This ensures we get some test orders even with limited data
  const hasEnoughData = safeLength >= NUM_TEST_ORDERS * candlesPerWeek;
  
  // Calculate spacing - either weekly spacing or simple sequential spacing
  const adjustedSpacing = hasEnoughData ? 
    Math.max(Math.floor(safeLength / (NUM_TEST_ORDERS * candlesPerWeek)), 1) : 
    Math.max(Math.floor(safeLength / NUM_TEST_ORDERS), 1);
  
  for (let i = 0; i < NUM_TEST_ORDERS; i++) {
    // Select a candle based on our spacing strategy
    let baseIndex;
    let maxRandomOffset;
    
    if (hasEnoughData) {
      // Weekly spacing approach
      baseIndex = Math.min(i * adjustedSpacing * candlesPerWeek, safeLength - candlesPerWeek);
      maxRandomOffset = Math.min(candlesPerWeek, safeLength - baseIndex - 1);
    } else {
      // Simple sequential approach when not enough data
      baseIndex = Math.min(i * adjustedSpacing, safeLength - 1);
      maxRandomOffset = Math.min(Math.floor(adjustedSpacing / 2), safeLength - baseIndex - 1);
    }
    
    // Ensure baseIndex is valid
    baseIndex = Math.max(0, baseIndex);
    
    // Add some randomness but ensure we stay within bounds
    maxRandomOffset = Math.max(0, maxRandomOffset);
    const randomOffset = maxRandomOffset > 0 ? Math.floor(Math.random() * maxRandomOffset) : 0;
    
    const candleIndex = baseIndex + randomOffset;
    
    // Safety check to ensure we have a valid candle
    if (candleIndex < 0 || candleIndex >= candles.length || !candles[candleIndex]) {
      console.warn(`Skipping order ${i+1} due to invalid candle index: ${candleIndex}`);
      continue;
    }
    
    const candle = candles[candleIndex];
    
    // Determine if we should place a long or short order
    const isLong = tradeConfig.direction === 'buy' || 
                  (tradeConfig.direction === 'both' && Math.random() > 0.5);
    
    // Create a market order at current price
    const marketPrice = isLong ? candle.close : candle.close;
    
    // Create initial order (without edge data)
    const order = {
      id: `ORDER-${candle.time}-${isLong ? 'BUY' : 'SELL'}`,
      type: 'MARKET',
      side: isLong ? 'BUY' : 'SELL',
      price: marketPrice,
      quantity: 1.0,
      time: candle.time,
      status: 'FILLED',
      // Add properties required by EdgeConsoleLogger
      referencePrice: marketPrice, // Using the same price as reference for market orders
      movePct: 0.01 // Minimal move for market orders
    };
    
    // Calculate real edge data for the order using the limitOrderHandler
    const orderWithEdges = limitOrderHandler.updateOrderEdgeData(order, candle);
    
    // Log order creation
    console.log(`\n [ORDER] ${orderWithEdges.side} MARKET @ ${orderWithEdges.price.toFixed(2)} | Time: ${formatDateTime(orderWithEdges.time)}`);
    logOrder(orderWithEdges);
    
    // Store order for testing
    testOrders.push({
      order: orderWithEdges,
      candle
    });
  }
  
  console.log(`
Created ${testOrders.length} test market orders with real edge data
`);
  
  // 3. Test dynamic edge data updates
  console.log(`Testing dynamic edge data updates for market orders...
`);
  
  for (const test of testOrders) {
    const { order, candle } = test;
    
    const minutes = 120; 

    // Find a candle that's at least 5 bars later
    const laterIndex = candles.findIndex(c => c.time === candle.time) + minutes;
    if (laterIndex >= candles.length) continue;
    
    const laterCandle = candles[laterIndex];
    
    console.log(`
Order @ ${order.price.toFixed(2)} | Original Time: ${formatDateTime(order.time)}`);
    console.log(`Updating with data from ${formatDateTime(laterCandle.time)} (${minutes} minutes later)`);
    
    // Display original edge data
    console.log(`Original Edge Data:`);
    logOrder(order);
    
    // Update edge data for the order
    const updatedOrder = limitOrderHandler.updateOrderEdgeData(order, laterCandle);
    
    // Update the displayed price to show current price from the later candle
    const orderForDisplay = {
      ...updatedOrder,
      originalPrice: order.price,      // Store the original order price
      price: laterCandle.close,       // Use the current candle's closing price
      displayCurrentPrice: true        // Flag to indicate this is displaying current price
    };
    
    // Display updated edge data
    console.log(`Updated Edge Data:`);
    logOrder(orderForDisplay);
    
    // Calculate any changes in edge positioning
    const dailyChange = updatedOrder.edges?.daily?.position - order.edges?.daily?.position;
    const weeklyChange = updatedOrder.edges?.weekly?.position - order.edges?.weekly?.position;
    const monthlyChange = updatedOrder.edges?.monthly?.position - order.edges?.monthly?.position;
    
    // Calculate price change after 5 minutes
    const priceChange = laterCandle.close - order.price;
    const priceChangePct = (priceChange / order.price) * 100;
    
    // Display edge changes with color coding
    console.log(`${colors.bright}╔══════════════════════ EDGE CHANGES ══════════════════════╗${colors.reset}`);
    
    // Add a dedicated timestamp row for easier chart reference
    console.log(`${colors.bright}║${colors.reset} ${colors.bright}TIME${colors.reset}: ${colors.yellow}${formatDateTime(order.time)}${colors.reset} ${colors.bright}→${colors.reset} ${colors.cyan}${formatDateTime(laterCandle.time)}${colors.reset} ${colors.bright}║${colors.reset}`);
    
    const dailyColor = dailyChange >= 0 ? colors.green : colors.red;
    const weeklyColor = weeklyChange >= 0 ? colors.green : colors.red;
    const monthlyColor = monthlyChange >= 0 ? colors.green : colors.red;
    const priceColor = priceChange >= 0 ? colors.green : colors.red;
    
    console.log(`${colors.bright}║${colors.reset} ${colors.yellow}Daily:${colors.reset}   ${dailyColor}${dailyChange >= 0 ? '+' : ''}${dailyChange?.toFixed(1)}%${colors.reset}  ${colors.bright}|${colors.reset} ` +
              `${colors.cyan}Weekly:${colors.reset} ${weeklyColor}${weeklyChange >= 0 ? '+' : ''}${weeklyChange?.toFixed(1)}%${colors.reset}  ${colors.bright}|${colors.reset} ` +
              `${colors.magenta}Monthly:${colors.reset} ${monthlyColor}${monthlyChange >= 0 ? '+' : ''}${monthlyChange?.toFixed(1)}%${colors.reset} ${colors.bright}║${colors.reset}`);
    
    // Display price change information with clear initial and current prices
    console.log(`${colors.bright}║${colors.reset} ${colors.brightCyan}Initial Price:${colors.reset} ${order.price.toFixed(2)} ${colors.bright}→${colors.reset} ${colors.brightCyan}Current:${colors.reset} ${priceColor}${laterCandle.close.toFixed(2)}${colors.reset} ${colors.bright}║${colors.reset}`);
    console.log(`${colors.bright}║${colors.reset} ${colors.brightCyan}Price Change:${colors.reset} ${priceColor}${priceChange >= 0 ? '+' : ''}${priceChange.toFixed(2)} (${priceChange >= 0 ? '+' : ''}${priceChangePct.toFixed(3)}%)${colors.reset} ${colors.bright}║${colors.reset}`);
              
    console.log(`${colors.bright}╚════════════════════════════════════════════════════════╝${colors.reset}`);
    
    console.log('-'.repeat(80));
  }
  
  console.log(`
Test completed successfully.`);
}

// Run the test
runTest().catch(error => {
  console.error('Error running test:', error);
});

