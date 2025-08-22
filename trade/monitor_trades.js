// monitor_trades.js - Connects to the local trade simulator for a live view of open trades.

import WebSocket from 'ws';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

const PORT = process.env.TRADE_SIM_PORT || 3100;
const WS_URL = `ws://localhost:${PORT}`;

const openTrades = new Map();
const closedTrades = []; // Array to store closed trade history
const latestPrices = new Map(); // symbol -> price
let capital = { equity: 0, cash: 0, usedMargin: 0, realizedPnl: 0 };

const MAX_CLOSED_TRADES = 20; // Keep last 20 closed trades
const TRADES_LOG_PATH = path.join(process.cwd(), 'trade', 'logs', 'sim_trades.jsonl');

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

function formatCurrency(value) {
    return `$${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDuration(ms) {
    if (!Number.isFinite(ms) || ms < 0) return '—';
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function loadTradeHistory() {
    try {
        if (!fs.existsSync(TRADES_LOG_PATH)) {
            console.log('No trade history file found. Starting fresh.');
            return;
        }

        const logData = fs.readFileSync(TRADES_LOG_PATH, 'utf8');
        const lines = logData.trim().split('\n').filter(line => line.trim());
        
        // Parse each line and extract closed trades
        const historicalTrades = [];
        for (const line of lines) {
            try {
                const logEntry = JSON.parse(line);
                
                // Look for trade close events
                if ((logEntry.type === 'close' || logEntry.event === 'close') && logEntry.trade) {
                    const trade = logEntry.trade;
                    
                    // Normalize the trade data format
                    const normalizedTrade = {
                        id: trade.id,
                        symbol: trade.symbol,
                        side: trade.side,
                        entryPrice: trade.entryPrice,
                        exitPrice: trade.exitPrice,
                        leverage: trade.leverage,
                        openTs: trade.openTime || trade.openTs,
                        closedTs: trade.exitTime || trade.closeTime || logEntry.ts,
                        pnl: trade.netPnl || trade.pnl,
                        pnlPct: trade.pnlPct,
                        result: logEntry.reason || trade.closeReason || '—',
                        usedMargin: trade.usedMargin
                    };
                    
                    historicalTrades.push(normalizedTrade);
                }
            } catch (parseError) {
                // Skip malformed lines
                continue;
            }
        }
        
        // Keep only the most recent trades and add to closedTrades array
        const recentTrades = historicalTrades.slice(-MAX_CLOSED_TRADES);
        closedTrades.push(...recentTrades);
        
        console.log(`Loaded ${recentTrades.length} historical trades from log file.`);
        
    } catch (error) {
        console.error('Error loading trade history:', error.message);
    }
}

function displayTrades() {
    console.clear();
    console.log(`--- 🛡️  Live Trade Monitor ---`);
    console.log(` ${new Date().toLocaleString()}`);
    // Live prices line
    if (latestPrices.size > 0) {
        const parts = Array.from(latestPrices.entries())
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([sym, px]) => `${sym}: ${Number(px).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
        console.log(parts.join('   '));
    } else {
        console.log('Prices: —');
    }
    console.log('='.repeat(85));

    // Capital Display
    const equityStr = `Equity: ${formatCurrency(capital.equity)}`.padEnd(28);
    const cashStr = `Cash: ${formatCurrency(capital.cash)}`.padEnd(28);
    const marginStr = `Used Margin: ${formatCurrency(capital.usedMargin)}`.padEnd(28);
    console.log(`${equityStr}${cashStr}${marginStr}`);
    const pnlStr = `Realized PnL: ${formatPnl(capital.realizedPnl)}`;
    console.log(pnlStr);
    console.log('='.repeat(130));

    // OPEN TRADES SECTION
    console.log('📈 OPEN TRADES');
    const headers = [
        'ID'.padEnd(4),
        'Symbol'.padEnd(10),
        'Side'.padEnd(6),
        'Entry Time'.padEnd(18),
        'Entry Price'.padEnd(14),
        'Margin'.padEnd(15),
        'Leverage'.padEnd(10),
        'TP'.padEnd(14),
        'SL'.padEnd(14),
        'Duration'.padEnd(10),
        'PnL ($)'.padEnd(15),
        'PnL (%)'.padEnd(12)
    ];
    console.log(headers.join(' '));
    console.log('-'.repeat(150));

    if (openTrades.size === 0) {
        console.log('No open trades. Waiting for activity...');
    } else {
        for (const trade of openTrades.values()) {
            const pnlStr = formatPnl(trade.pnl);
            const pnlPctStr = formatPnlPct(trade.pnlPct);
            const now = Date.now();
            const ots = Number(trade.openTs);
            const dur = (Number.isFinite(ots) && ots > 0) ? formatDuration(now - ots) : '—';
            const entryTime = (Number.isFinite(ots) && ots > 0) ? new Date(ots).toLocaleTimeString() : '—';
            const tpStr = (trade.tp === null || trade.tp === undefined) ? '—' : formatCurrency(trade.tp);
            const slStr = (trade.sl === null || trade.sl === undefined) ? '—' : formatCurrency(trade.sl);
            const row = [
                String(trade.id).padEnd(4),
                trade.symbol.padEnd(10),
                trade.side.padEnd(6),
                entryTime.padEnd(18),
                formatCurrency(trade.entryPrice).padEnd(14),
                formatCurrency(trade.usedMargin).padEnd(15),
                `x${trade.leverage}`.padEnd(10),
                tpStr.padEnd(14),
                slStr.padEnd(14),
                dur.padEnd(10),
                pnlStr.padEnd(15 + 9), // Pad extra to account for invisible color codes
                pnlPctStr.padEnd(12 + 9)
            ];
            console.log(row.join(' '));
        }
    }

    // CLOSED TRADES SECTION
    if (closedTrades.length > 0) {
        console.log('\n📊 RECENT CLOSED TRADES');
        const closedHeaders = [
            'ID'.padEnd(4),
            'Symbol'.padEnd(10),
            'Side'.padEnd(6),
            'Entry Time'.padEnd(18),
            'Exit Time'.padEnd(18),
            'Entry'.padEnd(14),
            'Exit'.padEnd(14),
            'Leverage'.padEnd(10),
            'Duration'.padEnd(10),
            'Result'.padEnd(8),
            'PnL ($)'.padEnd(15),
            'PnL (%)'.padEnd(12)
        ];
        console.log(closedHeaders.join(' '));
        console.log('-'.repeat(180));

        // Show most recent closed trades first
        const recentClosed = closedTrades.slice(-10).reverse();
        for (const trade of recentClosed) {
            const pnlStr = formatPnl(trade.pnl);
            const pnlPctStr = formatPnlPct(trade.pnlPct);
            const duration = formatDuration(trade.closedTs - trade.openTs);
            const result = trade.result || '—';
            const entryTime = (Number.isFinite(trade.openTs) && trade.openTs > 0) ? new Date(trade.openTs).toLocaleTimeString() : '—';
            const exitTime = (Number.isFinite(trade.closedTs) && trade.closedTs > 0) ? new Date(trade.closedTs).toLocaleTimeString() : '—';
            
            const row = [
                String(trade.id).padEnd(4),
                trade.symbol.padEnd(10),
                trade.side.padEnd(6),
                entryTime.padEnd(18),
                exitTime.padEnd(18),
                formatCurrency(trade.entryPrice).padEnd(14),
                formatCurrency(trade.exitPrice).padEnd(14),
                `x${trade.leverage}`.padEnd(10),
                duration.padEnd(10),
                result.padEnd(8),
                pnlStr.padEnd(15 + 9), // Pad extra to account for invisible color codes
                pnlPctStr.padEnd(12 + 9)
            ];
            console.log(row.join(' '));
        }
    }

    console.log('='.repeat(130));
    console.log('Watching for trade updates... (Press Ctrl+C to exit)');
}


function connect() {
    const ws = new WebSocket(WS_URL);
    let displayInterval;

    ws.on('open', () => {
        console.log(`Connecting to ${WS_URL}...`);
        // Load trade history from log file on startup
        loadTradeHistory();
        // Start rendering the display immediately
        if (displayInterval) clearInterval(displayInterval);
        displayInterval = setInterval(displayTrades, 500); // Redraw every 500ms
    });

    ws.on('message', (raw) => {
        try {
            const msg = JSON.parse(raw.toString());
            switch(msg.type) {
                case 'price_cache':
                    if (Array.isArray(msg.prices)) {
                        msg.prices.forEach(p => {
                            if (p && p.symbol && Number.isFinite(Number(p.price))) {
                                latestPrices.set(p.symbol, Number(p.price));
                            }
                        });
                    }
                    break;
                case 'price':
                    if (msg.symbol && Number.isFinite(Number(msg.price))) {
                        latestPrices.set(msg.symbol, Number(msg.price));
                    }
                    break;
                case 'price_update':
                    if (msg.symbol && Number.isFinite(Number(msg.price))) {
                        latestPrices.set(msg.symbol, Number(msg.price));
                    }
                    break;
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
                    // Store in closed trades history before removing from open trades
                    const closedTrade = {
                        ...msg.trade,
                        closedTs: Date.now()
                    };
                    closedTrades.push(closedTrade);
                    
                    // Keep only the most recent closed trades
                    if (closedTrades.length > MAX_CLOSED_TRADES) {
                        closedTrades.shift(); // Remove oldest
                    }
                    
                    openTrades.delete(msg.trade.id);
                    break;
                case 'capital_update':
                    capital = msg.capital;
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
