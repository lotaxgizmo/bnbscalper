// my_trades.js - Your simple script to run trades.

import {
  openMarketTrade,
  closeTrade,
  getCapital,
  getStatus,
  getTrades,
} from './simClient.js';

// Helper to wait for a number of milliseconds
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ======================================================
// --- EDIT YOUR TRADE HERE ---
const myTrade = {
  symbol: 'BTCUSDT',
  side: 'LONG',
  amountToRisk: 100, // The amount of YOUR capital to use for this trade (your margin)
  leverage: 50,      // The leverage to apply
  tpPct: 1.0,        // Take Profit at +1.0%
  slPct: 0.5,        // Stop Loss at -0.5%
};
// With $100 risked at 10x leverage, your total position size will be $1000.
// ======================================================

async function runMyTrade() {
  console.log('--- Starting Your Trade Simulation ---');

  // 1. Check server status
  try {
    console.log('Checking server status...');
    await getStatus();
    console.log('✅ Server is running.');
  } catch (e) {
    console.error('❌ Could not connect to the trade simulator. Is it running? (run: node trade/tradeMaker.js)');
    return;
  }

  // 2. Open the trade
  const notional = myTrade.amountToRisk * myTrade.leverage;
  console.log(`\nOpening ${myTrade.side} trade for ${myTrade.symbol}...`);
  console.log(`   -> Risking $${myTrade.amountToRisk} with ${myTrade.leverage}x leverage for a $${notional} position.`);

  const tradeParams = { ...myTrade, notional };
  const response = await openMarketTrade(tradeParams);
  const tradeId = response.trade?.id || response.id;

  if (!tradeId) {
    console.error('❌ Failed to open trade. Response:', response);
    return;
  }

  // 3. Confirm the trade is OPEN (handles pending state)
  console.log(`Trade request sent. ID: #${tradeId}. Waiting for confirmation...`);
  let confirmedTrade;
  for (let i = 0; i < 10; i++) { // Try for 10 seconds
    const { open } = await getTrades();
    confirmedTrade = open.find(t => t.id === tradeId && t.status === 'OPEN');
    if (confirmedTrade) break;
    await sleep(1000);
  }

  if (!confirmedTrade) {
    console.error(`❌ Trade #${tradeId} did not open after 10 seconds. Please check server logs.`);
    return;
  }

  console.log(`✅ Trade #${tradeId} is confirmed OPEN!`);
  console.log(confirmedTrade);

  // 4. Wait for a few seconds to simulate the trade being live
  console.log('\nWaiting for 5 seconds...');
  await sleep(5000);

  // 5. Check the price again
  console.log('\nChecking price update...');
  const currentStatus = await getStatus();
  const latestPriceInfo = currentStatus.priceCache.find(p => p.symbol === myTrade.symbol);
  console.log(`✅ Latest ${myTrade.symbol} price: ${latestPriceInfo?.lastPrice}`);

  // 6. Force-close the trade
  console.log(`\nForce-closing trade #${tradeId}...`);
  const closedResult = await closeTrade(tradeId);
  console.log('✅ Trade closed.');
  console.log(closedResult.trade);

  // 7. Check final capital
  console.log('\nFetching final capital...');
  const finalCapital = await getCapital();
  console.log(finalCapital);

  console.log('\n--- Simulation Finished ---');
}

runMyTrade();
