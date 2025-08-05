# BNB Scalper - User Guide

## Overview
A comprehensive trading toolkit for BNB/USDT scalping, featuring real-time price tracking, Renko charting, and compound profit calculations. Optimized for 50x leverage trading with 0.08% target moves.

## Configuration

### Multiple Concurrent Trades (New!)
You can now configure the backtester to handle multiple trades simultaneously:
- Set `maxConcurrentTrades` in `tradeconfig.js` to control how many trades can be open at once
  - Default: `1` (original behavior)
  - Example: `3` allows up to three trades to be open simultaneously

### Position Sizing Options (New!)
Control how trade sizes are calculated with these options in `tradeconfig.js`:
- `positionSizingMode`: Choose between:
  - `'percent'`: Each trade uses X% of capital (uses `riskPerTrade` setting)
  - `'fixed'`: Each trade uses a consistent amount of capital
- `amountPerTrade`: Fixed USDT amount per trade when using fixed mode
  - Example: `10` will use exactly 10 USDT per trade (if available)

### Data Source Settings
- Set `useLocalData` in `config.js` to control data source:
  - `false`: Live data from Bybit/Binance API (default)
  - `true`: Use local historical data from CSV files
- System automatically falls back to API if local data isn't available

### Time Settings
You can now configure the chart's timeframe in `config.js`:
- Set `time` to your desired interval ('1m', '5m', '15m', '1h', etc.)
- Example: `export const time = '1m'` for 1-minute candles
- The Renko chart will automatically adjust to your chosen timeframe

## Components

### 0. Analysis Tools
- Integrated backtesting and analysis system
- Shared data processing between analysis and trading
- Consistent calculations and formatting
- Reliable pivot detection across all components
- Detailed P&L analysis including:
  * Highest and lowest winning trade P&L
  * Highest and lowest losing trade P&L
  * Exported to JSON and CSV summary files
  * Helps identify best and worst trade performance


### 1. Real-Time Price Tracking
- Live BNB/USDT price updates via fronttest.js
- Optimized WebSocket processing for better performance
- 24-hour high/low tracking
- Volume monitoring with detailed candle information
- Choice of Binance or Bybit data feeds
- Simplified price tracking without unused TP/SL functionality

### 2. Renko Chart Visualization
- Dynamic block formation based on price movements
- Block size: 100 USDT (configurable in config.js)
- Interactive tooltips with price information
- Dark theme for extended trading sessions
- Customizable block sizes
- Adjustable price scale increments (default: $0.50)

### 3. Profit Calculator
- Compound interest projections
- Trade frequency modeling
- Capital growth visualization

### 4. Smart Order Management
- Automatic limit order cancellation
- Dynamic thresholds based on market volatility
- Protection against adverse price movements
- Configurable cancellation sensitivity

### 5. Optimization Tools
- Parallel backtest optimization with `pivotOptimizer.js`
- Multi-core processing for faster parameter sweeps
- Automatically uses all available CPU cores
- Generates comprehensive CSV result files
- Finds optimal take-profit and stop-loss combinations
- Displays top 5 most profitable parameter sets

## Quick Start

1. **Configuration** (edit `config.js`):
   ```javascript
   api: 'bybit'                    // or 'binance'
   time: '1m'                      // timeframe
   limit: 120                     // number of candles
   renkoBlockSize: 1.3             // in USDT
   averageSwingThresholdPct: 100   // % of average swing to use as threshold
   showThresholdTrades: true       // show details of trades above threshold
   ```

2. **Launch Components**:
   - Open `simple_chart3.html` for the Renko chart
   - Run `compound.js` for profit projections
   - Use `bybit_ws.js` for standalone price monitoring

## Trading Strategy Integration
- Down→Up reversal focus (60% success rate)
- Volatility bands: 0.03-0.04% range
- Target: 0.08% raw moves (4% leveraged)
- Risk management with 2% stop-loss

## Troubleshooting

### Price Feed Issues
1. Check internet connection
2. Verify API access
3. Restart WebSocket connection
4. Use a VPN if you're in a country with strict internet regulations (e.g. Nigeria)

### Chart Display Problems
1. Clear browser cache
2. Check console for errors
3. Verify configuration settings

## Support
For technical issues or feature requests, please check the technical documentation or submit an issue through the project repository.
