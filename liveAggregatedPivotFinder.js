// liveAggregatedPivotFinder.js
// Live 1m-aggregated pivot detection with real-time notifications
// Uses our corrected pivot detection technology with CandleAggregator

// ===== CONFIGURATION =====
const LIVE_PIVOT_CONFIG = {
    // Time control
    liveMode: true,                    // Always use API for live data
    lookback: '12h',                   // How much historical data to load
    
    // Rolling (auto-refresh) mode
    rolling: true,                     // Continually poll for new pivots
    refreshSeconds: 15,                // Polling interval (15s for 1m candles)
    perPivotTelegram: true,           // Send per-pivot TG message on detection
    
    // Display
    showData: false,
    showRecentPivots: 10,
    showRefreshCount: true,           // Show refresh counter in terminal
    
    // Telegram
    sendTelegram: true,               // Send summary to telegram
    telegramPivotsPerTimeframe: 5     // Number of pivots to show per timeframe
};

import {
    symbol,
    useLocalData,
    api,
    pivotDetectionMode,
    timezone
} from './config/config.js';

import { multiPivotConfig } from './config/multiPivotConfig.js';
import { CandleAggregator } from './zaggregator/candleAggregator.js';
import { getCandles as getBinanceCandles } from './apis/binance.js';
import { getCandles as getBybitCandles } from './apis/bybit.js';
import telegramNotifier from './utils/telegramNotifier.js';
import { fmtDateTime, fmtTime24 } from './utils/formatters.js';

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

// Clear console (cross-platform)
function clearConsole() {
    try {
        if (process.stdout && process.stdout.isTTY) {
            process.stdout.write('\x1b[2J\x1b[3J\x1b[H');
            return;
        }
    } catch {}
    try { console.clear(); } catch {}
    try { process.stdout.write('\n'.repeat(120)); } catch {}
}

// Helper to format time differences
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

// CORRECTED Pivot detection function with proper minSwingPct and minLegBars validation
function detectPivot(candles, index, config) {
    const { pivotLookback, minSwingPct, minLegBars } = config;
    
    if (index < pivotLookback || index >= candles.length) return null;
    
    const currentCandle = candles[index];
    const currentHigh = pivotDetectionMode === 'close' ? currentCandle.close : currentCandle.high;
    const currentLow = pivotDetectionMode === 'close' ? currentCandle.close : currentCandle.low;
    
    // Check for high pivot
    let isHighPivot = true;
    for (let j = 1; j <= pivotLookback; j++) {
        if (index - j < 0) {
            isHighPivot = false;
            break;
        }
        const compareHigh = pivotDetectionMode === 'close' ? candles[index - j].close : candles[index - j].high;
        if (currentHigh <= compareHigh) {
            isHighPivot = false;
            break;
        }
    }
    
    // Check for low pivot
    let isLowPivot = true;
    for (let j = 1; j <= pivotLookback; j++) {
        if (index - j < 0) {
            isLowPivot = false;
            break;
        }
        const compareLow = pivotDetectionMode === 'close' ? candles[index - j].close : candles[index - j].low;
        if (currentLow >= compareLow) {
            isLowPivot = false;
            break;
        }
    }
    
    if (!isHighPivot && !isLowPivot) return null;
    
    const pivotType = isHighPivot ? 'high' : 'low';
    const pivotPrice = isHighPivot ? currentHigh : currentLow;
    
    // Validate minimum leg bars requirement (distance from last opposite pivot)
    if (minLegBars > 1) {
        let barsFromOpposite = 0;
        const oppositeType = pivotType === 'high' ? 'low' : 'high';
        
        // Count bars since last opposite pivot type
        for (let j = 1; j <= Math.min(pivotLookback * 3, index); j++) {
            if (index - j < 0) break;
            
            const checkCandle = candles[index - j];
            const checkHigh = pivotDetectionMode === 'close' ? checkCandle.close : checkCandle.high;
            const checkLow = pivotDetectionMode === 'close' ? checkCandle.close : checkCandle.low;
            
            // Check if this candle was an opposite pivot
            let wasOppositePivot = false;
            if (oppositeType === 'high') {
                // Check if it was higher than surrounding candles
                let isHigher = true;
                for (let k = 1; k <= Math.min(pivotLookback, j, index - j); k++) {
                    if (index - j - k >= 0 && checkHigh <= (pivotDetectionMode === 'close' ? candles[index - j - k].close : candles[index - j - k].high)) {
                        isHigher = false;
                        break;
                    }
                    if (index - j + k < candles.length && checkHigh <= (pivotDetectionMode === 'close' ? candles[index - j + k].close : candles[index - j + k].high)) {
                        isHigher = false;
                        break;
                    }
                }
                wasOppositePivot = isHigher;
            } else {
                // Check if it was lower than surrounding candles
                let isLower = true;
                for (let k = 1; k <= Math.min(pivotLookback, j, index - j); k++) {
                    if (index - j - k >= 0 && checkLow >= (pivotDetectionMode === 'close' ? candles[index - j - k].close : candles[index - j - k].low)) {
                        isLower = false;
                        break;
                    }
                    if (index - j + k < candles.length && checkLow >= (pivotDetectionMode === 'close' ? candles[index - j + k].close : candles[index - j + k].low)) {
                        isLower = false;
                        break;
                    }
                }
                wasOppositePivot = isLower;
            }
            
            if (wasOppositePivot) {
                barsFromOpposite = j;
                break;
            }
        }
        
        // Reject pivot if not enough bars from last opposite pivot
        if (barsFromOpposite > 0 && barsFromOpposite < minLegBars) {
            return null;
        }
    }
    
    // Validate minimum swing percentage requirement
    if (minSwingPct > 0) {
        let maxSwingPct = 0;
        
        for (let j = 1; j <= pivotLookback; j++) {
            if (index - j < 0) break;
            
            const compareCandle = candles[index - j];
            const comparePrice = pivotDetectionMode === 'close' ? compareCandle.close : 
                                (pivotType === 'high' ? compareCandle.low : compareCandle.high);
            
            const swingPct = Math.abs((pivotPrice - comparePrice) / comparePrice * 100);
            maxSwingPct = Math.max(maxSwingPct, swingPct);
        }
        
        // Reject pivot if swing percentage is below minimum threshold
        if (maxSwingPct < minSwingPct) {
            return null;
        }
    }
    
    return {
        type: pivotType,
        price: pivotPrice,
        time: currentCandle.time,
        index: index,
        signal: pivotType === 'high' ? 'short' : 'long' // Inverted signals per memory
    };
}

class LiveAggregatedPivotFinder {
    constructor() {
        this.snapshotTime = Date.now();
        this.aggregator = null;
        this.oneMinuteCandles = [];
        this.timeframePivots = new Map();
        this.lastNotifiedPivotTime = new Map();
        this.lastProcessedTimes = {};
        this._tickRunning = false;
        this.refreshCount = 0;
        
        // Initialize aggregator with configured timeframes
        const timeframes = multiPivotConfig.timeframes.map(tf => tf.interval);
        this.aggregator = new CandleAggregator(timeframes, { keepSeries: true });
    }

    async load1mCandles() {
        const getCandles = api === 'binance' ? getBinanceCandles : getBybitCandles;
        const lookbackMs = parseDuration(LIVE_PIVOT_CONFIG.lookback);
        const candleCount = Math.ceil(lookbackMs / (60 * 1000)) + 100; // Extra buffer
        
        try {
            const candles = await getCandles(symbol, '1m', candleCount, this.snapshotTime, false);
            if (!candles || candles.length === 0) return [];
            
            // Filter to only closed candles (current minute might be forming)
            const now = this.snapshotTime;
            const currentMinuteBucket = Math.floor(now / 60000) * 60000;
            const closed = candles.filter(c => c.time < currentMinuteBucket);
            
            closed.sort((a, b) => a.time - b.time);
            
            if (LIVE_PIVOT_CONFIG.showData) {
                console.log(`${colors.yellow}[1m] Loaded ${closed.length} closed candles${colors.reset}`);
            }
            
            return closed;
        } catch (e) {
            console.error(`${colors.red}[1m] API error:${colors.reset}`, e.message);
            return [];
        }
    }

    processAggregatedPivots() {
        // Reset aggregator and process all 1m candles
        const timeframes = multiPivotConfig.timeframes.map(tf => tf.interval);
        this.aggregator = new CandleAggregator(timeframes, { keepSeries: true });
        
        // Clear previous state
        this.lastProcessedTimes = {};
        
        // Process each 1m candle through aggregator
        for (let i = 0; i < this.oneMinuteCandles.length; i++) {
            const currentCandle = this.oneMinuteCandles[i];
            this.aggregator.update(currentCandle);
            
            // Check each timeframe for pivots on CLOSED candles only
            for (const tfConfig of multiPivotConfig.timeframes) {
                const tf = tfConfig.interval;
                
                // Build series for pivot detection using closed candles only
                const closedSeries = this.aggregator.buildClosedSeries(tf);
                
                // Only check for pivots when we have enough closed candles
                if (closedSeries.length < tfConfig.lookback + 1) continue;
                
                // Get the most recent closed candle
                const latestClosedCandle = closedSeries[closedSeries.length - 1];
                
                // Skip if we already processed this candle time for this timeframe
                const candleKey = `${tf}_${latestClosedCandle.time}`;
                if (this.lastProcessedTimes[candleKey]) continue;
                this.lastProcessedTimes[candleKey] = true;
                
                // Check for pivot in the most recent CLOSED candle
                const latestIndex = closedSeries.length - 1;
                const pivot = detectPivot(closedSeries, latestIndex, {
                    pivotLookback: tfConfig.lookback,
                    minSwingPct: tfConfig.minSwingPct,
                    minLegBars: tfConfig.minLegBars
                });
                
                if (pivot) {
                    // Add to timeframe pivots
                    if (!this.timeframePivots.has(tf)) {
                        this.timeframePivots.set(tf, []);
                    }
                    
                    // Check if this pivot already exists (avoid duplicates)
                    const existing = this.timeframePivots.get(tf);
                    const isDuplicate = existing.some(p => p.time === pivot.time && p.type === pivot.type);
                    
                    if (!isDuplicate) {
                        existing.push(pivot);
                    }
                }
            }
        }
    }

    async detectAndNotifyNewPivots() {
        // Recompute all pivots
        this.processAggregatedPivots();

        for (const tfConfig of multiPivotConfig.timeframes) {
            const tf = tfConfig.interval;
            const pivots = this.timeframePivots.get(tf) || [];
            if (pivots.length === 0) continue;

            // Get the latest pivot
            const lastPivot = pivots[pivots.length - 1];
            const lastNotified = this.lastNotifiedPivotTime.get(tf) || 0;
            
            if (lastPivot.time > lastNotified) {
                // New pivot detected!
                this.printSinglePivot(tfConfig, lastPivot);
                
                if (LIVE_PIVOT_CONFIG.perPivotTelegram && LIVE_PIVOT_CONFIG.sendTelegram) {
                    await this.sendPivotTelegram(tfConfig, lastPivot);
                }
                
                this.lastNotifiedPivotTime.set(tf, lastPivot.time);
            }
        }
    }

    printSinglePivot(tfConfig, pivot) {
        const color = pivot.signal === 'long' ? colors.green : colors.red;
        const age = formatTimeDifference(this.snapshotTime - pivot.time);
        
        // Calculate percentage movement from previous pivot
        let movementPct = '';
        const pivots = this.timeframePivots.get(tfConfig.interval) || [];
        const pivotIndex = pivots.findIndex(p => p.time === pivot.time);
        if (pivotIndex > 0) {
            const prevPivot = pivots[pivotIndex - 1];
            const pctMove = ((pivot.price - prevPivot.price) / prevPivot.price * 100);
            movementPct = ` [${pctMove > 0 ? '+' : ''}${pctMove.toFixed(3)}%]`;
        } else {
            movementPct = ` [First Pivot]`;
        }
        
        console.log(`${colors.brightYellow}[NEW PIVOT]${colors.reset} ${tfConfig.interval.toUpperCase()} (${tfConfig.role}) ` +
            `=> ${color}${pivot.signal.toUpperCase()}${colors.reset} $${pivot.price.toFixed(2)} @ ${fmtDateTime(pivot.time)} (${fmtTime24(pivot.time)}) ${colors.dim}(${age} ago)${colors.reset}${movementPct}`);
    }

    async sendPivotTelegram(tfConfig, pivot) {
        const dir = pivot.signal === 'long' ? 'LONG' : 'SHORT';
        const age = formatTimeDifference(this.snapshotTime - pivot.time);
        const lines = [
            `📌 NEW AGGREGATED PIVOT — ${symbol}`,
            `⏱ ${fmtDateTime(pivot.time)} (${fmtTime24(pivot.time)}) • ${age} ago`,
            `🕓 TF: ${tfConfig.interval.toUpperCase()} (${tfConfig.role}) [AGGREGATED]`,
            `🎯 ${dir} @ $${pivot.price.toFixed(2)}`,
            `⚙️ MinSwing: ${tfConfig.minSwingPct}% | Lookback: ${tfConfig.lookback}`
        ];
        await telegramNotifier.sendMessage(lines.join('\n'));
    }

    async refreshOnce() {
        if (this._tickRunning) return;
        this._tickRunning = true;
        
        try {
            this.refreshCount++;
            clearConsole();
            
            if (LIVE_PIVOT_CONFIG.showRefreshCount) {
                console.log(`${colors.cyan}[REFRESH #${this.refreshCount}]${colors.reset} ${fmtDateTime(Date.now())} (${fmtTime24(Date.now())})`);
            }

            this.snapshotTime = Date.now();
            
            // Load fresh 1m candles
            this.oneMinuteCandles = await this.load1mCandles();
            
            // Initialize pivot tracking on first run
            if (this.lastNotifiedPivotTime.size === 0) {
                this.processAggregatedPivots();
                
                // Set last notified to latest pivot per timeframe to avoid spam
                for (const tfConfig of multiPivotConfig.timeframes) {
                    const pivots = this.timeframePivots.get(tfConfig.interval) || [];
                    if (pivots.length > 0) {
                        const latestPivot = pivots[pivots.length - 1];
                        this.lastNotifiedPivotTime.set(tfConfig.interval, latestPivot.time);
                    }
                }
            }

            // Detect and notify new pivots
            await this.detectAndNotifyNewPivots();

            // Print current status
            this.printResults();
            
        } finally {
            this._tickRunning = false;
        }
    }

    printResults() {
        const showCount = LIVE_PIVOT_CONFIG.showRecentPivots;
        console.log(`${colors.cyan}=== LIVE AGGREGATED PIVOT FINDER ===${colors.reset}`);
        console.log(`${colors.yellow}Time: ${fmtDateTime(this.snapshotTime)} (${fmtTime24(this.snapshotTime)})${colors.reset}`);
        console.log(`${colors.yellow}Symbol: ${symbol} | Detection: ${pivotDetectionMode} | 1m Candles: ${this.oneMinuteCandles.length}${colors.reset}`);

        for (const tfConfig of multiPivotConfig.timeframes) {
            const pivots = this.timeframePivots.get(tfConfig.interval) || [];
            const recents = pivots.slice(-showCount);
            
            console.log(`${colors.magenta}${tfConfig.interval.toUpperCase()} (${tfConfig.role}) - ${recents.length} recent pivots [MinSwing: ${tfConfig.minSwingPct}%]:${colors.reset}`);
            
            if (recents.length === 0) {
                console.log(`  ${colors.dim}No pivots found${colors.reset}`);
            } else {
                for (let i = 0; i < recents.length; i++) {
                    const p = recents[i];
                    const color = p.signal === 'long' ? colors.green : colors.red;
                    const age = formatTimeDifference(this.snapshotTime - p.time);
                    
                    // Calculate swing percentage from previous pivot
                    let swingPct = '';
                    if (i > 0) {
                        const prevPivot = recents[i - 1];
                        const pctMove = ((p.price - prevPivot.price) / prevPivot.price * 100);
                        swingPct = ` [${pctMove > 0 ? '+' : ''}${pctMove.toFixed(3)}%]`;
                    } else {
                        // Check if there are more pivots before this batch
                        const allPivots = this.timeframePivots.get(tfConfig.interval) || [];
                        const fullIndex = allPivots.findIndex(pivot => pivot.time === p.time);
                        if (fullIndex > 0) {
                            const prevPivot = allPivots[fullIndex - 1];
                            const pctMove = ((p.price - prevPivot.price) / prevPivot.price * 100);
                            swingPct = ` [${pctMove > 0 ? '+' : ''}${pctMove.toFixed(3)}%]`;
                        } else {
                            swingPct = ` [First]`;
                        }
                    }
                    
                    console.log(`  ${color}${p.signal.toUpperCase().padEnd(5)}${colors.reset} | $${p.price.toFixed(2)} | ${fmtDateTime(p.time)} (${fmtTime24(p.time)}) ${colors.dim}(${age} ago)${colors.reset}${swingPct}`);
                }
            }
        }
    }

    async maybeSendTelegramSummary() {
        if (!LIVE_PIVOT_CONFIG.sendTelegram) return;

        let lines = [
            `📌 LIVE AGGREGATED PIVOT SNAPSHOT (${symbol})`, 
            `⏰ ${fmtDateTime(this.snapshotTime)} (${fmtTime24(this.snapshotTime)})`,
            `🔧 Using 1m→Multi-TF Aggregation Technology`
        ];

        const showCount = LIVE_PIVOT_CONFIG.telegramPivotsPerTimeframe;
        
        for (const tfConfig of multiPivotConfig.timeframes) {
            const pivots = this.timeframePivots.get(tfConfig.interval) || [];
            if (pivots.length === 0) {
                lines.push(`[${tfConfig.interval}] — No pivots`);
                continue;
            }
            
            const recent = pivots.slice(-showCount);
            lines.push(`[${tfConfig.interval}] ${recent.length} pivots (${tfConfig.minSwingPct}% min):`);
            
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
    console.log(`${colors.cyan}Starting Live Aggregated Pivot Finder...${colors.reset}`);
    console.log(`${colors.yellow}Using 1m→Multi-Timeframe Aggregation Technology${colors.reset}`);
    console.log(`${colors.yellow}Configured Timeframes: ${multiPivotConfig.timeframes.map(tf => `${tf.interval}(${tf.minSwingPct}%)`).join(', ')}${colors.reset}`);

    const finder = new LiveAggregatedPivotFinder();

    // Initial run
    await finder.refreshOnce();
    await finder.maybeSendTelegramSummary();

    if (!LIVE_PIVOT_CONFIG.rolling) {
        console.log(`${colors.brightYellow}Done.${colors.reset}`);
        return;
    }

    console.log(`${colors.brightYellow}[ROLLING MODE] Refresh every ${LIVE_PIVOT_CONFIG.refreshSeconds}s — per-pivot TG: ${LIVE_PIVOT_CONFIG.perPivotTelegram ? 'ON' : 'OFF'}${colors.reset}`);

    // Start rolling loop
    const intervalMs = Math.max(5, LIVE_PIVOT_CONFIG.refreshSeconds) * 1000;
    const timer = setInterval(() => {
        finder.refreshOnce().catch(err => console.error('Refresh error:', err?.message || err));
    }, intervalMs);

    // Graceful exit
    const stop = () => {
        clearInterval(timer);
        console.log(`${colors.brightYellow}Stopped live aggregated pivot finder.${colors.reset}`);
        process.exit(0);
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
}

main().catch(err => {
    console.error('Error:', err);
    process.exitCode = 1;
});
