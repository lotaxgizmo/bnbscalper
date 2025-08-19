// pivotFinderTemp.js
// Lightweight pivot-only finder using multiPivotConfig timeframes
// ===== Runtime config for this temp tool =====
const PIVOT_TOOL_CONFIG = {
    // Time control
    targetTime: 'now', // 'now' or "YYYY-MM-DD HH:MM:SS"
    useCurrentTime: true,
    liveMode: true, // when true, fetch via API even if useLocalData is true
    // Prefer lookback (duration string). Backward compatible: if missing, fall back to lookbackMinutes.
    // Examples: '12h', '90m', '3600s', '1h30m', '2h15m30s'
    lookback: '12h',
    lookbackMinutes: 220, // legacy fallback
  
    // Rolling (auto-refresh) mode
    rolling: true,                 // if true, continually poll for new closed-candle pivots
    refreshSeconds: 5,            // polling interval
    perPivotTelegram: true,        // send per-pivot TG message on detection
  
    // Display
    showData: false,
    showRecentPivots: 10,
    showRefreshCount: true,        // show refresh counter in terminal
  
    // Telegram
    sendTelegram: true,                // set true to send summary to telegram
    telegramPerTimeframeLatestOnly: false, // set to false to show multiple pivots per timeframe
    telegramPivotsPerTimeframe: 5    // number of pivots to show per timeframe in Telegram messages
  };


import path from 'path';
import fs from 'fs';

import {
  symbol,
  useLocalData,
  api,
  pivotDetectionMode,
  timezone
} from '../config/config.js';

import { multiPivotConfig } from '../config/multiPivotConfig.js';
import { getCandles as getBinanceCandles } from '../apis/binance.js';
import { getCandles as getBybitCandles } from '../apis/bybit.js';
import telegramNotifier from '../utils/telegramNotifier.js';
import { fmtDateTime, fmtTime24 } from '../utils/formatters.js';

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  brightYellow: '\x1b[93m',
  dim: '\x1b[2m'
};

// Clear console (cross-platform best-effort)
function clearConsole() {
  try {
    if (process.stdout && process.stdout.isTTY) {
      // ANSI: clear screen, clear scrollback, move cursor to home
      // 2J = clear screen, 3J = clear scrollback, H = cursor home
      process.stdout.write('\x1b[2J\x1b[3J\x1b[H');
      return;
    }
  } catch {}
  // Fallback
  try { console.clear(); } catch {}
  // Last-resort fallback: print many newlines
  try { process.stdout.write('\n'.repeat(120)); } catch {}
}

// Helper to format time differences in days, hours, minutes
function formatTimeDifference(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const days = Math.floor(totalSeconds / (24 * 60 * 60));
  const hours = Math.floor((totalSeconds % (24 * 60 * 60)) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return `${days}d ${hours}h ${minutes}m ${seconds}s`;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

// Helper to format time differences as HH:MM:SS (total duration)
function formatTimeAgoHMS(milliseconds) {
  let totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  totalSeconds %= 3600;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}


// =============================================

// Timezone helpers
function partsFromTS(ts) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false
  });
  const parts = dtf.formatToParts(new Date(ts));
  const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second)
  };
}

function parseTargetTimeInZone(str) {
  if (str === 'now') return Date.now();
  // Support relative forms: 'now-1h30m', 'now+45m', 'now-20s'
  if (typeof str === 'string' && /^now[+-]/i.test(str)) {
    const sign = str.includes('-') ? -1 : 1;
    const durPart = str.split(/[+-]/)[1];
    const delta = parseDuration(durPart);
    const base = Date.now();
    return base + sign * delta;
  }
  if (typeof str === 'number' && Number.isFinite(str)) return Number(str);
  const m = /^\s*(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})\s*$/.exec(str || '');
  if (!m) return Date.now();
  const [, y, mo, d, h, mi, s] = m.map(v => Number(v));
  let guess = Date.UTC(y, mo - 1, d, h, mi, s);
  const shown = partsFromTS(guess);
  const shownUTC = Date.UTC(shown.year, shown.month - 1, shown.day, shown.hour, shown.minute, shown.second);
  const desiredUTC = Date.UTC(y, mo - 1, d, h, mi, s);
  let adjusted = guess + (desiredUTC - shownUTC);
  const shown2 = partsFromTS(adjusted);
  const shownUTC2 = Date.UTC(shown2.year, shown2.month - 1, shown2.day, shown2.hour, shown2.minute, shown2.second);
  adjusted = adjusted + (desiredUTC - shownUTC2);
  return adjusted;
}

function timeframeToMilliseconds(tf) {
  const unit = tf.slice(-1);
  const value = parseInt(tf.slice(0, -1));
  switch (unit) {
    case 'm': return value * 60 * 1000;
    case 'h': return value * 60 * 60 * 1000;
    case 'd': return value * 24 * 60 * 60 * 1000;
    default: return NaN;
  }
}

// Parse duration strings like '1h', '30m', '45s', or combos like '1h15m30s'
function parseDuration(str) {
  if (!str || typeof str !== 'string') return 0;
  const regex = /(\d+)\s*([hms])/gi;
  let match;
  let totalMs = 0;
  while ((match = regex.exec(str)) !== null) {
    const val = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();
    if (Number.isNaN(val)) continue;
    if (unit === 'h') totalMs += val * 60 * 60 * 1000;
    else if (unit === 'm') totalMs += val * 60 * 1000;
    else if (unit === 's') totalMs += val * 1000;
  }
  return totalMs;
}

class PivotOnlyFinder {
  constructor(snapshotTime) {
    this.snapshotTime = snapshotTime;
    this.timeframeCandles = new Map();
    this.timeframePivots = new Map();
    this.lastPivots = new Map();
    // Track last notified pivot timestamp per timeframe to avoid duplicates
    this.lastNotifiedPivotTime = new Map();
    // Prevent overlapping refresh ticks
    this._tickRunning = false;
    // Refresh counter
    this.refreshCount = 0;
  }

  async loadAllTimeframeData() {
    const shouldUseAPI = PIVOT_TOOL_CONFIG.liveMode || !useLocalData;
    const lookbackMs = PIVOT_TOOL_CONFIG.lookback
      ? parseDuration(PIVOT_TOOL_CONFIG.lookback)
      : (PIVOT_TOOL_CONFIG.lookbackMinutes * 60 * 1000);
    const windowStart = this.snapshotTime - lookbackMs;

    const loadPromises = multiPivotConfig.timeframes.map(async (tf) => {
      const candles = shouldUseAPI
        ? await this.loadTimeframeFromAPI(tf.interval, windowStart, this.snapshotTime)
        : await this.loadTimeframeFromCSV(tf.interval, windowStart, this.snapshotTime);
      return { interval: tf.interval, candles };
    });

    const results = await Promise.all(loadPromises);
    for (const { interval, candles } of results) {
      this.timeframeCandles.set(interval, candles);
      if (PIVOT_TOOL_CONFIG.showData) {
        console.log(`${colors.yellow}[${interval}] candles: ${candles.length}${colors.reset}`);
      }
    }
  }

  async loadTimeframeFromCSV(interval, startTime, endTime) {
    const csvPath = path.join(process.cwd(), 'data', 'historical', symbol, `${interval}.csv`);
    if (!fs.existsSync(csvPath)) {
      console.warn(`${colors.yellow}[${interval}] CSV not found: ${csvPath}${colors.reset}`);
      return [];
    }

    const fileContent = fs.readFileSync(csvPath, 'utf8');
    const lines = fileContent
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && line !== 'timestamp,open,high,low,close,volume');

    const candles = [];
    for (const line of lines) {
      const [time, open, high, low, close, volume] = line.split(',');
      const t = parseInt(time);
      if (isNaN(t) || isNaN(parseFloat(open))) continue;
      if (t >= startTime && t <= endTime) {
        candles.push({
          time: t,
          open: parseFloat(open),
          high: parseFloat(high),
          low: parseFloat(low),
          close: parseFloat(close),
          volume: parseFloat(volume || '0')
        });
      }
    }

    const tfMs = timeframeToMilliseconds(interval);
    const closed = candles.filter(c => (c.time + tfMs) <= this.snapshotTime);
    closed.sort((a, b) => a.time - b.time);
    return closed;
  }

  async loadTimeframeFromAPI(interval, startTime, endTime) {
    const getCandles = api === 'binance' ? getBinanceCandles : getBybitCandles;

    const intervalMinutes = { '1m': 1, '5m': 5, '15m': 15, '30m': 30, '1h': 60, '4h': 240, '1d': 1440 };
    const minutesPerCandle = intervalMinutes[interval] || 1;
    const timeWindowMinutes = (endTime - startTime) / (60 * 1000);
    const estimatedCandles = Math.ceil(timeWindowMinutes / minutesPerCandle) + 10;

    try {
      const all = await getCandles(symbol, interval, estimatedCandles, endTime, false);
      if (!all || all.length === 0) return [];
      const within = all.filter(c => c.time >= startTime && c.time <= this.snapshotTime);
      const tfMs = timeframeToMilliseconds(interval);
      const closed = within.filter(c => (c.time + tfMs) <= this.snapshotTime);
      closed.sort((a, b) => a.time - b.time);
      return closed;
    } catch (e) {
      console.error(`${colors.red}[${interval}] API error:${colors.reset}`, e.message);
      return [];
    }
  }

  detectPivotAtCandle(candles, index, timeframe) {
    if (index < timeframe.lookback) return null;

    const current = candles[index];
    const { minSwingPct, minLegBars } = timeframe;
    const swingThreshold = minSwingPct / 100;

    const lastPivot = this.lastPivots.get(timeframe.interval) || { type: null, price: null, time: null, index: 0 };

    // High pivot (long/contrarian)
    let isHigh = true;
    for (let j = 1; j <= timeframe.lookback; j++) {
      const cmp = candles[index - j];
      const cmpPrice = pivotDetectionMode === 'extreme' ? cmp.high : cmp.close;
      const curPrice = pivotDetectionMode === 'extreme' ? current.high : current.close;
      if (cmpPrice >= curPrice) { isHigh = false; break; }
    }
    if (isHigh) {
      const price = pivotDetectionMode === 'extreme' ? current.high : current.close;
      const swingPct = lastPivot.price ? (price - lastPivot.price) / lastPivot.price : 0;
      const isFirst = lastPivot.type === null;
      if ((isFirst || Math.abs(swingPct) >= swingThreshold) && (index - lastPivot.index) >= minLegBars) {
        const pivot = {
          time: current.time,
          price,
          signal: 'long',
          type: 'high',
          timeframe: timeframe.interval,
          index,
          swingPct: swingPct * 100
        };
        this.lastPivots.set(timeframe.interval, pivot);
        return pivot;
      }
    }

    // Low pivot (short/contrarian)
    let isLow = true;
    for (let j = 1; j <= timeframe.lookback; j++) {
      const cmp = candles[index - j];
      const cmpPrice = pivotDetectionMode === 'extreme' ? cmp.low : cmp.close;
      const curPrice = pivotDetectionMode === 'extreme' ? current.low : current.close;
      if (cmpPrice <= curPrice) { isLow = false; break; }
    }
    if (isLow) {
      const price = pivotDetectionMode === 'extreme' ? current.low : current.close;
      const swingPct = lastPivot.price ? (price - lastPivot.price) / lastPivot.price : 0;
      const isFirst = lastPivot.type === null;
      if ((isFirst || Math.abs(swingPct) >= swingThreshold) && (index - lastPivot.index) >= minLegBars) {
        const pivot = {
          time: current.time,
          price,
          signal: 'short',
          type: 'low',
          timeframe: timeframe.interval,
          index,
          swingPct: swingPct * 100
        };
        this.lastPivots.set(timeframe.interval, pivot);
        return pivot;
      }
    }

    return null;
  }

  processPivots() {
    // Reset per-timeframe pivot state for a clean recomputation
    this.lastPivots.clear();
    for (const tf of multiPivotConfig.timeframes) {
      const candles = this.timeframeCandles.get(tf.interval) || [];
      const pivots = [];
      for (let i = tf.lookback; i < candles.length; i++) {
        const candle = candles[i];
        if (candle.time > this.snapshotTime) break;
        const pivot = this.detectPivotAtCandle(candles, i, tf);
        if (pivot) pivots.push(pivot);
      }
      this.timeframePivots.set(tf.interval, pivots);
    }
  }

  // Determine last fully closed candle time for a timeframe given snapshotTime
  getLastClosedCandleTime(interval) {
    const tfMs = timeframeToMilliseconds(interval);
    // Candle at time T is considered closed at T + tfMs; we only allow candles where (time + tfMs) <= snapshot
    const candles = this.timeframeCandles.get(interval) || [];
    for (let i = candles.length - 1; i >= 0; i--) {
      if ((candles[i].time + tfMs) <= this.snapshotTime) {
        return candles[i].time;
      }
    }
    return null;
  }

  // In rolling mode, detect only new pivots since last notification and optionally send Telegram
  async detectAndNotifyNewPivots() {
    // Recompute pivots on current data
    this.processPivots();

    for (const tf of multiPivotConfig.timeframes) {
      const tfKey = tf.interval;
      const pivots = this.timeframePivots.get(tfKey) || [];
      if (pivots.length === 0) continue;

      // Ensure last pivot belongs to a fully closed candle
      const lastClosed = this.getLastClosedCandleTime(tfKey);
      const lastPivot = pivots[pivots.length - 1];
      if (!lastClosed || lastPivot.time > lastClosed) {
        // Last detected pivot is not yet on a closed candle; skip until close
        continue;
      }

      const lastNotified = this.lastNotifiedPivotTime.get(tfKey) || 0;
      if (lastPivot.time > lastNotified) {
        // New pivot — print and maybe notify
        this.printSinglePivot(tf, lastPivot);
        if (PIVOT_TOOL_CONFIG.perPivotTelegram && PIVOT_TOOL_CONFIG.sendTelegram) {
          await this.sendPivotTelegram(tf, lastPivot);
        }
        this.lastNotifiedPivotTime.set(tfKey, lastPivot.time);
      }
    }
  }

  printSinglePivot(tf, p) {
    const color = p.signal === 'long' ? colors.green : colors.red;
    const swingStr = p.swingPct != null ? ` (${p.swingPct.toFixed(2)}%)` : '';
    const age = formatTimeDifference(this.snapshotTime - p.time);
    console.log(`${colors.brightYellow}[NEW PIVOT]${colors.reset} ${tf.interval.toUpperCase()} (${tf.role}) ` +
      `=> ${color}${p.signal.toUpperCase()}${colors.reset} $${p.price.toFixed(2)} @ ${fmtDateTime(p.time)} (${fmtTime24(p.time)}) ${colors.dim}(${age} ago)${colors.reset}${swingStr}`);
  }

  async sendPivotTelegram(tf, p) {
    const dir = p.signal === 'long' ? 'LONG' : 'SHORT';
    const age = formatTimeDifference(this.snapshotTime - p.time);
    const lines = [
      `📌 NEW PIVOT — ${symbol}`,
      `⏱ ${fmtDateTime(p.time)} (${fmtTime24(p.time)}) • ${age} ago`,
      `🕓 TF: ${tf.interval.toUpperCase()} (${tf.role})`,
      `🎯 ${dir} @ $${p.price.toFixed(2)}`
    ];
    await telegramNotifier.sendMessage(lines.join('\n'));
  }

  // One refresh cycle: update time, load, detect, notify
  async refreshOnce() {
    if (this._tickRunning) return;
    this._tickRunning = true;
    try {
      // Increment refresh counter and clear screen first so this cycle acts like a restart
      this.refreshCount++;
      clearConsole();
      if (PIVOT_TOOL_CONFIG.showRefreshCount) {
        console.log(`${colors.cyan}[REFRESH #${this.refreshCount}]${colors.reset} ${fmtDateTime(Date.now())} (${fmtTime24(Date.now())})`);
      }

      this.snapshotTime = Date.now();
      await this.loadAllTimeframeData();
      // Ensure pivots are computed for the current snapshot before any notifications/printing
      this.processPivots();

      // On first run of rolling mode, initialize lastNotified to latest closed pivot per TF to avoid bulk spam
      if (this.lastNotifiedPivotTime.size === 0) {
        this.processPivots();
        for (const tf of multiPivotConfig.timeframes) {
          const pivots = this.timeframePivots.get(tf.interval) || [];
          if (pivots.length === 0) continue;
          const lastClosed = this.getLastClosedCandleTime(tf.interval);
          const lastClosedPivot = [...pivots].reverse().find(p => p.time <= (lastClosed || 0));
          if (lastClosedPivot) this.lastNotifiedPivotTime.set(tf.interval, lastClosedPivot.time);
        }
      }

      await this.detectAndNotifyNewPivots();

      // If for any reason no pivots are present, emit a brief diagnostic
      const totalPivots = Array.from(this.timeframePivots.values()).reduce((a, v) => a + (v?.length || 0), 0);
      if (totalPivots === 0) {
        console.log(`${colors.yellow}[Info] No pivots detected this cycle.${colors.reset}`);
      }

      // Reprint the full snapshot every refresh
      this.printResults();
    } finally {
      this._tickRunning = false;
    }
  }

  printResults() {
    const showCount = PIVOT_TOOL_CONFIG.showRecentPivots;
    console.log(`${colors.cyan}=== PIVOT-ONLY SNAPSHOT ===${colors.reset}`);
    console.log(`${colors.yellow}Time: ${fmtDateTime(this.snapshotTime)} (${fmtTime24(this.snapshotTime)})${colors.reset}`);
    console.log(`${colors.yellow}Symbol: ${symbol}${colors.reset}`);

    for (const tf of multiPivotConfig.timeframes) {
      const pivots = this.timeframePivots.get(tf.interval) || [];
      const recents = pivots.slice(-showCount);
      console.log(`${colors.magenta}${tf.interval.toUpperCase()} (${tf.role}) - ${recents.length} recent pivots:${colors.reset}`);
      if (recents.length === 0) {
        console.log(`  ${colors.dim}No pivots found${colors.reset}`);
      } else {
        for (const p of recents) {
          const color = p.signal === 'long' ? colors.green : colors.red;
          const swingStr = p.swingPct != null ? ` (${p.swingPct.toFixed(2)}%)` : '';
          const age = formatTimeDifference(this.snapshotTime - p.time);
          console.log(`  ${color}${p.signal.toUpperCase().padEnd(5)}${colors.reset} | $${p.price.toFixed(2)} | ${fmtDateTime(p.time)} (${fmtTime24(p.time)}) ${colors.dim}(${age} ago)${colors.reset}${swingStr}`);
        }
      }
    }
  }

  async maybeSendTelegramSummary() {
    if (!PIVOT_TOOL_CONFIG.sendTelegram) return;

    // Build compact summary per timeframe (show at least 10 pivots per timeframe)
    let lines = [`📌 PIVOT SNAPSHOT (${symbol})`, `⏰ ${fmtDateTime(this.snapshotTime)} (${fmtTime24(this.snapshotTime)})`];

    // Use the configurable number of pivots per timeframe
    const showCount = PIVOT_TOOL_CONFIG.telegramPivotsPerTimeframe;
    
    for (const tf of multiPivotConfig.timeframes) {
      const pivots = this.timeframePivots.get(tf.interval) || [];
      if (pivots.length === 0) {
        lines.push(`[${tf.interval}] —`);
        continue;
      }
      
      // Always show multiple pivots regardless of telegramPerTimeframeLatestOnly setting
      const recent = pivots.slice(-showCount);
      
      // Add a header for this timeframe
      lines.push(`[${tf.interval}] ${recent.length} pivots:\n`);
      
      // Add each pivot on its own line for better readability
      for (const p of recent) {
        const dir = p.signal === 'long' ? 'LONG' : 'SHORT';
        const price = p.price.toFixed(2);
        const age = formatTimeDifference(this.snapshotTime - p.time);
        lines.push(`• ${dir} @ $${price} • ${age} ago`);
      }
    }

    const msg = lines.join('\n');
    await telegramNotifier.sendMessage(msg);
  }
}

async function main() {
  const snapshotTime = PIVOT_TOOL_CONFIG.useCurrentTime
    ? Date.now()
    : parseTargetTimeInZone(PIVOT_TOOL_CONFIG.targetTime);

  console.log(`${colors.cyan}Starting pivot-only finder...${colors.reset}`);

  const finder = new PivotOnlyFinder(snapshotTime);

  // Initial snapshot run
  await finder.loadAllTimeframeData();
  finder.processPivots();
  finder.printResults();
  await finder.maybeSendTelegramSummary();

  if (!PIVOT_TOOL_CONFIG.rolling) {
    console.log(`${colors.brightYellow}Done.${colors.reset}`);
    return;
  }

  console.log(`${colors.brightYellow}[ROLLING MODE] Refresh every ${PIVOT_TOOL_CONFIG.refreshSeconds}s — per-pivot TG: ${PIVOT_TOOL_CONFIG.perPivotTelegram ? 'ON' : 'OFF'}${colors.reset}`);

  // Start rolling loop
  const intervalMs = Math.max(2, PIVOT_TOOL_CONFIG.refreshSeconds) * 1000;
  const timer = setInterval(() => {
    finder.refreshOnce().catch(err => console.error('Refresh error:', err?.message || err));
  }, intervalMs);

  // Graceful exit
  const stop = () => {
    clearInterval(timer);
    console.log(`${colors.brightYellow}Stopped rolling mode.${colors.reset}`);
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch(err => {
  console.error('Error:', err);
  process.exitCode = 1;
});
