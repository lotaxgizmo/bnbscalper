// close_trade.js - A simple script to force-close a specific trade or all open trades.

import { closeTrade, getTrades } from './simClient.js';

async function run() {
  // Get the command from the command line (e.g., "5" or "all")
  const command = process.argv[2];

  console.log('--- Manual Trade Closer ---');

  let openTrades = [];
  try {
    const { open } = await getTrades();
    openTrades = open || [];
    if (openTrades.length === 0) {
      console.log('✅ No open trades to close.');
      return;
    }
    console.log('Current Open Trades:');
    openTrades.forEach(t => {
      console.log(`  -> ID: ${t.id}, Symbol: ${t.symbol}, Side: ${t.side}, Notional: $${t.notional.toFixed(2)}`);
    });
  } catch (e) {
    console.error('❌ Could not connect to the trade simulator. Is it running? (run: node trade/tradeMaker.js)');
    return;
  }

  if (!command) {
    console.log('\nUsage: node trade/close_trade.js <TRADE_ID|all>');
    console.log('Example (single): node trade/close_trade.js 5');
    console.log('Example (all):    node trade/close_trade.js all');
    return;
  }

  if (command.toLowerCase() === 'all') {
    console.log(`\nAttempting to close all ${openTrades.length} trades...`);
    const closePromises = openTrades.map(trade => closeTrade(trade.id));
    const results = await Promise.allSettled(closePromises);

    results.forEach((result, index) => {
      const tradeId = openTrades[index].id;
      if (result.status === 'fulfilled') {
        console.log(`✅ Trade #${tradeId} closed successfully.`);
      } else {
        const error = result.reason?.response?.data?.error || result.reason.message;
        console.error(`❌ Failed to close trade #${tradeId}:`, error);
      }
    });
    console.log('\nAll trades have been processed.');

  } else {
    const id = Number(command);
    if (isNaN(id)) {
        console.error(`\nError: Invalid command "${command}". Please provide a trade ID number or "all".`);
        return;
    }
    console.log(`\nAttempting to close trade #${id}...`);

    try {
      const result = await closeTrade(id);
      if (result.error) {
        console.error(`❌ Failed to close trade #${id}:`, result.error);
      } else {
        console.log(`✅ Trade #${id} closed successfully.`);
        console.log(result.trade);
      }
    } catch (e) {
      if (e.response && e.response.data) {
          console.error(`❌ Error closing trade #${id}:`, e.response.data.error);
      } else {
          console.error(`❌ An unexpected error occurred:`, e.message);
      }
    }
  }
}

run();
