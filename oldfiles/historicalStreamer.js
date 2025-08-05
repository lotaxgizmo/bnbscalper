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
} from '../config/config.js';
import { tradeConfig } from '../config/tradeconfig.js';
import PivotTracker from '../utils/pivotTracker.js';
import { PaperTradeManager } from '../utils/live/paperTradeManager.js';
import { getCandles } from '../apis/bybit.js';
import { displayCandleInfo } from '../utils/consoleOutput.js';
import { formatDuration, colors } from '../utils/formatters.js';


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
        // 3. Simulate the stream asynchronously
    const processCandle = (index) => {
        if (index >= candles.length) {
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
            return;
        }

        const candle = candles[index];
        if (logCandlesInStreamer) {
            displayCandleInfo(candle);
        }

        const pivotSignal = pivotTracker.update(candle);

        // First, handle any existing trade with the current candle's data.
        if (activeTrade) {
            activeTrade.update(candle);
            if (!activeTrade.isActive()) {
                const result = activeTrade.getResult();
                console.log(`Trade finished. Result: ${JSON.stringify(result, null, 2)}`);
                activeTrade = null;
            }
        }

        // After updating any active trade, check if a new pivot was confirmed with this candle.
        if (pivotSignal && !activeTrade) {
            pivotCounter++;
            const color = pivotSignal.type === 'high' ? colors.green : colors.red;
            // **FIX**: Log the correct confirmation time, not the pivot's extreme time.
            const formattedConfirmTime = new Date(pivotSignal.confirmationTime).toLocaleString();
            const formattedExtremeTime = new Date(pivotSignal.time).toLocaleString();

            const summaryLine = `${pivotCounter}.[PIVOT] ${pivotSignal.type.toUpperCase()} @ ${pivotSignal.price.toFixed(2)} | Confirm: ${formattedConfirmTime} | Move: ${(pivotSignal.movePct * 100).toFixed(2)}% | Bars: ${pivotSignal.bars}`;
            const detailsLine = `(Extreme: ${pivotSignal.price.toFixed(2)} @ ${formattedExtremeTime} | Confirmed on Close: ${pivotSignal.confirmedOnClose})\n`;
            console.log(`${color}${summaryLine}\n${detailsLine}${colors.reset}`);

            const direction = tradeConfig.direction.toLowerCase();
            const pivotType = pivotSignal.type.toLowerCase();
            const canBuy = direction === 'buy' || direction === 'both';
            const canSell = direction === 'sell' || direction === 'both';

            if ((pivotType === 'low' && canBuy) || (pivotType === 'high' && canSell)) {
                // **FIX**: A trade signal occurs on the candle that confirms the pivot.
                // The market order should be filled on the *next* candle.
                const nextCandleIndex = index + 1;
                if (nextCandleIndex < candles.length) {
                    const tradeExecutionCandle = candles[nextCandleIndex];
                    activeTrade = new PaperTradeManager(tradeConfig, pivotSignal, tradeExecutionCandle);
                    const order = activeTrade.order;
                    const formattedFillTime = new Date(order.fillTime).toLocaleString();
                    const fillMessage = `[ORDER] ${order.side} MARKET FILLED @ ${order.fillPrice.toFixed(2)} | Time: ${formattedFillTime}`;
                    console.log(`${colors.yellow}${fillMessage}${colors.reset}`);
                }
            }
        }

        setTimeout(() => processCandle(index + 1), 0);
    };

    processCandle(0);

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
