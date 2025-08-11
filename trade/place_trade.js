// place_trade.js - A simple script to place a single trade and exit.

import { openMarketTrade, getStatus } from './simClient.js';

// ======================================================
// --- EDIT YOUR TRADE HERE ---
const myTrade = {
  symbol: 'BTCUSDT',
  side: 'SHORT',
  amountToRisk: 100, // The amount of YOUR capital to use for this trade (your margin)
  leverage: 45,      // The leverage to apply
  tpPct: 1.0,        // Take Profit at +1.0%
  slPct: 0.5,        // Stop Loss at -0.5%
};
// With $100 risked at 50x leverage, your total position size will be $5000.
// ======================================================

async function placeTrade() {
  console.log('--- Placing a New Trade ---');

  // 1. Check server status
  try {
    const status = await getStatus();
    if (!status.wsConnected) {
      console.error('❌ Server is not connected to Bybit WebSocket.');
      return;
    }
    console.log('✅ Server is running.');
  } catch (e) {
    console.error('❌ Could not connect to the trade simulator. Is it running?');
    console.error('   Run: node trade/tradeMaker.js');
    return;
  }

  // 2. Open the trade
  const notional = myTrade.amountToRisk * myTrade.leverage;
  console.log(`\nOpening ${myTrade.side} trade for ${myTrade.symbol}...`);
  console.log(`   -> Risking $${myTrade.amountToRisk} with ${myTrade.leverage}x leverage for a $${notional} position.`);

  try {
    const tradeParams = { ...myTrade, notional };
    const response = await openMarketTrade(tradeParams);
    
    if (response.error) {
        console.error(`❌ Failed to open trade:`, response.error);
    } else if (response.message && response.message.includes('Accepted')) {
        console.log(`✅ Trade request accepted. ID: #${response.id}`);
        console.log('   The trade will open when the first price update arrives.');
    } else {
        console.log(`✅ Trade opened successfully!`);
        console.log(response.trade);
    }
  } catch(e) {
      if (e.response && e.response.data) {
          console.error(`❌ Error opening trade:`, e.response.data.error);
      } else {
          console.error(`❌ An unexpected error occurred:`, e.message);
      }
  }
  
  console.log('\n--- Script Finished ---');
}

placeTrade();
