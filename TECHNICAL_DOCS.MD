# Technical Documentation

## 🚀 LIVE TRADING INTEGRATION - multiPivotFronttesterLive.js

### 2025-08-07: 🔧 CRITICAL PIVOT DETECTION FIX - CASCADE DISCREPANCY RESOLVED
- **MAJOR BUG FIX**: Fixed fronttester pivot detection to match backtester algorithm exactly
- **ROOT CAUSE**: Fronttester was ignoring `minSwingPct` and `minLegBars` swing filtering parameters
- **SOLUTION**: Implemented proper swing filtering in `detectPivotAtCandle()` method
- **IMPACT**: Reduced fronttester signals from 15.57/day to 2.22/day (now matches backtester)
- **ALGORITHM ALIGNMENT**: Both systems now use identical pivot detection and cascade confirmation

#### **Technical Changes Made**:
1. **Added Swing Filtering**: Implemented `minSwingPct` threshold checking (0.4% for 1h, 0.1% for 15m, 0.01% for 1m)
2. **Added Distance Filtering**: Implemented `minLegBars` minimum distance between pivots
3. **Last Pivot Tracking**: Added `lastPivots` Map to track previous pivot per timeframe for swing calculations
4. **Swing Percentage Calculation**: Added proper swing size calculation: `(pivotPrice - lastPivot.price) / lastPivot.price`
5. **Initialization**: Properly initialized pivot tracking system in `initialize()` method

#### **Results After Fix**:
- **Before**: Fronttester 14 signals → 14 cascades (15.57/day), Backtester 9 signals → 2 cascades (2.22/day)
- **After**: Fronttester 2 signals → 2 cascades (2.22/day), Backtester 9 signals → 2 cascades (2.22/day)
- **Status**: ✅ Both systems now produce identical cascade detection frequency

### 2025-08-07: 📈 ENHANCED STATISTICS & DISPLAY UPDATE
- **IMPROVED STATISTICS DISPLAY**: Updated trading performance summary to match backtester's clean format
- **IMPROVED TRADE DISPLAY**: Upgraded trade closure formatting to match backtester style with detailed entry/exit info
- **ALL TRADES DISPLAY**: Added comprehensive display of all trades taken above trading performance section
- **SINGLE TRADE MODE**: Added `singleTradeMode` to prevent concurrent trades (one trade at a time)
- **DISPLAY CONTROLS**: Added `hideTimeDisplay` and `hideProgressDisplay` config options
- **ENHANCED CONTROL**: Better user control over console output and trade execution behavior
- **FINAL SUMMARY POSITIONING**: Moved final summary to very bottom with enhanced color coding
- **COLOR-CODED OUTPUT**: Added comprehensive color coding to match professional trading interface
- **INITIAL CAPITAL DISPLAY**: Added initial capital display to trading performance for complete capital tracking

#### **All Trades Display Features**:
1. **Comprehensive Trade List**: Shows all trades taken with entry/exit times in both 12-hour and 24-hour formats
2. **Trade Status Indicators**: Clear WIN/LOSS indicators with result codes (TP, SL, TRAIL, EOB)
3. **Price Information**: Entry/exit prices, position sizes, and P&L percentages
4. **Open Trade Tracking**: Shows current open trades with SL/TP levels
5. **Color Coding**: Green for wins, red for losses, yellow for open trades
6. **Professional Formatting**: Clean, organized display with proper spacing and alignment

### 2025-08-07: 💰 COMPLETE LIVE TRADING SYSTEM INTEGRATION
- **MAJOR ENHANCEMENT**: Integrated full trading execution engine into live fronttester
- **REAL-TIME TRADING**: 1-minute candle precision for trade entry, monitoring, and exit
- **HIERARCHICAL EXECUTION**: Trades only execute when cascade confirmations meet hierarchical requirements
- **COMPREHENSIVE MONITORING**: Real-time trade management with TP/SL/trailing stops

#### **Key Trading Features Added**:
1. **Trade Creation**: Automatic trade execution on confirmed cascade signals
2. **Position Management**: Support for fixed/percentage/minimum position sizing
3. **Risk Management**: Stop loss, take profit, and trailing stop functionality
4. **Cost Simulation**: Realistic slippage and funding rate calculations
5. **Direction Control**: Support for buy/sell/both/alternate trading modes
6. **Capital Tracking**: Real-time capital management and PnL calculation
7. **Performance Analytics**: Comprehensive trading statistics and reporting

#### **Trading Integration Points**:
- **Signal Generation**: Uses existing hierarchical cascade confirmation system
- **Trade Execution**: Creates trades in `executeWindow()` when cascades confirm
- **Trade Monitoring**: Monitors all open trades every minute in simulation loop
- **Exit Management**: Handles TP/SL/trailing stops with 1-minute precision
- **Statistics Display**: Shows complete trading performance at simulation end

#### **Trading Configuration**:
- Controlled via `tradeconfig.js` with full parameter customization
- Position sizing modes: fixed dollar amount, percentage of capital, or minimum
- Direction modes: buy only, sell only, both directions, or alternating
- Risk parameters: stop loss %, take profit %, trailing stop settings
- Cost simulation: configurable slippage and funding rate models
- **Single Trade Mode**: `singleTradeMode: true` prevents concurrent trades
- **Display Controls**: `hideTimeDisplay` and `hideProgressDisplay` in `fronttesterconfig.js`

## 🔴 CRITICAL FIX: REAL-TIME LOGIC - multiPivotFronttesterV2.js

### 2025-08-07: ⚡ REAL-TIME LOGIC FIX - No Future Data Access
- **CRITICAL ISSUE FIXED**: System was accessing future candles that don't exist at current time
- **PROBLEM**: `findCandleIndexAtTime()` was looking for exact time matches, allowing future data
- **SOLUTION**: Only analyze candles with `time <= currentTime` (completed candles only)
- **REAL-TIME PRINCIPLE**: At 1:00 AM, you CANNOT see 2:00 AM candles - they don't exist yet!

- **IMPLEMENTATION FIX**:
  ```javascript
  // OLD (WRONG): Looking for exact time matches
  const candleIndex = this.findCandleIndexAtTime(candles, currentTime, tf.interval);
  
  // NEW (CORRECT): Only use completed candles
  let latestCandleIndex = -1;
  for (let i = candles.length - 1; i >= 0; i--) {
      if (candles[i].time <= currentTime) {
          latestCandleIndex = i;
          break;
      }
  }
  ```

- **KEY PRINCIPLE**: **REAL-TIME SIMULATION**
  * Every minute, system re-analyzes ALL available data up to that point
  * Detects new pivots from completed candles only
  * Opens/manages cascade windows based on current time
  * NO FUTURE DATA ACCESS - maintains true real-time behavior
  * NO HISTORICAL PIVOTS - only detects pivots that occur during simulation
  * HIERARCHICAL EXECUTION - respects timeframe hierarchy for proper cascade confirmation

### 🎯 HIERARCHICAL EXECUTION LOGIC - Smart Cascade Confirmation
- **PROBLEM SOLVED**: Previous logic executed on any 3 timeframes (e.g., 4h + 1m + 1h)
- **NEW LOGIC**: Respects proper timeframe hierarchy and role-based confirmation

- **EXECUTION RULES**:
  1. **CRITICAL RULE**: Execution timeframe (1m) can ONLY execute if at least one confirmation timeframe (1h or 15m) is present
  2. **Rule 1**: If execution timeframe (1m) + confirmation(s) + minimum total → EXECUTE
  3. **Rule 2**: If all confirmation timeframes (1h, 15m) confirm → EXECUTE on lowest available
  4. **Hierarchy**: Always respects 4h → 1h → 15m → 1m order

- **EXAMPLE SCENARIOS**:
  * **Scenario 1**: 4h (primary) + 1h (confirmation) + 1m (execution) → ✅ EXECUTE (has execution + confirmation)
  * **Scenario 2**: 4h (primary) + 1h (confirmation) + 15m (confirmation) → ✅ EXECUTE (all confirmations)
  * **Scenario 3**: 4h (primary) + 1m (execution) only → ❌ BLOCKED (execution without confirmation)
  * **Scenario 4**: 4h (primary) + 15m (confirmation) + 1m (execution) → ✅ EXECUTE (has execution + confirmation)
  * **Scenario 5**: 4h (primary) + 1m (execution) + 1h (confirmation) → ✅ EXECUTE (order doesn't matter, has both)

- **CONFIGURATION MAPPING**:
  ```javascript
  // multiPivotConfig.js roles:
  '4h': 'primary'      // Always required (window opener)
  '1h': 'confirmation' // Confirmation timeframe
  '15m': 'confirmation' // Confirmation timeframe  
  '1m': 'execution'    // Execution timeframe (preferred but optional)
  ```

- **SMART LOGIC BENEFITS**:
  * **Proper Hierarchy**: Respects timeframe order (big to small)
  * **Flexible Execution**: Works with or without execution timeframe
  * **Quality Control**: Ensures meaningful cascade confirmation
  * **Realistic Trading**: Matches real-world trading decision flow

## 🔴 LIVE TRADING SYSTEM - multiPivotFronttesterLive.js

### 2025-08-07: 🚀 LIVE API INTEGRATION - Real-Time Multi-Timeframe Cascade Detection
- **NEW SYSTEM**: multiPivotFronttesterLive.js - Complete live trading implementation
- **FEATURES IMPLEMENTED**:
  * **Live API Data Integration**: Uses Bybit API for historical data + WebSocket for real-time prices
  * **Real-Time Candle Updates**: Automatically fetches new candles as they complete
  * **Live Pivot Detection**: Detects pivots in real-time as new candles arrive
  * **WebSocket Price Feed**: Continuous live price updates for accurate execution
  * **Dynamic Window Management**: Opens/closes cascade windows based on live market data
  * **Live Cascade Execution**: Executes trades with current market prices

- **ARCHITECTURE COMPONENTS**:
  * **Historical Data Loading**: `loadInitialData()` - Loads recent historical data for all timeframes
  * **WebSocket Integration**: `connectWebSocket()` - Real-time price feed from Bybit
  * **Candle Monitoring**: `checkForNewCandles()` - Periodic checks for new completed candles
  * **Live Pivot Detection**: `checkForNewPivots()` - Real-time pivot formation detection
  * **Window-Based Cascades**: Same proven window system from V2 but with live data
  * **Live Execution**: Uses current WebSocket price for trade execution

- **LIVE DATA FLOW**:
  1. **Initialization**: Load historical data for all timeframes via API
  2. **WebSocket Connection**: Connect to live price feed
  3. **Candle Monitoring**: Check every minute for new completed candles
  4. **Pivot Detection**: Analyze new candles for pivot formation
  5. **Window Management**: Open primary windows, track confirmations
  6. **Live Execution**: Execute cascades with real-time prices

- **CONFIGURATION REQUIREMENTS**:
  * Set `useLocalData = false` in config.js to enable API data
  * Ensure Bybit API access (no authentication required for public data)
  * Configure timeframes in multiPivotConfig.js
  * Set debug options in fronttesterconfig.js

- **LIVE FEATURES**:
  * **Real-Time Price Display**: Shows current BTC price from WebSocket
  * **Live Cascade Execution**: Uses actual market price at execution time
  * **Heartbeat Monitoring**: Shows system status and connectivity
  * **Dynamic Buffer Management**: Maintains rolling candle buffers
  * **Automatic Reconnection**: WebSocket auto-reconnects on disconnection

- **BENEFITS OVER SIMULATION**:
  * **True Market Conditions**: Real market timing and price movements
  * **No Lookahead Bias**: Only uses data available at current time
  * **Live Price Execution**: Actual market prices for trade entries
  * **Real-Time Confirmation**: Cascades form based on live market action
  * **Production Ready**: Can be extended for actual trade execution

- **USAGE**: `node multiPivotFronttesterLive.js` - Starts live cascade detection system

---

## 🚨 CRITICAL SYSTEM FIXES

### 2025-08-07: 🎯 EXECUTION WINDOW LOGIC FIXED - Duplicate Cascade Elimination
- **CRITICAL ISSUE**: multiPivotFronttesterV2.js was executing cascades TWICE from same primary window
- **Problems Identified**:
  * Duplicate cascade executions: CASCADE #1 and CASCADE #2 from same primary
  * Two parallel systems running: old cascade detection + new window-based system
  * Execution window (1m) being detected BEFORE confirmations appeared
  * Timeline showing execution at wrong times

- **ROOT CAUSE**: Dual execution systems conflict
  * Old `checkForCascadeAtCurrentTime()` method running in parallel with new window system
  * Old system executed when confirmations met (without execution window)
  * New system executed when execution window appeared
  * Both systems called `displayCascade()` causing duplicates

- **SOLUTION IMPLEMENTED**: 
  * **Disabled old cascade detection system** - commented out `checkForCascadeAtCurrentTime()`
  * **Only window-based system active** - proper execution hierarchy enforced
  * **Execution window logic fixed** - 1m pivots only considered AFTER confirmations exist
  * **Single execution per window** - added `window.status !== 'executed'` check
  * **Proper timing sequence**: Primary → Confirmations → Execution Window → Execute

- **RESULT**: Perfect cascade execution with no duplicates and correct timing

### 2025-08-07: 🛡️ FUTURE LOOK BIAS ELIMINATION - Time-Progressive System Implementation
- **CRITICAL ISSUE**: multiPivotFronttester.js had severe future look bias problems
- **Problems Identified**:
  * Complete historical data pre-loading across all timeframes at startup
  * Access to full pivot history including future pivots during simulation
  * Forward-looking cascade confirmation with access to future candles
  * System could see entire future when making trading decisions

- **ROOT CAUSE**: System was designed like a backtester, not a real-time simulator
  * `initializeAllTimeframes()` pre-calculated ALL pivots from ALL timeframes
  * `checkForwardCascadeConfirmation()` had access to complete future candle dataset
  * Simulation could look ahead to see which cascades would be confirmed
  * No time-progressive data revelation system

- **SOLUTION IMPLEMENTED**: Complete Time-Progressive Architecture
  * **loadRawCandleDataOnly()**: Loads only raw candle data, NO pivot pre-calculation
  * **updateKnownPivotsUpToCurrentTime()**: Detects pivots progressively as time advances
  * **detectPivotAtIndex()**: Real-time pivot detection without future look
  * **checkTimeProgressiveCascadeConfirmation()**: Only uses data up to current simulation time
  * **currentSimulationTime**: Tracks current point in time progression
  * **timeframeKnownPivots**: Maintains pivots known only up to current time

- **KEY ARCHITECTURAL CHANGES**:
  1. **Time-Progressive Data Access**: Only reveal candles/pivots up to current simulation time
  2. **Real-Time Pivot Detection**: Detect pivots as we progress through time, not pre-calculate
  3. **Genuine Cascade Confirmation**: Wait for actual confirmations to develop in real-time
  4. **Streaming Architecture**: Process data candle-by-candle as if receiving live
  5. **No Future Knowledge**: System only knows what it should know at each moment

- **BENEFITS**:
  * **Realistic Simulation**: Behaves exactly like live trading would
  * **No Cheating**: Cannot see future pivots or confirmations
  * **True Performance**: Results reflect actual trading conditions
  * **Live Trading Ready**: Same logic works for both simulation and live trading
  * **Eliminates Bias**: No artificial performance inflation from future knowledge

- **VALIDATION**: System now properly simulates moving through time without any future look bias
- **Status**: ✅ CRITICAL FIX APPLIED - Future look bias completely eliminated

### 🚨 CRITICAL DISCOVERY: Backtester vs Fronttester Cascade Differences
- **Issue Found**: multiPivotBacktesterWithTrades.js still uses `detector.checkForwardCascadeConfirmation()`
- **Problem**: Backtester has FUTURE LOOK BIAS while Fronttester V2 is bias-free
- **Evidence**: 
  * Same primary pivots detected at identical times (5:00 AM, 9:00 AM, 1:00 PM, etc.)
  * Backtester shows higher strength percentages (75% vs 25%)
  * Backtester can wait longer for optimal confirmations (+15-17min vs +1-2min)
  * Backtester detects more total cascades due to future knowledge
- **Root Cause**: Backtester pre-loads ALL data and can "peek ahead" for confirmations
- **Impact**: Backtester results are artificially inflated and unrealistic
- **Action Required**: Backtester needs same time-progressive fix as Fronttester V2

### ✅ FRONTTESTER V2 IMPROVEMENTS: Proper Cascade Confirmation
- **Issue Fixed**: Fronttester was accepting weak cascades with only 2 timeframes (25% strength)
- **Solution**: Modified cascade confirmation to respect `minTimeframesRequired: 3` from config
- **Changes Made**:
  * Fixed cascade confirmation logic to require primary + 2 confirming timeframes minimum
  * Improved strength calculation based on total timeframes confirmed
  * Enhanced display formatting with 24-hour time format and clean price display
  * Removed comma formatting from entry prices for cleaner output
- **Result**: Fronttester now properly waits for adequate confirmations like backtester
- **Status**: ✅ IMPROVED - Fronttester respects minimum timeframe requirements

## API Data Consistency Fix

### Problem Solved
Previously, there was a discrepancy between CSV and API data volumes:
- **CSV Mode**: Used calculated limit from config.js (1,296 candles for 1m interval)
- **API Mode**: Limited to single API call (1,000 candles maximum)

This caused different cascade detection results between modes.

### Solution: Multi-Batch API Fetching
Implemented multi-batch API fetching in `multiTimeframePivotDetector.js`:

```javascript
// Multi-batch fetching logic
while (allCandles.length < timeframeLimit && consecutiveErrors < MAX_RETRIES) {
    const batchCandles = await getCandles(symbol, interval, BATCH_SIZE, endTime);
    allCandles = [...batchCandles, ...allCandles];
    endTime = batchCandles[0].time - 1; // Go backwards in time
}
```

**Key Features:**
- **Batch Size**: 1,000 candles per API call (respects Bybit limits)
- **Backwards Fetching**: Uses `endTime` parameter to fetch historical data
- **Error Handling**: 3 retries with exponential backoff (100ms → 1s → 2s)
- **Rate Limiting**: 100ms delay between successful requests
- **Deduplication**: Removes duplicate candles by timestamp
- **Consistent Limits**: Both modes now use same `calculateTimeframeLimit()` logic

**Results:**
- ✅ **CSV Mode**: 1,296 candles
- ✅ **API Mode**: 1,296 candles  
- ✅ **Identical Cascade Detection**: Both modes produce same results

## Multi-Timeframe Pivot System Updates

### 2025-08-06: 🚀 MULTI-TIMEFRAME CASCADE SYSTEM - Revolutionary Signal Filtering
- **Feature**: Implemented comprehensive multi-timeframe pivot confirmation system
- **Core Innovation**: Hierarchical cascade confirmation across multiple timeframes
- **Architecture**:
  * **MultiTimeframePivotDetector**: Core detection engine for multiple timeframes
  * **Cascade Confirmation Logic**: Primary timeframe triggers, smaller timeframes confirm
  * **Flexible Configuration**: Support for 2-10+ timeframes with individual parameters
  * **Signal Strength Scoring**: Weighted confirmation system for trade quality assessment

- **Implementation Details**:
  * **Primary Timeframe**: Largest timeframe (e.g., 4h) triggers initial signal
  * **Confirmation Cascade**: Each smaller timeframe must confirm within time window
  * **Signal Types**: HIGH pivot → SHORT signal, LOW pivot → LONG signal
  * **Time Windows**: Configurable confirmation windows for each timeframe
  * **Trade Execution**: Uses 1-minute candles for precise TP/SL monitoring

- **Configuration System**:
  * **multiPivotConfig.js**: Dedicated configuration file for multi-timeframe settings
  * **Timeframe Parameters**: Individual lookback, minSwingPct, minLegBars per timeframe
  * **Cascade Settings**: Confirmation windows, requirement levels, signal aging
  * **Preset Configurations**: Conservative, Aggressive, Scalping, Swing presets
  * **Debug Controls**: Detailed cascade process logging and analysis

- **Benefits**:
  * **Noise Reduction**: Filters out false signals from single timeframes
  * **Trend Alignment**: Ensures trades align with broader market structure
  * **Higher Win Rate**: Only trades when multiple timeframes agree
  * **Reduced Whipsaws**: Multiple confirmations prevent premature entries
  * **Flexible Testing**: Easy to test different timeframe combinations

- **Status**: ✅ FULLY OPERATIONAL - Multi-timeframe cascade system with clean backtester implementation

### 2025-08-07: 🐛 PNL COLOR DISPLAY FIX - Visual Output Correction
- **Issue**: PnL values in trade output were all showing in red color regardless of profit/loss
- **Root Cause**: Color determination was based on exit result type ('TP' vs others) instead of actual PnL value
- **Fix Applied**: Changed color logic to use `pnl >= 0` condition for green/red coloring
- **Code Changes**:
  * Removed `resultColor = result === 'TP' ? colors.green : colors.red`
  * Added `pnlColor = pnl >= 0 ? colors.green : colors.red`
  * Updated `pnlText` to use `pnlColor` instead of `resultColor`
- **Result**: Positive PnL values now display in green, negative in red as intended
- **Status**: ✅ FIXED - Trade output now correctly shows green for profits, red for losses

### 2025-08-07: 🚨 CRITICAL BUG FIX - SHORT Trade Trailing Take Profit Logic
- **Issue**: SHORT trades were exiting at incorrect prices due to wrong trailing TP calculation
- **Problem Identified**: Entry $108,166.50, Best Price $107,616.60, but exited at $106,003.17 instead of near best price
- **Root Cause**:
  * **Wrong Formula**: SHORT trade trailing TP was using `bestPrice * (1 - distance)` instead of `bestPrice * (1 + distance)`
  * **Logic Error**: Formula made trailing TP go BELOW best price instead of ABOVE it
- **Logic Explanation**: 
  * For SHORT trades, when price goes DOWN (favorable), trailing TP should trail DOWN but stay ABOVE best price
  * Example: Best price $107,616.60, with 0.3% distance should be $107,938.89 (above), not $107,294.35 (below)
- **Fix Applied**:
  * **Calculation Fix**: Changed `bestPrice * (1 - trailingTakeProfitDistance / 100)` to `bestPrice * (1 + trailingTakeProfitDistance / 100)` for SHORT trades
  * **Code Location**: Line 403 in multiPivotBacktesterWithTrades.js
- **Impact**: SHORT trades now properly trail their take profit levels as price moves favorably
- **Status**: ✅ FIXED - SHORT trade trailing take profit now uses correct calculation formula

### 2025-08-07: 💰 ENHANCED TRADE DETAILS & NUMBER FORMATTING - Improved User Experience
- **Feature**: Enhanced trade details display with additional financial information and comma-separated number formatting
- **New Trade Information Added**:
  * **Trade Amount**: Original capital allocated to the trade
  * **Trade Loss**: Absolute loss amount (displayed only for losing trades)
  * **Trade Remainder**: Amount remaining after trade completion (original amount + P&L)
- **Number Formatting Enhancement**:
  * **formatNumberWithCommas()**: New utility function for comma-separated number display
  * **Applied To**: All financial values including prices, amounts, P&L, fees, and costs
  * **Format**: Uses US locale formatting with 2 decimal places (e.g., 1,000,000.00)
- **Implementation Details**:
  * Added `formatNumberWithCommas()` helper function using `toLocaleString('en-US')`
  * Enhanced trade details section with trade amount, loss, and remainder calculations
  * Updated all price displays, cost breakdowns, and financial summaries
  * Applied formatting to entry/exit prices, trailing stop prices, and slippage impacts
- **Benefits**:
  * **Improved Readability**: Large numbers are easier to read with comma separators
  * **Better Financial Tracking**: Clear display of trade amounts and remainders
  * **Professional Appearance**: Consistent formatting across all financial displays
  * **Enhanced Analysis**: Easy identification of trade losses and remaining capital
- **Status**: ✅ FULLY IMPLEMENTED - All trade details now include comprehensive financial information with professional number formatting

### 2025-08-07: 🚀 MULTI-TIMEFRAME TRADING ENGINE - Complete Implementation
- **Feature**: Created multiPivotBacktesterWithTrades.js - Full trading engine with multi-timeframe cascade confirmation
- **Core Innovation**: Combines cascade signal detection with actual trade execution like pivotBacktester.js
- **Architecture**:
  * **Signal Detection**: Uses MultiTimeframePivotDetector for cascade confirmation
  * **Trade Execution**: Full trading engine with TP/SL monitoring on 1-minute candles
  * **Position Management**: Support for concurrent trades, position sizing, and capital management
  * **Cost Simulation**: Includes slippage and funding rate calculations

- **Implementation Details**:
  * **Cascade Confirmation**: Primary timeframe triggers, smaller timeframes confirm
  * **Signal Matching**: Fixed critical bug - cascades return 'long'/'short' signals, not 'buy'/'sell'
  * **Trade Creation**: Only executes trades when cascade confirmation is achieved
  * **Real-time Monitoring**: Uses 1-minute candles for precise TP/SL execution
  * **Direction Support**: Full support for buy/sell/both/alternate trading directions
  * **Forward-Looking Logic**: Realistic market order timing with execution delays (0-120 minutes)

- **Performance Results**:
  * **Signal Quality**: 20% confirmation rate (8/40 primary signals) - excellent noise filtering
  * **Trade Execution**: 4 trades executed with 1-minute precision
  * **Signal Strength**: All confirmations achieved 75% strength rating
  * **Timing Realism**: Variable execution delays simulate real cascade formation

- **Benefits Over Individual Pivot Trading**:
  * **Higher Signal Quality**: Multi-timeframe confirmation reduces false signals
  * **Better Timing**: Forward-looking validation prevents lookahead bias
  * **Noise Reduction**: Only 20% of signals pass confirmation - filters market noise
  * **Realistic Simulation**: Actual cascade formation timing with execution delays
  * **Performance Tracking**: Complete trade statistics, win rates, and duration analysis

- **Trading Features**:
  * **Position Sizing**: Fixed, percentage, and minimum-based sizing modes
  * **Risk Management**: Stop loss, take profit, and maximum concurrent trades
  * **Cost Simulation**: Realistic slippage and funding rate calculations
  * **Capital Protection**: Liquidation monitoring and capital tracking
  * **Trade Analytics**: Duration statistics, win/loss analysis, and performance metrics

- **Benefits**:
  * **Realistic Backtesting**: Combines multi-timeframe filtering with actual trade execution
  * **Higher Quality Signals**: Only trades when multiple timeframes align
  * **Complete Trading System**: Full position management and risk controls
  * **Performance Analysis**: Comprehensive statistics for strategy evaluation
  * **Forward-Looking Logic**: Realistic market order timing simulation

- **Status**: ✅ FULLY OPERATIONAL - Complete multi-timeframe trading system ready for backtesting

### 2025-08-07: 🎯 TRAILING STOP LOSS & TAKE PROFIT - Advanced Exit Management
- **Feature**: Implemented comprehensive trailing stop loss and trailing take profit system in multiPivotBacktesterWithTrades.js
- **Core Innovation**: Dynamic exit price adjustment that follows favorable price movement to lock in profits
- **Architecture**:
  * **Trailing Stop Loss**: Automatically adjusts stop loss upward (long) or downward (short) as price moves favorably
  * **Trailing Take Profit**: Activates after reaching trigger threshold, then trails behind best price
  * **Best Price Tracking**: Continuously monitors and records the most favorable price achieved
  * **Dual Mode Operation**: Works independently - either or both can be enabled

- **Configuration Options** (in tradeconfig.js):
  * **enableTrailingStop**: Enable/disable trailing stop loss (boolean)
  * **trailingStopDistance**: Distance to trail behind best price in % (default: 0.15%)
  * **enableTrailingTakeProfit**: Enable/disable trailing take profit (boolean)
  * **trailingTakeProfitTrigger**: Profit threshold to activate trailing TP in % (default: 1.5%)
  * **trailingTakeProfitDistance**: Distance to trail behind best price for TP in % (default: 0.3%)

- **Implementation Details**:
  * **Long Trades**: Trails stop loss upward as price rises, trails TP downward from peak
  * **Short Trades**: Trails stop loss downward as price falls, trails TP upward from lowest point
  * **Activation Logic**: Trailing stop activates when trade becomes profitable, trailing TP activates at trigger level
  * **Price Tracking**: Updates trailing levels only when price moves favorably (new highs for long, new lows for short)
  * **Exit Priority**: Trailing TP checked first, then regular TP, then trailing SL, then regular SL

- **Enhanced Trade Display**:
  * **Result Types**: New exit reasons 'TRAILING_TP' and 'TRAILING_SL' in trade results
  * **Trailing Info Section**: Shows activation status, trigger prices, and best price achieved
  * **Visual Indicators**: Color-coded display for triggered vs active trailing stops
  * **Original vs Trailing**: Comparison of original TP/SL prices with final trailing prices

- **Benefits**:
  * **Profit Protection**: Locks in gains when price moves favorably beyond initial targets
  * **Reduced Risk**: Automatically tightens stop loss as trade becomes more profitable
  * **Extended Profits**: Allows capturing larger moves while protecting against reversals
  * **Flexible Configuration**: Independent control of trailing SL and TP with custom distances
  * **Realistic Simulation**: Accurate modeling of advanced exit strategies used in live trading

- **Example Scenario**: 
  * Normal TP: 1%, Trailing TP Trigger: 1.5%, Trailing Distance: 0.3%
  * Price reaches 2% profit → Trailing TP activates at 1.7% (2% - 0.3%)
  * If price reverses to 1.7% → Exit with TRAILING_TP instead of riding down to 1% or SL

- **Status**: ✅ FULLY OPERATIONAL - Advanced trailing stop system ready for enhanced profit management

### 2025-08-07: 🎛️ CASCADE LOGGING CONTROL - hideCascades Configuration
- **Feature**: Added `hideCascades` configuration option to control cascade confirmation log visibility
- **Implementation**: New setting in tradeconfig.js allows hiding cascade logs while preserving trade execution logs
- **Behavior**:
  * **hideCascades: false** (default): Shows all cascade confirmation and failure logs plus progress indicators
  * **hideCascades: true**: Hides cascade logs and progress indicators, only shows trade execution results (└─> [SL] LONG trade closed...)
- **Benefits**:
  * **Clean Output**: Reduces log noise for users focused on trade results
  * **Selective Visibility**: Keeps essential trade information while hiding cascade details
  * **User Control**: Easy toggle for different analysis needs
- **Usage**: Set `hideCascades: true` in tradeconfig.js to hide cascade confirmation logs
- **Status**: ✅ IMPLEMENTED - Cascade logging control available in multiPivotBacktesterWithTrades.js

### 2025-08-06: 🔧 MULTI-TIMEFRAME BACKTESTER FIXES - Clean Implementation
- **Issue Fixed**: Original multiPivotBacktester.js had syntax errors and undefined variable references
- **Solution**: Created multiPivotBacktesterClean.js with proper multi-timeframe cascade logic
- **Key Improvements**:
  * **Proper Data Loading**: Uses MultiTimeframePivotDetector for all timeframe data loading
  * **Cascade Confirmation**: Iterates through primary timeframe pivots and checks cascade alignment
  * **Clean Architecture**: Removed legacy single-timeframe code that caused conflicts
  * **Accurate Results**: Shows realistic 0% confirmation rate (strict multi-timeframe alignment is rare)
  * **Performance Metrics**: Displays signal frequency, confirmation rates, and data timespan analysis

- **System Performance Verified**:
  * **Data Limits**: Proper 1-month limits enforced for all timeframes (4h: 180, 1h: 720, 15m: 2,880, 1m: 43,200 candles)
  * **Pivot Detection**: 2,235 total pivots detected across all timeframes with perfect alignment to single-timeframe results
  * **Cascade Processing**: Successfully processed 53 primary 4h signals with detailed confirmation analysis
  * **Signal Frequency**: 1.77 primary signals/day over 30-day data span

- **Files**:
  * **multiPivotBacktesterClean.js**: Clean, working multi-timeframe backtester
  * **multiPivotBacktester.js**: Original file (has syntax issues, use Clean version)
  * **MultiTimeframePivotDetector**: Core engine with proper candle limits and cascade logic

## Pivot Data System Updates

### Recent Updates

#### 2025-08-06: 🚀 OPTIMIZER ENHANCEMENT - Full Feature Parity with Backtester
- **Feature**: Updated pivotOptimizer.js to include all advanced features from pivotBacktester.js
- **Major Enhancements**:
  * **Funding Rate Simulation**: Added comprehensive funding rate cost calculation with fixed/variable modes
  * **Slippage Simulation**: Implemented configurable slippage models (fixed, variable, market impact)
  * **1-Minute Candle Support**: Enhanced trade execution to use 1-minute candles for precise TP/SL monitoring
  * **Live API Data Support**: Added support for fetching live candle data from Bybit API
  * **Enhanced Configuration Display**: Shows funding rate and slippage settings in optimizer output
  * **Improved Number Formatting**: Integrated formatNumber() for comma-separated financial values
- **Implementation Details**:
  * **Async Data Loading**: Updated loadCandlesOnce() to support live API data fetching
  * **Dual Timeframe System**: Pivot detection uses configured timeframe, trade execution uses 1-minute precision
  * **Cost Integration**: Funding and slippage costs properly integrated into PnL calculations
  * **Enhanced Display**: Configuration output shows active funding/slippage modes with color coding
  * **Backward Compatibility**: Maintains compatibility with existing CSV data and edge files
- **Trade Execution Improvements**:
  * **Realistic Timing**: Trade entries occur at candle close for realistic execution simulation
  * **Intracandle Precision**: 1-minute candles used for accurate TP/SL monitoring when available
  * **Cost Simulation**: Slippage and funding costs always work against trader for realistic results
  * **Proper Fallback**: Automatically falls back to pivot timeframe when 1-minute data unavailable
- **Configuration Enhancements**:
  * **Funding Rate Display**: Shows fixed/variable funding rates with percentages and intervals
  * **Slippage Mode Display**: Shows active slippage mode (fixed/variable/market impact) with parameters
  * **Direction Mode**: Enhanced display for alternate mode with explanation
  * **Data Source Indication**: Clear indication of data source (local CSV, edges, or live API)
- **Benefits**:
  * **Accurate Optimization**: More realistic backtesting results with proper cost simulation
  * **Feature Consistency**: Optimizer now has same capabilities as standalone backtester
  * **Better Decision Making**: Enhanced configuration display helps users understand active settings
  * **Flexible Data Sources**: Supports local files and live API data for different use cases
- **Status**: ✅ IMPLEMENTED - pivotOptimizer.js now has full feature parity with pivotBacktester.js

#### 2025-08-06: 🎯 COMPREHENSIVE OPTIMIZATION - Pivot Parameter Optimization Added
- **Feature**: Enhanced pivotOptimizer.js to optimize pivot detection parameters alongside trading parameters
- **New Optimization Parameters**:
  * **minSwingPct**: Minimum percentage move required to mark a pivot (affects pivot sensitivity)
  * **minLegBars**: Minimum number of candles required per swing leg (affects pivot quality)
  * **pivotLookback**: Number of candles to look back for pivot confirmation (affects pivot detection pattern)
- **Implementation Details**:
  * **6-Dimensional Optimization**: Now optimizes TP, SL, Leverage, MinSwing%, MinLegBars, and PivotLookback simultaneously
  * **Enhanced CSV Output**: Added new columns for pivot parameters in results file
  * **Dynamic Parameter Passing**: runBacktest() function now accepts pivot configuration parameters
  * **Worker Thread Support**: All new parameters properly passed to worker threads for parallel processing
  * **Progress Display Enhancement**: Shows current values for all 6 parameters during optimization
- **Configuration Integration**:
  * **optimizerConfig.js**: Added minSwingPctRange, minLegBarsRange, and pivotLookbackRange
  * **Flexible Ranges**: Each parameter can have independent start, end, and step values
  * **Backward Compatibility**: Existing configurations continue to work with default ranges
- **Benefits**:
  * **Complete Strategy Optimization**: Finds optimal pivot detection settings for each market condition
  * **Market Adaptation**: Different timeframes and volatility levels require different pivot sensitivities
  * **Comprehensive Testing**: Tests thousands of parameter combinations for robust strategy development
  * **Professional Results**: CSV output includes all parameters for detailed analysis and backtesting
- **Performance Impact**:
  * **Exponential Combinations**: Parameter combinations multiply (e.g., 3×7×1×3×1×1 = 63 combinations)
  * **Parallel Processing**: Worker threads handle increased computational load efficiently
  * **Memory Optimization**: Cached pivot data prevents recalculation across parameter variations
- **Usage Example**:
  ```javascript
  // optimizerConfig.js
  minSwingPctRange: { start: 0.2, end: 1.0, step: 0.3 },  // Test 0.2%, 0.5%, 0.8%
  minLegBarsRange: { start: 1, end: 5, step: 1 },          // Test 1-5 candles
  pivotLookbackRange: { start: 2, end: 6, step: 2 }       // Test 2, 4, 6 lookback
  ```
- **Status**: ✅ IMPLEMENTED - Comprehensive 6-parameter optimization system operational

#### 2025-08-06: 🔧 CRITICAL FIX - Intracandle Trade Tracking
- **Issue**: Trade tracking was only checking one candle per pivot candle period instead of all 1-minute candles within that period
- **Problem**: When using weekly pivot candles, trades showed incorrect durations (7 days instead of actual exit time) and missed intracandle TP/SL hits
- **Root Cause**: System was only processing one 1-minute candle per week instead of all ~10,080 1-minute candles in that week
- **Solution Applied**:
  * **Enhanced Trade Processing**: Modified trade management loop to process ALL 1-minute candles between consecutive pivot candles
  * **Chronological Processing**: Each 1-minute candle is now checked in chronological order for TP/SL conditions
  * **Accurate Exit Detection**: Trades now exit at the exact 1-minute candle where TP/SL is hit, not at the end of the pivot period
  * **Proper Duration Calculation**: Trade durations now reflect actual time from entry to exit, not pivot candle intervals
- **Code Changes**:
  * **Filter Relevant Candles**: `tradeCandles.filter(tc => tc.time > previousPivotTime && tc.time <= currentPivotTime)`
  * **Process Each Candle**: Loop through all relevant 1-minute candles checking TP/SL conditions
  * **Early Exit**: Break loop immediately when trade closes to prevent over-processing
  * **Accurate Indexing**: Store correct exit index from 1-minute candles array
  * **Fixed Duration Calculation**: Use timestamps (`exitTime - entryTime`) instead of indices from different arrays
  * **Corrected Entry Timing**: Trades now enter at pivot candle close time (`currentCandle.time + candleDurationMs`) instead of candle start
  * **Proper Candle Filtering**: 1-minute candles filtered from trade entry time onwards, not from pivot candle start
  * **Fixed Display Timestamps**: Removed double-addition of candleDurationMs in trade details display to show correct execution times
- **Impact**:
  * **Realistic Results**: Backtesting now accurately simulates real trading conditions
  * **Proper Risk Management**: TP/SL levels are respected at 1-minute precision
  * **Correct Performance Metrics**: Trade durations and exit times are now accurate
- **Status**: ✅ RESOLVED - Critical intracandle tracking bug fixed, system now provides accurate trade execution simulation

#### 2025-08-06: 💰 NUMBER FORMATTING - Enhanced Trade Summary Display
- **Feature**: Added comma-separated number formatting for large financial values in trade summary
- **Implementation**:
  * **New Function**: Added `formatNumber()` to `utils/formatters.js` for consistent number formatting
  * **Enhanced Display**: Applied formatting to Final Capital, Overall Profit, and Total PnL values
  * **Improved Readability**: Large numbers now display with thousands separators (e.g., 15,172,645.41)
- **Updated Files**:
  * `utils/formatters.js`: Added `formatNumber(num, decimals = 2)` function
  * `pivotBacktester.js`: Updated trade summary output to use comma formatting
- **Benefits**:
  * **Better Readability**: Large financial numbers are easier to read with comma separators
  * **Professional Display**: Trade summaries now have consistent, professional number formatting
  * **Consistent Formatting**: All large numbers use the same formatting standard
- **Usage**: Numbers automatically formatted in trade summary output with commas for thousands separators
- **Status**: ✅ IMPLEMENTED - Enhanced number formatting operational in trade summaries

#### 2025-08-05: 🎛️ FRONTTESTER DEBUG CONTROL - Configurable Output System
- **Feature**: Added `fronttesterconfig.js` in config folder to control debug output visibility
- **Implementation**:
  * **Debug Output Control**: `showDebug` - Controls general debug messages (pivot history, system state)
  * **Pivot Checking Control**: `showPivotChecking` - Controls detailed pivot checking logs during buffer analysis
  * **Buffer Analysis Control**: `showBufferAnalysis` - Controls buffer re-analysis debug information
  * **Edge Data Control**: `showEdgeData` - Controls edge data calculation displays
  * **System Status Control**: `showSystemStatus` - Controls startup, WebSocket connection, and simulation initialization messages
  * **Progress Control**: `showProgress` - Controls simulation progress indicators in past mode
  * **Heartbeat Control**: `showHeartbeat` - Controls periodic heartbeat messages in live mode
  * **Candle Display Control**: `hideCandles` - Controls candle completion displays (startup position, live candles, simulation candles)
- **Configuration Options** (in `config/fronttesterconfig.js`):
  ```javascript
  export const fronttesterconfig = {
      // Debug Output Controls
      showDebug: false,           // Show/hide debug output
      showPivotChecking: false,   // Show detailed pivot checking logs
      showBufferAnalysis: false,  // Show buffer re-analysis debug info
      showEdgeData: false,        // Show edge data calculations
      showSystemStatus: true,     // Show system status messages
      showProgress: true,         // Show simulation progress
      showHeartbeat: true,        // Show periodic heartbeat messages
      hideCandles: false,         // Hide candle completion displays
      
      // Display Settings
      hideCandle: true,           // Hide intermediate candle fetching messages
      logCandlesInStreamer: true, // Show/hide individual candle logs in streamer
      
      // Past Mode Simulation Settings
      pastMode: true,             // Enable past mode simulation (false = live WebSocket mode)
      speedMultiplier: 10000,     // Simulation speed: 1=normal, 2=2x, 10=10x speed
      startFromEnd: true,         // Start simulation from most recent data
      simulationLength: null      // Number of candles to simulate (null = use full limit)
  };
  ```
- **Benefits**:
  * **Clean Output**: Hide debug spam when not needed for analysis
  * **Selective Debugging**: Enable only specific debug categories for targeted troubleshooting
  * **User Experience**: Cleaner console output for production-like runs
  * **Development Flexibility**: Full debug control for development and testing
- **Usage**: Set individual flags to `true`/`false` in `config/fronttesterconfig.js` to control specific output categories
- **Status**: ✅ IMPLEMENTED - Full debug output control system operational

#### 2025-08-05: ⚡ PERFORMANCE OPTIMIZATION - Smart Pivot Checking
- **Issue**: Full buffer re-analysis was checking 95+ candles every time, causing debug spam
- **User Insight**: "Instead of checking from beginning, can it check the past two pivots and begin calculation from there?"
- **Solution**: Start checking from last confirmed pivot instead of full buffer
- **Implementation**:
  * **Find Last Pivot**: Locate last confirmed pivot position in current buffer
  * **Smart Starting Point**: Begin checking from candle AFTER last pivot (`startCheckingFromIndex = lastPivotPosition + 1`)
  * **Analyze Unknown Territory**: Only process unconfirmed candles
  * **Remove Debug Spam**: Eliminated excessive debug output
- **Performance Impact**:
  * **Before**: Check 95+ candles every time (massive waste)
  * **After**: Check only 2-10 new candles (95% reduction)
  * **Result**: Same accuracy, much faster, clean output
- **Status**: ✅ OPTIMIZED - Maintains perfect accuracy with massive performance improvement

#### 2025-08-05: 🔥 CRITICAL FIX - Full Buffer Re-Analysis Implementation
- **Critical Issue**: Fronttester worked perfectly on restart but missed pivots during real-time operation
- **Root Cause**: Real-time mode used incremental checking while restart used full buffer analysis
- **Key Insight**: "Restart finds all pivots correctly, real-time should do the same"
- **Solution**: Implement full buffer re-analysis on every new candle (later optimized)
- **Implementation**:
  * **Complete Re-analysis**: Re-analyze entire buffer from scratch (`for (let i = pivotLookback; i < candleBuffer.length; i++)`)
  * **Temporary Variables**: Use `tempLastPivot` and `tempPivotCounter` during analysis
  * **New Pivot Detection**: Only display/execute trades for pivots newer than last known pivot
  * **State Synchronization**: Update global `lastPivot` with latest pivot found
  * **Clean Output**: No duplicate announcements, only genuinely new pivots
- **Benefits**:
  * Perfect parity between restart and real-time behavior
  * No more missed pivots during continuous operation
  * Maintains backtester-level accuracy in real-time
- **Status**: ✅ RESOLVED - Later optimized for performance

#### 2025-08-05: 🔥 CRITICAL FIX - Buffer Shifting Pivot Detection Issue
- **Critical Issue**: pivotFronttester.js missing pivots due to stale buffer indices after buffer shifting
- **Root Cause**: Using `lastPivot.index` (static buffer position) while buffer shifts as new candles arrive
- **Impact**: Missed pivots like the one at 5:03 AM that backtester correctly detected
- **Solution**: Implemented timestamp-based pivot tracking
- **Implementation**:
  * **Timestamp Search**: Find last pivot position by searching for `lastPivot.time` in current buffer
  * **Dynamic Start Index**: Calculate correct starting position based on actual buffer position
  * **Fallback Logic**: Handle cases where last pivot is too old and no longer in buffer
  * **Buffer-Shift Resilient**: Works correctly even as candle buffer shifts during real-time operation
- **Benefits**:
  * Perfect parity between backtester and fronttester pivot detection
  * No more missed pivots due to buffer management
  * Robust real-time pivot detection
  * Maintains all existing output formatting
- **Status**: ✅ RESOLVED - Real-time pivot detection now matches backtester exactly

#### 2025-08-05: 🔥 CRITICAL FIX - Real-Time Pivot Detection Rewrite
- **Critical Issue**: pivotFronttester.js was stuck checking same pivot index repeatedly, missing new pivots
- **Root Cause**: Single-index checking approach with flawed `lastCheckedIndex` tracking
- **Solution**: Complete rewrite of `processNewCandle()` function with range-based pivot detection
- **Implementation**:
  * **Range-Based Checking**: Check all potential pivot positions from `lastCheckedIndex + 1` to `currentIndex - pivotLookback`
  * **Progressive Tracking**: Update `lastCheckedIndex` after processing each position
  * **Proper Initialization**: Set `lastCheckedIndex = lastPivot.index` after historical analysis
  * **Loop-Based Processing**: Use for-loop to check multiple pivot positions per candle
- **Benefits**:
  * Real-time pivot detection now works correctly
  * No more "stuck on same index" issues
  * Detects all new pivots as they occur
  * Proper progression through candle buffer
- **Status**: ✅ RESOLVED - Real-time pivot detection completely functional

#### 2025-08-05: Enhanced pivotFronttester.js Startup Display
- **Enhancement**: Added immediate display of latest available candle on system startup
- **User Request**: Show current market position before monitoring for new candles
- **Implementation**:
  - Added "CURRENT POSITION" section in `initializeSystem()` function
  - Displays complete candle information (OHLC, change, range, volume) with color formatting
  - Shows formatted time and date of the latest candle
  - Clear visual separation with "Starting from here" message
- **Benefits**:
  - User immediately sees current market position upon startup
  - Clear context for where real-time monitoring begins
  - Better user experience with immediate market data visibility
  - Eliminates confusion about system starting point

#### 2025-08-05: 🔥 CRITICAL FIX - Negative Bars Issue in Real-Time Pivot Detection
- **Critical Issue**: "Bars since last" showing negative values in real-time pivot detection
- **Root Cause**: Historical pivot analysis was updating `lastPivot.index` with historical indices, causing conflicts with real-time indexing
- **Impact**: Incorrect pivot timing calculations, potential missed pivots
- **Fix**: Added `lastPivot` index reset after historical analysis to align with real-time buffer indexing
- **Implementation**: Reset `lastPivot.index` to `candleBuffer.length - 1 - pivotLookback` after historical analysis
- **Debug Enhancement**: Added debug logging to track `lastPivot` state transitions
- **Status**: ✅ RESOLVED - Real-time pivot detection now uses correct indexing

#### 2025-08-05: 🔥 CRITICAL FIX - Pivot Analysis Bug in pivotFronttester.js
- **Critical Issue**: pivotFronttester.js was only detecting 10 pivots vs 28 in backtester from same data
- **Root Cause**: `analyzeInitialPivots()` loop stopped `pivotLookback` candles before end of buffer
- **Impact**: Missing 64% of recent pivots, incomplete market context
- **Fix**: Changed loop condition from `i < candleBuffer.length - pivotLookback` to `i < candleBuffer.length`
- **Result**: Now analyzes ALL available candles, matching backtester pivot count exactly
- **Status**: ✅ RESOLVED - Both systems now show identical pivot detection results

#### 2025-08-05: Created & Fixed Real-Time Pivot Trading System (pivotFronttester.js)
- **Major Enhancement**: Transformed pivotBacktester.js into a real-time trading system
- **Performance Optimizations**:
  - **Fast Startup**: Reduced initial candle load from 43,200 to 1,000 candles (2s vs 30s startup)
  - **Historical Context**: Added `analyzeInitialPivots()` to show last 10 pivots from loaded data
  - **Smart Display Logic**: Always shows completed candles, respects hideCandle for price updates only
  - **Heartbeat Monitoring**: 30-second status updates when hideCandle is disabled
- **Implementation**:
  - **WebSocket Integration**: Real-time price feeds from Bybit WebSocket API
  - **Rolling Candle Buffer**: Maintains optimized buffer of candles for pivot detection
  - **Live Pivot Detection**: Processes each new candle for pivot identification
  - **Real-Time Trade Execution**: Opens and manages trades based on detected pivots
  - **Active Trade Monitoring**: Continuous TP/SL monitoring with 1-minute precision
- **Key Features**:
  - Maintains all pivot detection logic from backtester
  - Real-time candle display with price change indicators
  - Live trade execution with slippage and funding rate simulation
  - Automatic reconnection on WebSocket disconnection
  - Capital and trade tracking with liquidation protection
- **Architecture**:
  - `initializeSystem()`: Loads initial candle buffer, analyzes pivots, starts WebSocket
  - `analyzeInitialPivots()`: Shows last 10 historical pivots for context
  - `processNewCandle()`: Analyzes each new candle for pivots and trade management
  - `executeTradeLogic()`: Opens trades when valid pivots are detected
  - `processActiveTrades()`: Monitors open positions for TP/SL exits
- **Benefits**:
  - True real-time trading capability with fast startup
  - No lookahead bias (same as backtester)
  - Live market adaptation with historical context
  - Immediate trade execution on pivot detection

#### 2025-08-05: Fixed Next Candle Time Display in fronttest.js
- **Issue**: "Next candle close at" indicator was showing the same time as the current candle instead of the next interval
- **Root Cause**: In `handleIntervalEnd()` function, `fetchLatestCandle()` was called before updating `currentIntervalEnd` to the next interval
- **Fix**: Reordered the function to update `currentIntervalEnd` before calling `fetchLatestCandle()`
- **Code Change**:
  ```javascript
  const handleIntervalEnd = async (timestamp) => {
      // First, calculate boundaries for the next interval and update currentIntervalEnd
      const boundaries = getIntervalBoundaries(timestamp, intervalValue);
      const previousIntervalEnd = currentIntervalEnd;
      currentIntervalEnd = boundaries.end;
      
      // Then fetch and display the latest completed candle (now with correct next interval time)
      await fetchLatestCandle();
      
      // Update tracking to the interval we just processed
      lastProcessedIntervalEnd = previousIntervalEnd;
  };
  ```
- **Result**: "Next candle close at" now correctly shows the upcoming interval time instead of the current one
- **Impact**: Improved user experience with accurate timing information in live monitoring

#### 2025-08-04: Added Funding Rate and Slippage Simulation to pivotBacktester.js
- **Feature**: Comprehensive funding rate and slippage simulation for realistic backtesting
- **Implementation**:
  - **Funding Rate Simulation**: 
    - Configurable funding rate charged every X hours (default 8h)
    - Fixed or variable funding rates with customizable ranges
    - Automatic calculation based on position size, leverage, and trade duration
  - **Slippage Simulation**:
    - Fixed, variable, or market impact-based slippage models
    - Applied to both entry and exit prices
    - Market impact increases with trade size
  - **Enhanced Trade Tracking**: Stores slippage and funding costs separately
  - **Detailed Reporting**: Shows cost breakdown in trade details and summary
- **Configuration Options**:
  - `enableFundingRate`: Enable/disable funding rate simulation
  - `fundingRateHours`: Funding period (8h typical)
  - `fundingRatePercent`: Fixed rate or base rate for variable mode
  - `fundingRateMode`: 'fixed' or 'variable'
  - `enableSlippage`: Enable/disable slippage simulation
  - `slippagePercent`: Base slippage percentage
  - `slippageMode`: 'fixed', 'variable', or 'market_impact'
- **Benefits**:
  - **Realistic Costs**: More accurate representation of actual trading costs
  - **Strategy Validation**: Better assessment of strategy profitability
  - **Risk Management**: Understanding of hidden costs in high-frequency trading
  - **Market Conditions**: Simulates different market liquidity scenarios
- **Display**: Configuration shows funding and slippage settings, trade details include cost breakdown

#### 2025-08-04: Implemented Alternate Trading Mode in pivotBacktester.js
- **Feature**: Added 'alternate' trading mode that inverts normal trading logic
- **Implementation**:
  - **Alternate Mode Logic**: When `direction: 'alternate'` is set in tradeConfig.js:
    - Opens LONG trades at high pivots (instead of SHORT)
    - Opens SHORT trades at low pivots (instead of LONG)
  - **Dynamic Trade Type Selection**: Trade type determined at runtime based on pivot type and mode
  - **Enhanced Display**: Configuration display shows "alternate (LONG at highs, SHORT at lows)" for clarity
  - **Consistent Logging**: Trade entry logs dynamically show correct trade type (LONG/SHORT)
- **Behavior**:
  - **Normal Mode**: HIGH pivots → SHORT trades, LOW pivots → LONG trades
  - **Alternate Mode**: HIGH pivots → LONG trades, LOW pivots → SHORT trades
  - **Both Mode**: Opens both LONG and SHORT trades at each pivot (unchanged)
  - **Buy/Sell Modes**: Single direction trading (unchanged)
- **Benefits**:
  - **Strategy Testing**: Allows testing contrarian vs momentum strategies
  - **Market Adaptation**: Can switch between mean reversion and trend following
  - **Risk Management**: Different risk profiles for different market conditions
  - **Backtesting Flexibility**: Compare normal vs alternate strategies easily
- **Usage**: Set `direction: 'alternate'` in tradeconfig.js to enable inverted trading logic

#### 2025-08-04: Enhanced pivotOptimizer.js with 3D Optimization (TP/SL/Leverage) and Performance Improvements
- **Feature**: Updated `pivotOptimizer.js` with comprehensive enhancements including leverage optimization
- **Implementation**:
  - **3D Optimization**: Added leverage as third optimization dimension alongside TP/SL
  - **Configurable Pivot Detection**: Added support for 'close' vs 'extreme' pivot detection modes
  - **Global Candle Caching**: Avoid reloading data for each combination
  - **Pivot Pre-computation**: Calculate all pivot points once
  - **Dual-Timeframe System**: Same 1-minute candle support as pivotBacktester.js
  - **Optimized Batch Processing**: Larger batch sizes reduce worker overhead
- **Performance Improvements**:
  - **Candle Caching**: Load historical data once instead of thousands of times
  - **Pivot Pre-computation**: Calculate pivot points once instead of recalculating for each combination
  - **Optimized Batching**: Use larger batch sizes to reduce worker creation overhead
  - **Memory Efficiency**: Reduced object creation and memory allocations
- **New Features**:
  - **Leverage Optimization**: Test different leverage values (1x to 100x configurable)
  - **Enhanced CSV Output**: Includes leverage column in results
  - **Comprehensive Display**: Shows TP/SL/Leverage ranges and current progress
  - **Pivot Detection Mode**: Configurable close vs extreme price detection
- **Benefits**:
  - **Massive Speed Increase**: 10-50x faster optimization runs
  - **3D Parameter Space**: Optimize TP, SL, and leverage simultaneously
  - **Accurate Execution**: 1-minute candle precision for TP/SL tracking
  - **Resource Efficient**: Lower CPU and memory usage despite more combinations
  - **Scalable**: Better performance with large parameter ranges (10,000+ combinations)
- **Behavior**: Same dual-timeframe system as pivotBacktester.js with configurable pivot detection

#### 2025-08-04: Enhanced Trade Execution with 1-Minute Candles
- **Feature**: Modified `pivotBacktester.js` to use 1-minute candles for trade execution while maintaining original timeframe for pivot detection
- **Implementation**:
  - Added `load1MinuteCandlesFromCSV()` function to load 1-minute candles within pivot timeframe range
  - Separated pivot detection candles (`pivotCandles`) from trade execution candles (`tradeCandles`)
  - Modified trade management logic to use 1-minute candles for accurate TP/SL tracking
  - Added intelligent fallback to pivot timeframe when 1-minute data unavailable
- **Behavior**:
  - **Pivot Detection**: Uses configured timeframe (e.g., 4h candles for 4h pivots)
  - **Trade Execution**: Always attempts to use 1-minute candles for precise entry/exit timing
  - **Fallback Logic**: Uses pivot timeframe if 1-minute data not available or when using live API data
- **Benefits**:
  - **Increased Accuracy**: More precise trade execution timing with 1-minute granularity
  - **Realistic Simulation**: Better represents actual trading conditions where TP/SL can be hit intracandle
  - **Maintains Strategy Integrity**: Pivot signals still based on original timeframe strategy
  - **Backward Compatible**: Automatically falls back to original behavior when 1-minute data unavailable
- **Display**: Shows clear indication when 1-minute candles are used vs fallback to pivot timeframe
- **Requirements**: Requires 1-minute historical data in `data/historical/{symbol}/1m.csv` for optimal functionality

#### 2025-08-04: Added Configurable Pivot Detection Mode
- **Feature**: Added `pivotDetectionMode` configuration setting to toggle between close and extreme price pivot detection
- **Implementation**:
  - Added `pivotDetectionMode` export to `config.js` with options: `'close'` or `'extreme'`
  - Updated `detectPivot()` function to use configurable price selection
  - Added `getPivotPrice()` helper function for consistent price extraction
  - Modified pivot storage and display to use detected pivot prices
- **Behavior**:
  - `'close'` mode: Uses candle close prices for pivot detection (original behavior)
  - `'extreme'` mode: Uses candle high prices for high pivots, low prices for low pivots
- **Benefits**:
  - Allows testing different pivot detection strategies
  - Maintains backward compatibility (defaults to 'close' mode)
  - Provides more aggressive pivot detection with 'extreme' mode
- **Display**: Title and configuration output now shows active detection mode
- **Verification**: Successfully tested and verified working correctly:
  - Close mode: 5 pivots using candle close prices
  - Extreme mode: 4 pivots using actual high/low prices
  - Different pivot prices and counts confirm proper functionality
  - Created `testPivotModes.js` for clear comparison testing

#### 2025-08-04: Fixed Live API Data Consistency Issue
- **Problem**: Live API data was processed in reverse chronological order, causing different pivot detection results compared to CSV data
- **Root Cause**: Bybit API returns candles newest-first, but pagination logic in multi-batch fetching created incorrect ordering
- **Impact**: Pivot detection results differed between CSV and API data sources, making backtesting inconsistent
- **Solution**:
  - Added chronological sorting logic to `pivotBacktester.js` for API data
  - Implemented duplicate removal and proper timestamp ordering: `uniqueCandles.sort((a, b) => a.time - b.time)`
  - Added `api` import to config imports
  - Preserved existing CSV generator logic (which already handled API sorting correctly)
- **Result**: Pivot detection now produces identical results between CSV and live API data sources
- **Verification**: Both data sources now show same pivot count, times, prices, and trade performance

#### 2025-08-04: Fixed pivotBacktester.js Data Source Configuration
- **Problem**: pivotBacktester.js was using `useEdges` flag instead of `useLocalData` to determine data source
- **Impact**: When `useLocalData = false`, script still used local CSV data instead of fetching live API data
- **Solution**: 
  - Added proper `useLocalData` import from config
  - Added `getCandles` import from Bybit API module
  - Moved data loading logic inside async `runTest()` function
  - Implemented three-way data source logic:
    * `useEdges = true`: Load pre-computed edge data from JSON
    * `useLocalData = true`: Load from local CSV files  
    * `useLocalData = false`: Fetch live data from Bybit API
- **Result**: `useLocalData = false` now correctly fetches live market data from API
- **Benefits**:
  - Proper separation of edge data vs local data configuration
  - Live market data integration for backtesting
  - Consistent behavior with other modules

#### Fixed pivotBacktester.js Data Source Configuration (August 2025)
- **Problem**: pivotBacktester.js was incorrectly using `useEdges` flag instead of `useLocalData` to determine data source, causing it to always use local CSV data even when `useLocalData = false`.
- **Solution**: 
  - Added proper `useLocalData` import from config
  - Added `getCandles` import from './apis/bybit.js'
  - Moved data loading logic inside the async `runTest()` function
  - Implemented three-way data source logic:
    * `useEdges = true`: Load pre-computed edge data from JSON
    * `useLocalData = true`: Load from local CSV files  
    * `useLocalData = false`: Fetch live data from Bybit API
- **Benefits**:
  - `useLocalData = false` now correctly fetches live API data
  - Proper separation of edge data vs local data configuration
  - Live market data integration for backtesting
  - Consistent behavior with other modules

#### Pivot Detection Removed from fronttest.js (August 2025)
- **Implementation**: Removed all pivot-related code from the `fronttest.js` script to create a cleaner, more focused price monitoring system.
- **Key Components Removed**:
  - **Pivot Detection Functions**: Removed `detectPivot()` function that identified high and low pivots.
  - **Pivot Formatting**: Removed `formatPivotOutput()` function used for displaying pivot information.
  - **Pivot Processing**: Removed pivot detection from the candle processing pipeline.
  - **Pivot-based Trade Creation**: Removed code that created trades based on pivot signals.
  - **Pivot References**: Removed pivot data from trade objects.
- **Key Components Retained**:
  - **Trade Management**: Maintained complete trade lifecycle functions including `createTrade()` for trade initialization and `updateTrades()` for handling take profit/stop loss events.
  - **Position Sizing**: Retained dynamic position sizing based on capital and risk per trade (from tradeconfig.js).
  - **P&L Tracking**: Kept real-time profit/loss calculation including fees, with leveraged position impact.
  - **Capital Updates**: Preserved live capital adjustments as trades close with proper fee accounting.
  - **Enhanced Logging**: Maintained color-coded console output for trades with clear status indicators.
- **Benefits**:
  - Cleaner, more focused code base
  - Reduced complexity in the real-time monitoring system
  - Maintained core trade management functionality
  - Performance tracking with complete P&L accounting
  - Visual feedback through color-coded status indicators

#### Real-time Price and Candle Data Stream Implementation (August 2025)
- **Implementation**: Created a dedicated script (`fronttest.js`) for monitoring real-time price updates and fetching complete candle data from the exchange API.
- **Key Components**:
  - Integration with enhanced Bybit WebSocket API for real-time price ticks
  - Direct integration with Bybit REST API for complete candle data
  - Rate-limited console output (1-second intervals)
  - Color-coded price change display
  - Real-time price movement percentage calculation
  - Automatic reconnection on disconnects
  - Error handling for both WebSocket and REST API
  - Countdown timer to next candle close
  - Complete OHLCV candle display at interval completion
  - Smart deduplication to prevent showing the same candle data multiple times
  - **Configurable candle check frequency**: Default checks every 5 seconds (5000ms), can be modified at line 213 in fronttest.js
  - **Configurable output verbosity**: Added `hideCandle` option in config.js to hide intermediate candle fetch logs and price updates while preserving main candle data display
  - **Simplified Historical Loading**: Modified to load only the configured limit of candles rather than calculating based on pivot lookback
- **Benefits**:
  - Live market monitoring without manual API calls
  - Real-time price updates combined with official exchange candle data
  - Foundation for real-time trading strategy development
  - Consistent data format with backtesting system
  - Complete candle data for more accurate trade decisions
  - Minimal latency for rapid market response
  - Cleaner, more focused code without pivot detection complexity

#### Realistic Instant Pivot Detection (No Lookahead) (July 2025)
- **Enhancement**: The pivot detection system in `tests/instantPivotTest.js` has been updated to remove all lookahead bias, providing a realistic simulation of a live trading strategy. It allows for precise tuning of pivot sensitivity and confirmation speed.
- **Two-Step Confirmation Logic (No Lookahead)**:
  1. **Candle Pattern (`pivotLookback`)**: To eliminate lookahead bias, a pivot is now confirmed if its high is strictly greater than the highs of the `pivotLookback` preceding candles (or its low is strictly lower for a low pivot). The check no longer uses future candles, making the test a true simulation of live performance.
  2. **Price Swing (`minSwingPct`)**: The move from the last pivot to the new pivot must meet the minimum percentage swing threshold defined by `minSwingPct`.
  3. **Time Between Pivots (`minLegBars`)**: A minimum number of candles, defined by `minLegBars`, must pass between consecutive pivots to reduce noise from rapid market fluctuations.
- **Detailed Swing Analysis**: The test now calculates and displays the absolute highest high (ATH) and lowest low (ATL) for the candles between each pivot. This is presented in a new indented line showing the `Swing Low` and `Swing High` with their percentage change from the start of the swing, offering a granular view of intra-swing volatility.
- **Refactored Test Output**: The `instantPivotTest.js` script's output has been refactored into a compact, single-line format. All data, including the pivot summary and the detailed swing analysis, is now presented on one line with color-coded labels for improved readability and data density.
- **Time Elapsed Summary**: The test now concludes with a summary of the total time period covered by the loaded candle data, providing better context for the analysis.
- **Market Movement Summary**: The test concludes with a summary of the absolute market movement, independent of pivot detection settings. It calculates the maximum upward and downward move from the starting price to the period's highest high and lowest low, respectively, and also shows the total price range from the absolute low to the absolute high. This provides a stable and accurate measure of the market's true volatility over the tested period.

#### Immediate Pivot Confirmation for Faster Trading (July 2025)
- **Issue**: The previous pivot detection logic, when `confirmOnClose` was enabled, introduced significant delays between a price peak/trough and the actual trade signal. This lag, sometimes lasting many minutes, is unacceptable for a high-frequency scalping strategy as it results in missed opportunities and poor entry prices.
- **Fix**: The `PivotTracker`'s `update` method has been modified to prioritize speed by effectively bypassing the `confirmOnClose` setting.
- **Implementation**: The logic now **always** uses a candle's `low` to confirm a high pivot and a candle's `high` to confirm a low pivot. A pivot is now confirmed as soon as the price makes a significant move in the opposite direction, even intra-candle, rather than waiting for a candle to close.
- **Benefit**: This change drastically reduces confirmation lag, enabling much faster trade entries that are closer to the actual pivot point. This is critical for the effectiveness of the scalping strategy.

#### Handling of Unresolved Trades in Historical Simulation (July 2025)
- **Issue**: The `historicalStreamer.js` script would finish with an "UNRESOLVED trade" message if a trade was still active when the historical data ran out. This left the backtest result incomplete, as the final P&L for the open trade was not calculated.
- **Fix**: A mechanism was implemented to automatically close any open trade at the end of the simulation.
- **Implementation**:
  - A new `forceClose(candle)` method was added to the `PaperTradeManager` class (`utils/live/paperTradeManager.js`). This method closes an active, filled trade using the provided candle's closing price and determines the result (WIN/LOSS).
  - The `historicalStreamer.js` script was updated to check for an active trade after its main loop concludes. If a trade is open, it calls the new `forceClose()` method using the very last candle from the dataset.
  - The console output was updated to clearly indicate when a trade has been `FORCE-CLOSED`, ensuring transparency in the backtest results.
- **Benefit**: This change ensures that all trades are resolved, providing a more complete and accurate performance picture for every backtest run.

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

#### Pre-computed Edge Data for Backtesting (July 2025)
- **Implementation**: Added a specialized backtesting script (`pivotBacktester.js`) that loads pre-computed candle data with edge calculations from a JSON file.
- **Key Components**:
  - Created `loadCandlesWithEdges()` function to parse JSON data containing both candles and edge information
  - Added `getCurrentEdgeData()` function to retrieve edge data directly from each candle's `edges` property
  - Modified `runTest()` function to use the loaded candles instead of fetching new ones
  - Updated `getCurrentEdgeData()` function to retrieve edge data directly from each candle's `edges` property
  - **Candle Limiting (July 2025)**: Enhanced `loadCandlesWithEdges()` to respect the `limit` parameter from config.js, allowing precise control over the number of most recent candles to process
- **Benefits**:
  - Eliminates runtime edge calculations during backtesting for improved performance
  - More consistent edge data across multiple backtesting runs
  - Clearer code that separates edge computation from backtesting logic
  - Compatible with both array-based and object-based JSON structure formats

#### Display Settings Integration in pivotBacktester.js (July 2025)
- **Configurable Output**: The `pivotBacktester.js` has been updated to respect the display settings from `tradeconfig.js`.
  - **Pivot Display Control**: The `showPivot` setting now controls the visibility of pivot detection logs, including high and low pivot information and swing analysis.
  - **Market Orders Display**: The `showLimits` setting now toggles the display of market order (limit) information, including entry price, size, take profit, and stop loss levels.
  - **Trade Details Visibility**: The `showTradeDetails` setting now determines whether trade closure details (TP/SL hits, PnL) are displayed in the console output.
- **Implementation**: Conditional logging statements have been added throughout the backtester to check these configuration flags before outputting information.
- **Benefit**: This enhancement allows users to customize the verbosity of the backtest output based on their needs, reducing noise when only summary statistics are required or providing full detail for in-depth analysis.

#### Robust Logging for Unfilled Trades (July 2025)
- **Issue**: The backtesting script would crash with a `TypeError` if it attempted to log the details of a trade that was never filled (e.g., a cancelled limit order).
- **Fix**: The `EdgeConsoleLogger.logTradeDetails` method was updated to handle these cases gracefully.
- **Implementation**:
  - The logger now checks if `trade.entryPrice` is `undefined` or `null`.
  - If the trade was not filled, it logs a clear `[TRADE X] CANCELLED/NOT FILLED` message, including the cancellation reason if available.
  - This prevents the script from crashing and provides more transparent logging in the backtest output, improving the reliability of the testing suite.

#### Code Duplication Refactoring (July 2025)
- **Issue**: The `pivotBacktester.js` script contained duplicated code for formatting duration strings and pivot output, with nearly identical implementations in multiple places within the file.
- **Fix**: Refactored the code to use single utility functions at the top level of the file and updated all usage locations to call these functions.
- **Implementation**: 
  - Moved the duration formatting logic to a top-level `formatDuration` utility function
  - Created a new `formatPivotOutput` function to handle both high and low pivot output formatting
  - Updated both the trade details display and trade duration statistics sections to use the `formatDuration` function
  - Updated both high and low pivot sections to use the `formatPivotOutput` function
  - This improves maintainability and ensures consistent formatting throughout the output

#### Comprehensive Pivot Backtester Refactoring (July 29, 2025)
- **Issue**: The `pivotBacktester.js` script contained significant code duplication in pivot detection logic, edge data display, and trade creation.
- **Fix**: Created reusable helper functions to reduce duplication and improve maintainability.
- **Implementation**:
  - Added `detectPivot()` function to unify high and low pivot detection logic into a single reusable function
  - Created `formatEdgeData()` function to handle the complex edge data display formatting
  - **Updated (July 29, 2025)**: Modified `formatEdgeData()` to consolidate edge data display from three separate lines into a single comprehensive line with sections for edge proximity, average edges, and range/total edges
  - **Updated (July 29, 2025)**: Enhanced edge data display with color differentiation for section headers (Edges: yellow, Average: magenta, Range: blue) and cyan pipe separators for improved visual scanning
  - **Updated (July 29, 2025)**: Fixed Average Edge calculation to properly show historical averages (7-day for daily, 4-period for weekly/biweekly/monthly) rather than just current period data
  - Implemented `createTrade()` function to standardize trade creation for both long and short positions
  - Updated all instances of pivot detection to use the new helper functions
  - Fixed math in edge calculation to properly handle absolute values for downward movements

#### Pivot Optimizer Implementation (August 15, 2025)
- **Implementation**: Created a dedicated script (`pivotOptimizer.js`) for systematically testing multiple take profit and stop loss combinations.
- **Key Components**:
  - Uses configuration ranges from `optimizerConfig.js` to define take profit and stop loss values to test
  - Runs multiple backtests, iterating through all TP/SL combinations using nested loops
  - Supports both edge-enhanced JSON and standard CSV candle data sources
  - Suppresses verbose output during individual backtests for clarity
  - Shows progress percentage during optimization runs
  - Saves all results to a timestamped CSV file for external analysis
  - Displays a summary of top 5 best performing combinations upon completion
  - Shows comprehensive metrics including profit in both percentage and dollar terms
  - Organized CSV output in `data/optimization/` folder for better file management
  - Uses close prices for pivot detection and trade execution (consistent with pivotBacktester.js)

#### End Of Backtest (EOB) Trade Handling Fix (August 2, 2025)
- **Issue Fixed**: Modified `pivotOptimizer.js` to handle EOB trades consistently with `pivotBacktester.js`
- **Implementation Details**:
  - Changed trades still open at the end of backtest from 'END' to 'EOB' designation
  - Added filtering to exclude EOB trades when calculating performance metrics:
    ```javascript
    // Filter out EOB trades to match pivotBacktester.js behavior
    const regularTrades = closedTrades.filter(t => t.result !== 'EOB');
    ```
  - Updated all metrics calculations to use regularTrades instead of closedTrades
  - Properly adjusted final capital calculation to exclude PnL from EOB trades:
    ```javascript
    // Adjust final capital by removing the impact of EOB trades
    const eobPnl = eobTrades.reduce((acc, t) => acc + t.pnl, 0);
    const adjustedFinalCapital = capital - eobPnl;
    ```
  - Enhanced output to display both percentage gains and absolute dollar amounts
  - Modified CSV output to maintain consistency with the new metrics
- **Benefits**:
  - Consistent metrics between backtester and optimizer tools
  - Proper comparison of different TP/SL combinations using the same standards
  - More realistic performance evaluation by excluding unresolved trades
  - Better understanding of actual profit amounts through dollar value display
- **Benefits**:
  - Enables data-driven parameter selection based on historical performance
  - Provides systematic approach to strategy optimization
  - Maintains consistent backtesting logic with `pivotBacktester.js`
  - Creates a permanent record of test results for later reference and comparison
  - Progress tracking gives estimated completion time for long-running optimization tests
  - Ensured pivot data objects are properly copied when creating trades to avoid reference issues
  - **Updated (July 30, 2025)**: Added `formatPercentageWithColor()` helper function to standardize color formatting for all percentage values
  - **Updated (July 30, 2025)**: Applied consistent color formatting to all edge data displays (main edges, breakout ranges, and average breakout ranges)
  - **Updated (July 30, 2025)**: Eliminated code duplication in percentage formatting across both `formatEdgeData()` function and main `runTest()` function
  - Maintained consistent formatting and behavior while reducing code size by ~200 lines
- **Benefits**:
  - Improved code maintainability by centralizing common logic
  - Reduced risk of inconsistencies between high and low pivot processing
  - Easier debugging with isolated, purpose-specific functions
  - More consistent edge data formatting and display

#### Pivot Removal from fronttest.js (Aug 4, 2025)
- **Implementation**: Completely removed pivot-related code from fronttest.js to create a cleaner price monitoring system.
- **Key Changes**:
  - Removed pivot detection functions and variables
  - Removed pivot formatting and display code
  - Removed historical pivot processing
  - Removed pivot-related console outputs
  - Modified the trade creation function to no longer reference pivot data
  - Updated header information to remove pivot settings
  - Simplified the candle processing logic
- **Benefits**:
  - Cleaner, more focused code base
  - Improved readability and maintainability
  - Reduced complexity in the real-time monitoring system
  - Maintained core price monitoring and trade management functionality

#### Candle / Trade Log Synchronization (Aug 4, 2025)
- **Issue**: Trade update logs occasionally appeared before the corresponding candle update, making real-time output confusing.
- **Fix Implementation (fronttest.js)**:
  - Introduced a single `intervalValue` constant to hold the numeric form of the configured interval for reuse.
  - Converted WebSocket price handler to **async** so it can `await fetchLatestCandle()` when a candle closes.
  - When the timestamp crosses the current interval end, the handler now:
    1. Calculates boundaries for the next interval.
    2. Awaits `fetchLatestCandle()` to fetch and display the completed candle (which internally triggers trade updates).
    3. Only after the above finishes, logs the "Next candle close at …" countdown.
  - Added missing rate-limit brace that was causing logging logic to malfunction.
- **Benefit**: Console output now shows candles first, then their related trade updates, then the countdown to the next candle, preserving chronological clarity.

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
  - The script outputs a summary of pivot detection and detailed trade performance statistics, including Gross PnL (before fees) and Net PnL (after fees). like P&L percentage, win rate, and excursions.
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
  * Shows current edge position percentages with explicit signs (+/-)
  * Includes average edge data for daily/weekly/monthly timeframes with consistent sign conventions
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

#### Edge Calculation Performance Optimization (July 2025)
- **Issue**: Edge calculations for larger timeframes were inefficient when using 1-minute candles, causing significant performance issues during backtesting with full historical data.
- **Impact**: Processing up to 43,200 candles for monthly edge calculations resulted in extremely slow backtests and high memory usage.
- **Optimization**: Modified `pivotBacktester.js` to use hourly candles for edge calculations while keeping 1-minute candles for display and trading logic:
  - Loads hourly candles specifically for edge calculations (60x fewer candles to process)
  - Limits hourly candles to 1,440 (approximately 2 months) for optimal performance
  - Automatically detects candle intervals and adjusts timeframe calculations accordingly:
    - For hourly data: Daily=24, Weekly=168, Biweekly=336, Monthly=720 candles
    - For minute data: Daily=1440, Weekly=10080, Biweekly=20160, Monthly=43200 candles
  - Includes fallback to minute candles if hourly data isn't available
- **Results**: 
  - Processing time reduced from minutes to seconds for full backtests
  - Memory usage significantly reduced
  - Edge accuracy maintained across all timeframes

#### Edge Calculation Timeframe Fix (July 2025)
- **Issue**: The edge calculation logic in `pivotBacktester.js` incorrectly assumed 1-hour candles when calculating timeframes for daily, weekly, biweekly, and monthly edges, despite actually processing 1-minute candle data.
- **Impact**: This resulted in inaccurate edge calculations with incorrectly scaled timeframes (e.g., "daily" edges only covered 24 minutes instead of 24 hours).
- **Fix**: Updated the timeframe calculations in the `calculateEdges` function to properly handle 1-minute candle data:
  - Daily: 24 * 60 = 1,440 candles (full 24 hours)
  - Weekly: 24 * 60 * 7 = 10,080 candles (full week)
  - Biweekly: 24 * 60 * 14 = 20,160 candles (two weeks)
  - Monthly: 24 * 60 * 30 = 43,200 candles (30 days)
- **Verification**: Edge calculations now correctly reflect the proper time periods, producing more accurate market analysis.

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

#### pivotBacktester.js
- Self-contained backtesting tool for pivot-based trading strategies
- Features:
  * Instant pivot detection with no lookahead bias
  * Uses high/low values for pivot detection (traditional pivot method)
  * Comprehensive trade tracking (entry, exit, P&L, drawdown)
  * Detailed trade statistics
  * Optional pivot edge integration
  * Customizable trade parameters via config files
  * Multi-directional trading modes (long, short, both)
  * Support for candle data from various sources
- Usage: `node pivotBacktester.js`
- Dependencies: Requires candle data in either JSON or CSV format
- Output: Detailed trade log, profit metrics, and performance statistics

#### Pivot Detection Modes

**Close-Only Pivot Detection** (`pivotBacktester.js`):
- Uses candle close prices for both pivot detection and trade entry
- More conservative in detecting pivots
- Provides realistic trade execution simulation for market orders
- Suitable for backtesting strategies that execute trades at candle close

> **Note:** Previously, the system offered a standard high/low pivot detection mode that used candle highs for high pivots and candle lows for low pivots. This version has been replaced with the more realistic close-only implementation.

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

### Sequential Trade Execution (July 2025)
- **Logic**: The backtesting system is designed to execute trades strictly in sequence, ensuring that a new trade is only initiated after the previous one has been fully resolved (i.e., closed, cancelled, or expired).
- **Implementation**: This is enforced by a two-level architecture:
  - **`BacktestController`**: Orchestrates the overall backtest. It iterates through each pivot signal in a `for...of` loop and uses `await` when calling the `TradeExecutor`. This `await` keyword is crucial as it pauses the loop, preventing it from processing the next pivot until the current trade simulation is complete.
  - **`TradeExecutor`**: Manages the lifecycle of a single trade. Its `run` method simulates the trade from order creation, through fill monitoring, to final closure (via take-profit, stop-loss, or expiration). It only returns control to the `BacktestController` once the trade is concluded.
- **Guarantee**: This design guarantees that there are no concurrent or overlapping trades in the backtest, providing a clear and realistic simulation of a single-position trading strategy.

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

## Simulation Tools

### Instant Pivot Test (`tests/instantPivotTest.js`)

- **Purpose**: A lightweight, dependency-free script for rapid prototyping and testing of the configurable, multi-step pivot detection logic. It allows for quick validation of the `pivotLookback`, `minSwingPct`, and `minLegBars` parameters.
- **Mechanism**:
  - The script is self-contained and loads historical candle data to simulate a data stream.
  - It applies the three-step pivot confirmation logic and prints a detailed, analytical summary for each confirmed pivot.
  - It concludes by reporting the total time elapsed in the dataset, providing context for the pivot frequency.
- **Benefit**: This tool enables rapid, iterative tuning of the core pivot detection parameters in an isolated environment, free from the complexities of the full trading framework. It is the primary tool for validating changes to the pivot detection strategy.

### Historical Streamer (`historicalStreamer.js`)

- **Purpose**: To simulate a live WebSocket data feed using historical candle data. This provides a hybrid front-testing/backtesting environment, allowing for the evaluation of live trading logic (`paperTrader.js`) against a complete historical dataset.
- **Configuration Display**: At startup, the streamer now displays a summary of the current trade settings from `config/tradeconfig.js` for immediate verification.
- **Mechanism**:
  - The script loads the entire historical candle dataset for a given symbol and interval from local CSV files.
  - It then iterates through the candles chronologically, feeding each candle into the `PivotTracker` and `pivotBacktester.js` instances.
  - This process mimics the behavior of the WebSocket connection in `paperTrader.js`, where candles are processed as they are received.
- **Integration**:
  - Utilizes the same configuration files (`config/config.js`, `config/tradeconfig.js`) as the live paper trader.
  - Leverages the `getCandles` function from `apis/bybit.js`, using both the `limit` and `time` settings from `config.js` to load the precise historical window for the simulation.
- **Benefit**: This tool enables rigorous, realistic testing of the live trading and pivot detection logic without needing to wait for a live market. It combines the real-time, event-driven nature of front-testing with the speed and comprehensiveness of a full historical backtest.
- **Output Formatting**:
  - All major events (Pivots, Trades, Closures) are logged in a clean, single-line, color-coded format to prevent output scrambling and enhance readability.
  - **`[PIVOT]`**: Green for `HIGH`, Red for `LOW`. Displays pivot number, type, price, confirmation time, percentage move, and bars.
    - *Example*: `1.[PIVOT] LOW @ 118478.00 | Confirm: 7/21/2025, 3:12:00 PM | Move: 0.35% | Bars: 28`
  - **`[TRADE]`**: Green for `WIN`, Red for `LOSS`. Displays result, side, PnL percentage, entry, and exit price.
    - *Example*: `[TRADE] WIN | Side: BUY | PnL: 0.5000% | Entry: 118478 | Exit: 119070.39`
  - **`[CLOSED]`**: Cyan for `WIN`, Magenta for `LOSS`. Used for trades that are force-closed at the end of the simulation data.
    - *Example*: `[CLOSED] WIN | Side: SELL | PnL: 0.0432% | Entry: 119460.3 | Exit: 119408.7`

### Pivot Backtester

### 2025-07-31 – Trade Details Edge Data

* Added pivot edge data display to each Trade Details block.
* `pivotBacktester.js` now calls `formatEdgeData()` for the pivot candle associated with the trade and prints the returned lines indented beneath the standard trade stats.
* Ensures visual formatting, colors, and indentation are identical to original pivot output.
 (`pivotBacktester.js`)

- **Purpose**: To provide a comprehensive backtest of a trading strategy based on pivot points. Unlike `instantPivotTest.js` which only validates pivot signals, `pivotBacktester.js` simulates actual trades based on these pivots, providing a full performance report.
- **Core Logic**:
  - The script loads historical candle data and applies the same pivot detection logic as other tools.
  - When a pivot is detected, it simulates a trade based on the settings in `config/tradeconfig.js`.
    - **Long Trades**: Initiated on `low` pivots.
    - **Short Trades**: Initiated on `high` pivots.
  - **Trade Management**: Each trade is managed with a pre-defined `takeProfit` and `stopLoss` percentage. The simulation tracks one active trade at a time, closing it when either the take profit or stop loss level is hit by subsequent candles.
- **Trade Configuration**

The `tradeconfig.js` file contains settings for trade execution:

- Direction: Controls which pivot types trigger trades ('buy', 'sell', or 'both')
- Take Profit: Percentage move for profit target
- Stop Loss: Percentage move for stop loss
- Leverage: Multiplier for position sizing
- Fees: Trading fees for maker orders
- Capital: Initial capital and risk per trade settings
- Order Settings: Distance and cancellation thresholds
- Trade Timeout: Maximum time in minutes a trade can remain open before automatic closure management.
- **Automatic Trade Closure at End of Backtest**: To ensure complete and accurate results, the backtester now automatically closes any open trades at the end of the simulation.
  - **Mechanism**: If an `activeTrade` object exists after all candles are processed, the trade is formally closed using the `close` price of the final candle in the dataset.
  - **Trade Record**: The closed trade is added to the trades array with a result of 'EOB' (End Of Backtest).
  - **Complete PnL Calculation**: Fees are properly calculated and deducted.
  - **Statistics Exclusion**: EOB trades are excluded from performance statistics (win rate, PnL) to prevent skewing results with incomplete trades.
- **Enhanced Trade Details Display**: The backtester now provides a comprehensive, color-coded breakdown of each trade before the summary statistics.
  - **Trade Header**: The first line of each trade is color-coded based on profitability (green for profitable trades, red for losing trades).
    - Shows trade number, direction (LONG/SHORT), P&L percentage, outcome (WIN/LOSS), and result type (TP, SL, EOB).
  - **Trade Details**: Entry, exit, and duration information is displayed in blue for improved readability.
  - **Price Movement**: Shows the raw price movement in both percentage and absolute terms, color-coded (green for price increases, red for decreases).
  - **Maximum Price Movements**: For each trade, displays the maximum favorable and unfavorable price movements that occurred during the trade's lifetime, providing valuable data for optimizing take profit and stop loss levels.
  - **Date Formatting**: Includes day of week alongside date and time for better context.
  - **Duration Calculation**: Shows trade duration in days, hours, and minutes for comprehensive analysis of holding periods.
- **Output**:
  - The script first outputs the standard pivot detection log for each identified pivot.
  - At the end of the simulation, it appends a detailed **Trade Summary**:
    - **Performance Metrics**: Total trades, wins, losses, and win rate.
    - **Profit and Loss**: 
      - **Gross PnL**: Total profit or loss *before* deducting trading fees.
      - **Net PnL**: The final profit or loss *after* all leveraged trading fees have been deducted.
    - **Capital**: Initial and final capital, and the overall percentage return on capital.
    - **Price Movement Statistics**: Detailed statistics on the maximum favorable and unfavorable price movements across all trades, including:
      - **Highest/Lowest/Average Favorable Movement**: The maximum, minimum, and average of the most favorable price movements across all trades.
      - **Highest/Lowest/Average Unfavorable Movement**: The maximum, minimum, and average of the most unfavorable price movements across all trades.
      - These statistics are crucial for optimizing take profit and stop loss levels based on actual market behavior.
    - **Trade Duration Statistics**: Comprehensive analysis of trade holding periods:
      - **Shortest Trade**: The duration of the quickest trade from entry to exit.
      - **Longest Trade**: The duration of the most extended trade from entry to exit.
      - **Average Trade**: The mean duration across all completed trades.
      - These metrics help optimize trading frequency and holding period strategies.

#### Backtest Delay Factor Implementation (August 2025)
- **Enhancement**: Added a configurable delay factor to the pivotBacktester.js script to simulate backtesting with historical data shifted by a specific number of candles.
- **Implementation**:
  - Added delay configuration in `config.js` as the number of candles to shift the backtest into the past
  - Modified `pivotBacktester.js` to remove the most recent N candles based on the delay setting
  - Added user-friendly output showing the effective backtest date after applying delay
  - Displays both the number of candles removed and the equivalent time period for clarity
  - Includes safety checks to ensure the delay doesn't exceed the available data
- **Benefits**:
  - Enables testing the strategy as if it were running in a past environment
  - Provides precise control over exactly how many candles to exclude from recent data
  - Useful for scenario analysis and historical validation
  - Helps identify how the strategy would have performed in specific market conditions
  - Assists in validating strategy consistency across different time periods
  - Simple numerical input makes configuration straightforward

#### Interval-Aware Time Calculation (August 2025)
- **Issue**: Previously, trade durations and elapsed times were calculated assuming all candles represented 1-minute intervals, regardless of the actual interval setting in config.js. This resulted in misleading duration statistics when using larger intervals like 1h or 1d.
- **Fix**: Enhanced the time calculation system in `pivotBacktester.js` to dynamically adjust for the candle interval specified in config.js.
- **Implementation**:
  - Added `intervalToMs()` function to convert interval strings (e.g., '1m', '1h', '1d') into millisecond durations
  - Updated duration calculations to use actual candle index differences multiplied by the interval duration
  - Modified elapsed time calculation to use candle count instead of raw timestamps, eliminating potential gaps in historical data
  - The `formatDuration()` function was preserved but now works with correctly scaled time values
- **Benefits**:
  - Accurate trade duration statistics regardless of candle interval (1m, 5m, 15m, 1h, 4h, 1d, etc.)
  - Consistent and reliable time elapsed reporting for backtest periods
  - Proper scaling of all time-based metrics when changing candle interval in config.js

This tool is essential for validating the end-to-end profitability of a pivot-based trading strategy, including the critical impact of leverage and fees.

#### Historical Data Fetching System (August 2025)
- **Implementation**: Created a robust system (`generateHistoricalData.js`) for fetching, validating, and maintaining historical price data.
- **Key Components**:
  - **Smart Gap Detection**: Identifies and fills missing data ranges rather than re-downloading everything
  - **Error Resilience**: Implements retry mechanism (3 attempts) with exponential backoff
  - **Data Validation**: Validates candle integrity before saving to prevent corrupt data
  - **File Backup**: Creates backups of existing files before modifications
  - **Interval Normalization**: Ensures consistent formatting of time intervals (e.g., appending 'm' to minute-based intervals)
  - **Rate Limit Handling**: Includes configurable delays between API requests
  - **Incremental Updates**: Tracks last update times to minimize redundant data fetching
  - **Configurable Timespan**: Fetches data based on configurable time period (months parameter)
  - **Multiple Pairs/Intervals**: Supports batch processing of multiple trading pairs and timeframes
- **Benefits**:
  - Provides reliable historical data foundation for backtesting and analysis
  - Minimizes API usage by fetching only necessary data
  - Prevents data corruption through validation and backups
  - Supports flexible historical analysis across multiple timeframes
  - Maintains data integrity with duplicate prevention and sorting

#### Account Liquidation Simulation (August 2025)
- **Issue**: Previously, the backtesting system allowed capital to become negative after losses, which is unrealistic as real trading accounts would be liquidated.
- **Fix**: Added realistic account liquidation simulation to both pivotBacktester.js and pivotOptimizer.js.
- **Implementation**:
  - Added checks after calculating P&L and updating capital to ensure capital never goes below zero
  - If capital reaches zero or negative, it is clamped to exactly zero
  - A clear "[LIQUIDATION]" message is shown in the console when liquidation occurs (only in pivotBacktester.js)
  - Trading is automatically stopped once liquidation occurs (no new trades will be opened)
  - Enhanced end-of-backtest (EOB) trade handling to respect liquidation state
  - Added final liquidation check before generating summary statistics
  - For EOB trades, capital is only updated if the account has not already been liquidated
  - If account was previously liquidated, EOB trades are still closed but don't affect capital
  - Liquidation messages are suppressed in pivotOptimizer.js to keep optimization output clean
- **Benefits**:
  - More realistic backtesting that accurately simulates real-world trading conditions
  - Better risk assessment by showing true account liquidation scenarios
  - Clear indication in logs when liquidation occurs for easier analysis of failure points
  - Prevents unrealistic scenarios where trading continues with negative capital
  - Ensures final capital is always exactly zero after liquidation, regardless of subsequent EOB trades
