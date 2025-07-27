// paperTrader.js - Main entry point for live paper trading

import {
    symbol,
    time as interval,
    minSwingPct,
    shortWindow,
    longWindow,
    confirmOnClose,
    minLegBars
} from './config/config.js';
import { tradeConfig } from './config/tradeconfig.js';
import { connectWebSocket } from './apis/bybit_ws.js';
import PivotTracker from './utils/pivotTracker.js';
import { PaperTradeManager } from './utils/live/paperTradeManager.js';

console.log('Starting Paper Trader...');

// State for the paper trading session
let activeTrade = null;

// 1. Initialize Pivot Tracker with correct configuration
const pivotConfig = {
    minSwingPct,
    shortWindow,
    longWindow,
    confirmOnClose,
    minLegBars
};
const pivotTracker = new PivotTracker(pivotConfig);

// 2. Setup WebSocket Connection
const ws = connectWebSocket();
let heartbeatInterval;

ws.on('open', () => {
    console.log('Connected to Bybit WebSocket.');
    const topic = `kline.${interval.replace('m', '')}.${symbol}`;
    console.log(`Subscribing to ${topic}...`);

    // Subscribe to the kline topic
    ws.send(JSON.stringify({ op: 'subscribe', args: [topic] }));

    // Start heartbeat
    heartbeatInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ op: 'ping' }));
        }
    }, 20000);
});

ws.on('message', (data) => {
    const message = JSON.parse(data);

    // Ignore non-kline or administrative messages
    if (!message.data || !Array.isArray(message.data)) {
        if (message.op === 'subscribe') {
            console.log('Subscription status:', message);
        }
        return;
    }

    const candleData = message.data[0];
    if (!candleData) return;

    console.log(`[${new Date(parseInt(candleData.timestamp)).toLocaleTimeString()}] Candle received. Close: ${candleData.close}`);

    const formattedCandle = {
        time: parseInt(candleData.timestamp),
        open: parseFloat(candleData.open),
        high: parseFloat(candleData.high),
        low: parseFloat(candleData.low),
        close: parseFloat(candleData.close),
        volume: parseFloat(candleData.volume),
        turnover: parseFloat(candleData.turnover),
    };

    if (activeTrade) {
        activeTrade.update(formattedCandle);
        if (!activeTrade.isActive()) {
            console.log('Trade finished. Result:', activeTrade.getResult());
            activeTrade = null;
        }
    }

    const pivot = pivotTracker.update(formattedCandle);

    if (pivot && !activeTrade) {
        console.log(`LIVE PIVOT DETECTED:`, pivot);
        activeTrade = new PaperTradeManager(tradeConfig, pivot);
    }
});

ws.on('close', () => {
    console.log('Disconnected from Bybit WebSocket.');
    clearInterval(heartbeatInterval);
});

ws.on('error', (err) => {
    console.error('WebSocket error:', err);
});

console.log('Paper Trader initialized. Waiting for live data...');
