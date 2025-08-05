// checkPivotFormat.js
// A simple script to check the pivot data format used in the backtest

import fs from 'fs';

// Load the enhanced pivot data
const pivotFile = 'data/pivots/BTCUSDT_1m_enhanced_0.3_6_50_4.json';
const pivotData = JSON.parse(fs.readFileSync(pivotFile, 'utf8'));

// Check the first few pivots
console.log(`Loaded ${pivotData.pivots.length} pivots from ${pivotFile}`);
console.log('\nFirst pivot structure:');
console.log(JSON.stringify(pivotData.pivots[0], null, 2));

// Check if pivots have the expected properties for enhanced format
const hasEnhancedFormat = pivotData.pivots.some(pivot => 
  pivot.confirmationTime && pivot.time && 
  pivot.extremeCandle && pivot.confirmationCandle
);

console.log(`\nPivots have enhanced format: ${hasEnhancedFormat}`);

// Check a sample of pivots to verify their structure
console.log('\nSampling 5 random pivots to check their structure:');
for (let i = 0; i < 5; i++) {
  const randomIndex = Math.floor(Math.random() * pivotData.pivots.length);
  const pivot = pivotData.pivots[randomIndex];
  console.log(`\nPivot #${randomIndex} (${pivot.type.toUpperCase()}):`);
  console.log(`- Price: ${pivot.price}`);
  console.log(`- Extreme Time: ${new Date(pivot.time * 1000).toLocaleString()}`);
  console.log(`- Confirmation Time: ${pivot.confirmationTime ? new Date(pivot.confirmationTime).toLocaleString() : 'N/A'}`);
  console.log(`- Has extremeCandle: ${!!pivot.extremeCandle}`);
  console.log(`- Has confirmationCandle: ${!!pivot.confirmationCandle}`);
}
