// Simple test version to debug the optimizer issue

console.log('Script starting...');
console.log('import.meta.url:', import.meta.url);
console.log('process.argv[1]:', process.argv[1]);
console.log('Comparison:', import.meta.url === `file://${process.argv[1]}`);

// Test the condition that should trigger execution
if (import.meta.url === `file://${process.argv[1]}`) {
    console.log('Main execution block triggered!');
    
    // Simple test function
    async function testRun() {
        try {
            console.log('Test function running...');
            
            // Test parameter generation
            const testConfig = {
                takeProfitRange: { start: 0.9, end: 0.9, step: 0.1 },
                stopLossRange: { start: 0.4, end: 0.4, step: 0.1 },
                leverageRange: { start: 1, end: 1, step: 1 },
                minimumTimeframes: 1,
                tradingModes: ['pivot'],
                maxCandles: 20160,
                timeframeCombinations: [[{
                    interval: '4h',
                    role: 'primary',
                    minSwingPctRange: { start: 0, end: 0.01, step: 0.01 }, // Just 2 values for test
                    lookbackRange: { start: 1, end: 1, step: 1 },
                    minLegBarsRange: { start: 1, end: 1, step: 1 },
                    weight: 1,
                    oppositeRange: [false]
                }]]
            };
            
            console.log('Generating test combinations...');
            
            // Simple combination generation
            const combinations = [];
            for (let tp = testConfig.takeProfitRange.start; tp <= testConfig.takeProfitRange.end; tp += testConfig.takeProfitRange.step) {
                for (let sl = testConfig.stopLossRange.start; sl <= testConfig.stopLossRange.end; sl += testConfig.stopLossRange.step) {
                    for (let lev = testConfig.leverageRange.start; lev <= testConfig.leverageRange.end; lev += testConfig.leverageRange.step) {
                        for (let swing = 0; swing <= 0.01; swing += 0.01) {
                            combinations.push({
                                takeProfit: tp,
                                stopLoss: sl,
                                leverage: lev,
                                tradingMode: 'pivot',
                                timeframes: [{
                                    interval: '4h',
                                    role: 'primary',
                                    minSwingPct: swing,
                                    lookback: 1,
                                    minLegBars: 1,
                                    weight: 1,
                                    opposite: false
                                }],
                                maxCandles: testConfig.maxCandles,
                                minimumTimeframes: testConfig.minimumTimeframes
                            });
                        }
                    }
                }
            }
            
            console.log(`Generated ${combinations.length} test combinations`);
            console.log('First combination:', JSON.stringify(combinations[0], null, 2));
            
            // Test worker import
            console.log('Testing worker import...');
            const { Worker } = await import('worker_threads');
            console.log('Worker imported successfully');
            
            console.log('Test completed successfully!');
            
        } catch (error) {
            console.error('Test failed:', error.message);
            console.error('Stack:', error.stack);
        }
    }
    
    testRun().catch(console.error);
} else {
    console.log('Main execution block NOT triggered');
    console.log('This means the script was imported, not executed directly');
}

console.log('Script end reached');
