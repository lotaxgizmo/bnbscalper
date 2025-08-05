// Test script to verify position sizing modes
import { tradeConfig } from './config/tradeconfig.js';

console.log('=== Position Sizing Mode Test ===\n');

// Test scenarios
const testScenarios = [
    { capital: 1000, mode: 'percent', riskPerTrade: 10, minimumTradeAmount: 100, amountPerTrade: 150 },
    { capital: 900, mode: 'percent', riskPerTrade: 10, minimumTradeAmount: 100, amountPerTrade: 150 },
    { capital: 500, mode: 'percent', riskPerTrade: 10, minimumTradeAmount: 100, amountPerTrade: 150 },
    { capital: 1000, mode: 'minimum', riskPerTrade: 10, minimumTradeAmount: 100, amountPerTrade: 150 },
    { capital: 900, mode: 'minimum', riskPerTrade: 10, minimumTradeAmount: 100, amountPerTrade: 150 },
    { capital: 500, mode: 'minimum', riskPerTrade: 10, minimumTradeAmount: 100, amountPerTrade: 150 },
    { capital: 1000, mode: 'fixed', riskPerTrade: 10, minimumTradeAmount: 100, amountPerTrade: 150 },
    { capital: 900, mode: 'fixed', riskPerTrade: 10, minimumTradeAmount: 100, amountPerTrade: 150 },
    { capital: 500, mode: 'fixed', riskPerTrade: 10, minimumTradeAmount: 100, amountPerTrade: 150 },
];

// Position sizing logic (copied from pivotBacktester.js)
function calculateTradeSize(availableCapital, config) {
    let tradeSize = 0;
    
    if (config.mode === 'fixed' && config.amountPerTrade) {
        // Use fixed amount, but check against available capital
        tradeSize = Math.min(config.amountPerTrade, availableCapital);
    } else if (config.mode === 'minimum' && config.minimumTradeAmount) {
        // Use percentage of available capital, but enforce minimum amount
        const percentageAmount = availableCapital * (config.riskPerTrade / 100);
        tradeSize = Math.max(percentageAmount, Math.min(config.minimumTradeAmount, availableCapital));
    } else {
        // Use percentage of available capital (default 'percent' mode)
        tradeSize = availableCapital * (config.riskPerTrade / 100);
    }
    
    return tradeSize;
}

console.log('Capital | Mode     | Risk% | MinAmt | FixedAmt | Trade Size | Explanation');
console.log('--------|----------|-------|--------|----------|------------|-------------');

testScenarios.forEach(scenario => {
    const tradeSize = calculateTradeSize(scenario.capital, {
        mode: scenario.mode,
        riskPerTrade: scenario.riskPerTrade,
        minimumTradeAmount: scenario.minimumTradeAmount,
        amountPerTrade: scenario.amountPerTrade
    });
    
    let explanation = '';
    if (scenario.mode === 'percent') {
        explanation = `${scenario.riskPerTrade}% of ${scenario.capital}`;
    } else if (scenario.mode === 'minimum') {
        const percentageAmount = scenario.capital * (scenario.riskPerTrade / 100);
        if (percentageAmount >= scenario.minimumTradeAmount) {
            explanation = `${scenario.riskPerTrade}% of ${scenario.capital} (above min)`;
        } else {
            explanation = `Minimum ${scenario.minimumTradeAmount} enforced`;
        }
    } else if (scenario.mode === 'fixed') {
        explanation = `Fixed ${scenario.amountPerTrade} (or available)`;
    }
    
    console.log(
        `${scenario.capital.toString().padStart(7)} | ` +
        `${scenario.mode.padEnd(8)} | ` +
        `${scenario.riskPerTrade.toString().padStart(5)}% | ` +
        `${scenario.minimumTradeAmount.toString().padStart(6)} | ` +
        `${scenario.amountPerTrade.toString().padStart(8)} | ` +
        `${tradeSize.toFixed(2).padStart(10)} | ` +
        `${explanation}`
    );
});

console.log('\n=== Current Configuration ===');
console.log(`Mode: ${tradeConfig.positionSizingMode}`);
console.log(`Risk Per Trade: ${tradeConfig.riskPerTrade}%`);
console.log(`Minimum Trade Amount: ${tradeConfig.minimumTradeAmount} USDT`);
console.log(`Fixed Amount Per Trade: ${tradeConfig.amountPerTrade} USDT`);
console.log(`Initial Capital: ${tradeConfig.initialCapital} USDT`);

// Test with current config
const currentTradeSize = calculateTradeSize(tradeConfig.initialCapital, {
    mode: tradeConfig.positionSizingMode,
    riskPerTrade: tradeConfig.riskPerTrade,
    minimumTradeAmount: tradeConfig.minimumTradeAmount,
    amountPerTrade: tradeConfig.amountPerTrade
});

console.log(`\nWith current config and ${tradeConfig.initialCapital} USDT capital:`);
console.log(`Trade Size: ${currentTradeSize.toFixed(2)} USDT`);
