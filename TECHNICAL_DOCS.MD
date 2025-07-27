# Technical Documentation

## Pivot Data System Updates

### Recent Updates

#### Trading Fee Implementation and Profitability Tuning (July 2025)
- **Issue**: After implementing leveraged profit calculations, the backtest was still not providing a realistic simulation because trading fees were not being deducted. This led to an overestimation of the strategy's profitability.
- **Fix**: The `formatTradeResult` method in `utils/backtest/backtestController.js` was updated to calculate and deduct trading fees from the gross profit of each trade. The fee is calculated based on the `totalMakerFee` percentage applied to the full leveraged position size.
- **Profitability Tuning**: The initial implementation of fees revealed that the strategy's `takeProfit` target (`0.015%`) was lower than the trading fee (`0.04%`), making every trade unprofitable. The `takeProfit` value in `config/tradeconfig.js` was adjusted to `0.2%` to ensure the strategy could overcome trading costs.

#### Corrected Leveraged Profit Calculation (July 2025)
- **Issue**: The final profit and capital displayed in the backtest summary were not correctly reflecting the configured leverage. While the per-trade P&L percentage was shown with leverage, the underlying currency profit (`pnlValue`) was calculated on an unleveraged basis.
- **Fix**: The `pnlValue` calculation in `utils/backtest/backtestController.js` was updated to multiply the raw profit by the leverage factor (`this.config.leverage`). This ensures that the absolute currency profit for each trade, and consequently the final capital summary, is accurately calculated based on the leveraged position size.

#### Logging System Enhancements (July 2025)
- **Sequential Pivot Numbering**: The pivot numbering system in the `EdgeConsoleLogger` has been corrected. Pivots are now assigned a unique, sequential number (1, 2, 3, ...) instead of being numbered in pairs. This provides a clearer and more accurate count of all detected pivots during a backtest.

- **Consolidated Trade Details Summary**: The display of trade details has been fixed and improved.
  - **Root Cause Fix**: The core issue was resolved by ensuring the `showTradeDetails` configuration from `tradeconfig.js` is correctly initialized in the base `ConsoleLogger` constructor.
  - **New Summary Section**: The `EdgeConsoleLogger` now includes an overridden `logFinalSummary` method. When `showTradeDetails` is `true`, this method appends a new "Trade Details" section to the end of the backtest report. This section contains a full, detailed breakdown of every trade executed during the run, keeping the real-time log clean while providing comprehensive data in the final summary.

#### Robust Logging for Unfilled Trades (July 2025)
- **Issue**: The backtesting script would crash with a `TypeError` if it attempted to log the details of a trade that was never filled (e.g., a cancelled limit order).
- **Fix**: The `EdgeConsoleLogger.logTradeDetails` method was updated to handle these cases gracefully.
- **Implementation**:
  - The logger now checks if `trade.entryPrice` is `undefined` or `null`.
  - If the trade was not filled, it logs a clear `[TRADE X] CANCELLED/NOT FILLED` message, including the cancellation reason if available.
  - This prevents the script from crashing and provides more transparent logging in the backtest output, improving the reliability of the testing suite.

#### Backtest Output Refactoring (July 2025)
- **Issue**: The backtest console output was cluttered and difficult to read due to interleaved log messages from different parts of the system. Pivot details and trade events were not logged sequentially.
- **Fix**: A new `BacktestController` class (`utils/backtest/backtestController.js`) was introduced to orchestrate the backtesting process and centralize all console logging.
- **Implementation**:
  - The `TradeExecutor` was refactored to remove all direct `console.log` calls. It now returns trade lifecycle data (order creation, fill, close) to the controller.
  - The main `backtestWithExecutor.js` script now instantiates and runs the `BacktestController`.
  - The `BacktestController` iterates through pivots, calls the `TradeExecutor` for each, and then logs the pivot and all resulting trade events in a clean, sequential order using the `EdgeConsoleLogger`.
  - This ensures that pivot logs are immediately followed by the logs of the trades they generate, improving readability and making the backtest output much easier to analyze.

#### Backtest Refactoring (July 2025)
- **Capital Tracking Removed**: The backtesting scripts (`backtestWithExecutor.js`) and statistics calculation (`utils/backtest/backtestStats.js`) have been refactored to remove all capital tracking logic.
  - The backtest no longer simulates portfolio growth or tracks initial/final capital.
  - The focus is now solely on individual trade performance metrics like P&L percentage, win rate, and excursions.
  - `backtestStats.js` no longer calculates or returns `finalCapital`, `totalReturn`, or `maxDrawdown`.
  - The console logger (`utils/backtest/consoleLogger.js` and `utils/backtest/edgeConsoleLogger.js`) has been updated to remove all capital-related output.

#### Edge Proximity Trading System (July 2025)
- Added intelligent edge proximity detection system for safer trading
- Configurable threshold for proximity to average daily edge (default 90%)
- Supports two actions when near edge: skip trading or reverse direction
- Complete integration with edge analysis data
- Visual alerts when edge proximity detected
- Used in BacktestEngine for both backtesting and live trading
- Compatible with existing edge data format

##### Edge Proximity Detection Details
- **Implementation**: Located in `BacktestEngine.checkEdgeProximity()`
- **Configuration**:
  * `edgeProximityEnabled` (boolean): Enables/disables the feature
  * `edgeProximityThreshold` (number): Percentage of average daily edge to trigger action
  * `edgeProximityAction` (string): Action to take - 'noTrade' or 'reverseTrade'
- **Algorithm**:
  * Calculates pivot's current move as a percentage of average daily move
  * Uses monthly average for stability and consistency
  * Threshold triggers when current move >= threshold % of average move
  * Logs detailed proximity information via EdgeConsoleLogger
  * Returns decision object with shouldTrade and originalDirection properties
- **Debug Mode**:
  * Debug logging has been removed from backtestEngine.js as of July 24, 2025
  * For debugging, use the EdgeConsoleLogger which still shows concise edge data
  * Logging is now focused on trade signals rather than internal calculations
- **Edge Data Display**:
  * Trade details now display complete edge data at entry time
  * Shows current edge position percentages with direction (U/D)
  * Includes average edge data for daily/weekly/monthly timeframes
  * Displays range/total edge movements for comprehensive analysis
  * Guaranteed edge data capture at order fill time (trade entry)
  * Uses pivot's exact edge data for orders (after July 24, 2025 fix)
  * Dynamic edge data updates via LimitOrderHandler module (July 24, 2025 enhancement)
  * Formats edge data in clear sections beneath trade summary
  * Consistent edge data between pivots and their derived orders
  * Visual formatting with box-style borders and color-coded metrics (July 2025 enhancement)
  * Color differentiation between timeframes (D/W/M) and movement directions (U/D)

#### Limit Order Handler Module (July 24, 2025)
- Specialized utility for managing limit orders with dynamic edge data updates
- Handles proper edge data inheritance from pivot to order
- Updates order edge data in real-time using historical data
- Uses same edge calculation algorithm as generateEnhancedPivotData.js
- Always uses actual historical data for accurate edge calculations
- Maintains reference to parent pivot for consistency and troubleshooting
- Integrates with backtestEngine.js for seamless limit order processing

#### Market Order Edge Data Testing (July 2025)
- Implemented test script for market orders with real edge data (testLimitOrderEdgeData.js)
- Generates a small number of random market orders (5 by default)
- Uses real candle data to calculate accurate edge metrics
- Eliminates dependency on synthetic pivot-based edge data
- Directly leverages LimitOrderHandler for edge data calculation
- Intelligently spaces test orders across different weeks for varied edge data
- Uses full historical candle dataset (all available candles) to ensure sufficient data for week-based spacing
- Calculates appropriate week spacing based on the selected interval
- Prevents orders from sharing the same weekly average edge metrics
- Demonstrates dynamic edge data updates over time (5-minute intervals)
- Shows percentage changes in edge positioning for daily/weekly/monthly timeframes
- Displays actual price changes after the 5-minute interval with:
  * Clear initial and current price display with directional arrow
  * Absolute price change values (e.g., +123.45)
  * Percentage price change values (e.g., +0.123%)
  * Color-coding (green for positive, red for negative) for quick visual assessment

#### Scheduled Limit Order Testing (July 2025)
- Implemented test script for scheduled limit orders (testScheduledLimitOrder.js)
- Creates a limit order at a specified time with configurable parameters:
  * Scheduled execution time (exact timestamp)
  * Custom price or market price at time of execution
  * Configurable position size (dollar amount)
  * Optional take profit percentage (disabled if set to 0)
  * Optional stop loss percentage (disabled if set to 0)
  * Trade direction  * Supports both BUY and SELL orders
  * Order distance percentage for testing pending orders
  * Configurable position update frequency (default: every 1000 candles in test config)
  * Configurable simulation length (default: 1000 candles)
- Detailed edge data metrics:
  * Daily, weekly, and monthly position
  * Average move calculations
  * Dynamic updates throughout the trade lifecycle
- Complete position tracking:
  * Real-time PnL calculations
  * Configurable periodic position updates
  * Final trade outcome with result metrics
- The simulation runs for a maximum of 1000 candles after the scheduled order time or until a TP/SL condition is met
- Provides comprehensive edge data at each stage of the trade
- Displays real-time position updates with current P&L
- Fully compatible with existing edge data system
- Enhanced visual formatting with separate lines for price data and edge data
- Provides comprehensive logging via EdgeConsoleLogger
- Market orders maintain required properties for compatibility with existing loggers
- Serves as validation test for edge data inheritance and update functionality
- Compatible with both enhanced and standard pivot data formats

#### Enhanced Pivot Detection System (July 2025)
- Completely redesigned pivot detection algorithm with improved timestamp accuracy
- Implemented proper handling of `confirmOnClose` setting to use closing prices for pivot confirmation
- Preserves extreme price tracking while using closing prices for confirmation
- Stores both extreme candle and confirmation candle for complete validation
- Increased batch overlap to ensure no pivots are missed at batch boundaries
- Added metadata to pivot cache to track algorithm version and settings

#### Predictive Pivot Detection Enhancement
- Reduced minimum leg bars from 3 to 2 for earlier pivot detection
- Maintains the 0.3% minimum swing percentage requirement
- Provides earlier trade signals while maintaining pivot quality
- Optimized for live trading to reduce lag between extreme time and confirmation time
- Allows for more timely limit order placement near pivot points

### Recent Fixes

#### Scheduled Limit Order Test Script Fixes (July 2025)
- **Issue**: The test script was failing with a `SyntaxError` due to a duplicated class declaration and incorrect constructor logic that ignored some configuration parameters like `simulationLength`.
- **Fix**: The script was refactored to remove the duplicate class and the constructor was corrected to accept the entire configuration object, ensuring all parameters are properly applied.
- **Benefit**: The test now runs reliably and accurately simulates scheduled orders based on the exact configuration provided, improving testing fidelity.


#### Timestamp Discrepancy Fix
- Fixed timestamp display discrepancy between console output and actual pivot data
- Console now shows both extreme time and confirmation time for enhanced pivots
- Added displayTime property to pivot objects for consistent time formatting
- Pivot objects now store both extreme time and confirmation time for complete audit trail
- Updated EdgeConsoleLogger to match the timestamp format used in pivotTimestampTest.js
- Implemented Date.toLocaleString() for consistent timestamp display across the application
- Fixed backtestWithEdges.js to properly display both timestamps in the same format
- Added timestamp format normalization to handle both millisecond and second timestamps
- Ensured consistent timestamp display across all backtest outputs

#### Price Identification Improvements
- Created new `enhancedPivotWorker.js` with proper handling of the confirmOnClose setting
- System now correctly uses closing prices for pivot confirmation when confirmOnClose is true
- Maintains tracking of actual high/low prices for pivot point identification
- Added validation to ensure pivots match actual candle data
- Stores complete candle data for both extreme and confirmation points

#### Batch Processing Enhancement
- Modified `generateEnhancedPivotData.js` to use the improved pivot detection algorithm
- Increased batch overlap size from 2x to 3x the long window to eliminate boundary issues
- Enhanced candle data validation for each pivot with full candle storage
- Improved chronological processing to ensure accurate pivot detection
- Added algorithm version tracking in saved pivot data

### Testing Tools

#### pivotTimestampTest.js
- Lightweight, single-file test script for verifying pivot timestamp accuracy
- Features:
  * Loads a subset of candle data from local JSON file
  * Implements simplified PivotTracker with proper timestamp handling
  * Attaches candle data to each pivot for validation
  * Simulates mini backtest to verify timestamp display
  * Processes all pivots without targeting specific timestamps
  * Validates pivot prices against actual candle highs/lows
  * Real-time ready architecture with candle-by-candle processing
- Usage: `node pivotTimestampTest.js`
- Dependencies: Requires candle data in `data/historical/SYMBOL/INTERVAL.csv` format
- Output: Detailed console logs showing pivot timestamps, prices, and validation results
- Real-Time Capability: Core PivotTracker class is designed with a stateful, event-driven architecture suitable for streaming data integration

#### enhancedPivotWorker.js
- Improved worker implementation for parallel pivot detection
- Features:
  * Built-in EnhancedPivotTracker class with proper timestamp handling
  * Correctly implements confirmOnClose setting for pivot confirmation
  * The simulation runs for a maximum of 1000 candles after the scheduled order time or until a TP/SL condition is met
  * Preserves all edge calculation functionality from the original worker
  * Maintains backward compatibility with existing edge data structures
  * Adds validation data to ensure pivots match actual candle data
- Integration: Used by `generateEnhancedPivotData.js` for parallel processing
- Compatibility: Produces enhanced pivot data that works with existing backtesting tools

## Console Logger System

### Overview
The console logging system has been modularized into a dedicated ConsoleLogger class that handles all output formatting and display logic. This separation improves code organization and maintainability.

### Components

#### ConsoleLogger Class (utils/backtest/consoleLogger.js)
- Handles all console output formatting
- Configurable through performance mode
- Methods:
  * logInitialConfig: Display initial trade settings
  * logCacheStatus: Show pivot cache status
  * logFetchDetails: Display candle fetch information
  * logTradeDetails: Format and show individual trade results
  * logFinalSummary: Display comprehensive backtest results
  * logExportStatus: Confirm data export completion
  * logError: Format and display error messages
  * logPivot: Display pivot point detection and details
  * logLimitOrder: Show limit order events and cancellations

### Integration
- Used by backtest.js for all console output
- Extended by EdgeConsoleLogger for edge-enhanced backtesting
- Respects performance mode settings
- Maintains consistent color coding and formatting
- Centralizes all output string templates

### Edge-Enhanced Backtesting

#### EdgeConsoleLogger Class (utils/backtest/edgeConsoleLogger.js)
- Extends ConsoleLogger with edge proximity data display
- Shows edge percentages for daily, weekly, and monthly timeframes
- Format: `D:+1.8%(U) W:-1.4%(L) M:+2.1%(U)`
  * D/W/M: Daily/Weekly/Monthly timeframe
  * +/-: Position relative to edge
  * %: Percentage to edge
  * U/L: Upper/Lower edge
- Enhanced pivot display with dual timestamp support:
  * Shows both extreme time and confirmation time for enhanced pivots
  * Format: `Extreme: 7/21/2025, 6:10:00 PM | Confirm: 7/21/2025, 6:29:00 PM`
  * Ensures accurate representation of when pivots actually formed vs. when they were confirmed
  * Maintains compatibility with legacy pivot format
- Uses pivot.confirmTime for enhanced pivots and pivot.displayTime for legacy pivots

#### Edge Data Flow
1. generateEdgePivots.js calculates edge data for all timeframes
2. backtestWithEdges.js loads edge-enhanced pivot cache
3. PivotTracker preserves edge data during pivot detection
4. EdgeConsoleLogger formats and displays edge proximity

#### Edge Calculation
- Calculated relative to period start price
- Maintains directional accuracy:
  * Position: Shows percentage from period start to current price
    - Positive when price is above period start
    - Negative when price is below period start
  * Range: Shows maximum range within the period as a percentage
    - Calculated as (high-low)/reference
    - Always positive value representing volatility
  * Direction indicators (U/D) match the sign of the percentage
    - U (Up): Current price above reference
    - D (Down): Current price below reference
  * Negative when price below period start
  * Positive when price above period start
- Uses candle.open for period start
- Uses candle.close for current price

#### Integration Points
- Uses same pivot cache system as regular backtest
- Maintains backward compatibility through class extension
- Edge data preserved throughout backtest pipeline

## Chart System

### Backtest Chart (charts/backtest_chart.html)
- Dynamic chart visualization of backtest results
- Reads data directly from pivot cache system
- Uses Chart.js for rendering
- Components:
  * Price action chart with trade entries
  * Capital growth tracking
  * Trade statistics display
  * Performance metrics panel

### Data Flow
1. Backtest.js saves results to pivot cache
2. Chart loads data using `loadPivotData` from pivotCache.js
3. Renders visualizations using cached data

### Integration Points
- Uses same configuration as backtest system
- Shares pivot cache with main application
- Maintains consistent styling and theming

## Backtesting System

## Parallel Processing

### Backtesting Optimization
The backtesting optimizer uses Node.js worker threads to parallelize optimization runs:

1. Main Process (backtestOptimizer.js):
   - Divides total iterations among 4 worker threads
   - Distributes workload evenly
   - Collects and combines results

2. Worker Process (backtestWorker.js):
   - Handles subset of optimization iterations
   - Runs backtests independently
   - Returns results to main process

This parallel approach provides approximately 4x speedup over sequential processing.

### Enhanced Pivot Data Generation
The pivot data generation system uses parallel processing for faster execution:

1. Main Process (generateEnhancedPivotData.js):
   - Configurable number of worker threads (NUM_WORKERS)
   - Splits candle data into equal batches based on NUM_WORKERS
   - Spawns worker threads for each batch
   - Merges and sorts results chronologically

2. Worker Process (pivotWorker.js):
   - Processes assigned candle batch
   - Detects pivots and calculates edge data
   - Returns pivot data to main process

Key benefits:
- Approximately 4x faster pivot generation
- Better CPU resource utilization
- Maintains data integrity through chronological sorting
- Preserves exact pivot detection accuracy

## Performance Metrics

The system tracks various performance metrics including:

- Trade success rates and win/loss ratios
- P&L calculations with leverage and fees
  * Highest and lowest winning trade P&L values
  * Highest and lowest losing trade P&L values
- Favorable and adverse price excursions
  - The `TradeExecutor` now tracks the maximum favorable and adverse price movements for each trade.
  - This data is passed to `BacktestStats` for accurate excursion analysis in the final summary.

#### Excursion Calculation Fix (July 2025)
- **Issue**: The backtest summary consistently reported Favorable and Adverse Excursion values as 0.00% or NaN.
- **Root Cause**: A typo in `utils/backtest/tradeExecutor.js` within the `updateExcursions` method. The calculation was attempting to use `this.order.entryPrice`, which was `undefined`. The correct property, set when an order is filled, is `this.order.fillPrice`.
- **Fix**: The property reference was corrected from `this.order.entryPrice` to `this.order.fillPrice`. This ensures that the excursion calculations are performed using the actual fill price of the trade, resulting in accurate, non-zero excursion statistics.
- **Simulation Loop Correction**: The simulation loop in `TradeExecutor.run()` was also refined to ensure `updateExcursions()` is called for every candle a trade is active, from the fill candle to the exit candle, guaranteeing data is captured even for trades that open and close on the same candle.
- Trade durations and timing
  - Durations are now correctly calculated in milliseconds and formatted into a human-readable `days, hours, minutes` string.
- Data exported to JSON and displayed in console output
- Helps identify trade performance extremes
