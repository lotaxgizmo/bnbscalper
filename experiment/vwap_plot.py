# experiment/vwap_plot.py

import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
from pathlib import Path

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
    'output_format': 'png',      # Output format
    'dpi': 200                   # Chart resolution
}

# Derived paths
DATA_PATH = Path(__file__).resolve().parents[1] / "data" / "historical" / CONFIG['symbol'] / f"{CONFIG['base_interval']}.csv"
OUTPUT_PATH = Path(__file__).resolve().parent / f"{CONFIG['symbol']}_{CONFIG['target_timeframe']}_vwap_rsi.{CONFIG['output_format']}"

# ========== CANDLE AGGREGATION SYSTEM ==========
def aggregate_candles(df, target_minutes):
    """Aggregate 1m candles to target timeframe (similar to Node.js buildImmediateAggregatedCandles)"""
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
    """Parse timeframe string to minutes (e.g., '5m' -> 5, '1h' -> 60)"""
    if timeframe_str.endswith('m'):
        return int(timeframe_str[:-1])
    elif timeframe_str.endswith('h'):
        return int(timeframe_str[:-1]) * 60
    else:
        return int(timeframe_str)

# === Load Data ===
print(f"Loading {CONFIG['symbol']} data from {DATA_PATH}")

# First, read just the first row to check if it's a header
with open(DATA_PATH, "r") as f:
    first_line = f.readline().lower()

if "timestamp" in first_line or "time" in first_line:
    df = pd.read_csv(DATA_PATH, header=0, names=["time","open","high","low","close","volume"])
else:
    df = pd.read_csv(DATA_PATH, header=None, names=["time","open","high","low","close","volume"])

# convert timestamp
df["time"] = pd.to_datetime(df["time"], unit="ms", errors="coerce")

# drop bad rows
df = df.dropna(subset=["time"]).reset_index(drop=True)

# Apply data limit
if CONFIG['max_candles'] > 0 and len(df) > CONFIG['max_candles']:
    df = df.tail(CONFIG['max_candles']).reset_index(drop=True)
    print(f"Limited to last {CONFIG['max_candles']} candles")

# Aggregate to target timeframe
target_minutes = parse_timeframe(CONFIG['target_timeframe'])
df = aggregate_candles(df, target_minutes)
print(f"Aggregated to {CONFIG['target_timeframe']} timeframe: {len(df)} candles")

prices = df["close"].astype(float).values
volumes = df["volume"].astype(float).values
times = df["time"]

# === Compute VWAP ===
def rolling_vwap(prices, volumes, length):
    vwap = np.full(len(prices), np.nan)
    pv = prices * volumes
    for i in range(length-1, len(prices)):
        window_pv = pv[i-length+1:i+1]
        window_v = volumes[i-length+1:i+1]
        if window_v.sum() > 0:
            vwap[i] = window_pv.sum() / window_v.sum()
    return vwap

# === Compute Bands ===
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

# === Compute RSI ===
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

vwap = rolling_vwap(prices, volumes, CONFIG['vwap_length'])
b2_hi, b2_lo = compute_bands(prices, vwap, CONFIG['band_length'], 2, log_space=True)
b3_hi, b3_lo = compute_bands(prices, vwap, CONFIG['band_length'], 3, log_space=True)
rsi_series = rsi(prices, CONFIG['rsi_length'])

# === Plot ===
fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(CONFIG['chart_width'], CONFIG['chart_height']), sharex=True,
                               gridspec_kw={"height_ratios": [3, 1]})

# Price & Bands
ax1.plot(times, prices, label="Close", color="black", linewidth=1)
ax1.plot(times, vwap, label="VWAP", color="blue", linewidth=1.5)
ax1.plot(times, b2_hi, "--", color="green", label="2σ")
ax1.plot(times, b2_lo, "--", color="green")
ax1.plot(times, b3_hi, "--", color="red", label="3σ")
ax1.plot(times, b3_lo, "--", color="red")
ax1.scatter(times.iloc[-1], prices[-1], color="orange", zorder=5, label="Latest")

ax1.set_title(f"{CONFIG['symbol']} VWAP Deviation+ ({CONFIG['target_timeframe']})")
ax1.set_ylabel("Price")
ax1.legend(loc="upper left")
ax1.grid(alpha=0.3)

# RSI Panel
ax2.plot(times, rsi_series, color="purple", label=f"RSI ({CONFIG['rsi_length']})")
ax2.axhline(70, color="red", linestyle="--")
ax2.axhline(30, color="green", linestyle="--")
ax2.set_ylabel("RSI")
ax2.set_ylim(0, 100)
ax2.legend(loc="upper left")
ax2.grid(alpha=0.3)

plt.xlabel("Time")
plt.tight_layout()
plt.savefig(OUTPUT_PATH, dpi=CONFIG['dpi'])
print(f"Saved chart to {OUTPUT_PATH}")
