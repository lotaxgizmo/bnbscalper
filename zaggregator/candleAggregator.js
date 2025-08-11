"use strict";

import { EventEmitter } from "events";

// Utility: parse timeframe input into milliseconds
// Accepts: number (ms) or string like '1m','5m','15m','1h','4h','1d'
function parseTimeframeToMs(tf) {
  if (typeof tf === "number" && Number.isFinite(tf)) return tf;
  if (typeof tf !== "string") throw new Error(`Invalid timeframe: ${tf}`);
  const m = tf.trim().toLowerCase();
  const match = m.match(/^(\d+)([smhd])$/);
  if (!match) throw new Error(`Invalid timeframe string: ${tf}`);
  const value = parseInt(match[1], 10);
  const unit = match[2];
  const unitMs = unit === "s" ? 1000 : unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000; // d
  return value * unitMs;
}

function getBucketStart(ts, tfMs) {
  return Math.floor(ts / tfMs) * tfMs;
}

function cloneCandle(c) {
  if (!c) return null;
  return {
    time: c.time,
    end: c.end,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
    closed: !!c.closed,
  };
}

// 1m -> multi-timeframe aggregator with no lookahead.
// Feed strictly chronological 1m candles to update().
// Maintains per-timeframe active (forming) candle and last closed snapshot.
// Emits events: 'update:TF' on forming updates, 'close:TF' on candle close.
class CandleAggregator extends EventEmitter {
  constructor(timeframes, options = {}) {
    super();

    // Options
    this.strictChronological = options.strictChronological !== false; // default true
    this.keepSeries = options.keepSeries !== false; // default true (store closed series for backtests)

    // Normalize timeframes => ms, and keep a pretty label for events
    const tfList = Array.isArray(timeframes) ? timeframes : [timeframes];
    this.timeframes = tfList.map(parseTimeframeToMs).sort((a, b) => a - b);
    this.labels = new Map();
    for (const tf of tfList) {
      const ms = parseTimeframeToMs(tf);
      const label = typeof tf === "string" ? tf.trim().toLowerCase() : `${Math.round(ms / 60000)}m`;
      this.labels.set(ms, label);
    }
    // Ensure labels for ms-only inputs
    for (const tfMs of this.timeframes) {
      if (!this.labels.has(tfMs)) this.labels.set(tfMs, `${Math.round(tfMs / 60000)}m`);
    }

    // State per timeframe
    this.state = new Map(); // tfMs -> { active, lastClosed, series: [] }
    for (const tfMs of this.timeframes) {
      this.state.set(tfMs, { active: null, lastClosed: null, series: this.keepSeries ? [] : null });
    }

    this.lastMinuteTime = null;
  }

  // Validate 1m candle structure
  static validateMinute(c) {
    if (!c || typeof c !== "object") throw new Error("Minute candle must be an object");
    const req = ["time", "open", "high", "low", "close", "volume"];
    for (const k of req) {
      if (!(k in c)) throw new Error(`Minute candle missing field: ${k}`);
    }
    if (!Number.isFinite(c.time)) throw new Error("Minute candle time must be a number (ms)");
  }

  // Feed the next 1m candle (must be chronological unless strictChronological=false)
  update(min1) {
    CandleAggregator.validateMinute(min1);
    if (this.strictChronological && this.lastMinuteTime != null && min1.time <= this.lastMinuteTime) {
      throw new Error(`Out-of-order 1m candle: ${min1.time} <= ${this.lastMinuteTime}`);
    }
    this.lastMinuteTime = min1.time;

    for (const tfMs of this.timeframes) {
      this.#updateForTimeframe(tfMs, min1);
    }
  }

  // Return current forming candle for tfMs (ms) or tf string
  getActive(tf) {
    const tfMs = parseTimeframeToMs(tf);
    const st = this.state.get(tfMs);
    return st && st.active ? cloneCandle(st.active) : null;
  }

  // Return last closed candle for tfMs (ms) or tf string
  getLastClosed(tf) {
    const tfMs = parseTimeframeToMs(tf);
    const st = this.state.get(tfMs);
    return st && st.lastClosed ? cloneCandle(st.lastClosed) : null;
  }

  // Return closed series for tf (if keepSeries=true)
  buildClosedSeries(tf) {
    const tfMs = parseTimeframeToMs(tf);
    const st = this.state.get(tfMs);
    if (!st) return [];
    if (!this.keepSeries) throw new Error("Series storage disabled. Set options.keepSeries=true.");
    return st.series.map(cloneCandle);
  }

  // Snapshot of all TFs
  getState() {
    const out = {};
    for (const tfMs of this.timeframes) {
      const st = this.state.get(tfMs);
      const label = this.labels.get(tfMs) || `${Math.round(tfMs / 60000)}m`;
      out[label] = {
        active: st.active ? cloneCandle(st.active) : null,
        lastClosed: st.lastClosed ? cloneCandle(st.lastClosed) : null,
        count: st.series ? st.series.length : 0,
      };
    }
    return out;
  }

  reset() {
    for (const tfMs of this.timeframes) {
      const st = this.state.get(tfMs);
      st.active = null;
      st.lastClosed = null;
      if (st.series) st.series.length = 0;
    }
    this.lastMinuteTime = null;
  }

  // Internal per-TF update
  #updateForTimeframe(tfMs, min1) {
    const st = this.state.get(tfMs);
    const label = this.labels.get(tfMs) || `${Math.round(tfMs / 60000)}m`;
    const bucketStart = getBucketStart(min1.time, tfMs);
    const bucketEnd = bucketStart + tfMs - 1; // inclusive end for convenience

    if (!st.active) {
      // Initialize new active candle with this minute
      st.active = {
        time: bucketStart,
        end: bucketEnd,
        open: min1.open,
        high: min1.high,
        low: min1.low,
        close: min1.close,
        volume: min1.volume,
        closed: false,
      };
      this.emit(`update:${label}`, cloneCandle(st.active));
      return;
    }

    // If minute still in the same bucket -> update forming candle
    if (getBucketStart(st.active.time, tfMs) === bucketStart) {
      st.active.high = Math.max(st.active.high, min1.high);
      st.active.low = Math.min(st.active.low, min1.low);
      st.active.close = min1.close;
      st.active.volume += min1.volume;
      this.emit(`update:${label}`, cloneCandle(st.active));
      return;
    }

    // Else bucket changed -> finalize previous active, emit close, start new
    const closed = { ...st.active, closed: true };
    st.lastClosed = closed;
    if (st.series) st.series.push(closed);
    this.emit(`close:${label}`, cloneCandle(closed));

    // Start new active from this minute
    st.active = {
      time: bucketStart,
      end: bucketEnd,
      open: min1.open,
      high: min1.high,
      low: min1.low,
      close: min1.close,
      volume: min1.volume,
      closed: false,
    };
    this.emit(`update:${label}`, cloneCandle(st.active));
  }
}

export {
  CandleAggregator,
  parseTimeframeToMs,
};

