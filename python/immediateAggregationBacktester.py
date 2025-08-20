# Immediate Aggregation Backtester - Python Version
"""
immediateAggregationBacktester.py
Advanced backtester using immediate aggregation technology
Supports both individual pivot trading and cascade confirmation strategies
"""

import os
import sys
import json
import csv
import math
import time
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple, Any
from dataclasses import dataclass
from collections import defaultdict

try:
    import pandas as pd
    HAS_PANDAS = True
except ImportError:
    HAS_PANDAS = False

# ===== CONFIGURATION =====
BACKTEST_CONFIG = {
    # Trading mode
    'trading_mode': 'cascade',  # 'pivot' = trade individual pivots, 'cascade' = require multi-timeframe confirmation
    
    # Data settings
    'use_live_api': False,      # Force API data
    'max_candles': 43200,       # 30 days of 1m candles - MATCH JAVASCRIPT EXACTLY
    
    # Output settings
    'show_every_nth_trade': 1,  # Show every Nth trade
    'show_first_n_trades': 20,  # Always show first N trades
    'progress_every': 1000,     # Progress update frequency
    
    # Logging settings
    'show_initialization_logs': False,  # Hide immediate aggregation initialization logs
}

# ===== DATA CLASSES =====
@dataclass
class Candle:
    time: int
    open: float
    high: float
    low: float
    close: float
    volume: float

@dataclass
class Pivot:
    type: str  # 'high' or 'low'
    price: float
    time: int
    index: int
    signal: str  # 'long' or 'short'
    swing_pct: float = 0.0
    timeframe: str = ''

@dataclass
class Trade:
    id: str
    type: str  # 'long' or 'short'
    timeframe: str
    entry_price: float
    entry_time: int
    trade_size: float
    take_profit_price: float
    stop_loss_price: float
    leverage: int
    status: str = 'open'
    exit_price: Optional[float] = None
    exit_time: Optional[int] = None
    exit_reason: str = ''
    pnl: float = 0.0
    pnl_pct: float = 0.0
    pivot: Optional[Pivot] = None
    
    # Slippage tracking
    original_entry_price: Optional[float] = None
    entry_slippage: float = 0.0
    exit_slippage: Optional[float] = None
    original_exit_price: Optional[float] = None
    
    # Trailing fields
    best_price: float = 0.0
    trailing_take_profit_active: bool = False
    trailing_take_profit_price: Optional[float] = None
    original_take_profit_price: Optional[float] = None
    trailing_stop_loss_active: bool = False
    trailing_stop_loss_price: Optional[float] = None
    original_stop_loss_price: Optional[float] = None
    
    def __post_init__(self):
        if self.best_price == 0.0:
            self.best_price = self.entry_price
        if self.original_take_profit_price is None:
            self.original_take_profit_price = self.take_profit_price
        if self.original_stop_loss_price is None:
            self.original_stop_loss_price = self.stop_loss_price

@dataclass
class Confirmation:
    timeframe: str
    role: str
    weight: float
    pivot: Pivot
    inverted: bool = False

# ===== COLORS =====
class Colors:
    RESET = '\033[0m'
    RED = '\033[31m'
    GREEN = '\033[32m'
    YELLOW = '\033[33m'
    CYAN = '\033[36m'
    MAGENTA = '\033[35m'
    BLUE = '\033[34m'
    DIM = '\033[2m'
    BOLD = '\033[1m'

# ===== UTILITY FUNCTIONS =====
def parse_timeframe_to_minutes(timeframe: str) -> int:
    """Parse timeframe string to minutes"""
    tf = timeframe.lower()
    
    if tf.endswith('m'):
        return int(tf.replace('m', ''))
    elif tf.endswith('h'):
        return int(tf.replace('h', '')) * 60
    elif tf.endswith('d'):
        return int(tf.replace('d', '')) * 60 * 24
    elif tf.endswith('w'):
        return int(tf.replace('w', '')) * 60 * 24 * 7
    else:
        # Default to minutes if no suffix
        return int(tf)

def format_dual_time(timestamp: int) -> str:
    """Format timestamp to show both 12-hour and 24-hour time"""
    dt = datetime.fromtimestamp(timestamp / 1000)
    twelve_hour = dt.strftime('%m/%d/%Y, %I:%M:%S %p')
    twenty_four_hour = dt.strftime('%H:%M:%S')
    return f"{twelve_hour} ({twenty_four_hour})"

def format_number_with_commas(number: float) -> str:
    """Format number with commas for thousands separator"""
    if not isinstance(number, (int, float)):
        return str(number)
    return f"{number:,.2f}"

def apply_funding_rates(current_time: int, open_trades: List, capital: float, applied_funding_rates: set, trade_config: Dict) -> float:
    """Apply funding rates to open trades at specified intervals"""
    funding_interval_hours = trade_config.get('funding_interval_hours', 8)  # Default 8 hours
    funding_rate = trade_config.get('funding_rate', 0.0001)  # Default 0.01%
    
    if not open_trades or funding_rate == 0:
        return capital
    
    # Calculate funding time key (every X hours)
    funding_time_key = (current_time // (funding_interval_hours * 60 * 60 * 1000)) * (funding_interval_hours * 60 * 60 * 1000)
    
    if funding_time_key not in applied_funding_rates:
        applied_funding_rates.add(funding_time_key)
        
        total_funding = 0
        for trade in open_trades:
            # Funding cost = position size * funding rate
            funding_cost = trade.trade_size * funding_rate
            total_funding += funding_cost
        
        capital -= total_funding
        
        if trade_config.get('show_trade_details', False):
            print(f"{Colors.DIM}💰 Funding applied: -${total_funding:.2f} | Remaining Capital: ${capital:.2f}{Colors.RESET}")
    
    return capital

def is_no_trade_day(timestamp: int, no_trade_days: List[str]) -> bool:
    """Check if timestamp falls on a no-trade day"""
    if not no_trade_days:
        return False
    
    dt = datetime.fromtimestamp(timestamp / 1000, tz=timezone.utc)
    day_names = ['Su', 'M', 'T', 'W', 'Th', 'F', 'Sa']
    current_day = day_names[dt.weekday()]
    
    return current_day in no_trade_days

# ===== CONFIGURATION LOADING =====
def load_config():
    """Load configuration from files"""
    config_dir = os.path.join(os.path.dirname(__file__), 'config')
    
    # Load main config
    with open(os.path.join(config_dir, 'config.json'), 'r') as f:
        main_config = json.load(f)
    
    # Load trade config
    with open(os.path.join(config_dir, 'trade_config.json'), 'r') as f:
        trade_config = json.load(f)
    
    # Load multi pivot config
    with open(os.path.join(config_dir, 'multi_agg_config.json'), 'r') as f:
        multi_pivot_config = json.load(f)
    
    return main_config, trade_config, multi_pivot_config

# ===== DATA LOADING =====
def load_1m_candles(symbol: str, use_local_data: bool, max_candles: int) -> List[Candle]:
    """Load 1-minute candles from CSV or API"""
    print(f"{Colors.CYAN}Loading 1m candles...{Colors.RESET}")
    
    should_use_api = BACKTEST_CONFIG['use_live_api'] or not use_local_data
    
    if not should_use_api:
        # Load from CSV with optimized reading
        csv_path = os.path.join(os.path.dirname(__file__), '..', 'data', 'historical', symbol, '1m.csv')
        if not os.path.exists(csv_path):
            raise FileNotFoundError(f"Local 1m data not found: {csv_path}")
        
        candles = []
        print(f"{Colors.DIM}Reading CSV file: {csv_path}{Colors.RESET}")
        
        try:
            # DIRECT SYSTEM TAIL COMMAND - FASTEST APPROACH
            import subprocess
            result = subprocess.run(['tail', '-n', str(max_candles + 1), csv_path], 
                                  capture_output=True, text=True)
            lines = result.stdout.strip().split('\n')[1:]  # Skip header
            
            candles = []
            for line in lines:
                if line.strip():
                    timestamp, open_price, high, low, close, volume = line.split(',')[:6]
                    candles.append(Candle(
                        time=int(timestamp),
                        open=float(open_price),
                        high=float(high),
                        low=float(low),
                        close=float(close),
                        volume=float(volume)
                    ))
            
            # Sort chronologically to match JavaScript
            candles.sort(key=lambda x: x.time)
            print(f"{Colors.GREEN}Loaded {len(candles)} 1m candles from CSV{Colors.RESET}")
        
        except Exception as e:
            print(f"{Colors.RED}Error loading CSV: {e}{Colors.RESET}")
            print(f"{Colors.YELLOW}Attempting simple fallback method...{Colors.RESET}")
            
            # Simple fallback: read entire file and take last N lines
            try:
                with open(csv_path, 'r') as f:
                    all_lines = f.readlines()
                    # Skip header and take last max_candles
                    data_lines = all_lines[1:]  # Skip header
                    last_lines = data_lines[-max_candles:] if len(data_lines) > max_candles else data_lines
                    
                    for line in last_lines:
                        if line.strip() and ',' in line:
                            parts = line.strip().split(',')
                            if len(parts) >= 6:
                                try:
                                    timestamp, open_price, high, low, close, volume = parts[:6]
                                    candles.append(Candle(
                                        time=int(timestamp),
                                        open=float(open_price),
                                        high=float(high),
                                        low=float(low),
                                        close=float(close),
                                        volume=float(volume)
                                    ))
                                except (ValueError, IndexError):
                                    continue
            except Exception as fallback_error:
                print(f"{Colors.RED}Fallback also failed: {fallback_error}{Colors.RESET}")
                return []
        
        candles.sort(key=lambda x: x.time)
        print(f"{Colors.GREEN}Loaded {len(candles)} 1m candles from CSV{Colors.RESET}")
        return candles
    else:
        # Load from API (placeholder - implement actual API call)
        print(f"{Colors.YELLOW}API loading not implemented yet{Colors.RESET}")
        return []

# ===== PIVOT DETECTION =====
def detect_pivot(candles: List[Candle], index: int, config: Dict) -> Optional[Pivot]:
    pivot_lookback = config['pivotLookback']
    min_swing_pct = config['minSwingPct']
    min_leg_bars = config['minLegBars']
    pivot_detection_mode = config.get('pivot_detection_mode', 'close')
    
    # Allow lookback = 0 by skipping only the very first candle
    if pivot_lookback == 0 and index == 0:
        return None
    if index < pivot_lookback or index >= len(candles):
        return None
    
    current_candle = candles[index]
    current_high = current_candle.close if pivot_detection_mode == 'close' else current_candle.high
    current_low = current_candle.close if pivot_detection_mode == 'close' else current_candle.low
    
    # Check for high pivot
    is_high_pivot = True
    if pivot_lookback > 0:
        for j in range(1, pivot_lookback + 1):
            if index - j < 0:
                is_high_pivot = False
                break
            compare_high = candles[index - j].close if pivot_detection_mode == 'close' else candles[index - j].high
            if current_high <= compare_high:
                is_high_pivot = False
                break
    
    # Check for low pivot
    is_low_pivot = True
    if pivot_lookback > 0:
        for j in range(1, pivot_lookback + 1):
            if index - j < 0:
                is_low_pivot = False
                break
            compare_low = candles[index - j].close if pivot_detection_mode == 'close' else candles[index - j].low
            if current_low >= compare_low:
                is_low_pivot = False
                break
    
    # Special handling when lookback = 0
    if pivot_lookback == 0:
        prev = candles[index - 1]
        prev_high = prev.close if pivot_detection_mode == 'close' else prev.high
        prev_low = prev.close if pivot_detection_mode == 'close' else prev.low
        is_high_pivot = current_high > prev_high
        is_low_pivot = current_low < prev_low
        
        # If both directions qualify, pick the dominant excursion
        if is_high_pivot and is_low_pivot:
            up_excursion = abs(current_high - prev_high)
            down_excursion = abs(prev_low - current_low)
            if up_excursion >= down_excursion:
                is_low_pivot = False
            else:
                is_high_pivot = False
    
    if not is_high_pivot and not is_low_pivot:
        return None
    
    pivot_type = 'high' if is_high_pivot else 'low'
    pivot_price = current_high if is_high_pivot else current_low
    
    # Calculate swing percentage
    max_swing_pct = 0.0
    
    if min_swing_pct > 0:
        upper = 1 if pivot_lookback == 0 else pivot_lookback
        for j in range(1, upper + 1):
            if index - j < 0:
                break
            
            compare_candle = candles[index - j]
            if pivot_detection_mode == 'close':
                compare_price = compare_candle.close
            else:
                compare_price = compare_candle.low if pivot_type == 'high' else compare_candle.high
            
            swing_pct = abs((pivot_price - compare_price) / compare_price * 100)
            max_swing_pct = max(max_swing_pct, swing_pct)
        
        if max_swing_pct < min_swing_pct:
            return None
    
    return Pivot(
        type=pivot_type,
        price=pivot_price,
        time=current_candle.time,
        index=index,
        signal='short' if pivot_type == 'high' else 'long',
        swing_pct=max_swing_pct
    )

# ===== IMMEDIATE AGGREGATION =====
def aggregate_candles(one_minute_candles: List[Candle], target_interval: str) -> List[Candle]:
    """Aggregate 1-minute candles into target timeframe"""
    # Parse interval to minutes
    interval_minutes = parse_timeframe_to_minutes(target_interval)
    
    if interval_minutes <= 0:
        raise ValueError(f"Invalid interval: {target_interval}")
    
    aggregated_candles = []
    interval_ms = interval_minutes * 60 * 1000
    
    # Group candles by time windows
    candle_groups = defaultdict(list)
    
    for candle in one_minute_candles:
        # Calculate the start of the interval window this candle belongs to
        window_start = (candle.time // interval_ms) * interval_ms
        candle_groups[window_start].append(candle)
    
    # Create aggregated candles
    for window_start in sorted(candle_groups.keys()):
        candles_in_window = candle_groups[window_start]
        
        if candles_in_window:
            # Sort candles by time within the window
            sorted_candles = sorted(candles_in_window, key=lambda x: x.time)
            
            # Create aggregated candle
            aggregated_candle = Candle(
                time=window_start + interval_ms,  # End time of the interval
                open=sorted_candles[0].open,
                high=max(c.high for c in sorted_candles),
                low=min(c.low for c in sorted_candles),
                close=sorted_candles[-1].close,
                volume=sum(c.volume for c in sorted_candles)
            )
            
            aggregated_candles.append(aggregated_candle)
    
    return sorted(aggregated_candles, key=lambda x: x.time)

def parse_timeframe_to_minutes(timeframe: str) -> int:
    """Parse timeframe string to minutes"""
    if timeframe.endswith('m'):
        return int(timeframe[:-1])
    elif timeframe.endswith('h'):
        return int(timeframe[:-1]) * 60
    elif timeframe.endswith('d'):
        return int(timeframe[:-1]) * 24 * 60
    elif timeframe.endswith('w'):
        return int(timeframe[:-1]) * 7 * 24 * 60
    else:
        raise ValueError(f"Unknown timeframe format: {timeframe}")

# ===== TRADE MANAGEMENT =====
def create_trade(trade_type: str, pivot: Pivot, trade_size: float, entry_time: int, timeframe: str, config: Dict) -> Trade:
    """Create a new trade"""
    trade_id = f"{int(time.time() * 1000)}_{len(str(entry_time))}"
    
    # Use pivot price as entry price
    entry_price = pivot.price
    
    # Calculate TP and SL
    tp_distance = entry_price * (config['take_profit'] / 100)
    sl_distance = entry_price * (config['stop_loss'] / 100)
    
    if trade_type == 'long':
        take_profit_price = entry_price + tp_distance
        stop_loss_price = entry_price - sl_distance
    else:
        take_profit_price = entry_price - tp_distance
        stop_loss_price = entry_price + sl_distance
    
    return Trade(
        id=trade_id,
        type=trade_type,
        timeframe=timeframe,
        entry_price=entry_price,
        entry_time=entry_time,
        trade_size=trade_size,
        take_profit_price=take_profit_price,
        stop_loss_price=stop_loss_price,
        leverage=config['leverage'],
        pivot=pivot
    )

def update_trade(trade: Trade, current_candle: Candle, config: Dict) -> bool:
    """Update trade and check if it should be closed"""
    current_price = current_candle.close
    is_long = trade.type == 'long'
    
    # Update best price
    if is_long:
        if current_price > trade.best_price:
            trade.best_price = current_price
    else:
        if current_price < trade.best_price:
            trade.best_price = current_price
    
    # Check exit conditions
    should_close = False
    exit_reason = ''
    
    if is_long:
        if current_price >= trade.take_profit_price:
            should_close = True
            exit_reason = 'TP'
        elif current_price <= trade.stop_loss_price:
            should_close = True
            exit_reason = 'SL'
    else:
        if current_price <= trade.take_profit_price:
            should_close = True
            exit_reason = 'TP'
        elif current_price >= trade.stop_loss_price:
            should_close = True
            exit_reason = 'SL'
    
    if should_close:
        trade.status = 'closed'
        trade.exit_price = current_price
        trade.exit_time = current_candle.time
        trade.exit_reason = exit_reason
        
        # Calculate P&L
        price_change = (trade.exit_price - trade.entry_price) if is_long else (trade.entry_price - trade.exit_price)
        trade.pnl = (price_change / trade.entry_price) * trade.trade_size * trade.leverage
        trade.pnl_pct = (price_change / trade.entry_price) * 100 * trade.leverage
        
        # Apply fees and slippage
        total_fees = trade.trade_size * (config.get('total_maker_fee', 0.1) / 100) * 2  # Entry + exit
        
        # Apply slippage simulation
        if config.get('simulate_slippage', False):
            slippage_pct = config.get('slippage_percentage', 0.02)
            slippage_amount = trade.trade_size * (slippage_pct / 100)
            trade.pnl -= slippage_amount
        
        # Apply funding rate simulation (for positions held over funding periods)
        if config.get('simulate_funding', False):
            trade_duration_hours = (trade.exit_time - trade.entry_time) / (1000 * 60 * 60)
            funding_periods = int(trade_duration_hours / 8)  # Funding every 8 hours
            if funding_periods > 0:
                funding_rate = config.get('funding_rate', 0.01)  # 0.01% per period
                funding_cost = trade.trade_size * (funding_rate / 100) * funding_periods
                trade.pnl -= funding_cost
        
        trade.pnl -= total_fees
    
    return should_close

def calculate_trade_size(capital: float, config: Dict) -> float:
    """Calculate trade size based on position sizing mode - MATCH JAVASCRIPT EXACTLY"""
    sizing_mode = config.get('position_sizing_mode', 'percent')
    
    if sizing_mode == 'fixed':
        return config.get('amount_per_trade', 100)
    elif sizing_mode == 'percent':
        # JavaScript: tradeSize = capital * (tradeConfig.riskPerTrade / 100);
        return capital * (config.get('risk_per_trade', 100) / 100)
    elif sizing_mode == 'minimum':
        calculated = capital * (config.get('risk_per_trade', 100) / 100)
        minimum = config.get('minimum_trade_amount', 100)
        return max(calculated, minimum)
    else:
        return config.get('amount_per_trade', 100)

def apply_direction_filter(pivot: Pivot, config: Dict) -> Tuple[bool, str]:
    """Apply direction filtering logic"""
    direction = config.get('direction', 'both')
    signal = pivot.signal
    
    if signal == 'long':
        if direction in ['buy', 'both']:
            return True, 'long'
        elif direction == 'alternate':
            return True, 'short'  # Invert in alternate mode
    elif signal == 'short':
        if direction in ['sell', 'both']:
            return True, 'short'
        elif direction == 'alternate':
            return True, 'long'  # Invert in alternate mode
    
    return False, ''

# ===== CASCADE CONFIRMATION =====
def check_cascade_confirmation(primary_pivot: Pivot, all_timeframe_pivots: Dict, as_of_time: int, primary_interval: str, config: Dict) -> List[Confirmation]:
    """Check for cascade confirmation across timeframes"""
    confirmations = []
    proximity_window_ms = 5 * 60 * 1000  # 5 minutes
    
    cascade_settings = config.get('cascade_settings', {})
    confirmation_window = cascade_settings.get('confirmation_window', {})
    configured_minutes = confirmation_window.get(primary_interval)
    
    if configured_minutes is not None:
        configured_window_ms = configured_minutes * 60 * 1000
        effective_window_ms = min(proximity_window_ms, configured_window_ms)
    else:
        effective_window_ms = proximity_window_ms
    
    for tf_config in config['timeframes']:
        timeframe = tf_config['interval']
        
        pivots = all_timeframe_pivots.get(timeframe, [])
        if not pivots:
            continue
        
        # Determine target signal type
        target_signal = 'short' if primary_pivot.signal == 'long' else 'long' if tf_config.get('opposite', False) else primary_pivot.signal
        
        # Find recent pivots within window
        recent_pivots = [
            p for p in pivots
            if p.signal == target_signal
            and abs(p.time - primary_pivot.time) <= effective_window_ms
            and p.time <= as_of_time
        ]
        
        if recent_pivots:
            confirmations.append(Confirmation(
                timeframe=timeframe,
                role=tf_config.get('role', 'secondary'),
                weight=tf_config.get('weight', 1),
                pivot=recent_pivots[0],
                inverted=tf_config.get('opposite', False)
            ))
    
    return confirmations

def meets_execution_requirements(confirmations: List[Confirmation], config: Dict) -> bool:
    """Check if confirmations meet execution requirements"""
    cascade_settings = config.get('cascade_settings', {})
    min_required = cascade_settings.get('min_timeframes_required', 2)
    
    if len(confirmations) < min_required:
        return False
    
    require_primary = cascade_settings.get('require_primary_timeframe', False)
    if require_primary:
        has_primary = any(c.role == 'primary' for c in confirmations)
        if not has_primary:
            return False
    
    return True

# ===== MAIN FUNCTION =====
def run_immediate_aggregation_backtest():
    """Main backtesting function"""
    start_time = time.time()
    
    print(f"{Colors.CYAN}=== IMMEDIATE AGGREGATION BACKTESTER ==={Colors.RESET}")
    
    # Load configurations
    main_config, trade_config, multi_pivot_config = load_config()
    
    symbol = main_config['symbol']
    use_local_data = main_config['use_local_data']
    pivot_detection_mode = main_config['pivot_detection_mode']
    
    print(f"{Colors.YELLOW}Symbol: {symbol}{Colors.RESET}")
    print(f"{Colors.YELLOW}Trading Mode: {BACKTEST_CONFIG['trading_mode'].upper()}{Colors.RESET}")
    print(f"{Colors.YELLOW}Detection Mode: {pivot_detection_mode}{Colors.RESET}")
    
    # Load data
    one_minute_candles = load_1m_candles(symbol, use_local_data, BACKTEST_CONFIG['max_candles'])
    
    if not one_minute_candles:
        print(f"{Colors.RED}No candle data loaded. Exiting.{Colors.RESET}")
        return
    
    # Initialize timeframe data structures
    timeframe_data = {}
    timeframe_pivots = {}
    
    # Build aggregated candles for each timeframe
    for tf_config in multi_pivot_config['timeframes']:
        tf_name = tf_config['interval']
        
        if tf_name == '1m':
            timeframe_data[tf_name] = one_minute_candles
        elif tf_name == '2h':
            timeframe_data[tf_name] = aggregate_candles(one_minute_candles, '2h')
        else:
            timeframe_data[tf_name] = aggregate_candles(one_minute_candles, tf_name)
        
        if BACKTEST_CONFIG['show_initialization_logs']:
            print(f"{Colors.DIM}Building {tf_name} aggregated candles...{Colors.RESET}")
        
        timeframe_pivots[tf_name] = []
        
        if BACKTEST_CONFIG['show_initialization_logs']:
            print(f"{Colors.DIM}Built {len(timeframe_data[tf_name])} {tf_name} candles{Colors.RESET}")
    
    # Detect pivots for each timeframe
    for tf_config in multi_pivot_config['timeframes']:
        tf_name = tf_config['interval']
        aggregated_candles = timeframe_data[tf_name]
        
        pivot_config = {
            'pivotLookback': tf_config['lookback'],
            'minSwingPct': tf_config['minSwingPct'],
            'minLegBars': tf_config['minLegBars'],
            'pivot_detection_mode': pivot_detection_mode
        }
        
        for i in range(len(aggregated_candles)):
            pivot = detect_pivot(aggregated_candles, i, pivot_config)
            
            if pivot:
                pivot.timeframe = tf_name
                timeframe_pivots[tf_name].append(pivot)
        
        if BACKTEST_CONFIG['show_initialization_logs']:
            print(f"{Colors.DIM}Detected {len(timeframe_pivots[tf_name])} {tf_name} pivots{Colors.RESET}")
    
    # Summary of pivot detection
    total_pivots = sum(len(pivots) for pivots in timeframe_pivots.values())
    print(f"{Colors.CYAN}Total pivots detected across all timeframes: {Colors.YELLOW}{total_pivots}{Colors.RESET}")
    
    # Display pivot counts by timeframe
    for tf_config in multi_pivot_config['timeframes']:
        tf_name = tf_config['interval']
        pivots = timeframe_pivots.get(tf_name, [])
        print(f"  {Colors.YELLOW}{tf_name.ljust(4)}{Colors.RESET}: {Colors.GREEN}{str(len(pivots)).rjust(4)}{Colors.RESET} pivots")
    
    # Get primary timeframe for main trading loop
    primary_tf = next((tf for tf in multi_pivot_config['timeframes'] if tf['role'] == 'primary'), None)
    if not primary_tf:
        raise ValueError('No primary timeframe configured')
    
    primary_tf_name = primary_tf['interval']
    primary_candles = timeframe_data[primary_tf_name]
    primary_pivots = timeframe_pivots[primary_tf_name]
    
    # Trading simulation
    capital = trade_config['initial_capital']
    open_trades = []
    all_trades = []
    confirmed_signals = 0
    executed_trades = 0
    total_signals = 0
    
    print(f"{Colors.CYAN}=== STARTING IMMEDIATE AGGREGATION BACKTESTING WITH TRADES ==={Colors.RESET}")
    print(f"{Colors.YELLOW}Initial Capital: ${format_number_with_commas(capital)}{Colors.RESET}")
    print(f"{Colors.DIM}Processing {len(primary_candles)} primary candles from {primary_tf_name} timeframe{Colors.RESET}")
    print(f"{Colors.YELLOW}Trade monitoring using 1-minute precision{Colors.RESET}")
    
    # Load 1-minute candles for precise trade monitoring
    one_minute_candles = timeframe_data.get('1m', [])
    if not one_minute_candles:
        raise ValueError('1-minute candles required for precise trade monitoring')
    
    # Create time map for quick 1-minute candle lookup
    one_minute_time_map = {candle.time: i for i, candle in enumerate(one_minute_candles)}
    
    # Pending cascade windows awaiting confirmations (like JavaScript)
    pending_windows = []
    applied_funding_rates = set()  # Track applied funding to avoid duplicates
    
    # Process each primary timeframe candle
    for i, current_candle in enumerate(primary_candles):
        current_time = current_candle.time
        
        # Find the corresponding 1-minute candle range for this primary candle
        primary_tf_minutes = parse_timeframe_to_minutes(primary_tf_name)
        start_time = current_time - (primary_tf_minutes * 60 * 1000)
        
        # Find all 1-minute candles that fall within this primary candle's time range
        minute_candles_in_range = []
        for minute_candle in one_minute_candles:
            if start_time < minute_candle.time <= current_time:
                minute_candles_in_range.append(minute_candle)
        
        # Store closed trades for this candle to display them in chronological order
        closed_trades_this_candle = []
        
        # Apply funding rates (every X hours) - matching JavaScript
        capital = apply_funding_rates(current_time, open_trades, capital, applied_funding_rates, trade_config)
        
        # Update existing trades with each 1-minute candle in the range
        for minute_candle in minute_candles_in_range:
            for j in range(len(open_trades) - 1, -1, -1):
                trade = open_trades[j]
                
                # Only monitor trades that have actually started (entry time has passed)
                if minute_candle.time >= trade.entry_time:
                    should_close = update_trade(trade, minute_candle, trade_config)
                    
                    if should_close:
                        capital += trade.pnl
                        closed_trade = open_trades.pop(j)
                        closed_trades_this_candle.append(closed_trade)
            
            # Evaluate pending cascade windows at this minute for execution
            if BACKTEST_CONFIG['trading_mode'] == 'cascade' and pending_windows:
                for w in range(len(pending_windows) - 1, -1, -1):
                    win = pending_windows[w]
                    primary_interval = primary_tf_name
                    proximity_window_ms = 5 * 60 * 1000  # 5 minutes
                    configured_minutes = multi_pivot_config.get('cascadeSettings', {}).get('confirmationWindow', {}).get(primary_interval)
                    configured_window_ms = configured_minutes * 60 * 1000 if configured_minutes else None
                    effective_window_ms = min(proximity_window_ms, configured_window_ms) if configured_window_ms else proximity_window_ms
                    window_end = win['primary_pivot'].time + effective_window_ms
                    
                    if minute_candle.time > window_end:
                        # Expire window
                        pending_windows.pop(w)
                        continue
                    
                    # Check cascade confirmation
                    confirmations = check_cascade_confirmation(win['primary_pivot'], timeframe_pivots, minute_candle.time, primary_interval, multi_pivot_config)
                    if meets_execution_requirements(confirmations, multi_pivot_config):
                        # Determine execution time: max(primary, last confirmation)
                        last_conf_time = max(c.pivot.time for c in confirmations)
                        execution_time = max(win['primary_pivot'].time, last_conf_time)
                        
                        # Apply entry delay from config
                        delay_ms = trade_config.get('entry_delay_minutes', 0) * 60 * 1000
                        actual_entry_time = execution_time + delay_ms
                        
                        # Entry price: 1m close at delayed entry time
                        entry_price_override = None
                        delayed_entry_idx = one_minute_time_map.get(actual_entry_time)
                        if delayed_entry_idx is not None:
                            entry_price_override = one_minute_candles[delayed_entry_idx].close
                        else:
                            # Find nearest 1m candle to delayed entry time
                            thirty_sec = 30 * 1000
                            nearest = None
                            for c in one_minute_candles:
                                if abs(c.time - actual_entry_time) <= thirty_sec:
                                    if not nearest or abs(c.time - actual_entry_time) < abs(nearest.time - actual_entry_time):
                                        nearest = c
                            if nearest:
                                entry_price_override = nearest.close
                        
                        if not entry_price_override:
                            continue  # Cannot execute without price
                        
                        # Apply direction filtering
                        should_open_trade, trade_type = apply_direction_filter(win['primary_pivot'], trade_config)
                        
                        if should_open_trade:
                            # Check concurrent trade limits
                            max_trades = 1 if trade_config.get('single_trade_mode', False) else trade_config.get('max_concurrent_trades', 1)
                            
                            if len(open_trades) < max_trades:
                                confirmed_signals += 1
                                executed_trades += 1
                                
                                # Calculate trade size
                                trade_size = calculate_trade_size(capital, trade_config)
                                
                                # Create and execute trade with override price
                                trade = create_trade(trade_type, win['primary_pivot'], trade_size, actual_entry_time, primary_tf_name, trade_config)
                                trade.entry_price = entry_price_override  # Override with precise 1m close price
                                open_trades.append(trade)
                                all_trades.append(trade)
                                
                                if trade_config.get('show_trade_details', True):
                                    print(f"{Colors.GREEN}🎯 CASCADE #{confirmed_signals} CONFIRMED: {trade_type.upper()}{Colors.RESET}")
                                    print(f"{Colors.CYAN}   Entry Price: ${trade.entry_price:.2f} | Size: ${format_number_with_commas(trade.trade_size)} | TP: ${trade.take_profit_price:.2f} | SL: ${trade.stop_loss_price:.2f}{Colors.RESET}")
                        
                        # Remove executed window
                        pending_windows.pop(w)
        
        # Display closed trades in chronological order
        for closed_trade in closed_trades_this_candle:
            if trade_config.get('show_trade_details', True):
                time_str = format_dual_time(closed_trade.exit_time)
                pnl_color = Colors.GREEN if closed_trade.pnl >= 0 else Colors.RED
                pnl_text = f"{pnl_color}{'+' if closed_trade.pnl >= 0 else ''}{format_number_with_commas(closed_trade.pnl)}{Colors.RESET}"
                print(f"  {Colors.MAGENTA}└─> [{closed_trade.exit_reason}] {closed_trade.type.upper()} trade closed @ {time_str} | ${closed_trade.exit_price:.2f}. PnL: {pnl_text}{Colors.RESET}")
        
        # Check for new pivot signals at this time and add to pending windows
        current_pivot = next((p for p in primary_pivots if p.time == current_time), None)
        if current_pivot:
            total_signals += 1
            
            if BACKTEST_CONFIG['trading_mode'] == 'cascade':
                # Add to pending windows for later evaluation (like JavaScript)
                pending_windows.append({
                    'primary_pivot': current_pivot,
                    'created_time': current_time
                })
        
        # Progress indicator
        if i % BACKTEST_CONFIG['progress_every'] == 0:
            progress = (i / len(primary_candles)) * 100
            print(f"{Colors.DIM}Progress: {progress:.1f}% ({i}/{len(primary_candles)}){Colors.RESET}")
    
    # Close any remaining open trades
    if open_trades:
        last_candle = primary_candles[-1]
        for trade in open_trades:
            update_trade(trade, last_candle, trade_config)
            capital += trade.pnl
    
    # Display results summary
    print(f"\n{Colors.CYAN}=== BACKTESTING RESULTS SUMMARY ==={Colors.RESET}")
    print(f"{Colors.YELLOW}Total Primary Signals: {Colors.GREEN}{total_signals}{Colors.RESET}")
    print(f"{Colors.YELLOW}Confirmed Cascade Signals: {Colors.GREEN}{confirmed_signals}{Colors.RESET}")
    print(f"{Colors.YELLOW}Executed Trades: {Colors.GREEN}{executed_trades}{Colors.RESET}")
    
    if total_signals > 0:
        confirmation_rate = (confirmed_signals / total_signals) * 100
        print(f"{Colors.YELLOW}Signal Confirmation Rate: {Colors.GREEN}{confirmation_rate:.1f}%{Colors.RESET}")
        
        execution_rate = (executed_trades / confirmed_signals) * 100 if confirmed_signals > 0 else 0
        print(f"{Colors.YELLOW}Trade Execution Rate: {Colors.GREEN}{execution_rate:.1f}%{Colors.RESET} (confirmed signals that became trades)")
    
    # Calculate frequency metrics
    data_start_time = one_minute_candles[0].time
    data_end_time = one_minute_candles[-1].time
    total_hours = (data_end_time - data_start_time) / (1000 * 60 * 60)
    signals_per_day = (total_signals / total_hours) * 24 if total_hours > 0 else 0
    confirmed_signals_per_day = (confirmed_signals / total_hours) * 24 if total_hours > 0 else 0
    executed_trades_per_day = (executed_trades / total_hours) * 24 if total_hours > 0 else 0
    
    print(f"{Colors.YELLOW}Primary Signal Frequency: {Colors.GREEN}{signals_per_day:.2f} signals/day{Colors.RESET}")
    print(f"{Colors.YELLOW}Confirmed Signal Frequency: {Colors.GREEN}{confirmed_signals_per_day:.2f} confirmed/day{Colors.RESET}")
    print(f"{Colors.YELLOW}Executed Trade Frequency: {Colors.GREEN}{executed_trades_per_day:.2f} trades/day{Colors.RESET}")
    
    data_span_days = total_hours / 24
    print(f"{Colors.CYAN}Data Timespan: {data_span_days:.1f} days{Colors.RESET}")
    
    # Trading performance
    if all_trades:
        winning_trades = [t for t in all_trades if t.pnl > 0]
        losing_trades = [t for t in all_trades if t.pnl <= 0]
        win_rate = (len(winning_trades) / len(all_trades)) * 100
        total_pnl = sum(t.pnl for t in all_trades)
        total_return = (total_pnl / trade_config['initial_capital']) * 100
        
        print(f"\n{Colors.CYAN}--- Trading Performance ---{Colors.RESET}")
        print(f"{Colors.YELLOW}Total Trades: {Colors.GREEN}{len(all_trades)}{Colors.RESET}")
        print(f"{Colors.YELLOW}Winning Trades: {Colors.GREEN}{len(winning_trades)}{Colors.RESET}")
        print(f"{Colors.YELLOW}Losing Trades: {Colors.RED}{len(losing_trades)}{Colors.RESET}")
        print(f"{Colors.YELLOW}Win Rate: {Colors.GREEN}{win_rate:.1f}%{Colors.RESET}")
        print(f"{Colors.YELLOW}Total P&L: {Colors.GREEN if total_pnl >= 0 else Colors.RED}{format_number_with_commas(total_pnl)} USDT{Colors.RESET}")
        print(f"{Colors.YELLOW}Total Return: {Colors.GREEN if total_return >= 0 else Colors.RED}{format_number_with_commas(total_return)}%{Colors.RESET}")
        print(f"{Colors.YELLOW}Final Capital: {Colors.GREEN if capital >= 0 else Colors.RED}{format_number_with_commas(capital)} USDT{Colors.RESET}")
    
    print(f"\n{Colors.CYAN}--- Multi-Timeframe Backtesting Complete ---{Colors.RESET}")
    
    elapsed_time = time.time() - start_time
    print(f"{Colors.YELLOW}Backtest completed in {elapsed_time:.2f} seconds{Colors.RESET}")

# Run the backtester
if __name__ == "__main__":
    try:
        run_immediate_aggregation_backtest()
    except Exception as err:
        import traceback
        print(f'\nAn error occurred during backtesting: {err}')
        print(f'Traceback:')
        traceback.print_exc()
        sys.exit(1)
