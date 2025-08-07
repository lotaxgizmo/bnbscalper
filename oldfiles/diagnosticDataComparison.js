// diagnosticDataComparison.js
// Compare candle data between CSV and API sources to identify differences

import {
    symbol,
    time as interval,
    limit
} from '../config/config.js';

import { getCandles } from '../apis/bybit.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CSV_DATA_FILE = path.join(__dirname, 'data', 'historical', symbol, `${interval}.csv`);

// Function to load candles from CSV (simplified version)
const loadCandlesFromCSV = (filePath, candleLimit) => {
    try {
        if (!fs.existsSync(filePath)) {
            console.error(`CSV file not found: ${filePath}`);
            return [];
        }
        
        const fileContent = fs.readFileSync(filePath, 'utf8');
        const lines = fileContent
            .split('\n')
            .map(line => line.trim())
            .filter(line => line && line !== 'timestamp,open,high,low,close,volume');
        
        let candles = [];
        
        for (const line of lines) {
            const [time, open, high, low, close, volume] = line.split(',');
            
            const candle = {
                time: parseInt(time),
                open: parseFloat(open),
                high: parseFloat(high),
                low: parseFloat(low),
                close: parseFloat(close),
                volume: parseFloat(volume || '0')
            };
            
            if (!isNaN(candle.time) && !isNaN(candle.open) && !isNaN(candle.high) && !isNaN(candle.low) && !isNaN(candle.close)) {
                candles.push(candle);
            }
        }
        
        // Sort chronologically and take the most recent candles
        candles.sort((a, b) => a.time - b.time);
        if (candleLimit > 0 && candles.length > candleLimit) {
            candles = candles.slice(-candleLimit);
        }
        
        return candles;
    } catch (error) {
        console.error('Error reading CSV candles:', error);
        return [];
    }
};

async function compareData() {
    console.log('=== CANDLE DATA COMPARISON ===\n');
    
    // Load CSV data
    console.log('Loading CSV data...');
    const csvCandles = loadCandlesFromCSV(CSV_DATA_FILE, limit);
    console.log(`CSV: Loaded ${csvCandles.length} candles`);
    
    // Load API data
    console.log('Loading API data...');
    const apiCandles = await getCandles(symbol, interval, limit);
    console.log(`API: Loaded ${apiCandles.length} candles`);
    
    if (csvCandles.length === 0 || apiCandles.length === 0) {
        console.error('Failed to load data from one or both sources');
        return;
    }
    
    // Compare time ranges
    console.log('\n=== TIME RANGE COMPARISON ===');
    console.log(`CSV First: ${new Date(csvCandles[0].time).toLocaleString()}`);
    console.log(`CSV Last:  ${new Date(csvCandles[csvCandles.length - 1].time).toLocaleString()}`);
    console.log(`API First: ${new Date(apiCandles[0].time).toLocaleString()}`);
    console.log(`API Last:  ${new Date(apiCandles[apiCandles.length - 1].time).toLocaleString()}`);
    
    // Find overlapping time period
    const csvStart = csvCandles[0].time;
    const csvEnd = csvCandles[csvCandles.length - 1].time;
    const apiStart = apiCandles[0].time;
    const apiEnd = apiCandles[apiCandles.length - 1].time;
    
    const overlapStart = Math.max(csvStart, apiStart);
    const overlapEnd = Math.min(csvEnd, apiEnd);
    
    console.log(`\nOverlap Start: ${new Date(overlapStart).toLocaleString()}`);
    console.log(`Overlap End:   ${new Date(overlapEnd).toLocaleString()}`);
    
    if (overlapStart >= overlapEnd) {
        console.log('\n❌ NO OVERLAP FOUND - This explains the different pivots!');
        console.log('CSV and API data are from completely different time periods.');
        return;
    }
    
    // Find overlapping candles
    const csvOverlap = csvCandles.filter(c => c.time >= overlapStart && c.time <= overlapEnd);
    const apiOverlap = apiCandles.filter(c => c.time >= overlapStart && c.time <= overlapEnd);
    
    console.log(`\nOverlapping candles: CSV=${csvOverlap.length}, API=${apiOverlap.length}`);
    
    // Compare first 10 overlapping candles
    console.log('\n=== FIRST 10 OVERLAPPING CANDLES ===');
    const compareCount = Math.min(10, csvOverlap.length, apiOverlap.length);
    
    for (let i = 0; i < compareCount; i++) {
        const csvCandle = csvOverlap[i];
        const apiCandle = apiOverlap.find(c => c.time === csvCandle.time);
        
        if (!apiCandle) {
            console.log(`❌ Missing API candle for time: ${new Date(csvCandle.time).toLocaleString()}`);
            continue;
        }
        
        const timeStr = new Date(csvCandle.time).toLocaleString();
        console.log(`\n${i + 1}. ${timeStr}`);
        console.log(`   CSV: O=${csvCandle.open} H=${csvCandle.high} L=${csvCandle.low} C=${csvCandle.close}`);
        console.log(`   API: O=${apiCandle.open} H=${apiCandle.high} L=${apiCandle.low} C=${apiCandle.close}`);
        
        // Check for differences
        const tolerance = 0.01; // Allow small floating point differences
        const openDiff = Math.abs(csvCandle.open - apiCandle.open);
        const highDiff = Math.abs(csvCandle.high - apiCandle.high);
        const lowDiff = Math.abs(csvCandle.low - apiCandle.low);
        const closeDiff = Math.abs(csvCandle.close - apiCandle.close);
        
        if (openDiff > tolerance || highDiff > tolerance || lowDiff > tolerance || closeDiff > tolerance) {
            console.log(`   ❌ DIFFERENCE DETECTED!`);
            if (openDiff > tolerance) console.log(`      Open diff: ${openDiff.toFixed(4)}`);
            if (highDiff > tolerance) console.log(`      High diff: ${highDiff.toFixed(4)}`);
            if (lowDiff > tolerance) console.log(`      Low diff: ${lowDiff.toFixed(4)}`);
            if (closeDiff > tolerance) console.log(`      Close diff: ${closeDiff.toFixed(4)}`);
        } else {
            console.log(`   ✅ Match`);
        }
    }
    
    // Summary
    console.log('\n=== SUMMARY ===');
    if (csvEnd < apiStart || apiEnd < csvStart) {
        console.log('❌ PROBLEM: CSV and API data are from different time periods');
        console.log('   This explains why pivot detection results are different.');
        console.log('   The CSV file needs to be updated with more recent data.');
    } else {
        console.log('✅ Data sources have overlapping time periods');
        console.log('   Differences in pivots may be due to data precision or processing order.');
    }
}

// Run the comparison
(async () => {
    try {
        await compareData();
    } catch (err) {
        console.error('Error during comparison:', err);
        process.exit(1);
    }
})();
