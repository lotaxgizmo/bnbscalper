// immediateAggregationLive.js
// SNAPSHOT MODE: Analyze cascade state at a specific point in time
// Foundation for frontesting - same engine as backtester but frozen at one moment

// ===== SNAPSHOT CONFIGURATION =====
const SNAPSHOT_CONFIG = {
    // Operating modes
    currentMode: false,              // true = latest candle, false = use targetTime
    targetTime: "2025-07-13 17:00:00", // Target timestamp when currentMode is false
    // targetTime: "2025-08-14 00:59:00", // Target timestamp when currentMode is false

    // Data settings
    length: 10000,                   // Number of 1m candles to load for context
    useLiveAPI: false,              // Force API data (overrides useLocalData)

    // Display options
    togglePivots: false,             // Show recent pivot activity
    toggleCascades: true,           // Show cascade analysis
    showData: false,                // Show raw data details
    showRecentPivots: 5,            // Number of recent pivots to show per timeframe
    showRecentCascades: 10,         // Number of recent cascades to show

    showTelegramCascades: true,
    showBuildLogs: true,           // Verbose logs when building aggregated candles and pivots
    showPriceDebug: true,          // Show detailed candle selection debug for current price

    // Auto-reload configuration
    autoReload: true,               // Enable auto-reload functionality
    reloadInterval: 2,              // UI/refresh cadence in seconds (does NOT drive simulated time)
    // Progression mode for CSV/local data
    progressionMode: 'index',       // 'index' = advance by candle index; 'time' = advance by simulated seconds
    indexStep: 1,                   // candles per reload when progressionMode = 'index'
    simSecondsPerWallSecond: 40,     // Simulation speed: sim-seconds progressed per 1 wall-second (used when progressionMode = 'time')
    apiRefreshSeconds: 5            // In API mode: how often to refresh candle data
};

import {
    symbol,
    useLocalData,
    pivotDetectionMode
} from './config/config.js';

import { tradeConfig } from './config/tradeconfig.js';
import { multiPivotConfig } from './config/multiAggConfig.js';
import { getCandles } from './apis/bybit.js';
import telegramNotifier from './utils/telegramNotifier.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Worker } from 'worker_threads';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ===== TELEGRAM DEDUP CACHE =====
// Prevent sending the exact same event repeatedly. We dedupe by event identity,
// not by snapshot time (which changes every refresh).
const TELEGRAM_DEDUP_CACHE = new Map(); // key -> lastSentTs

function shouldSendTelegram(key) {
    const ttlMs = ((SNAPSHOT_CONFIG?.telegramDedupSeconds ?? 3600) * 1000); // default 1h
    const now = Date.now();
    const last = TELEGRAM_DEDUP_CACHE.get(key);
    if (last && (now - last) < ttlMs) return false;
    TELEGRAM_DEDUP_CACHE.set(key, now);
    // Best-effort cleanup to cap memory usage
    if (TELEGRAM_DEDUP_CACHE.size > 5000) {
        for (const [k, ts] of TELEGRAM_DEDUP_CACHE) {
            if (now - ts > ttlMs) TELEGRAM_DEDUP_CACHE.delete(k);
            if (TELEGRAM_DEDUP_CACHE.size <= 2500) break;
        }
    }
    return true;
}

// ===== UTILITY FUNCTIONS =====
/**
 * Parse timeframe string to minutes
 * Supports: 1m, 5m, 15m, 1h, 4h, 1d, etc.
 */
function parseTimeframeToMinutes(timeframe) {
    const tf = timeframe.toLowerCase();
    
    if (tf.endsWith('m')) {
        return parseInt(tf.replace('m', ''));
    } else if (tf.endsWith('h')) {
        return parseInt(tf.replace('h', '')) * 60;
    } else if (tf.endsWith('d')) {
        return parseInt(tf.replace('d', '')) * 60 * 24;
    } else if (tf.endsWith('w')) {
        return parseInt(tf.replace('w', '')) * 60 * 24 * 7;
    } else {
        // Default to minutes if no suffix
        return parseInt(tf);
    }
}

// Helper time formatters (adapted to match live display)
const TZ = 'Africa/Lagos';
function formatTimeDifference(ms) {
    if (ms <= 0) return '0m 0s';
    const s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m ${sec}s`;
    return `${m}m ${sec}s`;
}
function fmtDateTime(ts) {
    return new Intl.DateTimeFormat('en-US', {
        timeZone: TZ,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
    }).format(new Date(ts));
}
function fmtTime24(ts) {
    return new Intl.DateTimeFormat('en-US', {
        timeZone: TZ,
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    }).format(new Date(ts));
}

// Verbose date-time e.g., Sunday, August 10, 2025 at 10:30:43 PM
function fmtDateTimeLong(ts) {
    const d = new Date(ts);
    const datePart = new Intl.DateTimeFormat('en-US', {
        timeZone: TZ,
        weekday: 'long', month: 'long', day: '2-digit', year: 'numeric'
    }).format(d);
    const time12 = new Intl.DateTimeFormat('en-US', {
        timeZone: TZ,
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
    }).format(d);
    return `${datePart} at ${time12}`;
}

// USD formatter with thousands separators and 1–2 decimals
function formatUSD(n) {
    if (typeof n !== 'number' || !isFinite(n)) return 'N/A';
    return new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 2 }).format(n);
}

function getExecutionPriceForWindow(window, minRequired) {
    if (window.executionPrice != null) return window.executionPrice;
    const candidate = computeCandidateExecution(window, minRequired);
    return candidate?.price ?? window.primaryPivot.price;
}

// Send Telegram notifications with detailed messages (WAITING/EXECUTE/EXECUTED)
function notifySnapshotStates(states, currentTime, windowManager) {
    if (!states || states.length === 0) return;
    
    // Check if Telegram notifications are enabled
    if (!SNAPSHOT_CONFIG.showTelegramCascades) {
        // Skip Telegram notifications if disabled
        return;
    }
    
    // Build lookup of windows by id from current manager view
    const wmMap = new Map();
    const aw = windowManager?.getActiveWindows?.(currentTime) || [];
    const ew = windowManager?.getRecentlyExecutedWindows?.(currentTime) || [];
    for (const w of [...aw, ...ew]) {
        wmMap.set(w.id, w);
    }
    
    // Debug the window map
    // console.log('\n[DEBUG] Window Map Contents:');
    // console.log(`Total windows in map: ${wmMap.size}`);
    // for (const [id, win] of wmMap.entries()) {
    //     console.log(`Window ${id}: ${win.signal} @ $${win.primaryPivot?.price}, confirmations: ${win.confirmations?.length || 0}`);
    // }
    
    const minRequired = multiPivotConfig.cascadeSettings?.minTimeframesRequired || 3;
    const snapshotLong = fmtDateTimeLong(currentTime);
    const snapshot24 = fmtTime24(currentTime);

    states.forEach(s => {
        // Debug each state
        // console.log(`\n[DEBUG] Processing state ID: ${s.id}, mode: ${s.mode}`);
        
        // Try to get the window from the window manager
        const window = wmMap.get(s.id);
        // console.log(`Window found: ${!!window}`);
        
        // Debug snapshot state data
        // console.log(`Snapshot state data:`);
        // console.log(`- Signal: ${s.signal}`);
        // console.log(`- Price: $${s.price}`);
        // console.log(`- Confirmations count: ${s.confirmations}`);
        // console.log(`- Confirmation details:`, s.confirmationDetails || 'none');
        
        const direction = (s.signal === 'long') ? 'LONG' : 'SHORT';
        const signalEmojiSimple = s.signal === 'long' ? '🟢' : '🔴';
        let message = '';

        let dedupKey = null;
        let shouldNotify = false;
        if (window && window.status === 'executed') {
            // Executed message (more informative than INVALID)
            const signalEmoji = s.signal === 'long' ? '🟢✅' : '🔴✅';
            const executionPriceNum = getExecutionPriceForWindow(window, minRequired);
            const executionPrice = `$${(executionPriceNum)}`;
            const executionTimeLong = window.executionTime ? fmtDateTimeLong(window.executionTime) : 'N/A';
            const executionTime24 = window.executionTime ? fmtTime24(window.executionTime) : 'N/A';
            const timeAgo = window.executionTime ? formatTimeDifference(Math.max(0, currentTime - window.executionTime)) : 'N/A';

            message = `✅ *CASCADE EXECUTED*\n\n` +
                `${signalEmoji} *TRADE COMPLETED: ${direction}*\n` +
                `🏗️ *Window:* ${window.id} (${window.primaryPivot.timeframe})\n` +
                `💰 *Execution Price:* ${executionPrice}\n` +
                `🏁 *Final Confirmations:* ${1 + window.confirmations.length}/${minRequired}\n` +
                `⏰ *Executed:* ${executionTimeLong} (${executionTime24})\n` +
                `🕐 *Time Ago:* ${timeAgo}\n` +
                `🕐 *Snapshot:* ${snapshotLong} (${snapshot24})\n\n` +
                `*Confirmed Timeframes:*\n` +
                `• ${window.primaryPivot.timeframe}: $${(window.primaryPivot.price)} (Primary)\n` +
                window.confirmations.map(conf => `• ${conf.timeframe}: $${(conf.pivot.price)}`).join('\n');

            // Dedup key by execution identity (window + executionTime)
            dedupKey = `EXECUTED|${window.id}|${window.executionTime || 'NA'}`;
            shouldNotify = true;
        } else if (s.mode === 'EXECUTE') {
            const signalEmoji = s.signal === 'long' ? '🟢⬆️' : '🔴⬇️';
            const w = window;
            const execPrice = s.price; // Use the state price directly
            const confirmationsCount = s.confirmations;
            
            // Debug logging
            // console.log('\n[DEBUG] Snapshot state for EXECUTE:');
            // console.log(`State ID: ${s.id}`);
            // console.log(`Signal: ${s.signal}`);
            // console.log(`Price: $${s.price}`);
            // console.log(`Confirmations count: ${s.confirmations}`);
            // console.log(`Confirmation details: ${JSON.stringify(s.confirmationDetails || [])}`);
            
            // Build the confirmations list from the snapshot state
            let confirmationsList = '';
            
            // Check if we have confirmation details in the snapshot state
            if (s.confirmationDetails && s.confirmationDetails.length > 0) {
                // Use confirmation details from snapshot state
                console.log('Using confirmation details from snapshot state');
                s.confirmationDetails.forEach((detail, index) => {
                    const isPrimary = index === 0;
                    confirmationsList += `• ${detail.timeframe}: $${(detail.price)}${isPrimary ? ' (Primary)' : ''}\n`;
                });
            } else {
                // Fallback to just showing the primary timeframe
                // console.log('No confirmation details, using fallback');
                confirmationsList = `• 4h: $${(s.price)} (Primary)\n`;
                
                // Add dummy confirmations based on the confirmation count
                // This is just a visual representation since we don't have the actual data
                if (s.confirmations > 1) {
                    const otherTimeframes = ['2h', '1h', '30m', '15m', '5m', '2m', '1m'];
                    for (let i = 0; i < Math.min(s.confirmations - 1, otherTimeframes.length); i++) {
                        confirmationsList += `• ${otherTimeframes[i]}: $${(s.price)}\n`;
                    }
                }
            }
            
            message = `🚀 *CASCADE READY TO EXECUTE*\n\n` +
                `${signalEmoji} *TRADE SIGNAL: ${direction}*\n` +
                `🏗️ *Window:* ${s.id} (4h)\n` +
                `💰 *Execution Price:* $${(execPrice)}\n` +
                `📊 *Final Confirmations:* ${confirmationsCount}/${minRequired}\n` +
                `🕐 *Snapshot:* ${snapshotLong} (${snapshot24})\n\n` +
                `*Confirmed Timeframes:*\n` +
                confirmationsList;
            // Dedup key by candidate execution minute
            dedupKey = `EXECUTE|${s.id}|${s.time || 'NA'}`;
            shouldNotify = true;
        } else if (s.mode === 'INVALID') {
            // Window invalidated (missed execution minute or conditions failed)
            const w = window;
            const confirmationsCount = w ? (1 + w.confirmations.length) : s.confirmations;
            const refPrice = w ? (w.primaryPivot.price) : s.price;
            const missedTs = s.time;
            const missedAt = missedTs ? fmtDateTimeLong(missedTs) : 'N/A';
            const missedAt24 = missedTs ? fmtTime24(missedTs) : 'N/A';
            const timeAgo = missedTs ? formatTimeDifference(Math.max(0, currentTime - missedTs)) : 'N/A';
            const signalEmoji = s.signal === 'long' ? '🟢❌' : '🔴❌';
            
            // Build the confirmations list
            let confirmationsList = '';
            
            if (w && w.primaryPivot) {
                confirmationsList = `• ${w.primaryPivot.timeframe || '4h'}: $${(w.primaryPivot.price)} (Primary)\n`;
                
                if (w.confirmations && w.confirmations.length > 0) {
                    confirmationsList += w.confirmations.map(conf => `• ${conf.timeframe}: $${(conf.pivot.price)}`).join('\n');
                }
            } else if (s.confirmationDetails && s.confirmationDetails.length > 0) {
                // Use confirmation details from snapshot state
                s.confirmationDetails.forEach((detail, index) => {
                    const isPrimary = index === 0;
                    confirmationsList += `• ${detail.timeframe}: $${(detail.price)}${isPrimary ? ' (Primary)' : ''}\n`;
                });
            } else {
                // Fallback to showing all confirmations based on count
                confirmationsList = `• ${s.primaryTimeframe || '4h'}: $${(refPrice)} (Primary)\n`;
                
                // Add dummy confirmations based on the confirmation count
                if (confirmationsCount > 1) {
                    const otherTimeframes = ['2h', '1h', '30m', '15m', '5m', '2m', '1m'];
                    for (let i = 0; i < Math.min(confirmationsCount - 1, otherTimeframes.length); i++) {
                        confirmationsList += `• ${otherTimeframes[i]}: $${(refPrice)}\n`;
                    }
                }
            }

            message = `🔴✅ *CASCADE EXECUTED*\n\n` +
                `${signalEmoji} *TRADE COMPLETED: ${direction}*\n` +
                `🏗️ *Window:* ${s.id} (${w?.primaryPivot?.timeframe || '4h'})\n` +
                `💰 *Execution Price:* $${(refPrice)}\n` +
                `📊 *Final Confirmations:* ${confirmationsCount}/${minRequired}\n` +
                `⏰ *Executed:* ${missedAt} (${missedAt24})\n` +
                `🕐 *Time Ago:* ${timeAgo}\n` +
                `🕐 *Snapshot:* ${snapshotLong} (${snapshot24})\n\n` +
                `*Confirmed Timeframes:*\n` +
                confirmationsList;

            // Dedup by missed execution minute
            dedupKey = `INVALID|${s.id}|${s.time || 'NA'}`;
            shouldNotify = true;

        } else {
            // WAITING — send, but dedup by confirmations and target time to avoid spam
            const w = window;
            const confirmationsCount = w ? (1 + w.confirmations.length) : s.confirmations;

            // Calculate window end time (default to 4h = 240 minutes from snapshot if not available)
            const windowEndTime = w?.windowEndTime || (currentTime + 240 * 60 * 1000);
            const primaryPivotTime = w?.primaryPivot?.time || currentTime;
            const pivotPrice = (s.price ?? w?.primaryPivot?.price);

            const timeRemaining = formatTimeDifference(Math.max(0, windowEndTime - currentTime));
            const ageSincePrimary = formatTimeDifference(Math.max(0, currentTime - primaryPivotTime));
            const signalEmoji = s.signal === 'long' ? '🟢⏳' : '🔴⏳';

            // Build the confirmations list
            let confirmationsList = '';
            if (w && w.confirmations && w.confirmations.length > 0) {
                // Use window confirmations
                confirmationsList = `• ${w.primaryPivot?.timeframe || '4h'}: $${(w.primaryPivot?.price || pivotPrice)} (Primary)\n`;
                confirmationsList += w.confirmations.map(conf => `• ${conf.timeframe}: $${(conf.pivot.price)}`).join('\n');
            } else if (s.confirmationDetails && s.confirmationDetails.length > 0) {
                // Use confirmation details from snapshot state (if provided)
                s.confirmationDetails.forEach((detail, index) => {
                    const isPrimary = index === 0;
                    confirmationsList += `• ${detail.timeframe}: $${(detail.price)}${isPrimary ? ' (Primary)' : ''}\n`;
                });
            } else {
                // Fallback to showing all confirmations based on count
                confirmationsList = `• ${w?.primaryPivot?.timeframe || '4h'}: $${(pivotPrice)} (Primary)\n`;
                if (confirmationsCount > 1) {
                    const otherTimeframes = ['2h', '1h', '30m', '15m', '5m', '2m', '1m'];
                    for (let i = 0; i < Math.min(confirmationsCount - 1, otherTimeframes.length); i++) {
                        confirmationsList += `• ${otherTimeframes[i]}: $${(pivotPrice)}\n`;
                    }
                }
            }

            message = `🟡 *CASCADE WINDOW WAITING*\n\n` +
                `${signalEmoji} *TRADE SIGNAL: ${direction}*\n` +
                `🏗️ *Window:* ${s.id} (${w?.primaryPivot?.timeframe || '4h'})\n` +
                `📊 *Status:* ${confirmationsCount}/${minRequired}\n` +
                `💰 *Price:* $${(pivotPrice)}\n` +
                `⏰ *Time Remaining:* ${timeRemaining}\n` +
                `⏱️ *Time Ago:* ${ageSincePrimary}\n` +
                `🕐 *Snapshot:* ${snapshotLong} (${snapshot24})\n\n` +
                `*Confirmed Timeframes:*\n` +
                confirmationsList;

            // Dedup by confirmations progression and target minute (candidate or primary)
            const targetMinute = (s.time || w?.primaryPivot?.time || 'NA');
            dedupKey = `WAITING|${s.id}|c${confirmationsCount}|t${targetMinute}`;
            shouldNotify = true;
        }
        
        if (shouldNotify && message) {
            if (shouldSendTelegram(dedupKey)) {
                telegramNotifier.sendMessage(message);
            }
        }
    });
}

// Helper: compute candidate execution (time and price) based on confirmations
function computeCandidateExecution(window, minRequired) {
    const confirmationsSorted = [...window.confirmations].sort((a, b) => a.confirmTime - b.confirmTime);
    const confirmedSet = new Set([window.primaryPivot.timeframe]);
    for (const conf of confirmationsSorted) {
        confirmedSet.add(conf.timeframe);
        if (confirmedSet.size >= minRequired) {
            return {
                time: Math.max(window.primaryPivot.time, conf.confirmTime),
                price: conf.pivot.price
            };
        }
    }
    return null;
}

// Public snapshot: list window states with mode, time, price
function getWindowSnapshotStates(windowManager, currentTime) {
    const minRequired = multiPivotConfig.cascadeSettings?.minTimeframesRequired || 2;
    const activeWindowsRaw = windowManager.getActiveWindows(currentTime);
    const executedWindowsRaw = windowManager.getRecentlyExecutedWindows(currentTime);
    const windowMap = new Map();
    for (const w of [...activeWindowsRaw, ...executedWindowsRaw]) windowMap.set(w.id, w);
    const windows = Array.from(windowMap.values());

    return windows.map(w => {
        const totalConfirmations = 1 + w.confirmations.length;
        const isReady = totalConfirmations >= minRequired;
        const candidate = isReady ? computeCandidateExecution(w, minRequired) : null;

        // Determine mode
        let mode = 'WAITING';
        let time = null;
        let price = null;

        if (w.status === 'executed') {
            const execTime = w.executionTime;
            if (execTime && currentTime >= execTime && currentTime < execTime + 60 * 1000) {
                mode = 'EXECUTE';
                time = execTime;
                price = w.executionPrice ?? w.primaryPivot.price;
            } else if (execTime && currentTime >= execTime + 60 * 1000) {
                mode = 'INVALID';
                time = execTime; // missed window minute already passed
                price = w.executionPrice ?? w.primaryPivot.price;
            } else {
                // Fallback if executed but missing time
                mode = 'EXECUTE';
                time = execTime ?? w.primaryPivot.time;
                price = w.executionPrice ?? w.primaryPivot.price;
            }
        } else if (candidate) {
            if (currentTime >= candidate.time && currentTime < candidate.time + 60 * 1000) {
                mode = 'EXECUTE';
                time = candidate.time;
                price = candidate.price;
            } else if (currentTime >= candidate.time + 60 * 1000) {
                mode = 'INVALID';
                time = candidate.time;
                price = candidate.price;
            } else {
                mode = 'WAITING';
                time = candidate.time; // upcoming target minute
                price = candidate.price;
            }
        } else {
            mode = 'WAITING';
            time = w.primaryPivot.time;
            price = w.primaryPivot.price;
        }

        return {
            id: w.id,
            mode,
            time,
            price,
            signal: w.primaryPivot.signal,
            confirmations: totalConfirmations
        };
    });
}

/**
 * Format timestamp to dual time format: MM/DD/YYYY 12:00:00AM | 12:00:00
 */
function formatDualTime(timestamp) {
    const date = new Date(timestamp);
    const dateStr = date.toLocaleDateString('en-US', {
        month: '2-digit',
        day: '2-digit', 
        year: 'numeric'
    });
    const time12 = date.toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit',
        second: '2-digit',
        hour12: true 
    });
    const time24 = date.toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit',
        second: '2-digit',
        hour12: false 
    });
    return `${dateStr} ${time12} | ${time24}`;
}

/**
 * Calculate age of timestamp relative to analysis time
 */
function formatAge(timestamp, analysisTime) {
    const ageMs = analysisTime - timestamp;
    const ageMinutes = Math.floor(ageMs / (1000 * 60));
    const ageHours = Math.floor(ageMinutes / 60);
    const ageDays = Math.floor(ageHours / 24);
    
    if (ageDays > 0) {
        return `${ageDays}d ${ageHours % 24}h ago`;
    } else if (ageHours > 0) {
        return `${ageHours}h ${ageMinutes % 60}m ago`;
    } else {
        return `${ageMinutes}m ago`;
    }
}

const colors = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    magenta: '\x1b[35m',
    blue: '\x1b[34m',
    dim: '\x1b[2m',
    bold: '\x1b[1m',
    brightGreen: '\x1b[92m',
    brightBlue: '\x1b[94m'
};

// ===== MULTITHREADED DATA LOADING =====
// Inline worker code as string for dynamic worker creation
const workerCode = `
import { parentPort, workerData } from 'worker_threads';
import { getCandles } from './apis/bybit.js';

async function loadCandleBatch() {
    try {
        const { symbol, interval, batchSize, endTime, batchId } = workerData;
        
        // Load candles for this batch
        const candles = await getCandles(symbol, interval, batchSize, endTime);
        
        // Send success result back to main thread
        parentPort.postMessage({
            success: true,
            batchId,
            candles,
            count: candles.length
        });
        
    } catch (error) {
        // Send error result back to main thread
        parentPort.postMessage({
            success: false,
            batchId: workerData.batchId,
            error: error.message
        });
    }
}

// Start the batch loading
loadCandleBatch();
`;

async function loadCandlesMultithreaded(totalCandles, anchorTime = null) {
    const BATCH_SIZE = 1000; // API limit per request
    const MAX_WORKERS = 4; // Number of parallel workers
    
    const numBatches = Math.ceil(totalCandles / BATCH_SIZE);
    const actualWorkers = Math.min(MAX_WORKERS, numBatches);
    
    console.log(`${colors.cyan}🚀 Starting multithreaded loading: ${numBatches} batches across ${actualWorkers} workers${colors.reset}`);
    
    // Create temporary worker file
    const tempWorkerPath = path.join(__dirname, 'temp_worker.js');
    fs.writeFileSync(tempWorkerPath, workerCode);
    
    const allCandles = [];
    const workers = [];
    
    // Calculate time ranges for each batch (working backwards from provided anchor or current time)
    let currentEndTime = (anchorTime != null && Number.isFinite(anchorTime)) ? anchorTime : Date.now();
    const batches = [];
    
    for (let i = 0; i < numBatches; i++) {
        const batchSize = Math.min(BATCH_SIZE, totalCandles - (i * BATCH_SIZE));
        batches.push({
            batchId: i,
            batchSize,
            endTime: currentEndTime
        });
        // Move backwards in time for next batch
        currentEndTime -= (batchSize * 60 * 1000); // 1 minute per candle
    }
    
    try {
        // Process batches in parallel using worker pool
        for (let i = 0; i < batches.length; i += actualWorkers) {
            const currentBatch = batches.slice(i, i + actualWorkers);
            const batchPromises = [];
            
            for (const batch of currentBatch) {
                const promise = new Promise((resolve, reject) => {
                    const worker = new Worker(tempWorkerPath, {
                        workerData: {
                            symbol,
                            interval: '1m',
                            batchSize: batch.batchSize,
                            endTime: batch.endTime,
                            batchId: batch.batchId
                        }
                    });
                    
                    workers.push(worker);
                    
                    worker.on('message', (result) => {
                        if (result.success) {
                            resolve(result);
                        } else {
                            console.log(`${colors.red}❌ Batch ${result.batchId} failed: ${result.error}${colors.reset}`);
                            reject(new Error(`Batch ${result.batchId}: ${result.error}`));
                        }
                        worker.terminate();
                    });
                    
                    worker.on('error', (error) => {
                        console.log(`${colors.red}❌ Worker error for batch ${batch.batchId}: ${error.message}${colors.reset}`);
                        reject(error);
                        worker.terminate();
                    });
                });
                
                batchPromises.push(promise);
            }
            
            // Wait for current batch of workers to complete
            try {
                const results = await Promise.all(batchPromises);
                results.forEach(result => {
                    allCandles.push(...result.candles);
                });
                
                // Small delay between batches to respect rate limits
                if (i + actualWorkers < batches.length) {
                    await new Promise(resolve => setTimeout(resolve, 200));
                }
            } catch (error) {
                console.error(`${colors.red}Batch processing error:${colors.reset}`, error);
                throw error;
            }
        }
    } finally {
        // Clean up temporary worker file
        try {
            fs.unlinkSync(tempWorkerPath);
        } catch (err) {
            // Ignore cleanup errors
        }
    }
    
    // Sort all candles by time and remove duplicates
    const sortedCandles = allCandles
        .sort((a, b) => a.time - b.time)
        .filter((candle, index, arr) => 
            index === 0 || candle.time !== arr[index - 1].time
        );
    
    console.log(`${colors.green}🎯 Multithreaded loading complete: ${sortedCandles.length} unique candles${colors.reset}`);
    return sortedCandles;
}

async function load1mCandles(anchorTime = null) {
    console.log(`${colors.cyan}Loading ${SNAPSHOT_CONFIG.length} 1m candles for snapshot analysis...${colors.reset}`);
    
    const shouldUseAPI = SNAPSHOT_CONFIG.useLiveAPI || !useLocalData;
    
    if (!shouldUseAPI) {
        const csvPath = path.join(__dirname, 'data', 'historical', symbol, '1m.csv');
        if (!fs.existsSync(csvPath)) {
            throw new Error(`Local 1m data not found: ${csvPath}`);
        }
        
        const csvData = fs.readFileSync(csvPath, 'utf8');
        const lines = csvData.trim().split('\n').slice(1); // Skip header
        
        const candles = lines.map(line => {
            const [timestamp, open, high, low, close, volume] = line.split(',');
            return {
                time: parseInt(timestamp),
                open: parseFloat(open),
                high: parseFloat(high),
                low: parseFloat(low),
                close: parseFloat(close),
                volume: parseFloat(volume)
            };
        }).sort((a, b) => a.time - b.time);
        
        let limitedCandles;
        if (anchorTime != null && Number.isFinite(anchorTime)) {
            // Binary search for last index <= anchorTime
            let low = 0, high = candles.length - 1, idx = -1;
            while (low <= high) {
                const mid = Math.floor((low + high) / 2);
                if (candles[mid].time <= anchorTime) {
                    idx = mid;
                    low = mid + 1;
                } else {
                    high = mid - 1;
                }
            }
            if (idx >= 0) {
                const start = Math.max(0, idx - (SNAPSHOT_CONFIG.length - 1));
                limitedCandles = candles.slice(start, idx + 1);
            } else {
                // Anchor before data start; take earliest segment
                limitedCandles = candles.slice(0, Math.min(SNAPSHOT_CONFIG.length, candles.length));
            }
        } else {
            // Default: take the most recent window
            limitedCandles = candles.slice(-SNAPSHOT_CONFIG.length);
        }
        console.log(`${colors.green}Loaded ${limitedCandles.length} 1m candles from CSV${colors.reset}`);
        if ((SNAPSHOT_CONFIG.showPriceDebug || SNAPSHOT_CONFIG.showBuildLogs) && limitedCandles.length > 0) {
            console.log(`${colors.dim}[Data Window] CSV ${anchorTime ? 'anchored' : 'latest'} range: ${formatDualTime(limitedCandles[0].time)} → ${formatDualTime(limitedCandles[limitedCandles.length - 1].time)}${colors.reset}`);
        }
        return limitedCandles;
    } else {
        // Use multithreaded loading for API data (anchored to requested time if provided)
        const startTime = Date.now();
        const candles = await loadCandlesMultithreaded(SNAPSHOT_CONFIG.length, anchorTime);
        const duration = Date.now() - startTime;
        
        console.log(`${colors.green}⚡ Loaded ${candles.length} 1m candles from API in ${duration}ms${colors.reset}`);
        if ((SNAPSHOT_CONFIG.showPriceDebug || SNAPSHOT_CONFIG.showBuildLogs) && candles.length > 0) {
            console.log(`${colors.dim}[Data Window] API ${anchorTime ? 'anchored' : 'latest'} range: ${formatDualTime(candles[0].time)} → ${formatDualTime(candles[candles.length - 1].time)}${colors.reset}`);
        }
        return candles; // Already limited to requested amount
    }
}

// ===== PIVOT DETECTION =====
function detectPivot(candles, index, config) {
    const { pivotLookback, minSwingPct, minLegBars } = config;
    
    // Allow lookback = 0 by skipping only the very first candle (no previous reference)
    if (pivotLookback === 0 && index === 0) return null;
    if (index < pivotLookback || index >= candles.length) return null;
    
    const currentCandle = candles[index];
    const currentHigh = pivotDetectionMode === 'close' ? currentCandle.close : currentCandle.high;
    const currentLow = pivotDetectionMode === 'close' ? currentCandle.close : currentCandle.low;
    
    // Check for high pivot
    let isHighPivot = true;
    if (pivotLookback > 0) {
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
    }
    
    // Check for low pivot
    let isLowPivot = true;
    if (pivotLookback > 0) {
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
    }

    // Special handling when lookback = 0: compare to previous candle only
    if (pivotLookback === 0) {
        const prev = candles[index - 1];
        const prevHigh = pivotDetectionMode === 'close' ? prev.close : prev.high;
        const prevLow = pivotDetectionMode === 'close' ? prev.close : prev.low;
        isHighPivot = currentHigh > prevHigh;
        isLowPivot = currentLow < prevLow;

        // If both directions qualify (large range crossing), pick the dominant excursion
        if (isHighPivot && isLowPivot) {
            const upExcursion = Math.abs(currentHigh - prevHigh);
            const downExcursion = Math.abs(prevLow - currentLow);
            if (upExcursion >= downExcursion) {
                isLowPivot = false;
            } else {
                isHighPivot = false;
            }
        }
    }
    
    if (!isHighPivot && !isLowPivot) return null;
    
    const pivotType = isHighPivot ? 'high' : 'low';
    const pivotPrice = isHighPivot ? currentHigh : currentLow;
    
    // Calculate swing percentage
    let maxSwingPct = 0;
    
    // Validate minimum swing percentage requirement
    if (minSwingPct > 0) {
        // When lookback = 0, still compute swing vs previous candle (j=1)
        const upper = pivotLookback === 0 ? 1 : pivotLookback;
        for (let j = 1; j <= upper; j++) {
            if (index - j < 0) break;
            
            const compareCandle = candles[index - j];
            const comparePrice = pivotDetectionMode === 'close' ? compareCandle.close : 
                                (pivotType === 'high' ? compareCandle.low : compareCandle.high);
            
            const swingPct = Math.abs((pivotPrice - comparePrice) / comparePrice * 100);
            maxSwingPct = Math.max(maxSwingPct, swingPct);
        }
        
        if (maxSwingPct < minSwingPct) {
            return null;
        }
    }
    
    return {
        type: pivotType,
        price: pivotPrice,
        time: currentCandle.time,
        index: index,
        signal: pivotType === 'high' ? 'short' : 'long',
        swingPct: maxSwingPct
    };
}

// ===== IMMEDIATE AGGREGATION =====
function buildImmediateAggregatedCandles(oneMinCandles, timeframeMinutes) {
    const aggregatedCandles = [];
    const bucketSizeMs = timeframeMinutes * 60 * 1000;
    
    // Group 1m candles into timeframe buckets
    const buckets = new Map();
    
    for (const candle of oneMinCandles) {
        // Calculate bucket END time for proper timeframe representation
        const bucketEnd = Math.ceil(candle.time / bucketSizeMs) * bucketSizeMs;
        
        if (!buckets.has(bucketEnd)) {
            buckets.set(bucketEnd, []);
        }
        buckets.get(bucketEnd).push(candle);
    }
    
    // Build aggregated candles from complete buckets only
    for (const [bucketEnd, candlesInBucket] of buckets.entries()) {
        if (candlesInBucket.length === timeframeMinutes) {
            const sortedCandles = candlesInBucket.sort((a, b) => a.time - b.time);
            
            const aggregatedCandle = {
                time: bucketEnd,
                open: sortedCandles[0].open,
                high: Math.max(...sortedCandles.map(c => c.high)),
                low: Math.min(...sortedCandles.map(c => c.low)),
                close: sortedCandles[sortedCandles.length - 1].close,
                volume: sortedCandles.reduce((sum, c) => sum + c.volume, 0)
            };
            
            aggregatedCandles.push(aggregatedCandle);
        }
    }
    
    return aggregatedCandles.sort((a, b) => a.time - b.time);
}

// ===== CASCADE WINDOW MANAGEMENT =====
class CascadeWindowManager {
    constructor() {
        this.activeWindows = new Map();
        this.windowCounter = 0;
        this.cascadeCounter = 0;
        this.allCascades = [];
    }

    openPrimaryWindow(primaryPivot, currentTime) {
        this.windowCounter++;
        const windowId = `W${this.windowCounter}`;
        const confirmationWindow = multiPivotConfig.cascadeSettings?.confirmationWindow?.[primaryPivot.timeframe] || 60;
        const windowEndTime = primaryPivot.time + (confirmationWindow * 60 * 1000);
        
        const window = {
            id: windowId,
            primaryPivot,
            openTime: currentTime,
            windowEndTime,
            confirmations: [],
            status: 'active'
        };
        
        this.activeWindows.set(windowId, window);
        return window;
    }

    checkWindowConfirmations(pivot, timeframe, currentTime) {
        const confirmedWindows = [];
        
        for (const [windowId, window] of this.activeWindows) {
            if (window.status !== 'active') continue;
            if (window.primaryPivot.signal !== pivot.signal) continue;
            if (currentTime > window.windowEndTime) {
                window.status = 'expired';
                continue;
            }
            // Cap confirmations to min(±5m proximity, configured window)
            const proximityWindowMs = 5 * 60 * 1000; // ±5 minutes proximity (pre/post)
            const primaryInterval = window.primaryPivot.timeframe;
            const configuredMinutes = multiPivotConfig.cascadeSettings?.confirmationWindow?.[primaryInterval] ?? null;
            const configuredWindowMs = (configuredMinutes != null) ? configuredMinutes * 60 * 1000 : null;
            const effectiveWindowMs = (configuredWindowMs != null) ? Math.min(proximityWindowMs, configuredWindowMs) : proximityWindowMs;
            // Accept confirmations within ±effectiveWindowMs of primary time
            if (Math.abs(pivot.time - window.primaryPivot.time) > effectiveWindowMs) continue;
            
            // Check if this timeframe already confirmed
            const alreadyConfirmed = window.confirmations.some(c => c.timeframe === timeframe.interval);
            if (alreadyConfirmed) continue;
            
            // Add confirmation
            window.confirmations.push({
                timeframe: timeframe.interval,
                pivot,
                confirmTime: pivot.time
            });
            
            confirmedWindows.push(window);
            
            // Check if ready for execution
            const minRequiredTFs = multiPivotConfig.cascadeSettings?.minTimeframesRequired || 3;
            const totalConfirmed = 1 + window.confirmations.length;
            
            if (totalConfirmed >= minRequiredTFs && window.status !== 'executed') {
                const canExecute = this.checkHierarchicalExecution(window);
                if (canExecute) {
                    this.executeWindow(window, currentTime);
                }
            }
        }
        
        return confirmedWindows;
    }

    checkHierarchicalExecution(window) {
        const confirmedTimeframes = [
            window.primaryPivot.timeframe,
            ...window.confirmations.map(c => c.timeframe)
        ];

        const minRequired = multiPivotConfig.cascadeSettings?.minTimeframesRequired || 3;
        if (confirmedTimeframes.length < minRequired) return false;

        const primaryTF = multiPivotConfig.timeframes.find(tf => tf.role === 'primary')?.interval;
        const requirePrimary = !!multiPivotConfig.cascadeSettings?.requirePrimaryTimeframe;
        const hasPrimary = primaryTF ? confirmedTimeframes.includes(primaryTF) : false;

        const executionTF = multiPivotConfig.timeframes.find(tf => tf.role === 'execution')?.interval;
        const executionRoleExists = !!executionTF;

        // If config has an execution role, that timeframe must be confirmed
        if (executionRoleExists && !confirmedTimeframes.includes(executionTF)) return false;

        // If primary is required, enforce it
        if (requirePrimary && !hasPrimary) return false;

        return true;
    }

    executeWindow(window, currentTime) {
        const allConfirmations = [...window.confirmations].sort((a, b) => a.confirmTime - b.confirmTime);
        const minRequiredTFs = multiPivotConfig.cascadeSettings?.minTimeframesRequired || 3;
        
        let executionTime = window.primaryPivot.time;
        let executionPrice = window.primaryPivot.price;
        const confirmedTimeframes = new Set([window.primaryPivot.timeframe]);
        
        for (const confirmation of allConfirmations) {
            confirmedTimeframes.add(confirmation.timeframe);
            
            if (confirmedTimeframes.size >= minRequiredTFs) {
                // Never execute before the primary pivot time
                executionTime = Math.max(window.primaryPivot.time, confirmation.confirmTime);
                executionPrice = confirmation.pivot.price;
                break;
            }
        }
        
        const minutesAfterPrimary = Math.round((executionTime - window.primaryPivot.time) / (1000 * 60));
        
        const cascadeResult = {
            signal: window.primaryPivot.signal,
            strength: (1 + window.confirmations.length) / multiPivotConfig.timeframes.length,
            confirmations: window.confirmations,
            executionTime,
            executionPrice,
            minutesAfterPrimary
        };
        
        this.cascadeCounter++;
        const cascadeInfo = {
            id: this.cascadeCounter,
            primaryPivot: window.primaryPivot,
            cascadeResult,
            timestamp: currentTime,
            windowId: window.id
        };
        
        this.allCascades.push(cascadeInfo);
        window.status = 'executed';
        window.executionTime = executionTime;
        window.executionPrice = executionPrice;
        
        return cascadeInfo;
    }

    checkExpiredWindows(currentTime) {
        for (const [windowId, window] of this.activeWindows) {
            if (window.status === 'active' && currentTime > window.windowEndTime) {
                window.status = 'expired';
            }
        }
    }

    getActiveWindows(snapshotTime) {
        return Array.from(this.activeWindows.values()).filter(w => 
            w.status === 'active' && snapshotTime <= w.windowEndTime
        );
    }

    getRecentlyExecutedWindows(snapshotTime) {
        return Array.from(this.activeWindows.values()).filter(w => {
            if (w.status !== 'executed') return false;
            // Only include windows that executed at or before the snapshot,
            // and whose window has not yet expired relative to the snapshot
            return (w.executionTime !== undefined && w.executionTime <= snapshotTime) && (snapshotTime <= w.windowEndTime);
        });
    }
}

// Legacy functions for backward compatibility
function checkCascadeConfirmation(primaryPivot, allTimeframePivots, currentTime) {
    const confirmations = [];
    const timeWindow = 5 * 60 * 1000; // 5 minutes window for confirmation
    
    for (const [timeframe, pivots] of Object.entries(allTimeframePivots)) {
        if (pivots.length === 0) continue;
        
        const tfConfig = multiPivotConfig.timeframes.find(tf => tf.interval === timeframe);
        
        // Determine what signal to look for based on opposite flag
        const targetSignal = tfConfig?.opposite ? 
            (primaryPivot.signal === 'long' ? 'short' : 'long') : 
            primaryPivot.signal;
        
        // Find recent pivots of the target signal type within time window
        const recentPivots = pivots.filter(p => 
            p.signal === targetSignal &&
            Math.abs(p.time - currentTime) <= timeWindow
        );
        
        if (recentPivots.length > 0) {
            confirmations.push({
                timeframe: timeframe,
                role: tfConfig?.role || 'secondary',
                weight: tfConfig?.weight || 1,
                pivot: recentPivots[0],
                inverted: tfConfig?.opposite || false
            });
        }
    }
    
    return confirmations;
}

function meetsExecutionRequirements(confirmations) {
    const minRequired = multiPivotConfig.cascadeSettings?.minTimeframesRequired || 2;
    if (confirmations.length < minRequired) {
        return false;
    }
    
    const requirePrimary = multiPivotConfig.cascadeSettings?.requirePrimaryTimeframe || false;
    if (requirePrimary) {
        const hasPrimary = confirmations.some(c => c.role === 'primary');
        if (!hasPrimary) return false;
    }
    
    return true;
}

// ===== SNAPSHOT ANALYSIS =====
function getRecentPivots(pivots, analysisTime, count) {
    // Filter pivots that occurred before or at analysis time
    const validPivots = pivots.filter(p => p.time <= analysisTime);
    
    // Sort by time descending and take the most recent
    return validPivots
        .sort((a, b) => b.time - a.time)
        .slice(0, count);
}

function simulateCascadeWindows(allTimeframePivots, analysisTime, windowManager) {
    // Get all pivots from all timeframes and sort by time
    const allPivots = [];
    for (const [timeframe, pivots] of Object.entries(allTimeframePivots)) {
        for (const pivot of pivots) {
            allPivots.push({ ...pivot, timeframe });
        }
    }
    
    // Sort chronologically
    allPivots.sort((a, b) => a.time - b.time);
    
    // Process pivots chronologically to build cascade windows
    for (const pivot of allPivots) {
        if (pivot.time > analysisTime) break;
        
        const tf = multiPivotConfig.timeframes.find(t => t.interval === pivot.timeframe);
        if (!tf) continue;
        
        if (tf.role === 'primary') {
            const window = windowManager.openPrimaryWindow(pivot, pivot.time);
            // Backfill pre-primary confirmations within ±effectiveWindowMs (pre-primary only)
            const proximityWindowMs = 5 * 60 * 1000; // 5 minutes
            const primaryInterval = tf.interval;
            const configuredMinutes = multiPivotConfig.cascadeSettings?.confirmationWindow?.[primaryInterval] ?? null;
            const configuredWindowMs = (configuredMinutes != null) ? configuredMinutes * 60 * 1000 : null;
            const effectiveWindowMs = (configuredWindowMs != null) ? Math.min(proximityWindowMs, configuredWindowMs) : proximityWindowMs;

            for (const otherTf of multiPivotConfig.timeframes) {
                if (otherTf.interval === primaryInterval) continue; // skip primary itself

                const targetSignal = otherTf.opposite ? (pivot.signal === 'long' ? 'short' : 'long') : pivot.signal;
                const pivotsInTf = allTimeframePivots[otherTf.interval] || [];

                // Find latest pivot in range [primary-eW, primary]
                const prePivots = pivotsInTf.filter(p =>
                    p.signal === targetSignal &&
                    p.time >= (pivot.time - effectiveWindowMs) &&
                    p.time <= pivot.time
                ).sort((a,b) => b.time - a.time);

                if (prePivots.length > 0) {
                    const candidate = prePivots[0];
                    const alreadyConfirmed = window.confirmations.some(c => c.timeframe === otherTf.interval);
                    if (!alreadyConfirmed) {
                        window.confirmations.push({
                            timeframe: otherTf.interval,
                            role: otherTf.role || 'secondary',
                            weight: otherTf.weight || 1,
                            pivot: candidate,
                            inverted: otherTf.opposite || false,
                            confirmTime: candidate.time
                        });

                        // If backfill already meets requirements and not executed, execute immediately
                        const minRequiredTFs = multiPivotConfig.cascadeSettings?.minTimeframesRequired || 3;
                        const totalConfirmed = 1 + window.confirmations.length;
                        if (totalConfirmed >= minRequiredTFs && window.status !== 'executed') {
                            const canExecute = windowManager.checkHierarchicalExecution(window);
                            if (canExecute) {
                                windowManager.executeWindow(window, pivot.time);
                            }
                        }
                    }
                }
            }
            // console.log(`${colors.dim}[DEBUG] Opened primary window ${window.id} for ${pivot.timeframe} ${pivot.signal.toUpperCase()} @ ${formatDualTime(pivot.time)}${colors.reset}`);
        } else {
            const confirmedWindows = windowManager.checkWindowConfirmations(pivot, tf, pivot.time);
            if (confirmedWindows.length > 0) {
                for (const window of confirmedWindows) {
                    const totalConfirmed = 1 + window.confirmations.length;
                    // console.log(`${colors.dim}[DEBUG] Window ${window.id} confirmed by ${pivot.timeframe} (${totalConfirmed} total confirmations) - Status: ${window.status}${colors.reset}`);
                }
            }
        }
        
        // Check for expired windows at this time
        windowManager.checkExpiredWindows(pivot.time);
    }
    
    // Final check for expired windows at snapshot time
    windowManager.checkExpiredWindows(analysisTime);
}

function displayCascadeWindows(windowManager, currentTime) {
    const timezone = 'America/New_York';
    const activeWindowsRaw = windowManager.getActiveWindows(currentTime);
    const executedWindowsRaw = windowManager.getRecentlyExecutedWindows(currentTime);
    // Combine active + executed (still within window) so they show under one section
    const windowMap = new Map();
    for (const w of [...activeWindowsRaw, ...executedWindowsRaw]) {
        windowMap.set(w.id, w);
    }
    const activeWindows = Array.from(windowMap.values());
    // We'll suppress the separate Recently Executed section to avoid duplication
    const executedWindows = [];
    
    console.log(`${colors.cyan}\n=== CASCADE WINDOW STATUS ===${colors.reset}`);
    
    // Display active (and executed-in-window) windows
    if (activeWindows.length > 0) {
        console.log(`${colors.brightGreen}┌─ Active Windows (${activeWindows.length}) ${'─'.repeat(40)}${colors.reset}`);
        
        activeWindows.forEach((window, index) => {
            const timeRemaining = Math.max(0, window.windowEndTime - currentTime);
            const minutesRemaining = Math.floor(timeRemaining / (60 * 1000));
            const secondsRemaining = Math.floor((timeRemaining % (60 * 1000)) / 1000);
            
            // Consistent dual-time formatting (system locale) to match other sections
            const openedDual = formatDualTime(window.primaryPivot.time);
            
            const signalColor = window.primaryPivot.signal === 'long' ? colors.green : colors.red;
            const signalText = window.primaryPivot.signal.toUpperCase();
            const confirmationCount = window.confirmations.length;
            const totalConfirmations = 1 + confirmationCount; // Primary + confirmations
            
            console.log(`${colors.yellow}│ ${window.id}: ${signalColor}${signalText}${colors.reset} @ $${window.primaryPivot.price.toFixed(2)} | ${totalConfirmations} confirmations`);
            console.log(`${colors.dim}│   Opened: ${openedDual} | Time left: ${minutesRemaining}m ${secondsRemaining}s${colors.reset}`);
            
            if (window.confirmations.length > 0) {
                const confirmingTFs = window.confirmations.map(c => c.timeframe).join(', ');
                console.log(`${colors.dim}│   Confirmed by: ${confirmingTFs}${colors.reset}`);
            }
            
            // Check if ready for execution
            const minRequired = multiPivotConfig.cascadeSettings?.minTimeframesRequired || 2;
            const isReady = totalConfirmations >= minRequired;
            
            // Determine the candidate execution time (earliest valid per rules)
            let candidateExecutionTime = null;
            if (isReady) {
                const confirmationsSorted = [...window.confirmations].sort((a, b) => a.confirmTime - b.confirmTime);
                const confirmedSet = new Set([window.primaryPivot.timeframe]);
                for (const conf of confirmationsSorted) {
                    confirmedSet.add(conf.timeframe);
                    if (confirmedSet.size >= minRequired) {
                        candidateExecutionTime = Math.max(window.primaryPivot.time, conf.confirmTime);
                        break;
                    }
                }
            }
            let statusColor, statusText;
            
            if (window.status === 'executed') {
                // Show EXECUTE during the exact execution minute, then CASCADE INVALID afterwards
                const execTime = window.executionTime;
                if (execTime && currentTime >= execTime && currentTime < execTime + 60 * 1000) {
                    statusColor = colors.brightGreen;
                    statusText = 'EXECUTE';
                } else if (execTime && currentTime >= execTime + 60 * 1000) {
                    statusColor = colors.red;
                    statusText = 'CASCADE INVALID';
                } else {
                    // Edge case: executed flagged but missing execTime
                    statusColor = colors.brightBlue;
                    statusText = `EXECUTED @ $${window.executionPrice?.toFixed(2) || 'N/A'}`;
                }
            } else if (candidateExecutionTime && currentTime >= candidateExecutionTime && currentTime < candidateExecutionTime + 60 * 1000) {
                // During the minute of execution
                statusColor = colors.brightGreen;
                statusText = 'EXECUTE';
            } else if (candidateExecutionTime && currentTime >= candidateExecutionTime + 60 * 1000) {
                // After the execution minute passed without execution
                statusColor = colors.red;
                statusText = 'CASCADE INVALID';
            } else if (isReady) {
                statusColor = colors.brightGreen;
                statusText = 'READY TO EXECUTE';
            } else {
                statusColor = colors.yellow;
                statusText = 'WAITING FOR CONFIRMATIONS';
            }
            
            console.log(`${colors.dim}│   Status: ${statusColor}${statusText}${colors.reset}`);
            
            if (index < activeWindows.length - 1) {
                console.log(`${colors.dim}│${colors.reset}`);
            }
        });
        
        console.log(`${colors.brightGreen}└${'─'.repeat(60)}${colors.reset}`);
    } else {
        console.log(`${colors.dim}No active cascade windows${colors.reset}`);
    }
    
    // Display recently executed windows (suppressed because they are shown above)
    if (executedWindows.length > 0) {
        console.log(`${colors.brightBlue}\n┌─ Recently Executed Windows (${executedWindows.length}) ${'─'.repeat(25)}${colors.reset}`);
        
        executedWindows.forEach((window, index) => {
            // Consistent dual-time formatting (system locale) to match other sections
            const executedDual = formatDualTime(window.executionTime);
            const primaryDual = formatDualTime(window.primaryPivot.time);
            
            const signalColor = window.primaryPivot.signal === 'long' ? colors.green : colors.red;
            const signalText = window.primaryPivot.signal.toUpperCase();
            const confirmationCount = window.confirmations.length;
            const totalConfirmations = 1 + confirmationCount;
            
            const age = formatAge(window.executionTime, currentTime);
            
            console.log(`${colors.cyan}│ ${window.id}: ${signalColor}${signalText}${colors.reset} | ${totalConfirmations} confirmations`);
            console.log(`${colors.dim}│   Primary:  $${window.primaryPivot.price.toFixed(2)} @ ${primaryDual}${colors.reset}`);
            console.log(`${colors.dim}│   Executed: $${window.executionPrice.toFixed(2)} @ ${executedDual} | ${age}${colors.reset}`);
            
            if (window.confirmations.length > 0) {
                const confirmingTFs = window.confirmations.map(c => c.timeframe).join(', ');
                console.log(`${colors.dim}│   Confirmed by: ${confirmingTFs}${colors.reset}`);
            }
            
            if (index < executedWindows.length - 1) {
                console.log(`${colors.dim}│${colors.reset}`);
            }
        });
        
        console.log(`${colors.brightBlue}└${'─'.repeat(60)}${colors.reset}`);
    }
    
    // Summary
    const totalWindows = activeWindows.length + executedWindows.length;
    if (totalWindows > 0) {
        console.log(`${colors.cyan}\nWindow Summary: ${activeWindows.length} active, ${executedWindows.length} recently executed${colors.reset}`);
    } else {
        console.log(`${colors.dim}No cascade windows to display${colors.reset}`);
    }
    
    // Provide structured snapshot modes for programmatic consumption
    const snapshotStates = getWindowSnapshotStates(windowManager, currentTime);
    if (snapshotStates.length > 0) {
        console.log(`${colors.cyan}\n=== SNAPSHOT WINDOW STATES (mode, price, time) ===${colors.reset}`);
        snapshotStates.forEach(s => {
            const t = s.time ? formatDualTime(s.time) : 'N/A';
            console.log(` - ${s.id}: ${s.mode} | $${(s.price ?? 0).toFixed(2)} | ${t}`);
        });
        // Notify for EXECUTE/INVALID
        notifySnapshotStates(snapshotStates, currentTime);
    }
}

function findRecentCascades(allTimeframePivots, analysisTime, count) {
    const cascades = [];
    
    // Get primary timeframe
    const primaryTf = multiPivotConfig.timeframes.find(tf => tf.role === 'primary');
    if (!primaryTf) return cascades;
    
    const primaryPivots = allTimeframePivots[primaryTf.interval] || [];
    
    // Check each primary pivot for cascade confirmation
    for (const primaryPivot of primaryPivots) {
        if (primaryPivot.time > analysisTime) continue;
        
        const confirmations = checkCascadeConfirmation(primaryPivot, allTimeframePivots, primaryPivot.time);
        const meetsRequirements = meetsExecutionRequirements(confirmations);
        
        if (meetsRequirements) {
            // Execution time is the moment when the Nth (threshold) confirmation arrives.
            // Use max(primaryPivot.time, last confirmation time) to ensure it never precedes the primary.
            const lastConfTime = Math.max(...confirmations.map(c => c.pivot.time));
            const executionTime = Math.max(primaryPivot.time, lastConfTime);

            cascades.push({
                primaryPivot,
                confirmations,
                strength: confirmations.length,
                time: executionTime,
                executionTime
            });
        }
    }
    
    // Sort by time descending and return most recent
    return cascades
        .sort((a, b) => b.time - a.time)
        .slice(0, count);
}

// ===== MAIN SNAPSHOT FUNCTION =====
async function runImmediateAggregationSnapshot(forcedAnalysisTime = null, preloadedCandles = null) {
    const startTime = Date.now();
    
    console.log(`${colors.cyan}=== IMMEDIATE AGGREGATION SNAPSHOT ANALYZER ===${colors.reset}`);
    console.log(`${colors.yellow}Symbol: ${symbol}${colors.reset}`);
    console.log(`${colors.yellow}Detection Mode: ${pivotDetectionMode}${colors.reset}`);
    console.log(`${colors.yellow}Snapshot Mode: ${SNAPSHOT_CONFIG.currentMode ? 'CURRENT' : 'TARGET'}${colors.reset}`);
    
    // Determine requested analysis time (to anchor data loading)
    let requestedAnalysisTime = null;
    if (forcedAnalysisTime != null) {
        requestedAnalysisTime = forcedAnalysisTime;
    } else if (!SNAPSHOT_CONFIG.currentMode) {
        requestedAnalysisTime = new Date(SNAPSHOT_CONFIG.targetTime).getTime();
    }
    
    // Load data (allow reuse when provided), anchored to requested time when available
    const oneMinuteCandles = preloadedCandles ? preloadedCandles : await load1mCandles(requestedAnalysisTime);
    
    // Determine analysis timestamp
    let analysisTime;
    if (forcedAnalysisTime != null) {
        analysisTime = forcedAnalysisTime;
        console.log(`${colors.green}Analysis Time (requested): ${formatDualTime(analysisTime)}${colors.reset}`);
    } else if (SNAPSHOT_CONFIG.currentMode) {
        analysisTime = oneMinuteCandles[oneMinuteCandles.length - 1].time;
        console.log(`${colors.green}Analysis Time: LATEST CANDLE${colors.reset}`);
    } else {
        analysisTime = new Date(SNAPSHOT_CONFIG.targetTime).getTime();
        console.log(`${colors.green}Analysis Time (requested): ${SNAPSHOT_CONFIG.targetTime}${colors.reset}`);
    }
    
    // Clamp analysis time to available data range
    const firstTs = oneMinuteCandles[0]?.time;
    const lastTs = oneMinuteCandles[oneMinuteCandles.length - 1]?.time;
    if (firstTs != null && lastTs != null) {
        const clamped = Math.max(firstTs, Math.min(analysisTime, lastTs));
        if (clamped !== analysisTime) {
            // console.log(`${colors.yellow}[Time Align] Requested snapshot ${formatDualTime(analysisTime)} is outside data range ${formatDualTime(firstTs)} → ${formatDualTime(lastTs)}; clamped to ${formatDualTime(clamped)}${colors.reset}`);
            analysisTime = clamped;
        }
    }
    
    const analysisTimeFormatted = formatDualTime(analysisTime);
    console.log(`${colors.cyan}Snapshot Timestamp: ${analysisTimeFormatted}${colors.reset}`);
    
    // Find current price at analysis time: pick the last candle at or before analysisTime
    let analysisCandle = null;
    if (oneMinuteCandles.length > 0) {
        // Walk backwards to find the last candle <= analysisTime (no future contamination)
        for (let i = oneMinuteCandles.length - 1; i >= 0; i--) {
            if (oneMinuteCandles[i].time <= analysisTime) {
                analysisCandle = oneMinuteCandles[i];
                break;
            }
        }
        // If none found (analysisTime before first), choose the nearest between first and last
        if (!analysisCandle) {
            analysisCandle = oneMinuteCandles.reduce((prev, curr) =>
                (Math.abs(curr.time - analysisTime) < Math.abs(prev.time - analysisTime) ? curr : prev)
            );
        }
    }
    if (SNAPSHOT_CONFIG.showPriceDebug && analysisCandle) {
        const diffSec = Math.round(Math.abs(analysisCandle.time - analysisTime) / 1000);
        const selectionRule = (analysisCandle.time <= analysisTime) ? '<= snapshot' : 'nearest (oob)';
        // console.log(`${colors.dim}[Price Debug] Candle @ ${formatDualTime(analysisCandle.time)} (${selectionRule}, Δ${diffSec}s) | Range: ${formatDualTime(firstTs)} → ${formatDualTime(lastTs)}${colors.reset}`);
        // console.log(`${colors.dim}[Price Debug] OHLC: O=${analysisCandle.open} H=${analysisCandle.high} L=${analysisCandle.low} C=${analysisCandle.close}${colors.reset}`);
    }
    console.log(`${colors.yellow}Current Price: $${analysisCandle?.close?.toFixed(2) ?? 'N/A'}${colors.reset}`);
    
    // Initialize cascade window manager
    const windowManager = new CascadeWindowManager();
    
    // Build aggregated candles for all timeframes
    const timeframeData = {};
    const allTimeframePivots = {};
    
    if (SNAPSHOT_CONFIG.showBuildLogs) console.log(`${colors.cyan}\n=== BUILDING IMMEDIATE AGGREGATION SYSTEM ===${colors.reset}`);
    
    for (const tfConfig of multiPivotConfig.timeframes) {
        const tf = tfConfig.interval;
        const timeframeMinutes = parseTimeframeToMinutes(tf);
        
        if (SNAPSHOT_CONFIG.showBuildLogs) console.log(`${colors.cyan}[${tf}] Processing ${timeframeMinutes}-minute aggregation...${colors.reset}`);
        
        const aggregatedCandles = buildImmediateAggregatedCandles(oneMinuteCandles, timeframeMinutes);
        timeframeData[tf] = {
            candles: aggregatedCandles,
            config: tfConfig
        };
        
        if (SNAPSHOT_CONFIG.showBuildLogs) {
            const earliestAgg = aggregatedCandles[0]?.time;
            const latestAgg = aggregatedCandles[aggregatedCandles.length - 1]?.time;
            if (earliestAgg != null && latestAgg != null) {
                // console.log(`${colors.dim}[${tf}] Coverage: ${formatDualTime(earliestAgg)} → ${formatDualTime(latestAgg)} (≤ Snapshot: ${formatDualTime(analysisTime)})${colors.reset}`);
            } else {
                // console.log(`${colors.dim}[${tf}] Coverage: no complete buckets before snapshot${colors.reset}`);
            }
        }
        
        // Detect ALL pivots for this timeframe (filter by analysis time during cascade simulation)
        const pivots = [];
        let lastAcceptedPivotIndex = null;
        for (let i = tfConfig.lookback; i < aggregatedCandles.length; i++) {
            
            const pivot = detectPivot(aggregatedCandles, i, {
                pivotLookback: tfConfig.lookback,
                minSwingPct: tfConfig.minSwingPct,
                minLegBars: tfConfig.minLegBars
            });

            if (!pivot) continue;

            // Enforce minimum bars between consecutive pivots
            if (lastAcceptedPivotIndex !== null) {
                const barsSinceLast = i - lastAcceptedPivotIndex;
                if (typeof tfConfig.minLegBars === 'number' && barsSinceLast < tfConfig.minLegBars) {
                    continue;
                }
            }

            pivots.push(pivot);
            lastAcceptedPivotIndex = i;
        }
        
        allTimeframePivots[tf] = pivots;
        if (SNAPSHOT_CONFIG.showBuildLogs) console.log(`${colors.green}[${tf}] Built ${aggregatedCandles.length} candles, detected ${pivots.length} pivots${colors.reset}`);
    }
    
    if (SNAPSHOT_CONFIG.showBuildLogs) console.log(`${colors.green}✅ Immediate aggregation system built successfully${colors.reset}`);
    
    if (SNAPSHOT_CONFIG.showBuildLogs) {
        const totalPivots = Object.values(allTimeframePivots).reduce((sum, pivots) => sum + pivots.length, 0);
        console.log(`${colors.cyan}Total pivots detected across all timeframes: ${colors.yellow}${totalPivots}${colors.reset}`);
    }
    
    // Simulate cascade windows chronologically
    console.log(`${colors.cyan}\n=== SIMULATING CASCADE WINDOWS ===${colors.reset}`);
    simulateCascadeWindows(allTimeframePivots, analysisTime, windowManager);
    
    // Display recent pivot activity
    if (SNAPSHOT_CONFIG.togglePivots) {
        console.log(`${colors.cyan}\n=== RECENT PIVOT ACTIVITY ===${colors.reset}`);
        
        for (const tfConfig of multiPivotConfig.timeframes) {
            const tf = tfConfig.interval;
            const pivots = allTimeframePivots[tf] || [];
            const recentPivots = getRecentPivots(pivots, analysisTime, SNAPSHOT_CONFIG.showRecentPivots);
            
            console.log(`${colors.yellow}\n[${tf}] Recent Pivots (${recentPivots.length}/${pivots.length} total):${colors.reset}`);
            
            if (recentPivots.length === 0) {
                console.log(`  ${colors.dim}No recent pivots${colors.reset}`);
            } else {
                recentPivots.forEach((pivot, index) => {
                    const age = formatAge(pivot.time, analysisTime);
                    const timeFormatted = formatDualTime(pivot.time);
                    const signalColor = pivot.signal === 'long' ? colors.green : colors.red;
                    const typeText = pivot.type.toUpperCase();
                    const signalText = pivot.signal.toUpperCase();
                    
                    console.log(`  ${index + 1}. ${signalColor}${typeText} @ $${pivot.price.toFixed(2)} | ${signalText} | ${age}${colors.reset}`);
                    console.log(`     ${colors.dim}${timeFormatted} | Swing: ${pivot.swingPct.toFixed(2)}%${colors.reset}`);
                });
            }
        }
    }
    
    // Display cascade windows at snapshot time
    displayCascadeWindows(windowManager, analysisTime);
    
    // Display recent cascade analysis
    if (SNAPSHOT_CONFIG.toggleCascades) {
        console.log(`${colors.cyan}\n=== RECENT CASCADE ANALYSIS ===${colors.reset}`);
        
        const recentCascades = findRecentCascades(allTimeframePivots, analysisTime, SNAPSHOT_CONFIG.showRecentCascades);
        
        if (recentCascades.length === 0) {
            console.log(`${colors.dim}No recent cascades found${colors.reset}`);
        } else {
            console.log(`${colors.yellow}Found ${recentCascades.length} recent cascades:${colors.reset}`);
            
            // Reverse the array so most recent cascade shows as #1
            recentCascades.reverse().forEach((cascade, index) => {
                const age = formatAge(cascade.time, analysisTime);
                const execTimeFormatted = formatDualTime(cascade.executionTime || cascade.time);
                const primaryTimeFormatted = formatDualTime(cascade.primaryPivot.time);
                const signalColor = cascade.primaryPivot.signal === 'long' ? colors.green : colors.red;
                const signalText = cascade.primaryPivot.signal.toUpperCase();
                const confirmingTFs = cascade.confirmations.map(c => c.timeframe).join(', ');
                
                console.log(`\n${colors.green}🎯 CASCADE #${recentCascades.length - index}: ${signalColor}${signalText}${colors.reset} | Strength: ${cascade.strength} | ${age}`);
                console.log(`   ${colors.cyan}Executed: ${execTimeFormatted}${colors.reset}`);
                console.log(`   ${colors.cyan}Primary:  ${primaryTimeFormatted} | $${cascade.primaryPivot.price.toFixed(2)} | Swing: ${cascade.primaryPivot.swingPct.toFixed(2)}%${colors.reset}`);
                console.log(`   ${colors.cyan}Confirming TFs: ${confirmingTFs}${colors.reset}`);
            });
        }
    }
    
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    console.log(`${colors.cyan}\n=== SNAPSHOT ANALYSIS COMPLETE ===${colors.reset}`);
    console.log(`${colors.dim}Analysis completed in ${duration}ms${colors.reset}`);
    console.log(`${colors.green}✅ Market state snapshot captured successfully${colors.reset}`);
}

// ===== AUTO-RELOAD TIME-FORWARD DRIVER =====
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function clearConsoleRefresh() {
    try {
        if (process.stdout && process.stdout.isTTY) {
            process.stdout.write('\x1b[2J'); // Clear screen
            process.stdout.write('\x1b[3J'); // Clear scrollback
            process.stdout.write('\x1b[H');  // Move cursor to top-left
        } else {
            console.clear();
        }
    } catch {
        console.clear();
    }
}

async function runAutoReloadProgression() {
    const reloadMs = (SNAPSHOT_CONFIG.reloadInterval || 8) * 1000; // UI refresh cadence only
    // If speed is not provided, default to 60 / reloadInterval so we move exactly 1 minute per reload.
    const speed = Number.isFinite(SNAPSHOT_CONFIG.simSecondsPerWallSecond)
        ? SNAPSHOT_CONFIG.simSecondsPerWallSecond
        : (reloadMs > 0 ? (60 / (reloadMs / 1000)) : 60); // sim-sec per wall-sec
    const shouldUseAPI = SNAPSHOT_CONFIG.useLiveAPI || !useLocalData;
    const apiRefreshMs = (SNAPSHOT_CONFIG.apiRefreshSeconds ?? Math.max(1, SNAPSHOT_CONFIG.reloadInterval || 8)) * 1000;
    let lastApiFetch = 0;

    const analysisStart = new Date(SNAPSHOT_CONFIG.targetTime).getTime();
    if (Number.isNaN(analysisStart)) {
        console.error(`${colors.red}Invalid SNAPSHOT_CONFIG.targetTime: ${SNAPSHOT_CONFIG.targetTime}${colors.reset}`);
        process.exit(1);
    }

    // Simulated time state for CSV/local progression
    let simTime = analysisStart; // Start at the configured targetTime
    const stepMs = reloadMs * speed; // simulated ms advanced per reload

    // Progress indefinitely with fresh data each iteration
    while (true) {
        // Clear screen for clean updates
        clearConsoleRefresh();

        // Load fresh candles for current simTime (like manual reload)
        const currentTimeForRun = shouldUseAPI ? null : simTime;
        const oneMinuteCandles = shouldUseAPI 
            ? (Date.now() - lastApiFetch >= apiRefreshMs ? await load1mCandles() : await load1mCandles())
            : await load1mCandles(currentTimeForRun);
        
        if (shouldUseAPI) {
            lastApiFetch = Date.now();
        }

        // Calculate data range for progress display
        const firstAvailableTime = oneMinuteCandles.length > 0 ? oneMinuteCandles[0].time : simTime;
        const lastAvailableTime = oneMinuteCandles.length > 0 ? oneMinuteCandles[oneMinuteCandles.length - 1].time : simTime;

        // Show a compact progression header
        const targetTimeForRun = shouldUseAPI ? lastAvailableTime : simTime;
        const denom = Math.max(1, lastAvailableTime - firstAvailableTime);
        const progressPct = shouldUseAPI ? 100 : Math.max(0, Math.min(100, ((targetTimeForRun - firstAvailableTime) / denom) * 100));
        const speedLabel = `${(Math.round(speed * 100) / 100)}x`;
        const stepLabel = `${Math.round((reloadMs/1000) * speed)}s/step`;
        console.log(`${colors.dim}⏱ Auto-Reload ${Math.round(reloadMs/1000)}s | Speed ${speedLabel} (${stepLabel}) | Progress: ${progressPct.toFixed(1)}% | Target: ${formatDualTime(targetTimeForRun)}${colors.reset}`);
        if (SNAPSHOT_CONFIG.showPriceDebug) {
            console.log(`${colors.dim}[Time Debug] Range: ${formatDualTime(firstAvailableTime)} → ${formatDualTime(lastAvailableTime)} | simTime: ${formatDualTime(simTime)}${colors.reset}`);
        }

        // Run snapshot for this analysis time using fresh candles
        await runImmediateAggregationSnapshot(targetTimeForRun, oneMinuteCandles);

        // Advance simulated time (CSV/local) and wait until next refresh
        if (!shouldUseAPI) {
            simTime = simTime + stepMs; // Continue progressing forward in time
        }
        await sleep(reloadMs);
    }
}

// Run the analyzer
(async () => {
    try {
        if (SNAPSHOT_CONFIG.autoReload && !SNAPSHOT_CONFIG.currentMode) {
            await runAutoReloadProgression();
        } else {
            await runImmediateAggregationSnapshot();
        }
    } catch (err) {
        console.error('\nAn error occurred during snapshot analysis:', err);
        process.exit(1);
    }
})();
