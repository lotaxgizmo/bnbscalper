# BNB Scalper - Technical Documentation

## Recent Updates

### Rate Limit Testing Utility Added (2025-07-18)
- Added `testRateLimits.js` for testing Bybit API rate limits
- Tests sequential requests with configurable delays
- Tests concurrent request handling
- Logs response times and rate limit errors
- Saves detailed results to `rateLimit_test_results.txt`


### Duration Formatting Fix (2025-07-18)
- Fixed duration calculations in backtest.js to properly convert milliseconds to minutes
- Individual trade durations now show correct time periods
- Total trade duration accurately reflects the configured candle limit
- Added Total Analysis Duration showing time between first and last pivot points
- Works correctly with any candle interval (1m, 5m, 15m, 1h, etc.)
- Affects both trade-specific and summary duration displays


### Shared Utilities Refactoring (2025-07-18)
- Created `utils/candleAnalytics.js` for shared candle handling
- Consolidated common functions from `backtest.js` and `index3.js`
- Improved code reuse and consistency between analysis and backtesting
- Updated imports to use shared formatters and utilities



### Limit Order Auto-Cancellation Added (2025-07-18)
- Added automatic cancellation of limit orders when price moves too far in opposite direction
- Uses `averageSwingThresholdPct` from trade configuration
- Cancels buy orders when price rises above entry by threshold percentage
- Cancels sell orders when price falls below entry by threshold percentage
- Displays cancellation details with price levels and percentage moves

### Configurable Swing Threshold Added (2025-07-18)
- Added `averageSwingThresholdPct` configuration in config.js
- Allows setting threshold as a percentage of average swing size
- Example: 50% shows swings ≥ half of average, 200% shows double
- Default set to 100% (exact average)
- Added `showThresholdTrades` boolean to display detailed trade information


### Backtesting Delay Support Added (2025-07-18)
- Added support for delay configuration in index3.js
- Allows backtesting from specific historical points
- Uses delay value from config.js (in interval units)
- Applies delay relative to current time

### Pivot Numbering Added (2025-07-18)
- Added sequential numbering to pivot points in index3.js
- Each pivot is now displayed with a unique identifier [PIVOT N]
- Pivot objects store their sequence number for reference
- Enhances tracking and referencing of specific pivot points

### Chart Price Scale Configuration (2025-07-17)
- Added configurable price scale increments in simple_chart3.html
- Y-axis ticks now support custom stepSize for price intervals
- Default stepSize set to 0.5 USDT
- Price display maintains 4 decimal precision

### Chart Time Configuration (2025-07-14)
- Fixed time configuration in simple_chart3.html to use config.js settings
- Chart now properly respects timeframe settings from config.js (1m, 5m, 15m, 1h, etc.)
- Renko blocks accurately reflect the chosen time interval
- Time configuration is now consistently applied across the application

### Recent Configuration Updates (2025-07-19)

#### Time Variable Standardization
- Fixed variable naming inconsistency in index.js
- Standardized usage of 'interval' instead of 'time' for timeframe references
- Updated getTimeInMinutes() and printCandleData() calls
- Ensures consistent timeframe handling across the application

#### Renko Configuration
- Changed Renko block size from 10 USDT to 100 USDT for better visualization
- Updated chart display to reflect new block size
- Affects all chart visualizations in simple_chart*.html files

### Data Source Configuration
1. **Local vs API Data**
   - `useLocalData` flag in config.js controls data source
   - When true: Uses local CSV files for historical data
   - When false: Uses live API data from Bybit/Binance
   - Automatic fallback to API if local data unavailable

2. **Data Flow**
   - Primary path: config.js → bybit.js/binance.js → candleAnalytics.js
   - Local data read through readLocalCandles() in bybit.js
   - API data fetched through getCandles() with pagination support
   - Maximum 500 candles per API batch to respect rate limits

### Historical Data System
1. **File Management**
   - Automated directory creation for data storage
   - CSV-based storage with standardized naming (e.g., '1m.csv', '1h.csv')
   - Timestamp tracking for incremental updates

2. **Data Processing**
   - Validation and sorting of candle data
   - Missing range detection and filling
   - Interval standardization (appends 'm' suffix for minute-based intervals)

3. **Update Management**
   - Tracks last update times per symbol/interval
   - Incremental updates to avoid redundant fetches
   - Handles data gaps and overlaps

4. **Data Validation**
   - Ensures chronological order
   - Validates candle integrity
   - Manages data consistency

### Configuration Parameters
1. **Time and Limits**
   - Custom time calculation using months, days, hours, minutes
   - Flexible limit calculation (weekly, daily, hourly, minute-based)
   - Current limit: 1440 candles
   - Delay configuration for historical data offset

2. **Chart Configuration**
   - Renko block size: 100 USDT
   - Time display options (full/abbreviated)

3. **Volatility Classification**
   - Medium: 85th percentile
   - High: 93rd percentile
   - Low: 10th percentile
   - Top: 99.55th percentile
   - Price percentile setting

4. **Pivot Detection Settings**
   - Minimum swing: 0.3%
   - Short window: 6 swings
   - Long window: 50 swings
   - Confirm on close: true
   - Minimum leg bars: 4
   - Average swing threshold: 100%

### Pivot System Architecture

1. **Pivot Cache System**
   - Persistent storage in JSON format
   - Dynamic file naming based on configuration
   - Metadata and pivot point storage
   - Cache management by symbol/interval

2. **Pivot Tracker**
   - Real-time pivot detection
   - Configurable parameters:
     * Minimum swing percentage
     * Volatility windows
     * Confirmation rules
     * Minimum leg requirements
   - State management for current swings
   - Historical pivot tracking

### Candle Processing System

1. **Basic Processing (candleProcessor.js)**
   - High-Low range analysis
   - Volatility tracking
   - Price averaging
   - Time normalization

2. **Advanced Processing (candleProcessor2.js)**
   - Close-to-close analysis
   - Enhanced statistics
   - Multiple volatility thresholds
   - Trend strength indicators

3. **Integration Points**
   - Pivot detection feed
   - Backtesting support
   - Chart visualization
   - Real-time analysis

### Formatting and Output System

1. **Time and Data Formatting**
   - Flexible duration displays
   - Interval conversion system
   - Smart pluralization
   - ANSI color coding

2. **Console Visualization**
   - Visual volatility markers (▲►•▼)
   - Color-coded price differences
   - Formatted time displays
   - Price component breakdown

3. **Statistical Output**
   - Volatility percentiles
   - Correction tracking
   - Duration summaries
   - Market statistics

4. **System Integration**
   - Analysis tool output
   - Backtesting reports
   - Market monitoring
   - Development feedback

### Exchange API Integration

1. **Bybit Integration**
   - REST API Implementation:
     * Historical data retrieval
     * Environment detection
     * Local data support
     * Rate limiting
   - WebSocket Feed:
     * Real-time updates
     * Auto-reconnection
     * Message validation
     * Symbol subscriptions

2. **Binance Integration**
   - REST API support
   - Compatible structures
   - Shared utilities
   - Cross-exchange support

3. **Environment Support**
   - Node.js features
   - Browser compatibility
   - Auto-detection
   - Dynamic imports

### Chart Visualization System

1. **Core Technology**
   - Chart.js Framework
   - Renko Block System
   - Real-time Updates
   - Interactive Elements

2. **Key Features**
   - Dark Theme Interface
   - Custom Tooltips
   - Dynamic Blocks
   - Price Visualization
   - Live Updates
   - Block Size: 100 USDT
   - Event Handling
   - Performance Optimization

3. **Data Handling**
   - Automatic Sorting
   - Block Generation
   - Price Tracking
   - Update Control
   - Historical Loading

4. **Visual Components**
   - Block Rendering
   - Price Markers
   - Current Price Display
   - Interactive Elements
   - Theme Management

### Testing and Backtesting System

1. **Backtesting Engine**
   - Strategy Testing:
     * Directional Trading
     * Leverage & Fees
     * Capital Management
   - Pivot Analysis:
     * Live Detection
     * Signal Generation
     * Historical Review
   - Results Analysis:
     * Trade Details
     * Statistics
     * Capital Growth
     * Time Analysis

2. **Rate Limit Testing**
   - Sequential Tests:
     * Request Control
     * Delay Management
     * Response Tracking
     * Success Monitoring
   - Concurrent Tests:
     * Load Testing
     * Error Handling
     * Performance Data
     * Detailed Logging

## System Architecture

### Core Components
1. **Data Providers** (`binance.js`, `bybit.js`)
   - REST API integrations
   - Historical data fetching
   - Rate limiting handling
   - Data normalization

2. **Real-time Feed** (`bybit_ws.js`)
   - WebSocket connection management
   - Price update handling
   - Snapshot vs. delta updates
   - Automatic reconnection

3. **Visualization** (`simple_chart3.html`)
   - Chart.js integration
   - Renko block generation
   - Real-time updates
   - Interactive features

4. **Analysis Tools** (`compound.js`)
   - Profit projection
   - Compound calculations
   - Performance metrics

5. **Configuration** (`config.js`)
   - System-wide settings
   - API selection
   - Timeframe management
   - Display preferences

## Code Organization and Dependencies

### Project Dependencies
```json
{
  "dependencies": {
    "axios": "^1.10.0",  // HTTP client for API requests
    "ws": "^8.18.3"     // WebSocket client for real-time data
  }
}
```

### Module Dependencies and Imports

1. **Main Application Entry Points**
```javascript
// index.js - Basic price analysis
import { getCandles as getBinanceCandles } from './binance.js'
import { getCandles as getBybitCandles } from './bybit.js'
import { api, time, symbol, limit, mediumPercentile, highPercentile, lowPercentile } from './config.js'
import { processCandleData, calculatePercentiles, trackCorrections } from './utils/candleProcessor.js'
import { formatDuration, getTimeInMinutes } from './utils/formatters.js'
import { printCandleData, printSummary } from './utils/consoleOutput.js'

// index2.js - Advanced movement analysis
// Additional imports for enhanced analysis features
import { processCandleData, calculatePercentiles, trackCorrections } from './utils/candleProcessor2.js'
import { printCandleData, printSummary } from './utils/consoleOutput2.js'
```

2. **Data Types and Structures**
```typescript
// Candle Data Structure
type Candle = {
  time: number;          // Unix timestamp in milliseconds
  open: number;          // Opening price
  high: number;          // Highest price
  low: number;           // Lowest price
  close: number;         // Closing price
  volume: number;        // Trading volume
  displayTime?: string;  // Formatted time string
  percentDiff?: string;  // Price movement percentage
  avgPrice?: string;    // Average price for the candle
}

// WebSocket Message Format
type WSMessage = {
  topic: string;         // Channel identifier (e.g., 'tickers.BNBUSDT')
  type: 'snapshot' | 'delta'; // Message type
  data: {
    lastPrice: string;   // Current price
    volume24h: string;   // 24h volume
    timestamp: number;   // Unix timestamp
  }
}
```

## Core Processes and Implementation

### 1. Data Provider Implementation

#### Binance Integration (`binance.js`)
```javascript
// Core Implementation
const BASE_URL = 'https://api.binance.com/api/v3';

// Candle Data Fetching Process
async function getCandles(symbol, interval, limit, customEndTime) {
  // 1. Initialize data structures
  const allCandles = [];
  let remainingLimit = limit;
  let endTime = customEndTime || Date.now();

  // 2. Batch processing with pagination
  while (remainingLimit > 0) {
    const batchLimit = Math.min(remainingLimit, 1000);
    const response = await fetchBatch(symbol, interval, batchLimit, endTime);
    
    // 3. Data normalization
    const candles = response.map(c => ({
      time: parseInt(c[0]),
      open: parseFloat(c[1]),
      high: parseFloat(c[2]),
      low: parseFloat(c[3]),
      close: parseFloat(c[4]),
      volume: parseFloat(c[5])
    }));

    // 4. Update collection and pagination
    allCandles.unshift(...candles);
    remainingLimit -= candles.length;
    endTime = candles[0].time - 1;
  }

  return allCandles;
}
```

### 2. Real-time Data Processing

#### WebSocket Implementation (`bybit_ws.js`)
```javascript
// 1. Connection Setup
const WS_URL = 'wss://stream.bybit.com/v5/public/linear';
let ws;

// 2. Connection Management
function connect() {
  ws = new WebSocket(WS_URL);

  // 3. Event Handlers
  ws.on('open', () => {
    // Subscribe to price updates
    ws.send(JSON.stringify({
      op: 'subscribe',
      args: [`tickers.${symbol}`]
    }));
  });

  // 4. Message Processing
  ws.on('message', (data) => {
    const message = JSON.parse(data);
    if (message.topic === `tickers.${symbol}`) {
      processUpdate(message);
    }
  });

  // 5. Error Recovery
  ws.on('close', () => setTimeout(connect, 5000));
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    ws.close();
  });
}
```

### 3. Data Analysis Pipeline

#### Price Movement Analysis
```javascript
// 1. Data Processing
function processCandleData(candles) {
  return candles.map((c, index) => {
    const prevCandle = index > 0 ? candles[index - 1] : c;
    return {
      ...c,
      percentDiff: calculatePriceDiff(c.close, prevCandle.close),
      avgPrice: calculateAverage(c.high, c.low)
    };
  });
}

// 2. Pattern Recognition
function trackCorrections(candlesWithStats, highAvg, normalAvg, lowAvg) {
  return candlesWithStats.reduce((acc, candle) => {
    const diff = parseFloat(candle.percentDiff);
    if (diff >= highAvg) {
      acc.correctionToNormalCount++;
    } else if (diff <= lowAvg) {
      acc.correctionToLowCount++;
    }
    return acc;
  }, { correctionToNormalCount: 0, correctionToLowCount: 0 });
}
```
### 4. Visualization Implementation

#### Chart System (`simple_chart3.html`)
```javascript
// 1. Chart Configuration
const chartConfig = {
  type: 'line',
  data: {
    datasets: [{
      label: 'Price',
      borderColor: '#00ff00',
      data: [],
      pointRadius: 0,
      borderWidth: 1,
      fill: false
    }]
  },
  options: {
    responsive: true,
    plugins: {
      annotation: {
        // Price level annotations
        annotations: {
          highLevel: {
            type: 'line',
            borderColor: 'red',
            borderWidth: 1
          },
          lowLevel: {
            type: 'line',
            borderColor: 'blue',
            borderWidth: 1
          }
        }
      }
    }
  }
};

// 2. Real-time Data Integration
function connectWebSocket() {
  const ws = new WebSocket(WS_URL);
  
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.topic === `tickers.${symbol}`) {
      updateChart(message.data.lastPrice);
    }
  };
}

// 3. Renko Block Generation
function createRenkoBlocks(price, blockSize) {
  const direction = price > lastPrice ? 1 : -1;
  const priceDiff = Math.abs(price - lastPrice);
  const blocks = Math.floor(priceDiff / blockSize);
  
  return Array(blocks).fill().map((_, i) => ({
    price: lastPrice + (direction * blockSize * (i + 1)),
    direction
  }));
}
```

### 5. Configuration Management

#### System Configuration (`config.js`)
```javascript
// 1. Trading Parameters
export const config = {
  // API Selection
  api: 'bybit',              // 'binance' or 'bybit'
  
  // Market Parameters
  symbol: 'BNBUSDT',         // Trading pair
  time: '1m',                // Timeframe
  limit: 100,                // Number of candles
  
  // Analysis Parameters
  lowPercentile: 25,         // Lower band percentile
  mediumPercentile: 50,      // Middle band percentile
  highPercentile: 75,        // Upper band percentile
  topPercentile: 90,         // Top band percentile
  
  // Display Settings
  showFullTimePeriod: true,  // Show complete time window
  delay: 0,                  // Data delay in minutes
  
  // Chart Settings
  renkoBlockSize: 0.1        // Block size for Renko chart
};

// 2. Runtime Configuration
export const runtimeConfig = {
  // WebSocket connection state
  wsConnected: false,
  
  // Price tracking
  lastPrice: null,
  lastUpdateTime: null,
  
  // Performance monitoring
  messageCount: 0,
  errorCount: 0
};

// 3. Error Handling Configuration
export const errorConfig = {
  maxRetries: 3,
  retryDelay: 5000,
  errorThreshold: 10
};
```

### 6. Trading Strategy Implementation

#### Pattern Recognition and Signal Generation
```javascript
// 1. Reversal Detection
function detectReversal(candles, threshold) {
  const lastCandles = candles.slice(-3);
  const [prev2, prev1, current] = lastCandles;
  
  // Down→Up reversal
  if (prev2.close > prev1.close && // Previous downtrend
      current.close > prev1.close && // Current uptick
      Math.abs(current.close - prev1.close) / prev1.close > threshold) {
    return 'UP';
  }
  
  // Up→Down reversal
  if (prev2.close < prev1.close && // Previous uptrend
      current.close < prev1.close && // Current downtick
      Math.abs(current.close - prev1.close) / prev1.close > threshold) {
    return 'DOWN';
  }
  
  return null;
}

// 2. Risk Management
function calculatePosition(capital, price, leverage) {
  const maxRiskPercent = 0.02; // 2% max risk
  const stopDistance = 0.021; // 0.21% stop loss
  
  const maxLoss = capital * maxRiskPercent;
  const positionSize = (maxLoss / stopDistance) * leverage;
  
  return Math.min(positionSize, capital * leverage);
}

## System Flow and Error Handling

### 1. Data Flow Implementation

#### Price Data Pipeline
```javascript
// Purpose: Initial data load and real-time updates
// Key Components:

// 1. Initial Data Load
async function initializeSystem() {
  try {
    // Fetch historical data
    const candles = await getCandles(symbol, time, limit);
    
    // Process and analyze
    const processedData = processCandleData(candles);
    const analysis = calculatePercentiles(processedData);
    
    // Initialize visualization
    initChart(processedData, analysis);
    
    // Start real-time updates
    connectWebSocket();
  } catch (error) {
    handleSystemError('initialization', error);
  }
}

// 2. Real-time Update Pipeline
function processUpdate(message) {
  try {
    // Validate data
    if (!validatePriceUpdate(message)) {
      throw new Error('Invalid price update');
    }
    
    // Update state
    updatePriceState(message);
    
    // Update visualization
    updateChart(message);
    
    // Check for signals
    checkTradingSignals(message);
  } catch (error) {
    handleUpdateError(error);
  }
}
```

### 2. Error Handling System

#### Comprehensive Error Management
```javascript
// 1. Error Types
const ErrorTypes = {
  NETWORK: 'NETWORK_ERROR',
  API: 'API_ERROR',
  WEBSOCKET: 'WEBSOCKET_ERROR',
  VALIDATION: 'VALIDATION_ERROR',
  PROCESSING: 'PROCESSING_ERROR'
};

// 2. Error Handler Implementation
function handleError(type, error, context) {
  // Log error with context
  console.error(`[${type}] ${error.message}`, {
    timestamp: new Date().toISOString(),
    context,
    stack: error.stack
  });

  // Implement recovery strategy
  switch (type) {
    case ErrorTypes.NETWORK:
      handleNetworkError(error);
      break;
    case ErrorTypes.WEBSOCKET:
      handleWebSocketError(error);
      break;
    case ErrorTypes.API:
      handleApiError(error);
      break;
    default:
      handleGenericError(error);
  }
}

// 3. Specific Error Handlers
function handleWebSocketError(error) {
  if (error.code === 'ECONNRESET') {
    reconnectWithBackoff();
  } else if (error.code === 'ETIMEDOUT') {
    resetConnection();
  }
}

function handleApiError(error) {
  if (error.response?.status === 429) {
    handleRateLimitError(error);
  } else if (error.response?.status === 500) {
    retryWithExponentialBackoff(error);
  }
}
```

### 3. Performance Optimization

#### Memory and CPU Management
```javascript
// 1. Data Structure Optimization
class PriceBuffer {
  constructor(maxSize = 1000) {
    this.maxSize = maxSize;
    this.buffer = new Float64Array(maxSize);
    this.timestamps = new Float64Array(maxSize);
    this.position = 0;
  }

  add(price, timestamp) {
    this.buffer[this.position] = price;
    this.timestamps[this.position] = timestamp;
    this.position = (this.position + 1) % this.maxSize;
  }
}

// 2. Chart Rendering Optimization
function optimizeChartRendering() {
  // Use requestAnimationFrame for smooth updates
  let frameRequest;
  let lastUpdate = 0;
  
  return (price) => {
    const now = performance.now();
    if (now - lastUpdate < 16.67) { // Max 60fps
      return;
    }
    
    cancelAnimationFrame(frameRequest);
    frameRequest = requestAnimationFrame(() => {
      updateChart(price);
      lastUpdate = now;
    });
  };
}

// 3. WebSocket Message Handling
const messageQueue = new Queue({
  maxSize: 1000,
  processInterval: 16 // Process every 16ms
});

ws.onmessage = (event) => {
  messageQueue.add(event.data);
};
```

## Deployment and Monitoring

### 1. System Requirements
```javascript
// Minimum Requirements
const requirements = {
  node: '>=14.0.0',
  memory: '512MB',
  cpu: '1 core',
  storage: '1GB'
};

// Dependencies
const dependencies = {
  axios: '^1.10.0',  // HTTP client
  ws: '^8.18.3',    // WebSocket client
  chartjs: '^4.0.0' // Visualization
};
```

### 2. Runtime Monitoring
```javascript
// 1. Performance Metrics
const metrics = {
  // WebSocket metrics
  wsMetrics: {
    messageCount: 0,
    errorCount: 0,
    reconnections: 0,
    lastLatency: 0
  },
  
  // Processing metrics
  processMetrics: {
    updateCount: 0,
    avgProcessingTime: 0,
    peakMemoryUsage: 0
  },
  
  // Trading metrics
  tradingMetrics: {
    signalsGenerated: 0,
    successfulTrades: 0,
    failedTrades: 0
  }
};

// 2. Health Checks
function performHealthCheck() {
  return {
    wsStatus: ws.readyState === 1,
    apiStatus: checkApiConnection(),
    memoryUsage: process.memoryUsage(),
    uptime: process.uptime(),
    lastUpdate: metrics.lastUpdateTime
  };
}
```

## Trading Strategy and Analysis

### 1. Market Analysis Implementation
```javascript
// 1. Price Movement Analysis
function analyzePriceMovements(candles) {
  // Track directional movements
  const movements = candles.reduce((acc, candle, i) => {
    if (i === 0) return acc;
    const prevClose = candles[i-1].close;
    const diff = ((candle.close - prevClose) / prevClose) * 100;
    
    if (diff > 0) acc.upMoves.push(diff);
    else if (diff < 0) acc.downMoves.push(Math.abs(diff));
    
    return acc;
  }, { upMoves: [], downMoves: [] });

  // Calculate success rates
  return {
    upMoveRate: movements.upMoves.length / candles.length,
    downMoveRate: movements.downMoves.length / candles.length,
    avgUpMove: average(movements.upMoves),
    avgDownMove: average(movements.downMoves)
  };
}

// 2. Volatility Analysis
function analyzeVolatility(candles) {
  const volatilityBands = candles.map(candle => {
    const range = candle.high - candle.low;
    const avgPrice = (candle.high + candle.low) / 2;
    return (range / avgPrice) * 100;
  });

  return {
    avgVolatility: average(volatilityBands),
    maxVolatility: Math.max(...volatilityBands),
    minVolatility: Math.min(...volatilityBands)
  };
}
```

### 2. Trading Strategy Implementation
```javascript
// 1. Down→Up Reversal Detection
function detectDownUpReversal(candles, threshold = 0.08) {
  const [prev2, prev1, current] = candles.slice(-3);
  
  // Confirm downtrend
  const isDowntrend = prev2.close > prev1.close;
  
  // Check for reversal
  const isReversal = current.close > prev1.close;
  
  // Validate movement size
  const movement = ((current.close - prev1.close) / prev1.close) * 100;
  const isSignificant = Math.abs(movement) >= threshold;
  
  return isDowntrend && isReversal && isSignificant;
}

// 2. Position Sizing with Leverage
function calculateLeveragedPosition(capital, price) {
  const leverage = 50;
  const targetProfit = 0.08; // 0.08% raw profit
  const stopLoss = 0.21;    // 0.21% max loss
  
  // Calculate position size based on risk
  const maxRisk = capital * 0.02; // 2% max risk per trade
  const positionSize = (maxRisk / stopLoss) * leverage;
  
  return {
    size: Math.min(positionSize, capital * leverage),
    leverage,
    expectedProfit: targetProfit * leverage - 0.02 * leverage * 2, // Account for fees
    maxLoss: stopLoss * leverage
  };
}
```

### 3. Risk Management System
```javascript
// 1. Position Risk Calculator
function calculatePositionRisk(position, price) {
  const liquidationPrice = price * (1 - (2 / position.leverage));
  const stopLossPrice = price * (1 - (0.0021)); // 0.21% stop loss
  
  return {
    liquidationDistance: ((price - liquidationPrice) / price) * 100,
    stopLossDistance: ((price - stopLossPrice) / price) * 100,
    maxDrawdown: position.maxLoss,
    expectedReturn: position.expectedProfit
  };
}

// 2. Risk Validation
function validateTradeRisk(position, price) {
  const risk = calculatePositionRisk(position, price);
  
  return {
    isValid: risk.liquidationDistance > risk.stopLossDistance * 3, // 3x safety margin
    riskReward: risk.expectedReturn / risk.maxDrawdown,
    safetyMargin: risk.liquidationDistance / risk.stopLossDistance
  };
}
```
