# BNB Scalper - Technical Documentation

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

## Component Details

### 1. Binance Integration (`binance.js`)
```javascript
// Core functionality
- Historical OHLCV data retrieval
- Batch processing for large datasets
- Price precision handling
- Timestamp management

// API Endpoints
BASE_URL = 'https://api.binance.com/api/v3'
Endpoints: /klines

// Data Processing
- Automatic pagination
- Data normalization
- Error handling
```

### 2. Bybit WebSocket (`bybit_ws.js`)
```javascript
// Connection Management
WS_URL = 'wss://stream.bybit.com/v5/public/linear'
- Auto-reconnection
- Subscription handling
- Error recovery

// Data Handling
- Snapshot processing
- Delta updates
- Real-time price tracking
- Volume monitoring
```

### 3. Compound Calculator (`compound.js`)
```javascript
// Features
- Flexible rate calculation
- Iterative compounding
- Progress logging
- Precision handling

// Configuration
- Customizable capital
- Adjustable rate
- Variable time periods
```

### 4. Configuration System (`config.js`)
```javascript
// Core Settings
- API selection
- Timeframe configuration
- Data limits
- Display preferences

// Trading Parameters
- Block size configuration
- Time period settings
- Display formatting
```

## Data Flow

### Price Data Pipeline
1. Initial Load:
   ```
   REST API → Historical Data → Data Processing → Chart Initialization
   ```

2. Real-time Updates:
   ```
   WebSocket → Price Update → State Management → Visual Update
   ```

### Trading Integration
1. Signal Generation:
   ```
   Price Data → Pattern Recognition → Trading Signals
   ```

2. Risk Management:
   ```
   Position Size → Leverage Calculation → Risk Parameters
   ```

## Development Guidelines

### Adding New Features
1. Configuration:
   - Add parameters to `config.js`
   - Document new settings
   - Validate values

2. Data Integration:
   - Implement error handling
   - Add retry mechanisms
   - Validate data format

3. UI Components:
   - Follow dark theme
   - Implement responsive design
   - Add error states

### Testing Requirements
1. Data Providers:
   - Connection stability
   - Data accuracy
   - Error handling
   - Rate limit compliance

2. Trading Logic:
   - Pattern recognition
   - Signal generation
   - Risk calculations

3. UI/UX:
   - Response times
   - Memory usage
   - Browser compatibility

## Performance Considerations

### WebSocket Optimization
- Heartbeat monitoring
- Reconnection backoff
- Message queuing
- Buffer management

### Chart Performance
- RequestAnimationFrame usage
- Canvas optimization
- Data point limiting
- Memory management

### Error Handling
1. Network Issues:
   - Automatic retry
   - Data recovery
   - State preservation

2. API Limits:
   - Rate monitoring
   - Request queuing
   - Fallback mechanisms

## Security Considerations

### API Integration
- Secure connection handling
- API key management
- Request signing
- Rate limit compliance

### Data Management
- Price data validation
- Signal verification
- Error bounds checking
- State validation

## Deployment

### Prerequisites
- Node.js environment
- Web server
- API access
- WebSocket support

### Configuration
1. API Setup:
   ```javascript
   - Select provider (Binance/Bybit)
   - Configure timeframes
   - Set data limits
   ```

2. Trading Parameters:
   ```javascript
   - Block size
   - Time periods
   - Risk limits
   ```

### Monitoring
- WebSocket connection status
- Data flow integrity
- Error rates
- Performance metrics
