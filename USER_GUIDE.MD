# User Guide

## Core Trading Logic

### High-Speed Pivot Confirmation

To maximize effectiveness for scalping, the pivot detection logic has been optimized for **speed**.

- **Immediate Confirmation**: The system no longer waits for a candle to close to confirm a pivot. Instead, a pivot is confirmed the moment the price moves significantly against the trend, even within the same candle.
- **Why this matters**: This change eliminates confirmation lag, allowing for much faster trade entries at prices closer to the actual pivot point. This is crucial for capturing small, rapid price movements.

## Testing Tools

### Enhanced Pivot Detection System

The system now uses an improved pivot detection algorithm with better timestamp handling and proper closing price confirmation:

```bash
node generators/generateEnhancedPivotData.js
```

This enhanced generator:
- Uses a completely redesigned pivot detection algorithm
- Properly handles the `confirmOnClose` setting for more accurate pivots
- Stores both extreme candle and confirmation candle data
- Increases batch overlap to ensure no pivots are missed
- Adds validation data to every pivot point
- Maintains full compatibility with existing edge data

### Pivot Timestamp Test

A lightweight test tool is available to verify pivot timestamp and price accuracy with enhanced predictive detection:

```bash
node pivotTimestampTest.js
```

This tool:
- Loads a small subset of candle data from your data directory
- Generates pivots with accurate timestamps
- Validates pivot prices against candle data
- Simulates a mini backtest to verify timestamp display
- Processes all pivots without targeting specific timestamps
- Features real-time ready architecture for live trading integration

Requirements:
- Candle data file in `data/historical/SYMBOL/INTERVAL.csv` format
- Node.js environment

The output will show detailed information about pivot timestamps, prices, and any discrepancies found.

### Realistic Pivot Detection Test (No Lookahead)

To test and fine-tune the core pivot detection logic, a dedicated script is available. This is the best tool for seeing how changes to your pivot settings affect the strategy's signals in a realistic, live-trading simulation.

```bash
node tests/instantPivotTest.js
```

This script tests a powerful **two-step confirmation logic without lookahead bias**:
1.  **Pivot Shape (`pivotLookback`)**: A candle's high must be strictly greater than the highs of the previous `pivotLookback` candles (or its low must be strictly lower for a low pivot). This confirms a pivot based *only* on past data, as it would happen in a live environment.
2.  **Minimum Swing (`minSwingPct`)**: The price move between pivots must be significant enough to be considered.
3.  **Minimum Time (`minLegBars`)**: A certain number of candles must pass between pivots to prevent noise.

You can tune these three parameters in `config/config.js` to balance sensitivity and signal quality.

#### Test Output

The script produces a clean, analytical summary for each pivot detected:

```
1.[PIVOT] LOW  @ 116691.20 | Time: Tuesday, July 22, 2025 at 5:54:00 AM | Move: 0.00% | Bars: 6
2.[PIVOT] HIGH @ 117274.00 | Time: Tuesday, July 22, 2025 at 6:14:00 AM | Move: +0.50% | Bars: 20
```

At the end, it will also show the total time period covered by the test data:

```
Data Time Elapsed: 0 days, 8 hours, 19 minutes.
```

Finally, the test provides a `Market Movement Summary` that shows the true volatility of the period, independent of your pivot settings:

```
--- Market Movement Summary ---
Max Upward Move: +2.29% (from start to ATH)
Max Downward Move: -0.25% (from start to ATL)
Net Price Range: 2.55% (from ATL to ATH)
```

- **Max Upward/Downward Move**: The biggest percentage change from the starting price to the highest high (All-Time High) and lowest low (All-Time Low) of the test period.
- **Net Price Range**: The total volatility from the absolute bottom to the absolute top.

### Historical Data Streamer

For a powerful hybrid of backtesting and live testing, you can use the historical data streamer. This tool simulates a real-time data feed using your local historical data, allowing you to see how your live trading logic would perform minute-by-minute.

```bash
node historicalStreamer.js
```

This script will:
- Display the current trade settings from `config/tradeconfig.js` at the very top of its output, so you can easily verify the configuration for the run.
- Load a specific number of historical candles based on the `limit` setting in `config/config.js`.
- Process them one-by-one, simulating a live market feed.
- Use your existing `PivotTracker` and `PaperTradeManager` to detect pivots and execute trades based on your live strategy configuration.
- The console will now confirm which candle timeframe is being used and assign a sequential number to each pivot for easy tracking.
- **Color-Coded Pivots**: To make the output easier to read, pivots are now color-coded. `high` pivots will appear in green, and `low` pivots will appear in red.
- **Unresolved Trade Handling**: If a trade is still open when the historical data runs out, the simulation will now automatically close it using the price from the last available candle. The final output will clearly state that the trade was `FORCE-CLOSED`, ensuring you always get a complete performance result.

### Backtest Output Readability

The console output for backtests run with `backtestWithExecutor.js` has been significantly improved for clarity.

- **Sequential Logging**: Pivot details are now immediately followed by the trade events (order creation, fills, closes) that result from them.
- **Reduced Clutter**: Redundant log messages, such as the extra "Order Filled" line, have been removed.

This provides a clean, step-by-step view of the backtest execution, making it easier to follow the strategy's logic and analyze its performance.

#### Real-Time Trading Capability

The EnhancedPivotTracker class is designed for real-time operation with these features:
- Candle-by-candle processing for efficient memory usage
- Stateful design that maintains trend direction between updates
- Proper timestamp handling for accurate pivot identification
- Complete pivot data with price, time, and move percentage information
- Proper handling of closing price confirmation when `confirmOnClose` is true

### Market Order Edge Data Test

A specialized testing tool for verifying market order edge data functionality without synthetic pivot data:

```bash
node tests/testLimitOrderEdgeData.js
```

This test script:
- Creates a small number (5) of random market orders using real candle data
- Intelligently spaces test orders across different weeks for varied edge data
- Uses all available historical candles (~270,000+) to ensure proper week-based spacing
- Calculates appropriate week spacing based on the selected interval
- Prevents orders from sharing the same weekly average edge metrics
- Calculates accurate edge data using the LimitOrderHandler module
- Shows dynamic edge data updates for orders at 5-minute intervals
- Displays clear price change information after 5 minutes with:
  * Initial price to current price comparison with directional arrow
  * Absolute price change values (e.g., +123.45)
  * Percentage price change values (e.g., +0.123%)
  * Color-coded display (green for positive, red for negative changes)

### Scheduled Limit Order Test

A utility tool for testing limit orders scheduled at a specific time with take profit and stop loss:

```bash
node tests/testScheduledLimitOrder.js
```

This test script:
- Creates a limit order at a user-defined time with configurable parameters
- Features customizable:
  * Entry time (specific timestamp)
  * Order price (custom price or market price at time of execution)
  * Position size (dollar amount)
  * Take profit percentage (0 to disable)
  * Stop loss percentage (0 to disable)
  * Trade direction (BUY/SELL)
  * Position update frequency (how often to show updates)
  * Simulation length (number of candles to simulate)
- Simulates the complete lifecycle of the limit order:
  * Order placement at the scheduled time
  * Real-time price monitoring for order fill
  * Take profit and stop loss management
  * Periodic position updates with P&L calculations
  * Final trade outcome reporting
- Provides comprehensive edge data analysis throughout the trade
- Demonstrates edge data inheritance and real-time updates
- Provides detailed metrics on edge position changes between updates
- Uses authentic market data rather than synthetic pivot data
- Features visually enhanced box-style formatting with color-coded metrics
- Color differentiation between timeframes (D/W/M) and movement directions (U/D)

Requirements:
- Candle data file in `data/historical/SYMBOL/INTERVAL.csv` format
- Configuration in `config/config.js` (symbol and interval)
- Node.js environment

The output shows comprehensive edge data for each market order including daily, weekly, and monthly metrics with positional changes over time.
- Storage of both extreme and confirmation candle data for validation

To adapt for real-time use:
1. Replace the historical data source with a WebSocket connection
2. Process incoming candles through the EnhancedPivotTracker.update() method
3. Add signal handling code to act on pivot detections

## Backtesting Behavior

### Sequential Trading: One Trade at a Time

The backtesting engine is designed to simulate trading realistically by handling only **one trade at a time**. It will not open a new position if another one is already active.

A trade must be fully completed (either by hitting its take-profit, stop-loss, or being cancelled) before the system will look for the next trading opportunity. This ensures the backtest results accurately reflect a strategy that doesn't manage multiple concurrent positions.

## Console Output

The application provides detailed console output during backtesting:

### Initial Setup
- Strategy configuration display
- Data source information (API or cache)
- Candle fetch statistics

### Trade Details
When `showTradeDetails` is enabled in config:
- Entry and exit prices
- Raw price movement and P&L
- Capital changes
- Maximum favorable/adverse excursions
- Trade timing and duration
- **New**: Complete edge data at entry time, including:
  * Current edge position percentages with direction indicators (U/D)
  * Average edge data for daily/weekly/monthly timeframes
  * Range/total edge movements for comprehensive analysis
  * Edge data is captured exactly at trade entry (order fill time), not at exit
  * System guarantees edge data presence even if pivot data is incomplete

Example trade details with edge data:
```
[TRADE 1] LONG | Entry: 110341.19 | Exit: 110506.70 | Move: 0.15% | P&L: 0.88% | Capital: $100.00 → $100.88 | WIN

Edges: D:+0.5%(U) W:+2.0%(U) M:+2.5%(U)
Average Edge D:+1.8%(U) W:+5.7%(U) M:+10.7%(U) | Range/Total Edge D:+1.3%(U) W:+4.1%(U) M:+11.9%(U)

  Max Favorable: +0.17%
  Max Adverse:   -9.05%
  Order Time: Tuesday   2025-05-27 02:31:00 PM
  Entry Time: Tuesday   2025-05-27 02:35:00 PM
  Exit Time:  Monday    2025-06-09 10:29:00 PM
  Duration:   13 days, 7 hours, 54 minutes
```

### Pivot Points
When `showPivot` is enabled in config:
- Real-time pivot detection display
- **New**: Pivots are now numbered sequentially (1, 2, 3, ...), providing a unique ID for every pivot.
- Pivot price and type (high/low)
- Swing percentage and duration
- Accurate timestamps showing both pivot time and candle time
- Improved pivot detection with closing price confirmation
- Validation to ensure pivot data matches actual candle data
- **New**: Enhanced pivot detection algorithm with proper timestamp handling
- **New**: Complete candle data storage for both extreme and confirmation points
- **New**: Proper implementation of `confirmOnClose` setting for accurate pivot confirmation
- **New**: Enhanced predictive pivot detection using 2 minimum leg bars (reduced from 3)
- **New**: Earlier pivot signals while maintaining the 0.3% minimum swing requirement

### Limit Orders
When `showLimits` is enabled in config:
- Limit order placement details
- Order cancellation events
- Price movement analysis
- Cancellation reasons
- **New**: The backtest summary now explicitly states if a trade was `CANCELLED/NOT FILLED`, providing a clearer picture of your strategy's behavior.

### Final Summary
- **New Trade Details Section**: If you set `showTradeDetails: true` in `config/tradeconfig.js`, the final summary will now include a "Trade Details" section. This provides a full breakdown of every single trade, including P&L, entry/exit times and prices, duration, and the specific edge data at the time of the trade.
- Date range and elapsed time
- Total trade count and win rate
- Overall P&L statistics
- **Excursion Analysis**:
  - **Favorable Excursion (MFE)**: This shows the maximum *potential* profit a trade reached while it was open. For example, if a trade closed with a 1.2% profit, but at one point was up by 2.5%, the favorable excursion is +2.5%. This helps you see if your take-profit targets are too tight.
  - **Adverse Excursion (MAE)**: This shows the maximum amount a trade went *against* you before it was closed. For example, a winning trade might have been in a -0.5% loss before turning profitable. This helps you analyze if your stop-loss levels are appropriate.
- Trade Durations (now correctly formatted in days, hours, and minutes)

### Edge-Enhanced Backtesting

#### Setup
1. Run `node generators/generateEdgePivots.js` to calculate edge data
2. Run `node backtestWithEdges.js` to backtest with edge analysis

#### Edge Information
For each pivot and limit order, you'll see edge proximity data:
```
D:+1.8%(U) W:-1.4%(L) M:+2.1%(U)
```
Where:
- D/W/M: Daily/Weekly/Monthly timeframe
- +/-: Sign indicates position relative to period start price
- %: Percentage movement from period start
- U/D: Direction indicator (Up when price is above period start, Down when below)

This helps identify trades near significant market edges across multiple timeframes.

### Advanced Limit Order Edge Data

Limit orders now maintain accurate and consistent edge data throughout their lifecycle:

- Orders inherit edge data directly from their parent pivots
- Edge data updates dynamically as market conditions change
- Consistent edge values displayed between pivots and their orders
- Improved accuracy in trade analysis and decision-making
- Complete edge data available in trade logs and reports

The system uses a specialized LimitOrderHandler module that:
1. Creates limit orders with proper edge inheritance
2. Updates order edge data using historical market data from configured symbol and interval
3. Maintains references to parent pivots for consistent tracking
4. Handles symbol and interval configuration gracefully with proper fallback options

### Performance Mode
- Set `performanceMode: true` in config to disable detailed console output
- Useful for running multiple backtests quickly
- Only critical errors will be displayed

## Viewing Backtest Results

### Chart Interface
1. Run a backtest first using the main application
2. Open `charts/backtest_chart.html` in your browser
3. The chart will automatically load the latest backtest results

### Chart Components
- **Price Action Chart**: Shows price movement and trade entries
  * Green dots: Long entries
  * Red dots: Short entries
  


- **Statistics Panel**:
  * Trade count and win rate
  * Best and worst trades
  * Average trade duration

- **Performance Metrics**:
  * Sharpe ratio

### Troubleshooting
- If no data appears, ensure you've run a backtest first
- Check browser console for any error messages
- Verify that the pivot cache files exist in data/pivots/
