// monitor_trades.js - Connects to the local trade simulator for a live view of open trades.

import WebSocket from 'ws';
import dotenv from 'dotenv';

dotenv.config();

const PORT = process.env.TRADE_SIM_PORT || 3100;
const WS_URL = `ws://localhost:${PORT}`;

const openTrades = new Map();

function formatPnl(pnl) {
    const pnlNum = Number(pnl || 0);
    const color = pnlNum >= 0 ? '\x1b[32m' : '\x1b[31m'; // Green for positive, Red for negative
    const reset = '\x1b[0m';
    const sign = pnlNum >= 0 ? '+' : '';
    return `${color}${sign}${pnlNum.toFixed(2)}${reset}`;
}

function formatPnlPct(pnlPct) {
    const pnlNum = Number(pnlPct || 0);
    const color = pnlNum >= 0 ? '\x1b[32m' : '\x1b[31m';
    const reset = '\x1b[0m';
    const sign = pnlNum >= 0 ? '+' : '';
    return `${color}${sign}${(pnlNum).toFixed(3)}%${reset}`;
}

function displayTrades() {
    console.clear();
    console.log(`--- 🛡️  Live Trade Monitor ---`);
    console.log(` ${new Date().toLocaleString()}`);
    console.log('='.repeat(85));
    const headers = [
        'ID'.padEnd(4),
        'Symbol'.padEnd(10),
        'Side'.padEnd(6),
        'Entry Price'.padEnd(14),
        'Notional'.padEnd(15),
        'PnL ($)'.padEnd(15),
        'PnL (%)'.padEnd(12)
    ];
    console.log(headers.join(' '));
    console.log('-'.repeat(85));

    if (openTrades.size === 0) {
        console.log('\nNo open trades. Waiting for activity...');
    } else {
        for (const trade of openTrades.values()) {
            const pnlStr = formatPnl(trade.pnl);
            const pnlPctStr = formatPnlPct(trade.pnlPct);
            const row = [
                String(trade.id).padEnd(4),
                trade.symbol.padEnd(10),
                trade.side.padEnd(6),
                String(trade.entryPrice).padEnd(14),
                `$${Number(trade.notional).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`.padEnd(15),
                pnlStr.padEnd(15 + 9), // Pad extra to account for invisible color codes
                pnlPctStr.padEnd(12 + 9)
            ];
            console.log(row.join(' '));
        }
    }
    console.log('='.repeat(85));
    console.log('Watching for trade updates... (Press Ctrl+C to exit)');
}


function connect() {
    const ws = new WebSocket(WS_URL);
    let displayInterval;

    ws.on('open', () => {
        console.log(`Connecting to ${WS_URL}...`);
        // Start rendering the display immediately
        if (displayInterval) clearInterval(displayInterval);
        displayInterval = setInterval(displayTrades, 500); // Redraw every 500ms
    });

    ws.on('message', (raw) => {
        try {
            const msg = JSON.parse(raw.toString());
            switch(msg.type) {
                case 'trade_cache':
                    msg.trades.forEach(trade => openTrades.set(trade.id, trade));
                    break;
                case 'trade_open':
                    openTrades.set(msg.trade.id, msg.trade);
                    break;
                case 'trade_update':
                    if (openTrades.has(msg.id)) {
                        const trade = openTrades.get(msg.id);
                        trade.pnl = msg.pnl;
                        trade.pnlPct = msg.pnlPct;
                    }
                    break;
                case 'trade_close':
                    openTrades.delete(msg.id);
                    break;
            }
        } catch (e) { /* ignore parse errors */ }
    });

    ws.on('close', () => {
        if (displayInterval) clearInterval(displayInterval);
        console.log('\n\n--- Stream Disconnected ---');
        console.log('Attempting to reconnect in 5 seconds...');
        setTimeout(connect, 5000);
    });

    ws.on('error', (err) => {
        if (displayInterval) clearInterval(displayInterval);
        console.error(`\n\n--- Connection Error ---`);
        console.error(`Could not connect to ${WS_URL}. Is the trade server running?`);
        console.error('Run: node trade/tradeMaker.js');
    });
}

connect();
