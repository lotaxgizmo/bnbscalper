# Issues Log

## Enhanced Log Control System Implementation

### Issue:
The multiPivotFronttesterLive.js system was generating excessive console output that made it difficult to focus on specific aspects of the trading system. Users needed granular control over different categories of logs (trades, windows, cascades) to reduce noise and improve analysis clarity.

### Solution:
Implemented comprehensive log control system with three new configuration options in `fronttesterconfig.js`:

1. **showTrades**: Controls trade opening and closing logs
2. **showWindow**: Controls window opening, confirmation, and execution logs  
3. **showRecentCascades**: Controls recent cascades display section

### Implementation Details:

**Configuration Options Added:**
```javascript
// In config/fronttesterconfig.js
export const fronttesterconfig = {
    showTrades: true,          // Show/hide trade opening and closing logs
    showWindow: true,          // Show/hide window logs
    showRecentCascades: true,  // Show/hide recent cascades display
    // ... existing options
};
```

**Code Changes Applied:**

1. **Trade Logs Control** - Wrapped all trade-related console.log statements:
```javascript
// Trade opening logs
if (fronttesterconfig.showTrades) {
    console.log(`🚀 TRADE OPENED: ${direction.toUpperCase()} #${this.tradeCounter}`);
    // ... additional trade opening logs
}

// Trade closing logs
if (fronttesterconfig.showTrades) {
    console.log(`[TRADE ${tradeId.toString().padStart(2, '0')}] ${direction.toUpperCase()} | P&L: ${pnlPercent}% | ${result} | Result: ${exitReason}`);
    // ... additional trade closing logs
}
```

2. **Window Logs Control** - Wrapped all window-related console.log statements:
```javascript
// Primary window opening
if (fronttesterconfig.showWindow) {
    console.log(`🟡 PRIMARY WINDOW OPENED [${windowId}]: ${primaryPivot.timeframe} ${primaryPivot.signal.toUpperCase()} pivot detected`);
    // ... additional window logs
}

// Confirmation window logs
if (fronttesterconfig.showWindow) {
    console.log(`🟢 CONFIRMATION WINDOW [${windowId}]: ${timeframe.interval} ${pivot.signal.toUpperCase()} pivot detected`);
    // ... additional confirmation logs
}

// Execution logs
if (fronttesterconfig.showWindow) {
    console.log(`✅ EXECUTING CASCADE - Hierarchical confirmation complete!`);
    // ... additional execution logs
}
```

3. **Recent Cascades Display Control**:
```javascript
displayRecentCascades() {
    if (!fronttesterconfig.showRecentCascades || this.recentCascades.length === 0) return;
    
    console.log(`┌─ Recent Cascades (${this.recentCascades.length}/3) ─────────────────────────────`);
    // ... cascade display logic
}
```

### Benefits:
- **Granular Control**: Users can hide specific log categories while keeping others visible
- **Clean Output**: Reduces console noise for focused analysis
- **Professional Display**: Configurable output suitable for different analysis needs
- **Backward Compatible**: All options default to `true` to maintain existing behavior
- **Mix and Match**: Users can combine settings (e.g., show trades but hide windows)

### Usage Examples:
- **Trades Only**: `showTrades: true, showWindow: false, showRecentCascades: false`
- **Signals Only**: `showTrades: false, showWindow: true, showRecentCascades: false`
- **Clean Mode**: `showTrades: false, showWindow: false, showRecentCascades: false`
- **Full Display**: `showTrades: true, showWindow: true, showRecentCascades: true` (default)

### Files Modified:
1. `config/fronttesterconfig.js` - Added new configuration options
2. `multiPivotFronttesterLive.js` - Added conditional checks around all relevant console.log statements
3. `TECHNICAL_DOCS.MD` - Added comprehensive documentation
4. `USER_GUIDE.md` - Updated display controls section

### Status: ✅ FULLY IMPLEMENTED
The log control system is now fully operational and provides users with complete control over console output categories for improved analysis and reduced noise.

---

## Negative "Bars since last" in Real-Time Pivot Detection

### Issue:
The real-time pivot detection system in `pivotFronttester.js` was showing negative values for "Bars since last" in debug output, indicating a critical indexing problem that could affect pivot timing calculations.

### Root Cause:
The historical pivot analysis in `analyzeInitialPivots()` was updating the global `lastPivot.index` variable with indices from the historical analysis (e.g., index 997). However, when the real-time system checked for new pivots at lower indices (e.g., index 994), the calculation `pivotIndex - lastPivot.index` resulted in negative values.

### Impact:
- Incorrect "Bars since last" calculations in debug output
- Potential for missed pivots due to incorrect timing logic
- Inconsistency between historical and real-time pivot detection systems
- Debug output showing confusing negative values

### Fix:
Added a `lastPivot` index reset after the historical analysis completes to align the indexing with the real-time buffer system.

**Code Snippet (Fix Applied):**
```javascript
// In pivotFronttester.js, after analyzeInitialPivots() completes

// Reset lastPivot for real-time detection to avoid negative bar calculations
// The historical analysis used different indexing, so we need to reset for real-time
if (lastPivot.type) {
    console.log(`${colors.dim || ''}[DEBUG] Resetting lastPivot tracking for real-time detection. Last historical pivot: ${lastPivot.type} @ ${lastPivot.price} (index ${lastPivot.index})${colors.reset || ''}`);
    // Keep the price and type but reset the index to current buffer position
    lastPivot.index = candleBuffer.length - 1 - pivotLookback; // Set to a reasonable starting point
}
```

### Additional Fix - Preventing Old Pivot Re-detection:
After the initial fix, the system was still detecting old pivots from historical analysis. Added a critical check to only process NEW pivots:

```javascript
// CRITICAL: Only check for pivots that are NEWER than what we've already processed
// This prevents re-detecting old pivots from historical analysis
if (pivotIndex <= lastPivot.index) {
    // Skip - this pivot was already processed in historical analysis
    return;
}
```

### Enhanced Real-Time Pivot Display:
Updated pivot output format for real-time detections to include:
- Full date and time formatting
- "🆕 REAL-TIME DETECTION" indicator
- Clear distinction from historical pivots

### Result:
- "Bars since last" now shows correct positive values
- Real-time pivot detection uses consistent indexing
- No more duplicate/old pivot detections
- Enhanced pivot output with full timestamps
- Clear visual distinction between historical and real-time pivots
- System maintains proper pivot tracking between historical and real-time phases

### Status: ✅ RESOLVED

## Misleading Backtest Results Due to Ignored Open Trades

### Issue:
Backtests for `buy`-only and `sell`-only strategies produced identical, statistically improbable PnL results. This created confusion and undermined confidence in the backtester's accuracy.

### Root Cause:
The final trade summary in `pivotBacktester.js` only calculated metrics based on *closed* trades. Any trade that was still open when the simulation ended was completely ignored. The "Final Capital" figure did not account for the unrealized PnL of this open position, leading to inaccurate and misleading reports.

### Fix:
The final summary logic was refactored to perform a **mark-to-market (MTM)** calculation for any open trade at the end of the test, ensuring the final report reflects the true state of the account.

1.  **MTM Calculation**: If a trade is still active after all candles are processed, its unrealized PnL is calculated using the closing price of the very last candle in the dataset.
2.  **Enhanced Summary**: The trade summary output was updated to be more transparent:
    *   A clear note is displayed if a trade is still open, along with its calculated MTM PnL.
    *   The summary now distinguishes between **Realized PnL** (from closed trades) and **Unrealized PnL** (from the open trade).
    *   The **Final Capital** now includes the unrealized PnL, providing a completely accurate end-of-test valuation.

**Code Snippet (After):**
```javascript
// In pivotBacktester.js, at the end of the runTest function

let finalCapital = capital;
let unrealizedPnl = 0;
if (activeTrade) {
    const endPrice = candles[candles.length - 1].close;
    const pnlPct = (activeTrade.type === 'long' ? (endPrice - activeTrade.entryPrice) / activeTrade.entryPrice : (activeTrade.entryPrice - endPrice) / activeTrade.entryPrice) * tradeConfig.leverage;
    unrealizedPnl = activeTrade.size * pnlPct;
    finalCapital += unrealizedPnl;
    console.log(`\n${colors.yellow}Note: 1 trade is still open.${colors.reset}`)
    console.log(`  └─> Mark-to-market PnL: ${(unrealizedPnl > 0 ? colors.green : colors.red)}${unrealizedPnl.toFixed(2)}${colors.reset}`);
}

if (trades.length > 0 || activeTrade) {
    console.log(`\n${colors.cyan}--- Trade Summary ---${colors.reset}`);
    // ... summary logic ...
    console.log(`Realized PnL: ...`);
    console.log(`Unrealized PnL: ...`);
    console.log(`Final Capital: ${colors.yellow}${finalCapital.toFixed(2)}${colors.reset}`);
    // ...
}
```

## Issues During Instant Pivot Test Development

### Issue:
During the development of the configurable pivot detection test (`tests/instantPivotTest.js`), two separate issues were introduced that caused the script to fail or produce no output.

1.  **`ReferenceError: displayCandleInfo is not defined`**: After refactoring the output to a new analytical format, the `displayCandleInfo` function was deleted, but an orphaned call to it remained at the end of the script, causing a crash.
2.  **No Pivot Output**: A logical flaw was introduced where the first pivot in a dataset could never be confirmed. The logic required every pivot to be a minimum percentage move away from the *previous* pivot. Since the first pivot has no predecessor, this check always failed, preventing any pivots from being logged.

### Fix:
Both issues were resolved within the `instantPivotTest.js` script.

1.  **ReferenceError**: The final, unnecessary call to `displayCandleInfo(candles[candles.length - 1], candles.length);` was removed from the script.

2.  **Initial Pivot Logic**: The conditional check for confirming a pivot was modified to bypass the `swingThreshold` check if it is the very first pivot being detected (`lastPivot.type === null`). This allows the first valid pivot pattern to be confirmed, which correctly seeds the process for all subsequent pivots.

    **Before:**
    ```javascript
    if (Math.abs(swingPct) >= swingThreshold && (i - lastPivot.index) >= minLegBars) {
        // ... confirm pivot
    }
    ```

    **After:**
    ```javascript
    // For the first pivot, we don't check swingPct. For subsequent pivots, we do.
    if ((lastPivot.type === null || Math.abs(swingPct) >= swingThreshold) && (i - lastPivot.index) >= minLegBars) {
        // ... confirm pivot
    }
    ```


## Unresolved Trades at End of Historical Simulation

### Issue:
The `historicalStreamer.js` simulation would end with an "UNRESOLVED trade" status if a trade was still active when the historical candle data concluded. This provided an incomplete picture of the strategy's performance, as the final trade's outcome was never determined.

### Root Cause:
The simulation loop would simply finish, and the logic only reported that a trade was still active. There was no mechanism to resolve the trade based on the end-of-data state.

### Fix:
A `forceClose` mechanism was implemented to ensure all trades are resolved.

1.  **New `forceClose` Method**: A new method, `forceClose(candle)`, was added to `utils/live/paperTradeManager.js`. It takes the last candle of the dataset, closes the trade at that candle's closing price, and calculates the final P&L.

    ```javascript
    // In utils/live/paperTradeManager.js
    forceClose(candle) {
        if (!this.tradeActive || this.order.status !== 'FILLED') return;

        this.order.status = 'CLOSED';
        this.order.exitTime = candle.time;
        this.order.exitPrice = candle.close; // Close at the candle's closing price

        if (this.order.side === 'BUY') {
            this.order.result = this.order.exitPrice >= this.order.fillPrice ? 'WIN' : 'LOSS';
        } else { // SELL
            this.order.result = this.order.exitPrice <= this.order.fillPrice ? 'WIN' : 'LOSS';
        }

        this.tradeActive = false;
    }
    ```

2.  **Updated Simulation Logic**: The `historicalStreamer.js` script was modified to use this new method. After the loop, it checks for an active trade and, if found, force-closes it.

    **Before:**
    ```javascript
    // In historicalStreamer.js
    if (activeTrade && activeTrade.isActive()) {
        const order = activeTrade.order; 
        console.log('\n----------------------------------------');
        console.log('Simulation finished with an UNRESOLVED trade:');
        console.log('Order Details:', JSON.stringify(order, null, 2));
        console.log('This trade did not close by the end of the historical data.');
        console.log('----------------------------------------');
    }
    ```

    **After:**
    ```javascript
    // In historicalStreamer.js
    if (activeTrade && activeTrade.isActive()) {
        const lastCandle = candles[candles.length - 1];
        activeTrade.forceClose(lastCandle);
        const result = activeTrade.getResult();

        console.log('\n----------------------------------------');
        console.log('Simulation finished. An open trade was FORCE-CLOSED at the end of the data:');
        console.log('Result:', {
            ...result,
            fillTime: result.fillTime ? new Date(result.fillTime).toLocaleString() : 'N/A',
            exitTime: result.exitTime ? new Date(result.exitTime).toLocaleString() : 'N/A'
        });
        console.log('----------------------------------------');
    }
    ```



## Strategy Unprofitable Due to Trading Fees

### Issue:
After correctly implementing trading fee deductions, the backtest became unprofitable. The net result for each trade was negative because the cost to execute the trade was higher than the profit target.

### Root Cause:
The `takeProfit` parameter in `config/tradeconfig.js` was set to `0.015` (representing 0.015%), while the `totalMakerFee` was `0.04%`. With 10x leverage, a trade's gross profit was `0.15%` (`$0.15`), but the fee on the leveraged position was `$0.40`, resulting in a net loss of `-$0.25` per trade. A comment in the code (`// Take profit at 0.2%`) indicated the intended value was much higher.

### Fix:
The `takeProfit` value in `config/tradeconfig.js` was updated from `0.015` to `0.2` to ensure the profit target is substantially higher than the trading fees, aligning the code with the documented intention.

**Before:**
```javascript
// In config/tradeconfig.js
  takeProfit: 0.015,    // Take profit at 0.2% 
```

**After:**
```javascript
// In config/tradeconfig.js
  takeProfit: 0.2,    // Take profit at 0.2%
```



## Backtest Profit Calculation Did Not Reflect Leverage

### Issue:
The backtest summary's final profit and capital figures were incorrect because they were not being calculated with the configured leverage. The P&L percentage per trade appeared correct, but the absolute currency profit (`pnlValue`) was based on an unleveraged amount.

### Root Cause:
In `utils/backtest/backtestController.js`, within the `formatTradeResult` method, the `pnlValue` constant was calculated using the raw, unleveraged profit-to-loss ratio. The leverage was applied to the display percentage (`pnlPercentage`) but was omitted from the currency value calculation that feeds into the capital statistics.

### Fix:
The `pnlValue` calculation was corrected to multiply the result by the leverage factor from the configuration. This ensures the currency profit accurately reflects the leveraged position size.

**Before:**
```javascript
// In utils/backtest/backtestController.js
const pnlValue = pnlRatio * (tradeResult.order.amount || this.config.initialCapital * (this.config.riskPerTrade / 100));
```

**After:**
```javascript
// In utils/backtest/backtestController.js
const pnlValue = pnlRatio * (tradeResult.order.amount || this.config.initialCapital * (this.config.riskPerTrade / 100)) * (this.config.leverage || 1);
```


## Incorrect Pivot Numbering

### Issue:
The console output was numbering pivots in pairs (e.g., 1. LOW, 1. HIGH, 2. LOW, 2. HIGH) instead of providing a unique, sequential number for every pivot.

### Root Cause:
The `EdgeConsoleLogger` was using a counter that only incremented when the pivot type changed from LOW to HIGH, effectively counting pairs.

### Fix:
The logging logic in `utils/backtest/edgeConsoleLogger.js` was modified to use a single counter (`this.pivotCount`) that increments for every single pivot logged, regardless of its type. This ensures each pivot receives a unique number.

**Before:**
```javascript
// In utils/backtest/edgeConsoleLogger.js
if (this.lastPivotType !== pivot.type) {
  if (pivot.type === 'high') this.pivotPairCount++;
  this.lastPivotType = pivot.type;
}
const paddedNumber = pivot.type === 'low' ? String(Math.ceil(this.pivotPairCount)).padStart(3, ' ') : '   ';
```

**After:**
```javascript
// In utils/backtest/edgeConsoleLogger.js
if (typeof this.pivotCount === 'undefined') {
  this.pivotCount = 0;
}
this.pivotCount++;

const paddedNumber = String(this.pivotCount).padStart(3, ' ');
```

## Trade Details Not Appearing in Final Summary

### Issue:
Despite `showTradeDetails: true` being set in the configuration, the detailed breakdown of each trade was not appearing anywhere in the backtest output. The user's intent was for these details to appear together in the final summary.

### Root Cause:
This was a multi-part issue:
1.  **Missing Configuration Initialization**: The base `ConsoleLogger` class constructor in `utils/backtest/consoleLogger.js` was not reading or storing the `showTradeDetails` value from the configuration object. This was the primary blocker.
2.  **Incorrect Logging Location**: An initial attempt to fix the issue involved calling the logger from the `BacktestController` in real-time, which was not the desired behavior.
3.  **Missing Summary Logic**: The `EdgeConsoleLogger` did not have logic to display all trade details at the end of the run.

### Fix:
The issue was resolved with a three-step correction:
1.  **Corrected the Base Logger**: The `showTradeDetails` property was correctly initialized in the `ConsoleLogger` constructor, ensuring the configuration was respected.

    ```javascript
    // In utils/backtest/consoleLogger.js constructor

## Paper Trader Fails to Connect Due to DNS Error

### Issue:
When running `paperTrader.js`, the script fails to establish a WebSocket connection and immediately exits after printing a DNS-related error.

### Root Cause:
The script is unable to resolve the Bybit WebSocket hostname (`stream.bybit.com`) into an IP address. The error message `getaddrinfo EAI_AGAIN` indicates a DNS lookup failure. This is not a bug in the application's code but rather an external, network-level problem. It can be caused by temporary internet issues, local DNS server problems, or a firewall.

### Fix:
This is an environmental issue, not a code issue. The primary solution is to **wait and retry the connection later**. If the problem persists, the user should check their internet connection and DNS settings. The application's error handling correctly catches this exception and prevents a crash, which is the desired behavior.

**Error Snippet:**
```
WebSocket error: Error: getaddrinfo EAI_AGAIN stream.bybit.com
```
    this.showTradeDetails = config.showTradeDetails || false;
    ```

2.  **Removed Real-Time Logging**: The incorrect call to `logTradeDetails` from the `BacktestController`'s main loop was removed.
3.  **Implemented Summary Logging**: The `logFinalSummary` method was added to `EdgeConsoleLogger`. This method first calls the parent summary function and then, if `showTradeDetails` is true, it iterates through all completed trades and prints their details under a new "— Trade Details —" header.

    ```javascript
    // In utils/backtest/edgeConsoleLogger.js
    logFinalSummary(trades, statistics) {
      // Call parent for the main summary statistics
      super.logFinalSummary(trades, statistics);

      // If trade details are enabled, log each one here under a separate header
      if (this.showTradeDetails && trades && trades.length > 0) {
        console.log('\n' + '-'.repeat(42));
        console.log(COLOR_YELLOW + '— Trade Details —' + COLOR_RESET);
        trades.forEach((trade, index) => {
          this.logTradeDetails(trade, index);
        });
      }
    }
    ```


## Cluttered Backtest Output and Redundant Logging

### Issue:
The backtest output from `backtestWithExecutor.js` was difficult to analyze due to two main problems:
1.  **Interleaved Logging**: Log messages for pivot detection and trade execution were not sequential. A pivot's log could appear long after the log for the trade it generated, making it hard to follow the strategy's logic.
2.  **Redundant Messages**: A persistent and redundant "✔ Order Filled" message was logged to the console, adding unnecessary clutter even after a centralized logger was introduced.

### Root Cause:
1.  **Decentralized Logging**: Both the `TradeExecutor` and the main backtest script were independently writing to the console, leading to a race condition in the output.
2.  **Overlooked Log Statement**: The redundant "Order Filled" message was being generated by a `console.log` call within the `TradeExecutor.checkOrderFill` method, which was missed during initial refactoring efforts.

### Fix:
The entire backtesting and logging flow was refactored for clarity and centralized control.

1.  **Introduced `BacktestController`**: A new class, `BacktestController`, was created to orchestrate the backtest. It is responsible for iterating through pivots, executing trades via the `TradeExecutor`, and managing all console output.

2.  **Refactored `TradeExecutor`**: All `console.log` statements were removed from `TradeExecutor`. The class was modified to return detailed trade event data (creation, fill, close) to the controller instead of logging directly.

    **Before (in `TradeExecutor.js`):**
    ```javascript
    checkOrderFill(candle) {
      // ... logic ...
      if (filled) {
        this.orderFilled = true;
        this.order.fillTime = candle.time;
        console.log(`\n${colors.bright}${colors.green}✔ Order Filled${colors.reset} ...`);
      }
      return filled;
    }
    ```

    **After (in `TradeExecutor.js`):**
    ```javascript
    checkOrderFill(candle) {
      // ... logic ...
      if (filled) {
        this.orderFilled = true;
        this.order.fillTime = candle.time;
        // No more console.log here
      }
      return filled;
    }
    ```

3.  **Centralized Logging**: The `BacktestController` now uses the `EdgeConsoleLogger` to print pivot and trade information in a strict, sequential order, ensuring the output is clean and easy to follow.


## Backtest Crashing Due to Unfilled Trades in Logger

### Issue:
The `backtestWithEdges.js` script was crashing with a `TypeError` when attempting to log trade details. The error occurred because the logger tried to access properties of a trade object that was never filled, specifically when a limit order was cancelled.

```
TypeError: Cannot read properties of undefined (reading 'toFixed')
    at EdgeConsoleLogger.logTradeDetails (file:///C:/Users/HP/Documents/Code%20Stuff/scalper/utils/backtest/edgeConsoleLogger.js:217:75)
```

### Root Cause:
The `logTradeDetails` function in `edgeConsoleLogger.js` did not account for trade objects that represented cancelled or unfilled orders. These objects lack properties like `entryPrice` and `exitPrice`. When the function attempted to call `.toFixed(4)` on the `undefined` `entryPrice`, it caused the script to crash.

### Fix:
A check was added to the `logTradeDetails` function to verify the existence of `trade.entryPrice` before attempting to log the full details. If the price is missing, the logger now prints a clear "CANCELLED/NOT FILLED" message, preventing the crash and making the backtest logs more informative.

**Before:**
```javascript
// In utils/backtest/edgeConsoleLogger.js
logTradeDetails(trade, index) {
  if (this.performanceMode) return;

  const result = trade.pnl >= 0 ? 'WIN' : 'LOSS';
  const color = result === 'WIN' ? COLOR_GREEN : COLOR_RED;
  const side = trade.side === 'BUY' ? 'LONG' : 'SHORT';

  console.log('\n' + '-'.repeat(80));
  console.log(color + `[TRADE ${index + 1}] ${side} | P&L: ${trade.pnl.toFixed(2)}% | ${result}` + COLOR_RESET);

  // ... logging logic

  console.log(COLOR_CYAN +
    `  Entry: ${formatDateTime(trade.entryTime)} at $${trade.entryPrice.toFixed(4)}\n` + // This line caused the crash
    `  Exit:  ${formatDateTime(trade.exitTime)} at $${trade.exitPrice.toFixed(4)}\n` +
    `  Duration: ${formatDuration(trade.duration)}` +
    COLOR_RESET
  );
  console.log('-'.repeat(80));
}
```

**After:**
```javascript
// In utils/backtest/edgeConsoleLogger.js
logTradeDetails(trade, index) {
  if (this.performanceMode) return;

  // Handle trades that were not filled (e.g., cancelled orders)
  if (typeof trade.entryPrice === 'undefined' || trade.entryPrice === null) {
    console.log('\n' + '-'.repeat(80));
    console.log(COLOR_YELLOW + `[TRADE ${index + 1}] CANCELLED/NOT FILLED` + COLOR_RESET);
    if (trade.cancellationReason) {
      console.log(COLOR_YELLOW + `  Reason: ${trade.cancellationReason}` + COLOR_RESET);
    }
    if (trade.side && trade.type) {
      console.log(COLOR_CYAN + `  Side: ${trade.side}, Type: ${trade.type}` + COLOR_RESET);
    }
    console.log('-'.repeat(80));
    return;
  }

  const result = trade.pnl >= 0 ? 'WIN' : 'LOSS';
  const color = result === 'WIN' ? COLOR_GREEN : COLOR_RED;
  const side = trade.side === 'BUY' ? 'LONG' : 'SHORT';

  console.log('\n' + '-'.repeat(80));
  console.log(color + `[TRADE ${index + 1}] ${side} | P&L: ${trade.pnl.toFixed(2)}% | ${result}` + COLOR_RESET);

  // ... existing logging logic ...
}
```


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

