// testPivotDisplay.js
// A script to test the pivot display format in the EdgeConsoleLogger

import fs from 'fs';
import { EdgeConsoleLogger } from './utils/backtest/edgeConsoleLogger.js';
import { formatDateTime } from './utils/candleAnalytics.js';

// Load the enhanced pivot data
const pivotFile = 'data/pivots/BTCUSDT_1m_enhanced_0.3_6_50_4.json';
const pivotData = JSON.parse(fs.readFileSync(pivotFile, 'utf8'));

console.log(`Loaded ${pivotData.pivots.length} pivots from ${pivotFile}`);

// Create an instance of EdgeConsoleLogger
const logger = new EdgeConsoleLogger({
  showCandle: true,
  showPivot: true,
  showTrade: true,
  showEdge: true,
  performanceMode: false
});

// Sample a few pivots to display
console.log('\n--- PIVOT DISPLAY TEST ---');
const sampleSize = 5;
const sampleIndices = Array.from({length: sampleSize}, () => 
  Math.floor(Math.random() * pivotData.pivots.length));

for (const index of sampleIndices) {
  const pivot = pivotData.pivots[index];
  
  console.log(`\n--- PIVOT #${index} (${pivot.type.toUpperCase()}) ---`);
  
  // Display raw pivot data for debugging
  console.log('Raw pivot data:');
  console.log(`- Price: ${pivot.price}`);
  console.log(`- time: ${pivot.time} (${typeof pivot.time})`);
  console.log(`- confirmationTime: ${pivot.confirmationTime} (${typeof pivot.confirmationTime})`);
  console.log(`- extremeCandle: ${pivot.extremeCandle ? 'present' : 'missing'}`);
  console.log(`- confirmationCandle: ${pivot.confirmationCandle ? 'present' : 'missing'}`);
  
  // Display formatted times for comparison
  console.log('\nFormatted timestamps:');
  console.log(`- Extreme time (new Date): ${new Date(pivot.time).toLocaleString()}`);
  console.log(`- Confirmation time (new Date): ${pivot.confirmationTime ? new Date(pivot.confirmationTime).toLocaleString() : 'N/A'}`);
  console.log(`- Extreme time (formatDateTime): ${formatDateTime(pivot.time)}`);
  console.log(`- Confirmation time (formatDateTime): ${pivot.confirmationTime ? formatDateTime(pivot.confirmationTime) : 'N/A'}`);
  
  // Now use the EdgeConsoleLogger to display the pivot
  console.log('\nEdgeConsoleLogger output:');
  logger.logPivot(pivot, pivot.extremeCandle);
  
  // Display the same pivot in pivotTimestampTest.js format for comparison
  console.log('\npivotTimestampTest.js style output:');
  const extremeDate = new Date(pivot.time);
  const confirmDate = pivot.confirmationTime ? new Date(pivot.confirmationTime) : null;
  console.log(`Pivot #${index} (${pivot.type.toUpperCase()}): Extreme time: ${extremeDate.toLocaleString()}, Confirmation time: ${confirmDate ? confirmDate.toLocaleString() : 'N/A'}`);
}
