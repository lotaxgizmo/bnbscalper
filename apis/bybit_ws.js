// bybit_ws.js
import WebSocket from 'ws';
const WS_URL = 'wss://stream.bybit.com/v5/public/linear';

export function connectWebSocket() {
  const ws = new WebSocket(WS_URL);
  return ws;
}
