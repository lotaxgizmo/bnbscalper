// testEdgeDetection.js
import { symbol, time as interval, limit, api, delay } from '../config/config.js';
import { fetchCandles } from '../utils/candleAnalytics.js';
import EdgeDetector from '../utils/edgeDetector.js';
import { saveEdgeData, getEdgeData } from '../utils/edgeCache.js';

async function testEdgeDetection() {
    console.log('\n▶ Testing Edge Detection System\n');
    
    // 1. Fetch recent candles
    console.log(`Fetching ${limit} candles for ${symbol}...`);
    const candles = await fetchCandles(symbol, interval, limit, api, delay);
    
    if (!candles.length) {
        console.error('❌ No candles fetched. Exiting.');
        process.exit(1);
    }
    
    console.log(`✅ Fetched ${candles.length} candles\n`);

    // 2. Initialize edge detector
    const detector = new EdgeDetector();
    
    // 3. Analyze current market position
    const analysis = detector.analyze(candles);
    
    // 4. Display results
    console.log('Edge Analysis Results:');
    console.log('-'.repeat(50));
    
    // Movement percentages
    console.log('\nMarket Movements:');
    Object.entries(analysis.details.moves).forEach(([timeframe, move]) => {
        console.log(`${timeframe.padEnd(8)}: ${move.toFixed(2)}%`);
    });
    
    // Edge conditions
    console.log('\nEdge Conditions:');
    Object.entries(analysis.details.edges).forEach(([timeframe, isEdge]) => {
        const status = isEdge ? '🔴 EDGE' : '🟢 Normal';
        console.log(`${timeframe.padEnd(8)}: ${status}`);
    });
    
    // Overall status
    console.log('\nOverall Status:');
    console.log(`Edge Count: ${analysis.details.edgeCount}`);
    console.log(`Final Result: ${analysis.isEdge ? '🚨 AT EDGE' : '✅ NOT AT EDGE'}\n`);
    
    // 5. Cache the results
    saveEdgeData(symbol, interval, analysis);
    console.log('Edge data cached successfully');
    
    // 6. Verify cache
    const cached = getEdgeData(symbol, interval);
    console.log('\nCache Verification:');
    console.log(`Cached at: ${new Date(cached.lastUpdate).toLocaleString()}`);
    console.log(`Cache matches: ${JSON.stringify(cached.edgeData) === JSON.stringify(analysis)}`);
}

// Run the test
console.log('Starting edge detection test...');
testEdgeDetection().catch(console.error);
