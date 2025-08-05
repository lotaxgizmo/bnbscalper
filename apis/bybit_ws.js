// bybit_ws.js
// WebSocket implementation for Bybit real-time data

import WebSocket from 'ws';
const WS_URL = 'wss://stream.bybit.com/v5/public/linear';

/**
 * Connect to Bybit WebSocket and subscribe to ticker updates
 * @param {string} symbol - Trading pair symbol (e.g., 'BTCUSDT')
 * @param {function} onMessageCallback - Callback function for processing ticker data
 * @returns {WebSocket} - The WebSocket connection object
 */
export function connectWebSocket(symbol, onMessageCallback) {
  // Create a new WebSocket connection
  const ws = new WebSocket(WS_URL);
  
  // Handle connection open
  ws.on('open', () => {
    console.log('WebSocket connection established');
    
    // Subscribe to ticker updates for the specified symbol
    const subscriptionMessage = JSON.stringify({
      op: 'subscribe',
      args: [`tickers.${symbol}`]
    });
    
    ws.send(subscriptionMessage);
    console.log(`Subscribed to ${symbol} ticker updates`);
  });
  
  // Handle incoming messages
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      
      // Process ticker data if available
      if (message.topic && message.topic.startsWith('tickers.') && message.data) {
        // Check if data is an array (Bybit sometimes sends data as an array)
        const dataItem = Array.isArray(message.data) ? message.data[0] : message.data;
        
        if (!dataItem) {
          console.error('No valid data found in message');
          return;
        }
        
        // For delta updates, we need to extract the price differently
        // Try different price fields in order of preference
        let price;
        if (dataItem.lastPrice) {
          price = dataItem.lastPrice;
        } else if (dataItem.markPrice) { 
          price = dataItem.markPrice;
        } else if (dataItem.indexPrice) {
          price = dataItem.indexPrice;
        } else if (dataItem.bid1Price && dataItem.ask1Price) {
          // Calculate the mid price if we have bid and ask
          const bid = parseFloat(dataItem.bid1Price);
          const ask = parseFloat(dataItem.ask1Price);
          price = ((bid + ask) / 2).toFixed(2);
        } else {
          // No suitable price found
          return;
        }
        
        const tickerData = {
          symbol: dataItem.symbol,
          price: price,
          timestamp: message.ts,
          // Include other fields when available
          volume: dataItem.volume24h,
          change: dataItem.change24h,
          high: dataItem.highPrice24h,
          low: dataItem.lowPrice24h,
          // Include bid/ask for reference
          bid: dataItem.bid1Price,
          ask: dataItem.ask1Price
        };
        
        // Call the callback function with the processed data
        if (onMessageCallback && typeof onMessageCallback === 'function') {
          onMessageCallback(tickerData);
        }
      }
    } catch (error) {
      console.error('Error processing WebSocket message:', error);
    }
  });
  
  // Handle errors
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
  
  // Handle connection close
  ws.on('close', () => {
    console.log('WebSocket connection closed');
    
    // Attempt to reconnect after a delay
    setTimeout(() => {
      console.log('Attempting to reconnect...');
      connectWebSocket(symbol, onMessageCallback);
    }, 5000);
  });
  
  // Return the WebSocket instance
  return ws;
}
