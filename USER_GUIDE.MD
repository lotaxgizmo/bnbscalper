# User Guide

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

### Pivot Points
When `showPivot` is enabled in config:
- Real-time pivot detection display
- Pivot price and type (high/low)
- Swing percentage and duration
- Timestamp of pivot formation

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
- +/-: Position relative to edge
- %: Percentage to edge
- U/L: Upper/Lower edge

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
