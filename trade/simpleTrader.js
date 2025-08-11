// simpleTrader.js - A simple command-line interface for the trade simulator
import {
  openMarketTrade,
  openLimitTrade,
  closeTrade,
  cancelTrade,
  getCapital,
  getTrades,
} from '../simClient.js';

// Helper to parse command line arguments like --key value
function parseArgs(args) {
  const parsed = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].substring(2);
      const value = args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true;
      parsed[key] = value;
      if (value !== true) i++;
    }
  }
  return parsed;
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);

  try {
    switch (command) {
      case 'open': {
        console.log('Placing order...');
        const params = {
          symbol: args.symbol || 'BTCUSDT',
          side: args.side ? String(args.side).toUpperCase() : 'LONG',
          tpPct: Number(args.tp) || 1,
          slPct: Number(args.sl) || 0.5,
          leverage: Number(args.lev) || 1,
          notional: Number(args.notional) || undefined,
        };
        let result;
        if (args.limit) {
            params.limitPrice = Number(args.limit);
            result = await openLimitTrade(params);
        } else {
            result = await openMarketTrade(params);
        }
        console.log('✅ Success:', result);
        break;
      }

      case 'close': {
        const id = Number(args.id);
        if (!id) {
          console.error('❌ Error: Please provide --id <trade_id>');
          return;
        }
        console.log(`Closing trade #${id}...`);
        const result = await closeTrade(id);
        console.log('✅ Success:', result);
        break;
      }

      case 'cancel': {
        const id = Number(args.id);
        if (!id) {
          console.error('❌ Error: Please provide --id <trade_id>');
          return;
        }
        console.log(`Canceling order #${id}...`);
        const result = await cancelTrade(id);
        console.log('✅ Success:', result);
        break;
      }

      case 'status': {
        console.log('Fetching status...');
        const capital = await getCapital();
        const trades = await getTrades();
        console.log('\n--- Capital ---');
        console.table(capital);
        console.log('\n--- Open Trades ---');
        if (trades.open.length > 0) {
            console.table(trades.open.map(({ id, symbol, side, status, entryPrice, tp, sl, notional }) => ({ id, symbol, side, status, entryPrice, tp, sl, notional })));
        } else {
            console.log('No open trades.');
        }
        console.log('\n--- Last 5 Closed Trades ---');
        if (trades.closed.length > 0) {
            console.table(trades.closed.slice(-5).map(({ id, symbol, side, exitPrice, netPnl, pnlPct }) => ({ id, symbol, side, exitPrice, netPnl: netPnl?.toFixed(2), pnlPct: pnlPct?.toFixed(2) + '%' })));
        } else {
            console.log('No closed trades.');
        }
        break;
      }

      case 'help':
      default: {
        console.log(`
  Trade Simulator CLI - A simpler way to trade.

  Usage: node simpleTrader.js <command> [options]

  Commands:
    status                Show current capital, open trades, and recent history.
    open                  Open a new trade (market by default).
    close                 Force-close an open trade by its ID.
    cancel                Cancel a pending (limit) order by its ID.
    help                  Show this help message.

  Options for 'open':
    --side <LONG|SHORT>   (default: LONG)
    --symbol <SYMBOL>     (default: BTCUSDT)
    --notional <amount>   Size of trade in USDT.
    --lev <number>        Leverage. (default: 1)
    --tp <percent>        Take Profit %. (default: 1)
    --sl <percent>        Stop Loss %. (default: 0.5)
    --limit <price>       If specified, makes it a limit order at <price>.

  Options for 'close' and 'cancel':
    --id <trade_id>       The ID of the trade to act on (required).

  Examples:
    node simpleTrader.js status
    node simpleTrader.js open --side SHORT --notional 50 --lev 10
    node simpleTrader.js open --side LONG --limit 60000 --notional 25
    node simpleTrader.js close --id 3
        `);
        break;
      }
    }
  } catch (err) {
    const msg = err.response?.data?.error || err.message;
    console.error('❌ Operation Failed:', msg);
  }
}

main();
