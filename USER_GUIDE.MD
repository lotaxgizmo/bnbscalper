# User Guide

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

#### Real-Time Trading Capability

The EnhancedPivotTracker class is designed for real-time operation with these features:
- Candle-by-candle processing for efficient memory usage
- Stateful design that maintains trend direction between updates
- Proper timestamp handling for accurate pivot identification
- Complete pivot data with price, time, and move percentage information
- Proper handling of closing price confirmation when `confirmOnClose` is true
- Storage of both extreme and confirmation candle data for validation

To adapt for real-time use:
1. Replace the historical data source with a WebSocket connection
2. Process incoming candles through the EnhancedPivotTracker.update() method
3. Add signal handling code to act on pivot detections

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

### Final Summary
- Date range and elapsed time
- Total trade count and win rate
- Overall P&L statistics
- Capital growth analysis
- Excursion analysis

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
  
- **Capital Chart**: Displays account balance over time
  * Shows cumulative profit/loss
  * Tracks capital growth

- **Statistics Panel**:
  * Trade count and win rate
  * Best and worst trades
  * Average trade duration

- **Performance Metrics**:
  * Starting and final capital
  * Total return percentage
  * Maximum drawdown
  * Sharpe ratio

### Troubleshooting
- If no data appears, ensure you've run a backtest first
- Check browser console for any error messages
- Verify that the pivot cache files exist in data/pivots/
