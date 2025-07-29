// tests/instantPivotTest.js
// Self-sufficient test file for instant pivot detection using the user's two-step logic.

import {
    symbol,
    time as interval,
    limit,
    minSwingPct,
    pivotLookback,
    minLegBars
} from '../config/config.js';
import { getCandles } from '../apis/bybit.js';
import { tradeConfig } from '../config/tradeconfig.js';

const colors = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
};

const displayCandleInfo = (candle, candleNumber, pivotType = null) => {
    const formattedTime = new Date(candle.time).toLocaleString();
    const o = candle.open.toFixed(2);
    const h = candle.high.toFixed(2);
    const l = candle.low.toFixed(2);
    const c = candle.close.toFixed(2);
    const cColor = c >= o ? colors.green : colors.red;

    let pivotIndicator = '   ';
    if (pivotType) {
        const pivotColor = pivotType === 'high' ? colors.green : colors.red;
        const pivotArrow = pivotType === 'high' ? '▲ H' : '▼ L';
        pivotIndicator = `${pivotColor}${pivotArrow}${colors.reset}`;
    }

    console.log(`  ${(candleNumber).toString().padStart(5, ' ')} | ${pivotIndicator} | ${formattedTime} | O: ${o} H: ${h} L: ${l} C: ${cColor}${c}${colors.reset}`);
};

console.log(`${colors.cyan}--- Instant Pivot Detection Test (Two-Step Logic) ---${colors.reset}`);

async function runTest() {
    const allLocalCandles = await getCandles(symbol, interval, null, null, true);
    // Ensure there are enough candles for the lookback on both sides
    if (!allLocalCandles || allLocalCandles.length < (pivotLookback * 2 + 1)) {
        console.error(`Not enough historical data. Need at least ${pivotLookback * 2 + 1} candles for lookback of ${pivotLookback}.`);
        return;
    }
    const candles = allLocalCandles.slice(-limit);
    console.log(`Loaded ${candles.length} of ${allLocalCandles.length} available '${interval}' local candles.\n`);

    let lastPivot = { type: null, price: null, time: null, index: 0 };
    const swingThreshold = minSwingPct / 100;
    let pivotCounter = 0;
    let highPivotCount = 0;
    let lowPivotCount = 0;

    // Iterate, leaving enough space for lookback on either side
    for (let i = pivotLookback; i < candles.length - pivotLookback; i++) {
        const currentCandle = candles[i];
        let pivotType = null;

        // --- High Pivot Logic ---
        let isHighPivot = true;
        for (let j = 1; j <= pivotLookback; j++) {
            if (currentCandle.high <= candles[i - j].high || currentCandle.high <= candles[i + j].high) {
                isHighPivot = false;
                break;
            }
        }

        if (isHighPivot) {
            const swingPct = lastPivot.price ? (currentCandle.high - lastPivot.price) / lastPivot.price : 0;
            // For the first pivot, we don't check swingPct. For subsequent pivots, we do.
            if ((lastPivot.type === null || Math.abs(swingPct) >= swingThreshold) && (i - lastPivot.index) >= minLegBars) {
                pivotType = 'high';
                pivotCounter++;
                highPivotCount++;
                const barsSinceLast = i - lastPivot.index;
                const movePct = swingPct * 100;
                const formattedTime = new Date(currentCandle.time).toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'medium' });
                
                console.log(`${colors.green}${pivotCounter}.[PIVOT] HIGH @ ${currentCandle.high.toFixed(2)} | Time: ${formattedTime} | Move: +${movePct.toFixed(2)}% | Bars: ${barsSinceLast}${colors.reset}`);
                
                lastPivot = { type: 'high', price: currentCandle.high, time: currentCandle.time, index: i };
            }
        }

        // --- Low Pivot Logic ---
        let isLowPivot = true;
        for (let j = 1; j <= pivotLookback; j++) {
            if (currentCandle.low >= candles[i - j].low || currentCandle.low >= candles[i + j].low) {
                isLowPivot = false;
                break;
            }
        }

        if (isLowPivot) {
            const swingPct = lastPivot.price ? (currentCandle.low - lastPivot.price) / lastPivot.price : 0;
            // For the first pivot, we don't check swingPct. For subsequent pivots, we do.
            if ((lastPivot.type === null || Math.abs(swingPct) >= swingThreshold) && (i - lastPivot.index) >= minLegBars) {
                pivotType = 'low';
                pivotCounter++;
                lowPivotCount++;
                const barsSinceLast = i - lastPivot.index;
                const movePct = swingPct * 100;
                const formattedTime = new Date(currentCandle.time).toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'medium' });

                console.log(`${colors.red}${pivotCounter}.[PIVOT] LOW  @ ${currentCandle.low.toFixed(2)} | Time: ${formattedTime} | Move: ${movePct.toFixed(2)}% | Bars: ${barsSinceLast}${colors.reset}`);
                
                lastPivot = { type: 'low', price: currentCandle.low, time: currentCandle.time, index: i };
            }
        }

        // Display the current candle, highlighting if it's a new pivot
                if (tradeConfig.showCandle) {
            displayCandleInfo(currentCandle, i + 1, pivotType);
        }
    }
    
    if (candles.length > 0) {
        const firstCandleTime = candles[0].time;
        const lastCandleTime = candles[candles.length - 1].time;
        const elapsedMs = lastCandleTime - firstCandleTime;

        const days = Math.floor(elapsedMs / (1000 * 60 * 60 * 24));
        const hours = Math.floor((elapsedMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((elapsedMs % (1000 * 60 * 60)) / (1000 * 60));
        
        console.log(`\nData Time Elapsed: ${days} days, ${hours} hours, ${minutes} minutes.`);
    }

    // --- Final Summary Calculation ---
    const firstPrice = candles[0].open;
    const highestHigh = Math.max(...candles.map(c => c.high));
    const lowestLow = Math.min(...candles.map(c => c.low));

    const totalUpwardChange = ((highestHigh - firstPrice) / firstPrice) * 100;
    const totalDownwardChange = ((lowestLow - firstPrice) / firstPrice) * 100;
    const netPriceRange = ((highestHigh - lowestLow) / lowestLow) * 100;

    const totalPivots = highPivotCount + lowPivotCount;
    if (totalPivots > 0) {
        const highPct = ((highPivotCount / totalPivots) * 100).toFixed(2);
        const lowPct = ((lowPivotCount / totalPivots) * 100).toFixed(2);
        console.log(`\n${colors.cyan}--- Pivot Summary ---${colors.reset}`);
        console.log(`${colors.green}High Pivots: ${highPivotCount.toString().padStart(2)} (${highPct}%)${colors.reset}`);
        console.log(`${colors.red}Low Pivots:  ${lowPivotCount.toString().padStart(2)} (${lowPct}%)${colors.reset}`);
        console.log(`Total Pivots: ${totalPivots}`);
    }

    console.log(`\n${colors.cyan}--- Market Movement Summary ---${colors.reset}`);
    console.log(`Max Upward Move: ${colors.green}+${totalUpwardChange.toFixed(2)}%${colors.reset} (from start to ATH)`);
    console.log(`Max Downward Move: ${colors.red}${totalDownwardChange.toFixed(2)}%${colors.reset} (from start to ATL)`);
    console.log(`Net Price Range: ${colors.yellow}${netPriceRange.toFixed(2)}%${colors.reset} (from ATL to ATH)`);

    console.log(`\n${colors.cyan}--- Test Complete ---${colors.reset}`);
}

(async () => {
    try {
        await runTest();
    } catch (err) {
        console.error('\nAn error occurred during the test:', err);
        process.exit(1);
    }
})();
