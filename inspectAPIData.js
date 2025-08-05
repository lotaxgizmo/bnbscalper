// inspectAPIData.js
// Inspect the exact API data being returned to identify pivot detection issues

import {
    symbol,
    time as interval,
    limit
} from './config/config.js';

import { getCandles } from './apis/bybit.js';

async function inspectAPIData() {
    console.log('=== API DATA INSPECTION ===\n');
    
    // Fetch API data
    console.log('Fetching API data...');
    const apiCandles = await getCandles(symbol, interval, limit);
    console.log(`Fetched ${apiCandles.length} candles from API`);
    
    if (apiCandles.length === 0) {
        console.error('No API data received');
        return;
    }
    
    // Check data integrity
    console.log('\n=== DATA INTEGRITY CHECK ===');
    console.log(`First candle: ${new Date(apiCandles[0].time).toLocaleString()}`);
    console.log(`Last candle:  ${new Date(apiCandles[apiCandles.length - 1].time).toLocaleString()}`);
    
    // Check for gaps in timestamps
    let gaps = 0;
    const expectedInterval = 60 * 1000; // 1 minute in milliseconds
    
    for (let i = 1; i < Math.min(100, apiCandles.length); i++) {
        const timeDiff = apiCandles[i].time - apiCandles[i-1].time;
        if (timeDiff !== expectedInterval) {
            gaps++;
            if (gaps <= 5) { // Show first 5 gaps
                console.log(`Gap detected: ${new Date(apiCandles[i-1].time).toLocaleString()} -> ${new Date(apiCandles[i].time).toLocaleString()} (${timeDiff/1000}s)`);
            }
        }
    }
    
    if (gaps > 0) {
        console.log(`❌ Found ${gaps} timestamp gaps in first 100 candles`);
    } else {
        console.log(`✅ No timestamp gaps found in first 100 candles`);
    }
    
    // Check sorting
    let sortingIssues = 0;
    for (let i = 1; i < apiCandles.length; i++) {
        if (apiCandles[i].time <= apiCandles[i-1].time) {
            sortingIssues++;
            if (sortingIssues <= 3) {
                console.log(`Sorting issue: ${new Date(apiCandles[i-1].time).toLocaleString()} -> ${new Date(apiCandles[i].time).toLocaleString()}`);
            }
        }
    }
    
    if (sortingIssues > 0) {
        console.log(`❌ Found ${sortingIssues} sorting issues`);
    } else {
        console.log(`✅ Data is properly sorted chronologically`);
    }
    
    // Show first 10 candles
    console.log('\n=== FIRST 10 CANDLES ===');
    for (let i = 0; i < Math.min(10, apiCandles.length); i++) {
        const c = apiCandles[i];
        const timeStr = new Date(c.time).toLocaleString();
        console.log(`${i+1}. ${timeStr} | O:${c.open} H:${c.high} L:${c.low} C:${c.close}`);
    }
    
    // Show last 10 candles
    console.log('\n=== LAST 10 CANDLES ===');
    const start = Math.max(0, apiCandles.length - 10);
    for (let i = start; i < apiCandles.length; i++) {
        const c = apiCandles[i];
        const timeStr = new Date(c.time).toLocaleString();
        console.log(`${i+1}. ${timeStr} | O:${c.open} H:${c.high} L:${c.low} C:${c.close}`);
    }
    
    // Check for duplicate timestamps
    const timeSet = new Set();
    let duplicates = 0;
    for (const candle of apiCandles) {
        if (timeSet.has(candle.time)) {
            duplicates++;
        } else {
            timeSet.add(candle.time);
        }
    }
    
    if (duplicates > 0) {
        console.log(`❌ Found ${duplicates} duplicate timestamps`);
    } else {
        console.log(`✅ No duplicate timestamps found`);
    }
    
    // Check data precision
    console.log('\n=== DATA PRECISION CHECK ===');
    const sampleCandle = apiCandles[Math.floor(apiCandles.length / 2)];
    console.log(`Sample candle precision:`);
    console.log(`  Open: ${sampleCandle.open} (${sampleCandle.open.toString().split('.')[1]?.length || 0} decimals)`);
    console.log(`  High: ${sampleCandle.high} (${sampleCandle.high.toString().split('.')[1]?.length || 0} decimals)`);
    console.log(`  Low: ${sampleCandle.low} (${sampleCandle.low.toString().split('.')[1]?.length || 0} decimals)`);
    console.log(`  Close: ${sampleCandle.close} (${sampleCandle.close.toString().split('.')[1]?.length || 0} decimals)`);
}

// Run the inspection
(async () => {
    try {
        await inspectAPIData();
    } catch (err) {
        console.error('Error during inspection:', err);
        process.exit(1);
    }
})();
