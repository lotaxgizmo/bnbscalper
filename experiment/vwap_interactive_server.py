# experiment/vwap_interactive_server.py

import pandas as pd
import numpy as np
import plotly.graph_objects as go
from plotly.subplots import make_subplots
import plotly.utils
from pathlib import Path
import json
from flask import Flask, render_template, jsonify, Response
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler
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
    'chart_width': 1200,         # Chart width in pixels
    'chart_height': 800,         # Chart height in pixels
    
    # Server settings
    'port': 5002,
    'file_watch_enabled': True   # Enable file watching for instant updates
}

# Derived paths
DATA_PATH = Path(__file__).resolve().parents[1] / "data" / "historical" / CONFIG['symbol'] / f"{CONFIG['base_interval']}.csv"
CONFIG_FILE = Path(__file__)

app = Flask(__name__)

# Global variables for caching and file watching
chart_cache = {'data': None, 'timestamp': 0, 'config_hash': None}
file_changed = threading.Event()

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

# ========== INTERACTIVE CHART GENERATION ==========
def generate_plotly_chart():
    """Generate interactive Plotly chart and return as JSON"""
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

        # Apply data limit - use smaller limit for web version
        web_limit = min(CONFIG['max_candles'], 5000)
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

        # Debug logging
        print(f"Price range: {prices.min():.2f} - {prices.max():.2f}")
        print(f"Time range: {times.iloc[0]} to {times.iloc[-1]}")
        print(f"Data shape: prices={len(prices)}, volumes={len(volumes)}, times={len(times)}")

        # Calculate indicators
        vwap = rolling_vwap(prices, volumes, CONFIG['vwap_length'])
        b2_hi, b2_lo = compute_bands(prices, vwap, CONFIG['band_length'], 2, log_space=True)
        b3_hi, b3_lo = compute_bands(prices, vwap, CONFIG['band_length'], 3, log_space=True)
        rsi_series = rsi(prices, CONFIG['rsi_length'])
        
        # Debug indicators
        print(f"VWAP range: {np.nanmin(vwap):.2f} - {np.nanmax(vwap):.2f}")
        print(f"RSI range: {np.nanmin(rsi_series):.2f} - {np.nanmax(rsi_series):.2f}")

        # Create subplots
        fig = make_subplots(
            rows=2, cols=1,
            shared_xaxes=True,
            vertical_spacing=0.1,
            row_heights=[0.7, 0.3]
        )

        # Price line
        fig.add_trace(
            go.Scatter(
                x=times, y=prices,
                mode='lines',
                name='Close',
                line=dict(color='white', width=1),
                hovertemplate='<b>Close</b>: %{y:.2f}<br><b>Time</b>: %{x}<extra></extra>'
            ),
            row=1, col=1
        )

        # VWAP line
        fig.add_trace(
            go.Scatter(
                x=times, y=vwap,
                mode='lines',
                name='VWAP',
                line=dict(color='cyan', width=2),
                hovertemplate='<b>VWAP</b>: %{y:.2f}<br><b>Time</b>: %{x}<extra></extra>'
            ),
            row=1, col=1
        )

        # 2σ Bands
        fig.add_trace(
            go.Scatter(
                x=times, y=b2_hi,
                mode='lines',
                name='2σ Upper',
                line=dict(color='lime', width=1, dash='dash'),
                hovertemplate='<b>2σ Upper</b>: %{y:.2f}<extra></extra>'
            ),
            row=1, col=1
        )
        
        fig.add_trace(
            go.Scatter(
                x=times, y=b2_lo,
                mode='lines',
                name='2σ Lower',
                line=dict(color='lime', width=1, dash='dash'),
                hovertemplate='<b>2σ Lower</b>: %{y:.2f}<extra></extra>'
            ),
            row=1, col=1
        )

        # 3σ Bands
        fig.add_trace(
            go.Scatter(
                x=times, y=b3_hi,
                mode='lines',
                name='3σ Upper',
                line=dict(color='red', width=1, dash='dash'),
                hovertemplate='<b>3σ Upper</b>: %{y:.2f}<extra></extra>'
            ),
            row=1, col=1
        )
        
        fig.add_trace(
            go.Scatter(
                x=times, y=b3_lo,
                mode='lines',
                name='3σ Lower',
                line=dict(color='red', width=1, dash='dash'),
                hovertemplate='<b>3σ Lower</b>: %{y:.2f}<extra></extra>'
            ),
            row=1, col=1
        )

        # Latest price marker
        fig.add_trace(
            go.Scatter(
                x=[times.iloc[-1]], y=[prices[-1]],
                mode='markers',
                name='Latest',
                marker=dict(color='orange', size=10),
                hovertemplate='<b>Latest Price</b>: %{y:.2f}<br><b>Time</b>: %{x}<extra></extra>'
            ),
            row=1, col=1
        )

        # RSI
        fig.add_trace(
            go.Scatter(
                x=times, y=rsi_series,
                mode='lines',
                name=f'RSI ({CONFIG["rsi_length"]})',
                line=dict(color='magenta', width=2),
                hovertemplate='<b>RSI</b>: %{y:.2f}<br><b>Time</b>: %{x}<extra></extra>'
            ),
            row=2, col=1
        )

        # RSI levels
        fig.add_hline(y=70, line_dash="dash", line_color="red", opacity=0.7, row=2, col=1)
        fig.add_hline(y=30, line_dash="dash", line_color="lime", opacity=0.7, row=2, col=1)

        # Update layout
        fig.update_layout(
            template='plotly_dark',
            height=CONFIG['chart_height'],
            showlegend=True,
            legend=dict(
                orientation="h",
                yanchor="bottom",
                y=1.02,
                xanchor="right",
                x=1
            ),
            margin=dict(l=50, r=50, t=80, b=50),
            hovermode='x unified',
            title=None  # Remove subplot titles that might cause issues
        )
        
        # Remove subplot titles
        fig.layout.annotations = ()

        # Update axes
        fig.update_xaxes(title_text="Time", row=2, col=1)
        fig.update_yaxes(title_text="Price", row=1, col=1)
        fig.update_yaxes(title_text="RSI", range=[0, 100], row=2, col=1)

        return json.loads(plotly.utils.PlotlyJSONEncoder().encode(fig)), len(df)
        
    except Exception as e:
        print(f"Error generating chart: {e}")
        return None, 0

def get_config_hash():
    """Generate hash of current config for cache invalidation"""
    return hash(str(sorted(CONFIG.items())))

def update_chart_cache():
    """Update chart cache if config changed or file changed"""
    current_hash = get_config_hash()
    
    if (chart_cache['data'] is None or 
        chart_cache['config_hash'] != current_hash or 
        file_changed.is_set()):
        
        print("Updating chart cache...")
        chart_data, candle_count = generate_plotly_chart()
        
        if chart_data:
            chart_cache['data'] = chart_data
            chart_cache['timestamp'] = time.time()
            chart_cache['config_hash'] = current_hash
            chart_cache['candle_count'] = candle_count
            file_changed.clear()
            print(f"Chart updated: {candle_count} candles")

# ========== FILE WATCHING ==========
class FileChangeHandler(FileSystemEventHandler):
    def on_modified(self, event):
        if not event.is_directory:
            if (event.src_path.endswith('.py') or 
                event.src_path.endswith('.csv') or
                'config' in event.src_path.lower()):
                print(f"File changed: {event.src_path}")
                file_changed.set()

def start_file_watcher():
    """Start file watcher for instant updates"""
    if not CONFIG['file_watch_enabled']:
        return
        
    event_handler = FileChangeHandler()
    observer = Observer()
    
    # Watch current directory for config changes
    observer.schedule(event_handler, str(Path(__file__).parent), recursive=False)
    
    # Watch data directory for data changes
    if DATA_PATH.parent.exists():
        observer.schedule(event_handler, str(DATA_PATH.parent), recursive=False)
    
    observer.start()
    print("File watcher started - instant updates enabled")
    return observer

# ========== FLASK ROUTES ==========
@app.route('/')
def index():
    update_chart_cache()
    return render_template('vwap_minimal.html')

@app.route('/api/chart')
def api_chart():
    update_chart_cache()
    return jsonify({
        'chart': chart_cache['data'],
        'timestamp': chart_cache['timestamp'],
        'config': CONFIG,
        'candle_count': chart_cache.get('candle_count', 0)
    })

@app.route('/events')
def events():
    """Server-Sent Events endpoint for instant updates"""
    def event_stream():
        last_hash = None
        while True:
            current_hash = get_config_hash()
            if file_changed.is_set() or current_hash != last_hash:
                update_chart_cache()
                yield f"data: {json.dumps({'reload': True, 'timestamp': time.time()})}\n\n"
                last_hash = current_hash
            time.sleep(1)
    
    return Response(event_stream(), mimetype='text/event-stream')

@app.route('/api/config')
def api_config():
    return jsonify(CONFIG)

if __name__ == '__main__':
    print(f"Starting Interactive VWAP Chart Server on http://localhost:{CONFIG['port']}")
    print("File watching enabled - instant updates on config/data changes")
    
    # Start file watcher
    observer = start_file_watcher()
    
    # Disable Flask's .env loading to avoid dotenv conflicts
    os.environ['FLASK_SKIP_DOTENV'] = '1'
    
    try:
        app.run(host='127.0.0.1', port=CONFIG['port'], debug=False, use_reloader=False)
    except Exception as e:
        print(f"Server error: {e}")
        if observer:
            observer.stop()
        sys.exit(1)
    finally:
        if observer:
            observer.stop()
            observer.join()
