// historicalStreamer.js - Simulates a live data stream from historical data for front-testing

import {
    symbol,
    time as interval,
    limit,
    minSwingPct,
    shortWindow,
    longWindow,
    confirmOnClose,
    minLegBars
} from './config/config.js';
import { tradeConfig } from './config/tradeconfig.js';
import PivotTracker from './utils/pivotTracker.js';
import { PaperTradeManager } from './utils/live/paperTradeManager.js';
import { getCandles } from './apis/bybit.js';
import { formatDuration } from './utils/formatters.js';

console.log('Starting Historical Streamer...');

async function runSimulation() {
    // 1. Initialize Pivot Tracker with correct configuration
    const pivotConfig = {
        minSwingPct,
        shortWindow,
        longWindow,
        confirmOnClose,
        minLegBars
    };
    const pivotTracker = new PivotTracker(pivotConfig);

    // 2. Load historical data
        const candles = await getCandles(symbol, interval, limit, null, true); // Use getCandles with forceLocal and the configured limit
    if (!candles || candles.length === 0) {
        console.error('No historical data found. Exiting.');
        return;
    }

    console.log(`Loaded ${candles.length} historical candles for interval '${interval}'.`);

    const startTime = new Date(candles[0].time).toLocaleString();
    const endTime = new Date(candles[candles.length - 1].time).toLocaleString();
    console.log(`Simulating from ${startTime} to ${endTime}`);

    console.log('Starting simulation...');

    // State for the paper trading session
    let activeTrade = null;
    let lastTradeEventTime = null;
    let pivotCounter = 0;

    // 3. Simulate the stream
    for (const candle of candles) {
        // Always update the pivot tracker with the latest candle.
        const pivot = pivotTracker.update(candle);

        // If a pivot is detected, log it, regardless of active trades.
        if (pivot) {
            pivotCounter++;
            console.log(`HISTORICAL PIVOT #${pivotCounter} DETECTED:`, {
                ...pivot,
                time: new Date(pivot.time).toLocaleString(),
                previousTime: new Date(pivot.previousTime).toLocaleString()
            });
        }

        // Manage the active trade lifecycle.
        if (activeTrade) {
            activeTrade.update(candle);
            if (!activeTrade.isActive()) {
                const result = activeTrade.getResult();
                console.log('Trade finished. Result:', {
                    ...result,
                    fillTime: result.fillTime ? new Date(result.fillTime).toLocaleString() : 'N/A',
                    exitTime: result.exitTime ? new Date(result.exitTime).toLocaleString() : 'N/A'
                });
                lastTradeEventTime = candle.time;
                activeTrade = null;
            }
        }

        // Only initiate a new trade if there isn't one active and a pivot occurred.
        if (pivot && !activeTrade) {
            activeTrade = new PaperTradeManager(tradeConfig, pivot);
            lastTradeEventTime = candle.time;
        }
    }

    // After the loop, check if a trade is still active
    if (activeTrade && activeTrade.isActive()) {
        const order = activeTrade.order; // Access the order property directly
        console.log('\n----------------------------------------');
        console.log('Simulation finished with an UNRESOLVED trade:');
        console.log('Order Details:', JSON.stringify(order, null, 2));
        console.log('This trade did not close by the end of the historical data.');
        console.log('----------------------------------------');
    }

    if (lastTradeEventTime) {
        const durationMs = lastTradeEventTime - candles[0].time;
        console.log(`\nTime from start to last trade event: ${formatDuration(durationMs)}`);
    }

    console.log('\nHistorical stream simulation finished.');
}

runSimulation().catch(err => {
    console.error('An error occurred during the simulation:', err);
});
