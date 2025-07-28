// historicalStreamer.js - Simulates a live data stream from historical data for front-testing

import {
    symbol,
    time as interval,
    limit,
    minSwingPct,
    shortWindow,
    longWindow,
    confirmOnClose,
    minLegBars,
    logCandlesInStreamer
} from './config/config.js';
import { tradeConfig } from './config/tradeconfig.js';
import PivotTracker from './utils/pivotTracker.js';
import { PaperTradeManager } from './utils/live/paperTradeManager.js';
import { getCandles } from './apis/bybit.js';
import { displayCandleInfo } from './utils/consoleOutput.js';
import { formatDuration, colors } from './utils/formatters.js';


const tradeSettingsDisplay = `
${colors.cyan}Trade Settings:${colors.reset}
- Direction: ${tradeConfig.direction}
- Take Profit: ${tradeConfig.takeProfit}%
- Stop Loss: ${tradeConfig.stopLoss}%
- Leverage: ${tradeConfig.leverage}x
- Maker Fee: ${tradeConfig.totalMakerFee}%
- Initial Capital: $${tradeConfig.initialCapital}
- Risk Per Trade: ${tradeConfig.riskPerTrade}%
`;
console.log(tradeSettingsDisplay);

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
        if (logCandlesInStreamer) {
            displayCandleInfo(candle);
        }
        // Always update the pivot tracker with the latest candle.
        const pivot = pivotTracker.update(candle);

        // If a pivot is detected, log it, regardless of active trades.
                if (pivot) {
            pivotCounter++;
                        const color = pivot.type === 'high' ? colors.green : colors.red;
            const formattedTime = new Date(pivot.time).toLocaleString();
            const formattedPrevTime = new Date(pivot.previousTime).toLocaleString();

            const summaryLine = `${pivotCounter}.[PIVOT] ${pivot.type.toUpperCase()} @ ${pivot.price.toFixed(2)} | Confirm: ${formattedTime} | Move: ${(pivot.movePct * 100).toFixed(2)}% | Bars: ${pivot.bars}`;
            const detailsLine = `(Prev: ${pivot.previousPrice.toFixed(2)} @ ${formattedPrevTime} | Confirmed on Close: ${pivot.confirmedOnClose})\n`;

            console.log(`${color}${summaryLine}\n${detailsLine}${colors.reset}`);
        }

        // Manage the active trade lifecycle.
        if (activeTrade) {
            activeTrade.update(candle);

            if (!activeTrade.isActive()) {
                const result = activeTrade.getResult();
                const resultString = `Trade finished. Result: ${JSON.stringify({
                    ...result,
                    fillTime: result.fillTime ? new Date(result.fillTime).toLocaleString() : 'N/A',
                    exitTime: result.exitTime ? new Date(result.exitTime).toLocaleString() : 'N/A'
                }, null, 2)}`;
                console.log(resultString);
                lastTradeEventTime = candle.time;
                activeTrade = null;
            }
        }

        // Only initiate a new trade if there isn't one active and a valid pivot occurred.
        if (pivot && !activeTrade) {
            const direction = tradeConfig.direction.toLowerCase();
            const pivotType = pivot.type.toLowerCase();

            const canBuy = direction === 'buy' || direction === 'both';
            const canSell = direction === 'sell' || direction === 'both';

            if ((pivotType === 'low' && canBuy) || (pivotType === 'high' && canSell)) {
                activeTrade = new PaperTradeManager(tradeConfig, pivot, candle);
                lastTradeEventTime = candle.time;

                // Since it's a market order, it's filled instantly. Log it here.
                const order = activeTrade.order;
                const formattedTime = new Date(order.fillTime).toLocaleString('en-US', { weekday: 'long' });
                const fillMessage = `[ORDER] ${order.side} MARKET FILLED @ ${order.fillPrice.toFixed(2)} | Current: ${candle.close.toFixed(2)} | Time: ${formattedTime}`;
                console.log(`${colors.yellow}${fillMessage}${colors.reset}`);
            }
        }


    }

    // After the loop, check if a trade is still active and force-close it
    if (activeTrade && activeTrade.isActive()) {
        const lastCandle = candles[candles.length - 1];
        activeTrade.forceClose(lastCandle);
        const result = activeTrade.getResult();

        console.log('\n----------------------------------------');
        console.log('Simulation finished. An open trade was FORCE-CLOSED at the end of the data:');
        const resultString = `Result: ${JSON.stringify({
            ...result,
            fillTime: result.fillTime ? new Date(result.fillTime).toLocaleString() : 'N/A',
            exitTime: result.exitTime ? new Date(result.exitTime).toLocaleString() : 'N/A'
        }, null, 2)}`;
        console.log(resultString);
        console.log('----------------------------------------');
    }

    if (lastTradeEventTime) {
        const durationMs = lastTradeEventTime - candles[0].time;
        console.log(`\nTime from start to last trade event: ${formatDuration(durationMs)}`);
    }
    console.log('\nHistorical stream simulation finished.');
}

(async () => {
    try {
        await runSimulation();
    } catch (err) {
        console.error('An error occurred during the simulation:', err);
    }
})();
