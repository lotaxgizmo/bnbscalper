# BNB Scalper - User Guide

## Overview
A comprehensive trading toolkit for BNB/USDT scalping, featuring real-time price tracking, Renko charting, and compound profit calculations. Optimized for 50x leverage trading with 0.08% target moves.

## Components

### 1. Real-Time Price Tracking
- Live BNB/USDT price updates
- 24-hour high/low tracking
- Volume monitoring
- Choice of Binance or Bybit data feeds

### 2. Renko Chart Visualization
- Dynamic block formation based on price movements
- Interactive tooltips with price information
- Dark theme for extended trading sessions
- Customizable block sizes

### 3. Profit Calculator
- Compound interest projections
- Trade frequency modeling
- Capital growth visualization

## Quick Start

1. **Configuration** (edit `config.js`):
   ```javascript
   api: 'bybit'           // or 'binance'
   time: '1m'             // timeframe
   limit: 120             // number of candles
   renkoBlockSize: 1.3    // in USDT
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
