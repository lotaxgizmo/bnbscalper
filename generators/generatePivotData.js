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
import { savePivotData, loadPivotData } from '../utils/pivotCache.js';

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

    // Check for existing data with same settings
    const existingData = loadPivotData(symbol, interval, pivotConfig);
    
    // 1. Fetch candles
    console.log('Fetching candles...');
    
    // If we have existing data, only fetch what we need
    let fetchLimit = limit;
    let lastKnownTime = null;
    
    if (existingData?.metadata?.candles?.length > 0) {
        const lastCandle = existingData.metadata.candles[existingData.metadata.candles.length - 1];
        lastKnownTime = lastCandle.time;
        // Only fetch new candles since last update
        fetchLimit = Math.min(limit, Math.ceil((Date.now() - lastKnownTime) / parseFloat(interval) / 60000));
        console.log(`Last known candle time: ${new Date(lastKnownTime).toISOString()}`);
        console.log(`Fetching ${fetchLimit} new candles...`);
    } else {
        console.log(`Fetching full history (${limit} candles)...`);
    }

    const candles = await fetchCandles(symbol, interval, fetchLimit, api, delay);
    console.log(`Fetched ${candles.length} candles (requested=${fetchLimit}).`);

    if (!candles.length) {
        console.error('❌ No candles fetched. Exiting.');
        process.exit(1);
    }

    // 2. Process candles and detect pivots
    console.log('\nProcessing candles for pivot detection...');
    const tracker = new PivotTracker(pivotConfig);
    const pivots = [];

    // If we have existing data with same settings, use it as starting point
    if (existingData) {
        console.log('Found existing pivot data with matching settings');
        console.log('Updating existing data...');
        
        // Initialize tracker with existing pivots
        for (const pivot of existingData.pivots) {
            tracker.addExistingPivot(pivot);
        }
        
        // Only process new candles that aren't in existing data
        const existingCandles = new Set(existingData.metadata.candles.map(c => c.time));
        const newCandles = candles.filter(c => !existingCandles.has(c.time));
        
        console.log(`Found ${newCandles.length} new candles to process`);
        
        for (const candle of newCandles) {
            const pivot = tracker.update(candle);
            if (pivot) pivots.push(pivot);
        }
    } else {
        // Process all candles for new data
        for (const candle of candles) {
            const pivot = tracker.update(candle);
            if (pivot) pivots.push(pivot);
        }
    }

    const finalPivots = existingData ? [...existingData.pivots, ...pivots] : pivots;
    console.log(`Total pivots: ${finalPivots.length} (${pivots.length} new)`);

    // 3. Save pivot data
    console.log('\nSaving pivot data to cache...');
    savePivotData(symbol, interval, finalPivots, pivotConfig, { 
        candles,
        generatedAt: Date.now(),
        lastUpdate: Date.now()
    });

    console.log('\n✅ Pivot data generation complete!');
    console.log('You can now run backtest.js to use this cached data');
}

// Run the generator
generatePivotData().catch(console.error);
