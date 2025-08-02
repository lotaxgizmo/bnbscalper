# Issue 38: Trade Size Parameter Change for Multiple Concurrent Trades

**Date:** August 1, 2025

**Problem:** When implementing multiple concurrent trades, the `createTrade()` function signature needed to be modified to accept a specific trade size rather than calculating it from total capital.

**Root Cause:** The original implementation calculated trade size internally based on capital and riskPerTrade percentage:

```javascript
// Original implementation - calculated size from capital
const createTrade = (type, currentCandle, pivotData, i, capital, tradeConfig) => {
    const size = capital * (tradeConfig.riskPerTrade / 100);
    // Rest of function...
};
```

With multiple concurrent trades, this approach wouldn't work because:
1. Trade size calculation needs to consider remaining available capital
2. Different sizing modes (percentage vs fixed) require different calculations
3. Size calculation must occur at the trade opening decision point where available capital is checked

**Fix:** Modified the function to accept the pre-calculated trade size directly:

```javascript
// New implementation - accepts pre-calculated size
const createTrade = (type, currentCandle, pivotData, i, tradeSize, tradeConfig) => {
    const size = tradeSize; // Use provided size directly
    // Rest of function...
};
```

And at call sites, we calculate the appropriate size before calling createTrade:

```javascript
// Size calculation at call site with multiple trade support
let tradeSize = 0;
if (tradeConfig.positionSizingMode === 'fixed' && tradeConfig.amountPerTrade) {
    // Use fixed amount, but check against available capital
    tradeSize = Math.min(tradeConfig.amountPerTrade, availableCapital);
} else {
    // Use percentage of total capital (default mode)
    tradeSize = availableCapital * (tradeConfig.riskPerTrade / 100);
}

// Only open trade if we have enough capital
if (tradeSize > 0) {
    const trade = createTrade('long', candles[i], lastPivot, i, tradeSize, tradeConfig);
    openTrades.push(trade);
    // Rest of code...
}
```
