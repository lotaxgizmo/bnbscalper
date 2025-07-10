// bybit_ws.js
import WebSocket from 'ws';
import { symbol } from './config.js';

const WS_URL = 'wss://stream.bybit.com/v5/public/linear';
let ws;

function connect() {
  ws = new WebSocket(WS_URL);

  ws.on('open', () => {
    console.log('Connected to Bybit WebSocket');
    // Subscribe to ticker updates for the symbol
    const subscribeMsg = {
      op: 'subscribe',
      args: [`tickers.${symbol}`]
    };
    ws.send(JSON.stringify(subscribeMsg));
  });

  // Keep track of latest data
  let latestData = {};

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);
      
      if (message.topic === `tickers.${symbol}`) {
        const update = message.data;

        if (message.type === 'snapshot') {
          // Full snapshot - store all data
          latestData = { ...update };
          console.log(`${symbol} Snapshot:`, {
            price: update.lastPrice,
            high24h: update.highPrice24h,
            low24h: update.lowPrice24h,
            volume24h: update.volume24h,
            timestamp: new Date(message.ts).toLocaleTimeString()
          });
        } else if (message.type === 'delta') {
          // Delta update - only update changed fields
          latestData = { ...latestData, ...update };
          
          // Only log when price changes
          if (update.lastPrice) {
            console.log(`${symbol} Update:`, {
              price: update.lastPrice,
              timestamp: new Date(message.ts).toLocaleTimeString()
            });
          }
        }
      }
    } catch (error) {
      console.error('Error processing message:', error);
    }
  });

  ws.on('close', () => {
    console.log('Disconnected from Bybit WebSocket');
    // Reconnect after 5 seconds
    setTimeout(connect, 5000);
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    ws.close();
  });
}

// Start the WebSocket connection
connect();

// Handle program termination
process.on('SIGINT', () => {
  console.log('Closing WebSocket connection...');
  if (ws) ws.close();
  process.exit();
});
