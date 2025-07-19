// generatePivotData.js
import {
    api,
    time as interval,
    symbol,
    limit,
    minSwingPct,
    shortWindow,
    longWindow,
    confirmOnClose,
    minLegBars,
    delay
} from '../config/config.js';

import PivotTracker from '../utils/pivotTracker.js';
import { fetchCandles } from '../utils/candleAnalytics.js';
import { savePivotData } from '../utils/pivotCache.js';

async function generatePivotData() {
    console.log(`\n▶ Generating Pivot Data for ${symbol} [${interval}] using ${api}\n`);

    // Configuration for pivot detection
    const pivotConfig = {
        minSwingPct,
        shortWindow,
        longWindow,
        confirmOnClose,
        minLegBars
    };

    console.log('Pivot Settings:');
    console.log(`- Min Swing: ${minSwingPct}%`);
    console.log(`- Short Window: ${shortWindow} candles`);
    console.log(`- Long Window: ${longWindow} candles`);
    console.log(`- Confirm on Close: ${confirmOnClose}`);
    console.log(`- Min Leg Bars: ${minLegBars}\n`);

    // 1. Fetch candles
    console.log(`Fetching full history (${limit} candles)...`);
    const candles = await fetchCandles(symbol, interval, limit, api, delay);
    console.log(`Fetched ${candles.length} candles.`);

    if (!candles.length) {
        console.error('❌ No candles fetched. Exiting.');
        process.exit(1);
    }

    // 2. Process candles and detect pivots
    console.log('\nProcessing candles for pivot detection...');
    const tracker = new PivotTracker(pivotConfig);
    const pivots = [];

    // Process all candles in batches
    const batchSize = 1000;
    console.log(`Processing ${candles.length} candles...`);
    
    // Sort to ensure chronological processing
    candles.sort((a, b) => a.time - b.time);
    
    for (let i = 0; i < candles.length; i += batchSize) {
        const batch = candles.slice(i, i + batchSize);
        for (const candle of batch) {
            const pivot = tracker.update(candle);
            if (pivot) pivots.push(pivot);
        }
        if ((i + batchSize) % 10000 === 0) {
            console.log(`Processed ${i + batchSize} candles...`);
        }
    }

    console.log(`Total pivots found: ${pivots.length}`);

    // 3. Save pivot data
    console.log('\nSaving pivot data to cache...');
    savePivotData(symbol, interval, pivots, pivotConfig, { 
        candles,
        generatedAt: Date.now(),
        lastUpdate: Date.now()
    });

    console.log('\n✅ Pivot data generation complete!');
    console.log('You can now run backtest.js to use this cached data');
}

// Run the generator
generatePivotData().catch(console.error);
