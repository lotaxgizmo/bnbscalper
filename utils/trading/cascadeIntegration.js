// Cascade Integration Utilities
// For future integration with immediateAggregationLiveOrder.js

import { quickMarketOrder } from './orderExecutor.js';

/**
 * Execute trade based on cascade signal
 * Designed for integration with cascade detection systems
 */
export async function executeCascadeTrade(cascadeData, tradingConfig = {}) {
  const {
    symbol = 'SOLUSDT',
    leverage = 80,
    stopLoss = 0.5,
    takeProfit = 1.0,
    tradeOnActive = false,
    ...otherConfig
  } = tradingConfig;

  // Extract signal from cascade data
  const signal = cascadeData.signal || cascadeData.direction || cascadeData.primaryPivot?.signal;
  const price = cascadeData.price || cascadeData.primaryPivot?.price;
  
  if (!signal) {
    throw new Error('No signal found in cascade data');
  }

  console.log(`🎯 CASCADE TRADE EXECUTION`);
  console.log(`Signal: ${signal.toUpperCase()}`);
  console.log(`Price: $${price}`);
  console.log(`Symbol: ${symbol}`);
  console.log(`Leverage: ${leverage}x`);

  const result = await quickMarketOrder(symbol, signal, leverage, {
    stopLoss,
    takeProfit,
    tradeOnActive,
    ...otherConfig
  });

  return result;
}

/**
 * Format cascade data for telegram notification with trade details
 */
export function formatCascadeTradeNotification(cascadeData, tradeResult) {
  const signal = cascadeData.signal || cascadeData.direction;
  const signalEmoji = signal === 'long' ? '🟢⬆️' : '🔴⬇️';
  
  let message = `🚀 *CASCADE TRADE EXECUTED*\n\n`;
  message += `${signalEmoji} *SIGNAL: ${signal.toUpperCase()}*\n`;
  message += `💰 *Entry Price:* $${tradeResult.entryPrice.toFixed(4)}\n`;
  message += `📊 *Position Size:* ${tradeResult.contractQty}\n`;
  message += `💵 *Notional:* $${tradeResult.notional.toFixed(2)}\n`;
  
  if (tradeResult.stopLossPrice) {
    message += `🛑 *Stop Loss:* $${tradeResult.stopLossPrice.toFixed(4)}\n`;
  }
  if (tradeResult.takeProfitPrice) {
    message += `🎯 *Take Profit:* $${tradeResult.takeProfitPrice.toFixed(4)}\n`;
  }
  
  message += `🆔 *Order ID:* ${tradeResult.orderId}\n`;
  message += `⏰ *Time:* ${new Date().toLocaleString()}`;
  
  return message;
}

/**
 * Validate cascade data before trade execution
 */
export function validateCascadeData(cascadeData) {
  const requiredFields = ['signal', 'price'];
  const missingFields = requiredFields.filter(field => 
    !cascadeData[field] && !cascadeData.primaryPivot?.[field]
  );
  
  if (missingFields.length > 0) {
    throw new Error(`Missing required cascade data: ${missingFields.join(', ')}`);
  }
  
  const signal = cascadeData.signal || cascadeData.primaryPivot?.signal;
  if (!['long', 'short', 'LONG', 'SHORT', 'Buy', 'Sell'].includes(signal)) {
    throw new Error(`Invalid signal: ${signal}`);
  }
  
  return true;
}
