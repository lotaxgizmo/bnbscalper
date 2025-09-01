// Refactored placeOrder.js using modular utilities
import { executeMarketOrder } from '../utils/trading/index.js';

// ==========================
// Execute order with cascade signal data
// ==========================
export async function executeTradeFromSignal(signalData) {
  const { signal, price, symbol = 'SOLUSDT', id, confirmations, tpsl } = signalData;
  
  // Convert signal format (long/short to Buy/Sell)
  const tradeSignal = signal === 'long' ? 'Buy' : 'Sell';
  
  // Use exact TP/SL prices from cascade calculation
  const TRADING_CONFIG = {
    symbol: symbol,
    signal: tradeSignal,
    leverage: 80,                // leverage to use
    amountMode: 'percentage',    // 'percentage' or 'fixed'
    usePercentage: 100,          // 100% = all-in (before buffer)
    fixedAmount: 100,            // USDT amount if fixed mode
    upperLimit: 50000,           // Max notional cap
    
    slTpMode: tpsl ? 'fixed' : 'percentage',  // Use fixed prices from cascade
    stopLoss: tpsl ? tpsl.stopLossPrice : 0.4,     // Use cascade-calculated SL price
    takeProfit: tpsl ? tpsl.takeProfitPrice : 0.6, // Use cascade-calculated TP price

    tradeOnActive: false         // Allow trading when active positions exist
  };

  try {
    console.log(`🚀 Executing cascade signal: ${signal.toUpperCase()} @ $${price}`);
    console.log(`📊 Window: ${id} | Confirmations: ${confirmations}`);
    if (tpsl) {
      console.log(`🎯 Take Profit: $${tpsl.takeProfitPrice} (+${tpsl.takeProfitPercent}%)`);
      console.log(`🛑 Stop Loss: $${tpsl.stopLossPrice} (-${tpsl.stopLossPercent}%)`);
    }
    
    const result = await executeMarketOrder(TRADING_CONFIG);
    
    if (result.success) {
      console.log('🎉 Trade executed successfully!');
      console.log('Order ID:', result.orderId);
      console.log('Entry Price:', result.entryPrice);
      console.log('Contract Qty:', result.contractQty);
      console.log('Notional:', result.notional.toFixed(2), 'USDT');
      return { success: true, ...result };
    } else {
      console.log('⚠️ Trade not executed:', result.reason);
      return { success: false, reason: result.reason };
    }
  } catch (error) {
    console.error('❌ Error placing order:', error.message);
    return { success: false, error: error.message };
  }
}

// ==========================
// STANDALONE TRADING CONFIGURATION (for direct execution)
// ==========================
const STANDALONE_CONFIG = {
  symbol: 'SOLUSDT',           // change symbol here
  signal: 'Buy',               // 'Buy'/'long' = long, 'Sell'/'short' = short
  leverage: 80,                // leverage to use
  amountMode: 'percentage',    // 'percentage' or 'fixed'
  usePercentage: 100,          // 100% = all-in (before buffer)
  fixedAmount: 100,            // USDT amount if fixed mode
  upperLimit: 50000,           // Max notional cap
  
  slTpMode: 'percentage',      // 'percentage' or 'fixed'
  stopLoss: 0.5,               // Stop loss: 0.5% if percentage mode, or exact price if fixed mode
  takeProfit: 1.0,             // Take profit: 1.0% if percentage mode, or exact price if fixed mode

  tradeOnActive: false         // Allow trading when active positions exist
};

async function placeOrder() {
  try {
    const result = await executeMarketOrder(STANDALONE_CONFIG);
    
    if (result.success) {
      console.log('🎉 Trade executed successfully!');
      console.log('Order ID:', result.orderId);
      console.log('Entry Price:', result.entryPrice);
      console.log('Contract Qty:', result.contractQty);
      console.log('Notional:', result.notional.toFixed(2), 'USDT');
    } else {
      console.log('⚠️ Trade not executed:', result.reason);
    }
  } catch (error) {
    console.error('❌ Error placing order:', error.message);
  }
}

// Execute the order only if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  placeOrder();
}
