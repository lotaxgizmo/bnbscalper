// Refactored placeOrder.js using modular utilities
import { executeMarketOrder } from './utils/trading/index.js';

// ==========================
// TRADING CONFIGURATION - EDIT HERE
// ==========================
const TRADING_CONFIG = {
  symbol: 'SOLUSDT',           // change symbol here
  signal: 'Buy',               // 'Buy'/'long' = long, 'Sell'/'short' = short
  // leverage: 50,                // leverage to use
  leverage: 80,                // leverage to use
  amountMode: 'percentage',    // 'percentage' or 'fixed'
  usePercentage: 100,          // 100% = all-in (before buffer)
  fixedAmount: 100,            // USDT amount if fixed mode
  // upperLimit: 200000,           // Max notional cap
  upperLimit: 250000,           // Max notional cap
  
  slTpMode: 'percentage',      // 'percentage' or 'fixed'
  // stopLoss: null,               // Stop loss: 0.5% if percentage mode, or exact price if fixed mode
  stopLoss: 0.5,               // Stop loss: 0.5% if percentage mode, or exact price if fixed mode
  // takeProfit: null,             // Take profit: 1.0% if percentage mode, or exact price if fixed mode
  takeProfit: 1.0,             // Take profit: 1.0% if percentage mode, or exact price if fixed mode

  tradeOnActive: false         // Allow trading when active positions exist
};

// ==========================
// Execute the order
// ==========================
async function placeOrder() {
  try {
    const result = await executeMarketOrder(TRADING_CONFIG);
    
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

// Execute the order
placeOrder();
