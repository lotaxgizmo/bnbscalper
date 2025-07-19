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
        // Use full limit if it's larger than what we have
        const existingCount = existingData.metadata.candles.length;
        if (limit > existingCount) {
            fetchLimit = limit;
            console.log(`Requested ${limit} candles which is more than existing ${existingCount} candles`);
            console.log(`Fetching full ${limit} candles...`);
        } else {
            // Only fetch new candles since last update
            fetchLimit = Math.ceil((Date.now() - lastKnownTime) / parseFloat(interval) / 60000);
            console.log(`Last known candle time: ${new Date(lastKnownTime).toISOString()}`);
            console.log(`Fetching ${fetchLimit} new candles...`);
        }
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
        console.log(`Loading ${existingData.pivots.length} existing pivots...`);
        const batchSize = 1000;
        for (let i = 0; i < existingData.pivots.length; i += batchSize) {
            const batch = existingData.pivots.slice(i, i + batchSize);
            for (const pivot of batch) {
                tracker.addExistingPivot(pivot);
            }
            if ((i + batchSize) % 10000 === 0) {
                console.log(`Loaded ${i + batchSize} pivots...`);
            }
        }
        
        // Find the time range of existing data
        let oldestExisting = Infinity;
        let newestExisting = -Infinity;
        
        // Process existing candles in batches
        console.log(`Processing ${existingData.metadata.candles.length} existing candles...`);
        for (let i = 0; i < existingData.metadata.candles.length; i += batchSize) {
            const batch = existingData.metadata.candles.slice(i, i + batchSize);
            for (const candle of batch) {
                if (candle.time < oldestExisting) oldestExisting = candle.time;
                if (candle.time > newestExisting) newestExisting = candle.time;
            }
            if ((i + batchSize) % 10000 === 0) {
                console.log(`Processed ${i + batchSize} candles...`);
            }
        }
        
        // Filter and sort new candles in batches
        const newCandles = [];
        console.log(`Filtering ${candles.length} new candles...`);
        for (let i = 0; i < candles.length; i += batchSize) {
            const batch = candles.slice(i, i + batchSize);
            for (const candle of batch) {
                if (candle.time < oldestExisting || candle.time > newestExisting) {
                    newCandles.push(candle);
                }
            }
            if ((i + batchSize) % 10000 === 0) {
                console.log(`Filtered ${i + batchSize} candles...`);
            }
        }
        
        console.log(`Existing data range: ${new Date(oldestExisting).toISOString()} to ${new Date(newestExisting).toISOString()}`);
        console.log(`Found ${newCandles.length} new candles to process`);
        
        // Sort to ensure chronological processing
        console.log('Sorting new candles...');
        newCandles.sort((a, b) => a.time - b.time);
        
        // Process new candles in batches
        console.log('Processing new candles...');
        for (let i = 0; i < newCandles.length; i += batchSize) {
            const batch = newCandles.slice(i, i + batchSize);
            for (const candle of batch) {
                const pivot = tracker.update(candle);
                if (pivot) pivots.push(pivot);
            }
            if ((i + batchSize) % 10000 === 0) {
                console.log(`Processed ${i + batchSize} new candles...`);
            }
        }
    } else {
        // Process all candles for new data in batches
        console.log(`Processing ${candles.length} candles for new data...`);
        const batchSize = 1000;
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
