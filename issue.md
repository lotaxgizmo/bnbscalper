# Issues Log

## Excursion Calculations Resulting in NaN Due to Incorrect Price Property

### Issue:
Even after implementing excursion tracking, backtest diagnostics showed that excursion calculations were resulting in `NaN` (Not a Number). This was because the entry price being used for the calculation was `undefined`.

```
[Excursion Update] Side: BUY, Entry: undefined, High: 117246.8, Low: 117191.2, Favorable: NaN%, Adverse: NaN%
```

### Root Cause:
A typo was identified in `utils/backtest/tradeExecutor.js` within the `updateExcursions` method. The code was attempting to access `this.order.entryPrice`, a property that was never set. The correct property, which holds the price at which the order was filled, is `this.order.fillPrice`.

### Fix:
The property reference was corrected in `updateExcursions` to use `this.order.fillPrice`. This provided the correct entry price for the calculation, resolving the `NaN` issue and enabling accurate excursion tracking.

**Before:**
```javascript
// In utils/backtest/tradeExecutor.js
updateExcursions(candle) {
  if (!this.orderFilled) return;

  const entryPrice = this.order.entryPrice; // Incorrect property
  // ... calculation logic
}
```

**After:**
```javascript
// In utils/backtest/tradeExecutor.js
updateExcursions(candle) {
  if (!this.orderFilled) return;

  const entryPrice = this.order.fillPrice; // Correct property
  let favorableMove, adverseMove;

  if (this.order.side === 'buy') {
    favorableMove = ((candle.high - entryPrice) / entryPrice) * 100;
    adverseMove = ((entryPrice - candle.low) / entryPrice) * 100;
  } else { // 'sell'
    favorableMove = ((entryPrice - candle.low) / entryPrice) * 100;
    adverseMove = ((candle.high - entryPrice) / entryPrice) * 100;
  }

  if (favorableMove > this.maxFavorableExcursion) {
    this.maxFavorableExcursion = favorableMove;
  }
  if (adverseMove > this.maxAdverseExcursion) {
    this.maxAdverseExcursion = adverseMove;
  }
}
```

This change, combined with earlier refinements to the simulation loop, ensures that excursion data is now calculated correctly and reliably for all trades.


## Backtest summary showing NaN% for excursions and incorrect durations

### Issue:
The backtest final summary was displaying `NaN%` for all Favorable and Adverse Excursion statistics. Additionally, trade durations were not being calculated or formatted correctly, often showing '0 minutes' for trades that lasted hours or days.

### Root Cause:
1.  **Excursion `NaN%`**: The `TradeExecutor` class was responsible for simulating the trade, but it did not track the maximum price movements for or against the position (`maxFavorableExcursion` and `maxAdverseExcursion`). Consequently, the final trade objects passed to the `BacktestStats` module lacked these properties, causing the statistical calculations to result in `NaN`.
2.  **Incorrect Duration**: The `formatDuration` utility in `utils/formatters.js` was written to expect an input in minutes, but the duration passed from the `TradeExecutor` was in milliseconds. This mismatch led to incorrect formatting.

### Fix:
1.  **Implement Excursion Tracking**: The `TradeExecutor` was enhanced to track excursions. An `updateExcursions` method was added, and it is called for every candle after the trade is filled. The final excursion values are attached to the trade result.

    ```javascript
    // In TradeExecutor.js
    updateExcursions(currentCandle) {
      if (!this.orderFilled) return;

      let price = currentCandle.close;
      if (this.order.side === 'buy') {
        const favorableExcursion = ((price - this.order.entryPrice) / this.order.entryPrice) * 100;
        const adverseExcursion = ((this.order.entryPrice - price) / this.order.entryPrice) * 100;
        this.maxFavorableExcursion = Math.max(this.maxFavorableExcursion, favorableExcursion);
        this.maxAdverseExcursion = Math.max(this.maxAdverseExcursion, adverseExcursion); // Stays positive
      } else { // sell
        const favorableExcursion = ((this.order.entryPrice - price) / this.order.entryPrice) * 100;
        const adverseExcursion = ((price - this.order.entryPrice) / this.order.entryPrice) * 100;
        this.maxFavorableExcursion = Math.max(this.maxFavorableExcursion, favorableExcursion);
        this.maxAdverseExcursion = Math.max(this.maxAdverseExcursion, adverseExcursion);
      }
    }
    ```

2.  **Correct Duration Formatting**: The `formatDuration` function was rewritten to correctly process milliseconds and convert them into a human-readable string of days, hours, and minutes.

    ```javascript
    // In utils/formatters.js
    function formatDuration(ms) {
      if (ms < 0) ms = 0;
      const days = Math.floor(ms / (1000 * 60 * 60 * 24));
      const hours = Math.floor((ms % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));

      let parts = [];
      if (days > 0) parts.push(`${days} day${days > 1 ? 's' : ''}`);
      if (hours > 0) parts.push(`${hours} hour${hours > 1 ? 's' : ''}`);
      if (minutes > 0 || parts.length === 0) parts.push(`${minutes} minute${minutes > 1 ? 's' : ''}`);

      return parts.join(', ');
    }
    ```

3.  **Integrate into Backtest Loop**: The main backtest loop in `backtestWithExecutor.js` was updated to correctly pull the excursion data from the `tradeResult` and place it into the trade object used for statistical analysis.

    ```javascript
    // In backtestWithExecutor.js
    allTrades.push({
      entryTime: tradeResult.order.fillTime,
      entryPrice: tradeResult.order.fillPrice,
      exitTime: tradeResult.order.exitTime,
      exitPrice: tradeResult.order.exitPrice,
      side: tradeResult.order.side,
      pnl: pnlPercentage,
      duration: tradeResult.duration, // ms
      maxFavorableExcursion: tradeResult.maxFavorableExcursion,
      maxAdverseExcursion: tradeResult.maxAdverseExcursion,
      edges: pivot.edges, // Carry over the edge data from the pivot
      capitalBefore,
      capitalAfter,
      result: pnlAmount >= 0 ? 'WIN' : 'LOSS'
    });
    ```
This series of fixes ensures the backtest summary is now fully accurate.



## Edge calculation using wrong reference point

### Issue:
The edge calculation was using the wrong reference point and direction logic, causing inconsistent signs in the edge percentages:
- Used lowest price as reference instead of period start price
- Determined direction based on recent price action instead of position relative to reference
- Multiplied by arbitrary direction (-1/1) instead of using natural sign from calculation

### Before:
```javascript
const move = ((highCandle.high - lowCandle.low) / lowCandle.low) * 100;
const currentMove = ((currentPrice - lowCandle.low) / lowCandle.low) * 100;

const hourAgo = windowEnd - (60 * 60 * 1000);
const recentCandles = candles.filter(c => c.time >= hourAgo && c.time <= windowEnd);
const direction = recentCandles.length > 1 ? 
    (recentCandles[recentCandles.length-1].close > recentCandles[0].close ? 1 : -1) : 0;

move: parseFloat((direction * move).toFixed(2)),
position: parseFloat((direction * currentMove).toFixed(2))
```

## Test market orders had same weekly average edge

### Issue:
The test market orders in testLimitOrderEdgeData.js were being generated with even spacing across the entire candle dataset, causing most orders to have the same weekly average edge values:

```javascript
// Select random candles for market orders
const step = Math.floor(candles.length / NUM_TEST_ORDERS);
  
for (let i = 0; i < NUM_TEST_ORDERS; i++) {
  // Select a random candle with good distribution
  const candleIndex = Math.min(i * step + Math.floor(Math.random() * step), candles.length - 1);
  const candle = candles[candleIndex];
  // ... rest of order creation
}
```

This resulted in poor test variety, as orders from the same week would share the same average edge data and wouldn't properly test the edge data system across different market conditions.

### Fix:
Implemented a week-spacing algorithm to ensure test orders are distributed across different weeks:

```javascript
// Calculate approximately how many candles in a week
const candlesPerWeek = interval === '1m' ? 60 * 24 * 7 : 
                      interval === '5m' ? 12 * 24 * 7 : 
                      interval === '15m' ? 4 * 24 * 7 :
                      interval === '1h' ? 24 * 7 : 7; // Adjust based on interval

// Ensure we have enough candles to spread across multiple weeks
if (candles.length < candlesPerWeek * NUM_TEST_ORDERS) {
  console.warn('Warning: Not enough historical data to spread orders across different weeks!');
}

const weekSpacing = Math.max(Math.floor(candles.length / (NUM_TEST_ORDERS * candlesPerWeek)), 1);

for (let i = 0; i < NUM_TEST_ORDERS; i++) {
  // Select a random candle from different weeks
  // Start from the earliest data and move forward by weeks
  const baseIndex = Math.min(i * weekSpacing * candlesPerWeek, candles.length - candlesPerWeek);
  // Add some randomness within the week
  const randomOffset = Math.floor(Math.random() * candlesPerWeek);
  const candleIndex = Math.min(baseIndex + randomOffset, candles.length - 1);
  const candle = candles[candleIndex];
  // ... rest of order creation
}
```

This change ensures that test orders are properly spaced across different weeks, providing more varied edge data for testing and better simulating real-world conditions.


### After:
```javascript
// Calculate position relative to reference (start of period)
const positionPct = ((currentPrice - referencePrice) / referencePrice) * 100;

// Calculate total range - always positive
const totalMovePct = Math.abs(((highPrice - lowPrice) / referencePrice) * 100);

return {
  move: parseFloat(totalMovePct.toFixed(2)),
  position: parseFloat(positionPct.toFixed(2)),
  averageMove: parseFloat(averageMovePct.toFixed(2))
};
```

## Test market orders had same weekly average edge

### Issue:
The test market orders in testLimitOrderEdgeData.js were being generated with even spacing across the entire candle dataset, causing most orders to have the same weekly average edge values:

```javascript
// Select random candles for market orders
const step = Math.floor(candles.length / NUM_TEST_ORDERS);
  
for (let i = 0; i < NUM_TEST_ORDERS; i++) {
  // Select a random candle with good distribution
  const candleIndex = Math.min(i * step + Math.floor(Math.random() * step), candles.length - 1);
  const candle = candles[candleIndex];
  // ... rest of order creation
}
```

This resulted in poor test variety, as orders from the same week would share the same average edge data and wouldn't properly test the edge data system across different market conditions.

### Fix:
Implemented a week-spacing algorithm to ensure test orders are distributed across different weeks:

```javascript
// Calculate approximately how many candles in a week
const candlesPerWeek = interval === '1m' ? 60 * 24 * 7 : 
                      interval === '5m' ? 12 * 24 * 7 : 
                      interval === '15m' ? 4 * 24 * 7 :
                      interval === '1h' ? 24 * 7 : 7; // Adjust based on interval

// Ensure we have enough candles to spread across multiple weeks
if (candles.length < candlesPerWeek * NUM_TEST_ORDERS) {
  console.warn('Warning: Not enough historical data to spread orders across different weeks!');
}

const weekSpacing = Math.max(Math.floor(candles.length / (NUM_TEST_ORDERS * candlesPerWeek)), 1);

for (let i = 0; i < NUM_TEST_ORDERS; i++) {
  // Select a random candle from different weeks
  // Start from the earliest data and move forward by weeks
  const baseIndex = Math.min(i * weekSpacing * candlesPerWeek, candles.length - candlesPerWeek);
  // Add some randomness within the week
  const randomOffset = Math.floor(Math.random() * candlesPerWeek);
  const candleIndex = Math.min(baseIndex + randomOffset, candles.length - 1);
  const candle = candles[candleIndex];
  // ... rest of order creation
}
```

This change ensures that test orders are properly spaced across different weeks, providing more varied edge data for testing and better simulating real-world conditions.


## Missing generateEdgeData module in market order testing

### Issue:
When attempting to create a test script for market orders with real edge data, the code referenced a non-existent module `generateEdgeData.js`:

```javascript
import { generateEdgeData } from '../generators/generateEdgeData.js';

// Later in code
const edgeData = await generateEdgeData(candles);
```

## Test market orders had same weekly average edge

### Issue:
The test market orders in testLimitOrderEdgeData.js were being generated with even spacing across the entire candle dataset, causing most orders to have the same weekly average edge values:

```javascript
// Select random candles for market orders
const step = Math.floor(candles.length / NUM_TEST_ORDERS);
  
for (let i = 0; i < NUM_TEST_ORDERS; i++) {
  // Select a random candle with good distribution
  const candleIndex = Math.min(i * step + Math.floor(Math.random() * step), candles.length - 1);
  const candle = candles[candleIndex];
  // ... rest of order creation
}
```

This resulted in poor test variety, as orders from the same week would share the same average edge data and wouldn't properly test the edge data system across different market conditions.

### Fix:
Implemented a week-spacing algorithm to ensure test orders are distributed across different weeks:

```javascript
// Calculate approximately how many candles in a week
const candlesPerWeek = interval === '1m' ? 60 * 24 * 7 : 
                      interval === '5m' ? 12 * 24 * 7 : 
                      interval === '15m' ? 4 * 24 * 7 :
                      interval === '1h' ? 24 * 7 : 7; // Adjust based on interval

// Ensure we have enough candles to spread across multiple weeks
if (candles.length < candlesPerWeek * NUM_TEST_ORDERS) {
  console.warn('Warning: Not enough historical data to spread orders across different weeks!');
}

const weekSpacing = Math.max(Math.floor(candles.length / (NUM_TEST_ORDERS * candlesPerWeek)), 1);

for (let i = 0; i < NUM_TEST_ORDERS; i++) {
  // Select a random candle from different weeks
  // Start from the earliest data and move forward by weeks
  const baseIndex = Math.min(i * weekSpacing * candlesPerWeek, candles.length - candlesPerWeek);
  // Add some randomness within the week
  const randomOffset = Math.floor(Math.random() * candlesPerWeek);
  const candleIndex = Math.min(baseIndex + randomOffset, candles.length - 1);
  const candle = candles[candleIndex];
  // ... rest of order creation
}
```

This change ensures that test orders are properly spaced across different weeks, providing more varied edge data for testing and better simulating real-world conditions.


### Fix:
Instead of creating a separate edge data generation module, we leveraged the existing `LimitOrderHandler` class which already had edge data calculation functionality:

```javascript
// Initialize without external logger
const limitOrderHandler = new LimitOrderHandler(config);

// Create initial order (without edge data)
const order = {
  id: `ORDER-${candle.time}-${isLong ? 'BUY' : 'SELL'}`,
  type: 'MARKET',
  side: isLong ? 'BUY' : 'SELL',
  price: marketPrice,
  quantity: 1.0,
  time: candle.time,
  status: 'FILLED',
  // Add properties required by EdgeConsoleLogger
  referencePrice: marketPrice,
  movePct: 0.01
};

// Calculate real edge data for the order using the limitOrderHandler
const orderWithEdges = limitOrderHandler.updateOrderEdgeData(order, candle);
```

## Test market orders had same weekly average edge

### Issue:
The test market orders in testLimitOrderEdgeData.js were being generated with even spacing across the entire candle dataset, causing most orders to have the same weekly average edge values:

```javascript
// Select random candles for market orders
const step = Math.floor(candles.length / NUM_TEST_ORDERS);
  
for (let i = 0; i < NUM_TEST_ORDERS; i++) {
  // Select a random candle with good distribution
  const candleIndex = Math.min(i * step + Math.floor(Math.random() * step), candles.length - 1);
  const candle = candles[candleIndex];
  // ... rest of order creation
}
```

This resulted in poor test variety, as orders from the same week would share the same average edge data and wouldn't properly test the edge data system across different market conditions.

### Fix:
Implemented a week-spacing algorithm to ensure test orders are distributed across different weeks:

```javascript
// Calculate approximately how many candles in a week
const candlesPerWeek = interval === '1m' ? 60 * 24 * 7 : 
                      interval === '5m' ? 12 * 24 * 7 : 
                      interval === '15m' ? 4 * 24 * 7 :
                      interval === '1h' ? 24 * 7 : 7; // Adjust based on interval

// Ensure we have enough candles to spread across multiple weeks
if (candles.length < candlesPerWeek * NUM_TEST_ORDERS) {
  console.warn('Warning: Not enough historical data to spread orders across different weeks!');
}

const weekSpacing = Math.max(Math.floor(candles.length / (NUM_TEST_ORDERS * candlesPerWeek)), 1);

for (let i = 0; i < NUM_TEST_ORDERS; i++) {
  // Select a random candle from different weeks
  // Start from the earliest data and move forward by weeks
  const baseIndex = Math.min(i * weekSpacing * candlesPerWeek, candles.length - candlesPerWeek);
  // Add some randomness within the week
  const randomOffset = Math.floor(Math.random() * candlesPerWeek);
  const candleIndex = Math.min(baseIndex + randomOffset, candles.length - 1);
  const candle = candles[candleIndex];
  // ... rest of order creation
}
```

This change ensures that test orders are properly spaced across different weeks, providing more varied edge data for testing and better simulating real-world conditions.


## EdgeConsoleLogger market order compatibility issues

### Issue:
The EdgeConsoleLogger didn't have a `logMarketOrder` method, causing errors when trying to log market orders:

```javascript
// Error: logger.logMarketOrder is not a function
logger.logMarketOrder(orderWithEdges);
```

## Test market orders had same weekly average edge

### Issue:
The test market orders in testLimitOrderEdgeData.js were being generated with even spacing across the entire candle dataset, causing most orders to have the same weekly average edge values:

```javascript
// Select random candles for market orders
const step = Math.floor(candles.length / NUM_TEST_ORDERS);
  
for (let i = 0; i < NUM_TEST_ORDERS; i++) {
  // Select a random candle with good distribution
  const candleIndex = Math.min(i * step + Math.floor(Math.random() * step), candles.length - 1);
  const candle = candles[candleIndex];
  // ... rest of order creation
}
```

This resulted in poor test variety, as orders from the same week would share the same average edge data and wouldn't properly test the edge data system across different market conditions.

### Fix:
Implemented a week-spacing algorithm to ensure test orders are distributed across different weeks:

```javascript
// Calculate approximately how many candles in a week
const candlesPerWeek = interval === '1m' ? 60 * 24 * 7 : 
                      interval === '5m' ? 12 * 24 * 7 : 
                      interval === '15m' ? 4 * 24 * 7 :
                      interval === '1h' ? 24 * 7 : 7; // Adjust based on interval

// Ensure we have enough candles to spread across multiple weeks
if (candles.length < candlesPerWeek * NUM_TEST_ORDERS) {
  console.warn('Warning: Not enough historical data to spread orders across different weeks!');
}

const weekSpacing = Math.max(Math.floor(candles.length / (NUM_TEST_ORDERS * candlesPerWeek)), 1);

for (let i = 0; i < NUM_TEST_ORDERS; i++) {
  // Select a random candle from different weeks
  // Start from the earliest data and move forward by weeks
  const baseIndex = Math.min(i * weekSpacing * candlesPerWeek, candles.length - candlesPerWeek);
  // Add some randomness within the week
  const randomOffset = Math.floor(Math.random() * candlesPerWeek);
  const candleIndex = Math.min(baseIndex + randomOffset, candles.length - 1);
  const candle = candles[candleIndex];
  // ... rest of order creation
}
```

This change ensures that test orders are properly spaced across different weeks, providing more varied edge data for testing and better simulating real-world conditions.


Additionally, the logger expected certain properties on the order object that were missing:

```javascript
// Error: Cannot read properties of undefined (reading 'toFixed')
const line = `[ORDER] ${order.type.toUpperCase()} LIMIT @ ${order.price.toFixed(2)} | ` +
  `Reference: ${order.referencePrice.toFixed(2)} | ` +
  `Move: ${order.movePct.toFixed(2)}%`;
```

## Test market orders had same weekly average edge

### Issue:
The test market orders in testLimitOrderEdgeData.js were being generated with even spacing across the entire candle dataset, causing most orders to have the same weekly average edge values:

```javascript
// Select random candles for market orders
const step = Math.floor(candles.length / NUM_TEST_ORDERS);
  
for (let i = 0; i < NUM_TEST_ORDERS; i++) {
  // Select a random candle with good distribution
  const candleIndex = Math.min(i * step + Math.floor(Math.random() * step), candles.length - 1);
  const candle = candles[candleIndex];
  // ... rest of order creation
}
```

This resulted in poor test variety, as orders from the same week would share the same average edge data and wouldn't properly test the edge data system across different market conditions.

### Fix:
Implemented a week-spacing algorithm to ensure test orders are distributed across different weeks:

```javascript
// Calculate approximately how many candles in a week
const candlesPerWeek = interval === '1m' ? 60 * 24 * 7 : 
                      interval === '5m' ? 12 * 24 * 7 : 
                      interval === '15m' ? 4 * 24 * 7 :
                      interval === '1h' ? 24 * 7 : 7; // Adjust based on interval

// Ensure we have enough candles to spread across multiple weeks
if (candles.length < candlesPerWeek * NUM_TEST_ORDERS) {
  console.warn('Warning: Not enough historical data to spread orders across different weeks!');
}

const weekSpacing = Math.max(Math.floor(candles.length / (NUM_TEST_ORDERS * candlesPerWeek)), 1);

for (let i = 0; i < NUM_TEST_ORDERS; i++) {
  // Select a random candle from different weeks
  // Start from the earliest data and move forward by weeks
  const baseIndex = Math.min(i * weekSpacing * candlesPerWeek, candles.length - candlesPerWeek);
  // Add some randomness within the week
  const randomOffset = Math.floor(Math.random() * candlesPerWeek);
  const candleIndex = Math.min(baseIndex + randomOffset, candles.length - 1);
  const candle = candles[candleIndex];
  // ... rest of order creation
}
```

This change ensures that test orders are properly spaced across different weeks, providing more varied edge data for testing and better simulating real-world conditions.


### Fix:
1. Used existing `logLimitOrder` method instead of a non-existent market order logger:
```javascript
logger.logLimitOrder(orderWithEdges);
```

## Test market orders had same weekly average edge

### Issue:
The test market orders in testLimitOrderEdgeData.js were being generated with even spacing across the entire candle dataset, causing most orders to have the same weekly average edge values:

```javascript
// Select random candles for market orders
const step = Math.floor(candles.length / NUM_TEST_ORDERS);
  
for (let i = 0; i < NUM_TEST_ORDERS; i++) {
  // Select a random candle with good distribution
  const candleIndex = Math.min(i * step + Math.floor(Math.random() * step), candles.length - 1);
  const candle = candles[candleIndex];
  // ... rest of order creation
}
```

This resulted in poor test variety, as orders from the same week would share the same average edge data and wouldn't properly test the edge data system across different market conditions.

### Fix:
Implemented a week-spacing algorithm to ensure test orders are distributed across different weeks:

```javascript
// Calculate approximately how many candles in a week
const candlesPerWeek = interval === '1m' ? 60 * 24 * 7 : 
                      interval === '5m' ? 12 * 24 * 7 : 
                      interval === '15m' ? 4 * 24 * 7 :
                      interval === '1h' ? 24 * 7 : 7; // Adjust based on interval

// Ensure we have enough candles to spread across multiple weeks
if (candles.length < candlesPerWeek * NUM_TEST_ORDERS) {
  console.warn('Warning: Not enough historical data to spread orders across different weeks!');
}

const weekSpacing = Math.max(Math.floor(candles.length / (NUM_TEST_ORDERS * candlesPerWeek)), 1);

for (let i = 0; i < NUM_TEST_ORDERS; i++) {
  // Select a random candle from different weeks
  // Start from the earliest data and move forward by weeks
  const baseIndex = Math.min(i * weekSpacing * candlesPerWeek, candles.length - candlesPerWeek);
  // Add some randomness within the week
  const randomOffset = Math.floor(Math.random() * candlesPerWeek);
  const candleIndex = Math.min(baseIndex + randomOffset, candles.length - 1);
  const candle = candles[candleIndex];
  // ... rest of order creation
}
```

This change ensures that test orders are properly spaced across different weeks, providing more varied edge data for testing and better simulating real-world conditions.


2. Added required properties to market orders:
```javascript
const order = {
  // Basic order properties
  id: `ORDER-${candle.time}-${isLong ? 'BUY' : 'SELL'}`,
  type: 'MARKET',
  side: isLong ? 'BUY' : 'SELL',
  price: marketPrice,
  quantity: 1.0,
  time: candle.time,
  status: 'FILLED',
  // Add properties required by EdgeConsoleLogger
  referencePrice: marketPrice, // Using the same price as reference for market orders
  movePct: 0.01 // Minimal move for market orders
};
```

## Test market orders had same weekly average edge

### Issue:
The test market orders in testLimitOrderEdgeData.js were being generated with even spacing across the entire candle dataset, causing most orders to have the same weekly average edge values:

```javascript
// Select random candles for market orders
const step = Math.floor(candles.length / NUM_TEST_ORDERS);
  
for (let i = 0; i < NUM_TEST_ORDERS; i++) {
  // Select a random candle with good distribution
  const candleIndex = Math.min(i * step + Math.floor(Math.random() * step), candles.length - 1);
  const candle = candles[candleIndex];
  // ... rest of order creation
}
```

This resulted in poor test variety, as orders from the same week would share the same average edge data and wouldn't properly test the edge data system across different market conditions.

### Fix:
Implemented a week-spacing algorithm to ensure test orders are distributed across different weeks:

```javascript
// Calculate approximately how many candles in a week
const candlesPerWeek = interval === '1m' ? 60 * 24 * 7 : 
                      interval === '5m' ? 12 * 24 * 7 : 
                      interval === '15m' ? 4 * 24 * 7 :
                      interval === '1h' ? 24 * 7 : 7; // Adjust based on interval

// Ensure we have enough candles to spread across multiple weeks
if (candles.length < candlesPerWeek * NUM_TEST_ORDERS) {
  console.warn('Warning: Not enough historical data to spread orders across different weeks!');
}

const weekSpacing = Math.max(Math.floor(candles.length / (NUM_TEST_ORDERS * candlesPerWeek)), 1);

for (let i = 0; i < NUM_TEST_ORDERS; i++) {
  // Select a random candle from different weeks
  // Start from the earliest data and move forward by weeks
  const baseIndex = Math.min(i * weekSpacing * candlesPerWeek, candles.length - candlesPerWeek);
  // Add some randomness within the week
  const randomOffset = Math.floor(Math.random() * candlesPerWeek);
  const candleIndex = Math.min(baseIndex + randomOffset, candles.length - 1);
  const candle = candles[candleIndex];
  // ... rest of order creation
}
```

This change ensures that test orders are properly spaced across different weeks, providing more varied edge data for testing and better simulating real-world conditions.


3. Eventually replaced external logger dependency with custom inline logging functions:
```javascript
// Custom logger functions
function formatEdges(edges) {
  if (!edges) return '';
  
  // Format current edge data
  const currentEdge = ' Edges: ' + ['D', 'W', 'M'].map(t => {
    const type = t === 'D' ? 'daily' : t === 'W' ? 'weekly' : 'monthly';
    const edge = edges[type];
    if (!edge) return '';
    
    // Direction should match sign - positive is up, negative is down
    const direction = edge.position >= 0 ? 'U' : 'D';
    const sign = edge.position >= 0 ? '+' : '';  // Negative sign is already included
    return `${t}:${sign}${edge.position.toFixed(1)}%(${direction})`;
  }).filter(Boolean).join(' ');
  // Additional formatting code...
}

function logOrder(order) {
  // Skip if no order or no edges
  if (!order || !order.edges) return;
  
  // Log basic order info with edge data
  const orderLine = `[ORDER] ${order.type.toUpperCase()} @ ${order.price.toFixed(2)} | ` +
    `Reference: ${order.referencePrice.toFixed(2)} | ` +
    `Move: ${order.movePct.toFixed(2)}%` +
    formatEdges(order.edges);
    
  console.log(orderLine);
}
const totalRange = ((highPrice - lowPrice) / referencePrice) * 100;

// Total range is always positive
move: parseFloat(totalRange.toFixed(2)),
// Position maintains its sign to show where we are relative to reference
position: parseFloat(positionPct.toFixed(2))
```

## Test market orders had same weekly average edge

### Issue:
The test market orders in testLimitOrderEdgeData.js were being generated with even spacing across the entire candle dataset, causing most orders to have the same weekly average edge values:

```javascript
// Select random candles for market orders
const step = Math.floor(candles.length / NUM_TEST_ORDERS);
  
for (let i = 0; i < NUM_TEST_ORDERS; i++) {
  // Select a random candle with good distribution
  const candleIndex = Math.min(i * step + Math.floor(Math.random() * step), candles.length - 1);
  const candle = candles[candleIndex];
  // ... rest of order creation
}
```

This resulted in poor test variety, as orders from the same week would share the same average edge data and wouldn't properly test the edge data system across different market conditions.

### Fix:
Implemented a week-spacing algorithm to ensure test orders are distributed across different weeks:

```javascript
// Calculate approximately how many candles in a week
const candlesPerWeek = interval === '1m' ? 60 * 24 * 7 : 
                      interval === '5m' ? 12 * 24 * 7 : 
                      interval === '15m' ? 4 * 24 * 7 :
                      interval === '1h' ? 24 * 7 : 7; // Adjust based on interval

// Ensure we have enough candles to spread across multiple weeks
if (candles.length < candlesPerWeek * NUM_TEST_ORDERS) {
  console.warn('Warning: Not enough historical data to spread orders across different weeks!');
}

const weekSpacing = Math.max(Math.floor(candles.length / (NUM_TEST_ORDERS * candlesPerWeek)), 1);

for (let i = 0; i < NUM_TEST_ORDERS; i++) {
  // Select a random candle from different weeks
  // Start from the earliest data and move forward by weeks
  const baseIndex = Math.min(i * weekSpacing * candlesPerWeek, candles.length - candlesPerWeek);
  // Add some randomness within the week
  const randomOffset = Math.floor(Math.random() * candlesPerWeek);
  const candleIndex = Math.min(baseIndex + randomOffset, candles.length - 1);
  const candle = candles[candleIndex];
  // ... rest of order creation
}
```

This change ensures that test orders are properly spaced across different weeks, providing more varied edge data for testing and better simulating real-world conditions.


### Fix:
The fix was implemented in `pivotWorker.js` by changing the `calculateMove` function to use the period start price as reference, and to maintain the natural sign of the position calculation. This ensures that the edge percentages are consistent in their sign (positive above reference, negative below reference).

## Edge Data Formatting Issues

### Issue:
Edge data output was difficult to read due to lack of visual formatting, making it hard to distinguish between different timeframes and metrics:

```

## Test market orders had same weekly average edge

### Issue:
The test market orders in testLimitOrderEdgeData.js were being generated with even spacing across the entire candle dataset, causing most orders to have the same weekly average edge values:

```javascript
// Select random candles for market orders
const step = Math.floor(candles.length / NUM_TEST_ORDERS);
  
for (let i = 0; i < NUM_TEST_ORDERS; i++) {
  // Select a random candle with good distribution
  const candleIndex = Math.min(i * step + Math.floor(Math.random() * step), candles.length - 1);
  const candle = candles[candleIndex];
  // ... rest of order creation
}
```

This resulted in poor test variety, as orders from the same week would share the same average edge data and wouldn't properly test the edge data system across different market conditions.

### Fix:
Implemented a week-spacing algorithm to ensure test orders are distributed across different weeks:

```javascript
// Calculate approximately how many candles in a week
const candlesPerWeek = interval === '1m' ? 60 * 24 * 7 : 
                      interval === '5m' ? 12 * 24 * 7 : 
                      interval === '15m' ? 4 * 24 * 7 :
                      interval === '1h' ? 24 * 7 : 7; // Adjust based on interval

// Ensure we have enough candles to spread across multiple weeks
if (candles.length < candlesPerWeek * NUM_TEST_ORDERS) {
  console.warn('Warning: Not enough historical data to spread orders across different weeks!');
}

const weekSpacing = Math.max(Math.floor(candles.length / (NUM_TEST_ORDERS * candlesPerWeek)), 1);

for (let i = 0; i < NUM_TEST_ORDERS; i++) {
  // Select a random candle from different weeks
  // Start from the earliest data and move forward by weeks
  const baseIndex = Math.min(i * weekSpacing * candlesPerWeek, candles.length - candlesPerWeek);
  // Add some randomness within the week
  const randomOffset = Math.floor(Math.random() * candlesPerWeek);
  const candleIndex = Math.min(baseIndex + randomOffset, candles.length - 1);
  const candle = candles[candleIndex];
  // ... rest of order creation
}
```

This change ensures that test orders are properly spaced across different weeks, providing more varied edge data for testing and better simulating real-world conditions.

[ORDER] MARKET @ 117346.70 | Reference: 117346.70 | Move: 0.01% Edges: D:+0.2%(U) W:-1.9%(D) M:+15.1%(U) Average Edge D:+2.6%(U) W:+7.0%(U) M:+18.9%(U) | Range/Total Edge D:+2.7%(U) W:+4.4%(U) M:+24.6%(U)
```

## Test market orders had same weekly average edge

### Issue:
The test market orders in testLimitOrderEdgeData.js were being generated with even spacing across the entire candle dataset, causing most orders to have the same weekly average edge values:

```javascript
// Select random candles for market orders
const step = Math.floor(candles.length / NUM_TEST_ORDERS);
  
for (let i = 0; i < NUM_TEST_ORDERS; i++) {
  // Select a random candle with good distribution
  const candleIndex = Math.min(i * step + Math.floor(Math.random() * step), candles.length - 1);
  const candle = candles[candleIndex];
  // ... rest of order creation
}
```

This resulted in poor test variety, as orders from the same week would share the same average edge data and wouldn't properly test the edge data system across different market conditions.

### Fix:
Implemented a week-spacing algorithm to ensure test orders are distributed across different weeks:

```javascript
// Calculate approximately how many candles in a week
const candlesPerWeek = interval === '1m' ? 60 * 24 * 7 : 
                      interval === '5m' ? 12 * 24 * 7 : 
                      interval === '15m' ? 4 * 24 * 7 :
                      interval === '1h' ? 24 * 7 : 7; // Adjust based on interval

// Ensure we have enough candles to spread across multiple weeks
if (candles.length < candlesPerWeek * NUM_TEST_ORDERS) {
  console.warn('Warning: Not enough historical data to spread orders across different weeks!');
}

const weekSpacing = Math.max(Math.floor(candles.length / (NUM_TEST_ORDERS * candlesPerWeek)), 1);

for (let i = 0; i < NUM_TEST_ORDERS; i++) {
  // Select a random candle from different weeks
  // Start from the earliest data and move forward by weeks
  const baseIndex = Math.min(i * weekSpacing * candlesPerWeek, candles.length - candlesPerWeek);
  // Add some randomness within the week
  const randomOffset = Math.floor(Math.random() * candlesPerWeek);
  const candleIndex = Math.min(baseIndex + randomOffset, candles.length - 1);
  const candle = candles[candleIndex];
  // ... rest of order creation
}
```

This change ensures that test orders are properly spaced across different weeks, providing more varied edge data for testing and better simulating real-world conditions.


### Fix:
1. Added color coding with ANSI color codes for console output:
```javascript
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  bright: '\x1b[1m',
  brightCyan: '\x1b[1;36m'
};
```

## Test market orders had same weekly average edge

### Issue:
The test market orders in testLimitOrderEdgeData.js were being generated with even spacing across the entire candle dataset, causing most orders to have the same weekly average edge values:

```javascript
// Select random candles for market orders
const step = Math.floor(candles.length / NUM_TEST_ORDERS);
  
for (let i = 0; i < NUM_TEST_ORDERS; i++) {
  // Select a random candle with good distribution
  const candleIndex = Math.min(i * step + Math.floor(Math.random() * step), candles.length - 1);
  const candle = candles[candleIndex];
  // ... rest of order creation
}
```

This resulted in poor test variety, as orders from the same week would share the same average edge data and wouldn't properly test the edge data system across different market conditions.

### Fix:
Implemented a week-spacing algorithm to ensure test orders are distributed across different weeks:

```javascript
// Calculate approximately how many candles in a week
const candlesPerWeek = interval === '1m' ? 60 * 24 * 7 : 
                      interval === '5m' ? 12 * 24 * 7 : 
                      interval === '15m' ? 4 * 24 * 7 :
                      interval === '1h' ? 24 * 7 : 7; // Adjust based on interval

// Ensure we have enough candles to spread across multiple weeks
if (candles.length < candlesPerWeek * NUM_TEST_ORDERS) {
  console.warn('Warning: Not enough historical data to spread orders across different weeks!');
}

const weekSpacing = Math.max(Math.floor(candles.length / (NUM_TEST_ORDERS * candlesPerWeek)), 1);

for (let i = 0; i < NUM_TEST_ORDERS; i++) {
  // Select a random candle from different weeks
  // Start from the earliest data and move forward by weeks
  const baseIndex = Math.min(i * weekSpacing * candlesPerWeek, candles.length - candlesPerWeek);
  // Add some randomness within the week
  const randomOffset = Math.floor(Math.random() * candlesPerWeek);
  const candleIndex = Math.min(baseIndex + randomOffset, candles.length - 1);
  const candle = candles[candleIndex];
  // ... rest of order creation
}
```

This change ensures that test orders are properly spaced across different weeks, providing more varied edge data for testing and better simulating real-world conditions.


2. Applied color coding to different edge metrics and directions:
```javascript
// Format different timeframes with distinct colors
const timeframeColor = t === 'D' ? colors.yellow : t === 'W' ? colors.cyan : colors.magenta;

// Up/down color coding
const directionColor = edge.position >= 0 ? colors.green : colors.red;
```

## Test market orders had same weekly average edge

### Issue:
The test market orders in testLimitOrderEdgeData.js were being generated with even spacing across the entire candle dataset, causing most orders to have the same weekly average edge values:

```javascript
// Select random candles for market orders
const step = Math.floor(candles.length / NUM_TEST_ORDERS);
  
for (let i = 0; i < NUM_TEST_ORDERS; i++) {
  // Select a random candle with good distribution
  const candleIndex = Math.min(i * step + Math.floor(Math.random() * step), candles.length - 1);
  const candle = candles[candleIndex];
  // ... rest of order creation
}
```

This resulted in poor test variety, as orders from the same week would share the same average edge data and wouldn't properly test the edge data system across different market conditions.

### Fix:
Implemented a week-spacing algorithm to ensure test orders are distributed across different weeks:

```javascript
// Calculate approximately how many candles in a week
const candlesPerWeek = interval === '1m' ? 60 * 24 * 7 : 
                      interval === '5m' ? 12 * 24 * 7 : 
                      interval === '15m' ? 4 * 24 * 7 :
                      interval === '1h' ? 24 * 7 : 7; // Adjust based on interval

// Ensure we have enough candles to spread across multiple weeks
if (candles.length < candlesPerWeek * NUM_TEST_ORDERS) {
  console.warn('Warning: Not enough historical data to spread orders across different weeks!');
}

const weekSpacing = Math.max(Math.floor(candles.length / (NUM_TEST_ORDERS * candlesPerWeek)), 1);

for (let i = 0; i < NUM_TEST_ORDERS; i++) {
  // Select a random candle from different weeks
  // Start from the earliest data and move forward by weeks
  const baseIndex = Math.min(i * weekSpacing * candlesPerWeek, candles.length - candlesPerWeek);
  // Add some randomness within the week
  const randomOffset = Math.floor(Math.random() * candlesPerWeek);
  const candleIndex = Math.min(baseIndex + randomOffset, candles.length - 1);
  const candle = candles[candleIndex];
  // ... rest of order creation
}
```

This change ensures that test orders are properly spaced across different weeks, providing more varied edge data for testing and better simulating real-world conditions.


3. Created a visually structured box format for edge data display:
```javascript
console.log(`${colors.bright}╔════════════════════════════════════════════════════════════════╗${colors.reset}`);
console.log(`${colors.bright}║${colors.reset} ${colors.yellow}[ORDER]${colors.reset} ${order.type.toUpperCase()} @ ${order.price.toFixed(2)} | ` +
  `Reference: ${order.referencePrice.toFixed(2)} | ` +
  `Move: ${order.movePct.toFixed(2)}% ${colors.bright}║${colors.reset}`);

console.log(`${colors.bright}╠════════════════════════════════════════════════════════════════╣${colors.reset}`);
console.log(`${colors.bright}║${colors.reset}${formatEdges(order.edges)}${colors.bright} ║${colors.reset}`);
console.log(`${colors.bright}╚════════════════════════════════════════════════════════════════╝${colors.reset}`);
```

## Test market orders had same weekly average edge

### Issue:
The test market orders in testLimitOrderEdgeData.js were being generated with even spacing across the entire candle dataset, causing most orders to have the same weekly average edge values:

```javascript
// Select random candles for market orders
const step = Math.floor(candles.length / NUM_TEST_ORDERS);
  
for (let i = 0; i < NUM_TEST_ORDERS; i++) {
  // Select a random candle with good distribution
  const candleIndex = Math.min(i * step + Math.floor(Math.random() * step), candles.length - 1);
  const candle = candles[candleIndex];
  // ... rest of order creation
}
```

This resulted in poor test variety, as orders from the same week would share the same average edge data and wouldn't properly test the edge data system across different market conditions.

### Fix:
Implemented a week-spacing algorithm to ensure test orders are distributed across different weeks:

```javascript
// Calculate approximately how many candles in a week
const candlesPerWeek = interval === '1m' ? 60 * 24 * 7 : 
                      interval === '5m' ? 12 * 24 * 7 : 
                      interval === '15m' ? 4 * 24 * 7 :
                      interval === '1h' ? 24 * 7 : 7; // Adjust based on interval

// Ensure we have enough candles to spread across multiple weeks
if (candles.length < candlesPerWeek * NUM_TEST_ORDERS) {
  console.warn('Warning: Not enough historical data to spread orders across different weeks!');
}

const weekSpacing = Math.max(Math.floor(candles.length / (NUM_TEST_ORDERS * candlesPerWeek)), 1);

for (let i = 0; i < NUM_TEST_ORDERS; i++) {
  // Select a random candle from different weeks
  // Start from the earliest data and move forward by weeks
  const baseIndex = Math.min(i * weekSpacing * candlesPerWeek, candles.length - candlesPerWeek);
  // Add some randomness within the week
  const randomOffset = Math.floor(Math.random() * candlesPerWeek);
  const candleIndex = Math.min(baseIndex + randomOffset, candles.length - 1);
  const candle = candles[candleIndex];
  // ... rest of order creation
}
```

This change ensures that test orders are properly spaced across different weeks, providing more varied edge data for testing and better simulating real-world conditions.


4. Added a special formatted section for edge data changes:
```javascript
console.log(`${colors.bright}╔══════════════════════ EDGE CHANGES ══════════════════════╗${colors.reset}`);
    
const dailyColor = dailyChange >= 0 ? colors.green : colors.red;
const weeklyColor = weeklyChange >= 0 ? colors.green : colors.red;
const monthlyColor = monthlyChange >= 0 ? colors.green : colors.red;

console.log(`${colors.bright}║${colors.reset} ${colors.yellow}Daily:${colors.reset}   ${dailyColor}${dailyChange >= 0 ? '+' : ''}${dailyChange?.toFixed(1)}%${colors.reset}  ${colors.bright}|${colors.reset} ` +
          `${colors.cyan}Weekly:${colors.reset} ${weeklyColor}${weeklyChange >= 0 ? '+' : ''}${weeklyChange?.toFixed(1)}%${colors.reset}  ${colors.bright}|${colors.reset} ` +
          `${colors.magenta}Monthly:${colors.reset} ${monthlyColor}${monthlyChange >= 0 ? '+' : ''}${monthlyChange?.toFixed(1)}%${colors.reset} ${colors.bright}║${colors.reset}`);
```

## Test market orders had same weekly average edge

### Issue:
The test market orders in testLimitOrderEdgeData.js were being generated with even spacing across the entire candle dataset, causing most orders to have the same weekly average edge values:

```javascript
// Select random candles for market orders
const step = Math.floor(candles.length / NUM_TEST_ORDERS);
  
for (let i = 0; i < NUM_TEST_ORDERS; i++) {
  // Select a random candle with good distribution
  const candleIndex = Math.min(i * step + Math.floor(Math.random() * step), candles.length - 1);
  const candle = candles[candleIndex];
  // ... rest of order creation
}
```

This resulted in poor test variety, as orders from the same week would share the same average edge data and wouldn't properly test the edge data system across different market conditions.

### Fix:
Implemented a week-spacing algorithm to ensure test orders are distributed across different weeks:

```javascript
// Calculate approximately how many candles in a week
const candlesPerWeek = interval === '1m' ? 60 * 24 * 7 : 
                      interval === '5m' ? 12 * 24 * 7 : 
                      interval === '15m' ? 4 * 24 * 7 :
                      interval === '1h' ? 24 * 7 : 7; // Adjust based on interval

// Ensure we have enough candles to spread across multiple weeks
if (candles.length < candlesPerWeek * NUM_TEST_ORDERS) {
  console.warn('Warning: Not enough historical data to spread orders across different weeks!');
}

const weekSpacing = Math.max(Math.floor(candles.length / (NUM_TEST_ORDERS * candlesPerWeek)), 1);

for (let i = 0; i < NUM_TEST_ORDERS; i++) {
  // Select a random candle from different weeks
  // Start from the earliest data and move forward by weeks
  const baseIndex = Math.min(i * weekSpacing * candlesPerWeek, candles.length - candlesPerWeek);
  // Add some randomness within the week
  const randomOffset = Math.floor(Math.random() * candlesPerWeek);
  const candleIndex = Math.min(baseIndex + randomOffset, candles.length - 1);
  const candle = candles[candleIndex];
  // ... rest of order creation
}
```

This change ensures that test orders are properly spaced across different weeks, providing more varied edge data for testing and better simulating real-world conditions.

