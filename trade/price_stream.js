// price_stream.js - Connects to the local trade simulator to stream live prices.

import WebSocket from 'ws';
import dotenv from 'dotenv';

dotenv.config();

const PORT = process.env.TRADE_SIM_PORT ? Number(process.env.TRADE_SIM_PORT) : 3100;
const WS_URL = `ws://localhost:${PORT}`;

let lastPrice = 0;

function connect() {
  const ws = new WebSocket(WS_URL);

  ws.on('open', () => {
    console.log(`--- 🔴 LIVE Price Stream ---`);
    console.log(`Connecting to ${WS_URL}...\n`);
  });

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'price') {
        const price = msg.price;
        const symbol = msg.symbol;
        const change = price - lastPrice;
        const indicator = change > 0 ? '🔼' : (change < 0 ? '🔽' : '─');

        // To avoid spamming, only show changes
        if (price !== lastPrice) {
            process.stdout.write(`\r${indicator} ${symbol}: ${price.toFixed(2)}   `);
        }

        lastPrice = price;
      } else if (msg.type === 'price_cache') {
        if (msg.prices && msg.prices.length > 0) {
            const latest = msg.prices[0];
            lastPrice = latest.price;
            console.log(`Last known price for ${latest.symbol}: ${latest.price.toFixed(2)}`);
            console.log('Waiting for new price updates...\n');
        } else {
            console.log('Connected. Waiting for first price update from the server...');
        }
      }
    } catch (e) {
      // ignore parse errors
    }
  });

  ws.on('close', () => {
    console.log('\n\n--- Stream Disconnected ---');
    console.log('Attempting to reconnect in 5 seconds...');
    setTimeout(connect, 5000);
  });

  ws.on('error', (err) => {
    console.error('\n\n--- Connection Error ---');
    console.error(`Could not connect to ${WS_URL}. Is the trade server running?`);
    console.error('Run: node trade/tradeMaker.js');
    // The 'close' event will handle reconnection logic.
  });
}

connect();
