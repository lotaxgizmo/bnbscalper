# experiment/vwap_web_server.py

import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import matplotlib
matplotlib.use('Agg')  # Use non-interactive backend
from pathlib import Path
import io
import base64
from flask import Flask, render_template, jsonify
import threading
import time
import os
import sys

# ========== CONFIGURATION ==========
CONFIG = {
    # Data settings
    'max_candles': 10080,        # Limit data (1 week of 1m candles)
    'symbol': 'BTCUSDT',
    'base_interval': '1m',       # Source data interval
    'target_timeframe': '1h',    # Aggregation target (1m, 5m, 15m, 1h, 4h)
    
    # Analysis settings
    'vwap_length': 20,           # VWAP rolling period
    'band_length': 20,           # Statistical band period
    'rsi_length': 14,            # RSI period
    
    # Chart settings
    'chart_width': 12,           # Chart width in inches
    'chart_height': 8,           # Chart height in inches
    'dpi': 100,                  # Chart resolution
    
    # Server settings
    'port': 5000,
    'auto_refresh_seconds': 5   # Auto refresh interval
}

# Derived paths
DATA_PATH = Path(__file__).resolve().parents[1] / "data" / "historical" / CONFIG['symbol'] / f"{CONFIG['base_interval']}.csv"

app = Flask(__name__)

# Global variables for caching
chart_cache = {'image': None, 'timestamp': 0, 'config_hash': None}

# ========== CANDLE AGGREGATION SYSTEM ==========
def aggregate_candles(df, target_minutes):
    """Aggregate 1m candles to target timeframe"""
    if target_minutes == 1:
        return df
    
    # Group by time intervals
    df['group'] = (df.index // target_minutes) * target_minutes
    
    aggregated = df.groupby('group').agg({
        'time': 'first',
        'open': 'first',
        'high': 'max',
        'low': 'min',
        'close': 'last',
        'volume': 'sum'
    }).reset_index(drop=True)
    
    return aggregated

def parse_timeframe(timeframe_str):
    """Parse timeframe string to minutes"""
    if timeframe_str.endswith('m'):
        return int(timeframe_str[:-1])
    elif timeframe_str.endswith('h'):
        return int(timeframe_str[:-1]) * 60
    else:
        return int(timeframe_str)

# ========== ANALYSIS FUNCTIONS ==========
def rolling_vwap(prices, volumes, length):
    vwap = np.full(len(prices), np.nan)
    pv = prices * volumes
    for i in range(length-1, len(prices)):
        window_pv = pv[i-length+1:i+1]
        window_v = volumes[i-length+1:i+1]
        if window_v.sum() > 0:
            vwap[i] = window_pv.sum() / window_v.sum()
    return vwap

def compute_bands(prices, vwap, length, mult, log_space=True):
    hi, lo = np.full(len(prices), np.nan), np.full(len(prices), np.nan)
    for i in range(length-1, len(prices)):
        window = prices[i-length+1:i+1]
        if log_space:
            logs = np.log(window)
            sd = logs.std()
            hi[i] = np.exp(np.log(vwap[i]) + mult * sd)
            lo[i] = np.exp(np.log(vwap[i]) - mult * sd)
        else:
            sd = window.std()
            hi[i] = vwap[i] + mult * sd
            lo[i] = vwap[i] - mult * sd
    return hi, lo

def rsi(prices, length):
    rsi_vals = np.full(len(prices), np.nan)
    if len(prices) > length:
        deltas = np.diff(prices)
        gains = np.where(deltas > 0, deltas, 0)
        losses = np.where(deltas < 0, -deltas, 0)
        avg_gain = gains[:length].mean()
        avg_loss = losses[:length].mean()
        rsi_vals[length] = 100 - (100 / (1 + avg_gain / (avg_loss or 1e-6)))
        for i in range(length+1, len(prices)):
            avg_gain = (avg_gain*(length-1) + gains[i-1]) / length
            avg_loss = (avg_loss*(length-1) + losses[i-1]) / length
            rs = avg_gain / (avg_loss or 1e-6)
            rsi_vals[i] = 100 - (100 / (1 + rs))
    return rsi_vals

# ========== CHART GENERATION ==========
def generate_chart():
    """Generate the VWAP chart and return as base64 image"""
    try:
        print(f"Loading {CONFIG['symbol']} data from {DATA_PATH}")
        
        # Load data
        with open(DATA_PATH, "r") as f:
            first_line = f.readline().lower()

        if "timestamp" in first_line or "time" in first_line:
            df = pd.read_csv(DATA_PATH, header=0, names=["time","open","high","low","close","volume"])
        else:
            df = pd.read_csv(DATA_PATH, header=None, names=["time","open","high","low","close","volume"])

        # Convert timestamp
        df["time"] = pd.to_datetime(df["time"], unit="ms", errors="coerce")
        df = df.dropna(subset=["time"]).reset_index(drop=True)

        # Apply data limit - use smaller limit for web version to avoid memory issues
        web_limit = min(CONFIG['max_candles'], 5000)  # Limit to 5000 candles max for web
        if web_limit > 0 and len(df) > web_limit:
            df = df.tail(web_limit).reset_index(drop=True)
            print(f"Limited to last {web_limit} candles for web performance")

        # Aggregate to target timeframe
        target_minutes = parse_timeframe(CONFIG['target_timeframe'])
        df = aggregate_candles(df, target_minutes)
        print(f"Aggregated to {CONFIG['target_timeframe']} timeframe: {len(df)} candles")

        prices = df["close"].astype(float).values
        volumes = df["volume"].astype(float).values
        times = df["time"]

        # Calculate indicators
        vwap = rolling_vwap(prices, volumes, CONFIG['vwap_length'])
        b2_hi, b2_lo = compute_bands(prices, vwap, CONFIG['band_length'], 2, log_space=True)
        b3_hi, b3_lo = compute_bands(prices, vwap, CONFIG['band_length'], 3, log_space=True)
        rsi_series = rsi(prices, CONFIG['rsi_length'])

        # Create plot
        plt.style.use('dark_background')  # Dark theme for web
        fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(CONFIG['chart_width'], CONFIG['chart_height']), 
                                       sharex=True, gridspec_kw={"height_ratios": [3, 1]})

        # Price & Bands
        ax1.plot(times, prices, label="Close", color="white", linewidth=1)
        ax1.plot(times, vwap, label="VWAP", color="cyan", linewidth=1.5)
        ax1.plot(times, b2_hi, "--", color="lime", label="2σ", alpha=0.7)
        ax1.plot(times, b2_lo, "--", color="lime", alpha=0.7)
        ax1.plot(times, b3_hi, "--", color="red", label="3σ", alpha=0.7)
        ax1.plot(times, b3_lo, "--", color="red", alpha=0.7)
        ax1.scatter(times.iloc[-1], prices[-1], color="orange", zorder=5, label="Latest", s=50)

        ax1.set_title(f"{CONFIG['symbol']} VWAP Deviation+ ({CONFIG['target_timeframe']}) - Live", 
                      color="white", fontsize=14)
        ax1.set_ylabel("Price", color="white")
        ax1.legend(loc="upper left")
        ax1.grid(alpha=0.3)

        # RSI Panel
        ax2.plot(times, rsi_series, color="magenta", label=f"RSI ({CONFIG['rsi_length']})")
        ax2.axhline(70, color="red", linestyle="--", alpha=0.7)
        ax2.axhline(30, color="lime", linestyle="--", alpha=0.7)
        ax2.set_ylabel("RSI", color="white")
        ax2.set_ylim(0, 100)
        ax2.legend(loc="upper left")
        ax2.grid(alpha=0.3)

        plt.xlabel("Time", color="white")
        plt.tight_layout()
        
        # Convert to base64
        img_buffer = io.BytesIO()
        plt.savefig(img_buffer, format='png', dpi=CONFIG['dpi'], 
                   facecolor='black', edgecolor='none')
        img_buffer.seek(0)
        img_base64 = base64.b64encode(img_buffer.getvalue()).decode()
        plt.close()
        
        return img_base64, len(df)
        
    except Exception as e:
        print(f"Error generating chart: {e}")
        return None, 0

def get_config_hash():
    """Generate hash of current config for cache invalidation"""
    return hash(str(sorted(CONFIG.items())))

def update_chart_cache():
    """Update chart cache if config changed or cache expired"""
    current_hash = get_config_hash()
    current_time = time.time()
    
    if (chart_cache['image'] is None or 
        chart_cache['config_hash'] != current_hash or 
        current_time - chart_cache['timestamp'] > CONFIG['auto_refresh_seconds']):
        
        print("Updating chart cache...")
        img_base64, candle_count = generate_chart()
        
        if img_base64:
            chart_cache['image'] = img_base64
            chart_cache['timestamp'] = current_time
            chart_cache['config_hash'] = current_hash
            chart_cache['candle_count'] = candle_count
            print(f"Chart updated: {candle_count} candles")

# ========== FLASK ROUTES ==========
@app.route('/')
def index():
    update_chart_cache()
    return render_template('vwap_chart.html', 
                         config=CONFIG, 
                         chart_image=chart_cache['image'],
                         candle_count=chart_cache.get('candle_count', 0))

@app.route('/api/chart')
def api_chart():
    update_chart_cache()
    return jsonify({
        'image': chart_cache['image'],
        'timestamp': chart_cache['timestamp'],
        'config': CONFIG,
        'candle_count': chart_cache.get('candle_count', 0)
    })

@app.route('/api/config')
def api_config():
    return jsonify(CONFIG)

if __name__ == '__main__':
    print(f"Starting VWAP Live Chart Server on http://localhost:{CONFIG['port']}")
    print("Auto-refresh every", CONFIG['auto_refresh_seconds'], "seconds")
    
    # Disable Flask's .env loading to avoid dotenv conflicts
    os.environ['FLASK_SKIP_DOTENV'] = '1'
    
    try:
        app.run(host='127.0.0.1', port=CONFIG['port'], debug=False, use_reloader=False)
    except Exception as e:
        print(f"Server error: {e}")
        sys.exit(1)
