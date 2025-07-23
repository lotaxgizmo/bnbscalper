# Technical Documentation

## Pivot Data System Updates

### Recent Updates

#### Predictive Pivot Detection Enhancement
- Reduced minimum leg bars from 3 to 2 for earlier pivot detection
- Maintains the 0.3% minimum swing percentage requirement
- Provides earlier trade signals while maintaining pivot quality
- Optimized for live trading to reduce lag between extreme time and confirmation time
- Allows for more timely limit order placement near pivot points

### Recent Fixes

#### Timestamp Discrepancy Fix
- Fixed timestamp display discrepancy between console output and actual pivot data
- Console now shows both pivot time and candle time for clarity
- Added displayTime property to pivot objects for consistent time formatting

#### Price Identification Improvements
- Enhanced pivotTracker.js to properly handle confirmOnClose setting
- System now correctly uses closing prices for pivot confirmation when confirmOnClose is true
- Maintains tracking of actual high/low prices for pivot point identification
- Added validation to ensure pivots match actual candle data

#### Batch Processing Enhancement
- Modified generatePivotData.js to process candles in a single pass
- Eliminated batch boundary issues that could cause missed pivots
- Added candle data validation to each pivot for verification
- Improved chronological processing to ensure accurate pivot detection

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
- Displays both pivot time and candle time for accurate timestamp representation
- Uses pivot.displayTime for consistent time formatting

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
- Capital changes and returns
- Favorable and adverse price excursions
- Trade durations and timing
- Data exported to JSON and displayed in console output
- Helps identify trade performance extremes
