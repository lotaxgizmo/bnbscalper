// oneMinutePivotScout.js
// Ultra-fast 1m pivot scout for immediate limit order ideas
// Detects provisional (instant) and confirmed (1-bar stall) pivots based on a min swing threshold.

import { symbol, useLocalData, pivotDetectionMode } from './config/config.js';
import { getCandles } from './apis/bybit.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
};

// Scout configuration
const SCOUT = {
  maxCandles: 5000,         // recent 1m history to analyze
  thresholdPct: 0.2,        // minimum swing to qualify as a pivot (percent)
  confirmWithStall: true,   // require 1-bar stall for confirmed pivots
  emitProvisional: true,    // also emit instant provisional pivots as soon as threshold is hit
  // Suggested limit placement relative to pivot extreme
  limitOffsetPct: 0.2,      // 0.3% away from pivot extreme
  showLastN: 20,            // show only the most recent N pivots in summary
};

function formatDualTime(ts) {
  const d = new Date(ts);
  const dateStr = d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
  const t12 = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
  const t24 = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  return `${dateStr} ${t12} | ${t24}`;
}

async function load1mCandles(max) {
  const shouldUseAPI = !useLocalData; // follow project convention
  if (!shouldUseAPI) {
    const csvPath = path.join(__dirname, 'data', 'historical', symbol, '1m.csv');
    if (!fs.existsSync(csvPath)) {
      throw new Error(`Local 1m data not found: ${csvPath}`);
    }
    const csvData = fs.readFileSync(csvPath, 'utf8');
    const lines = csvData.trim().split('\n').slice(1);
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
    return candles.slice(-max);
  }
  const candles = await getCandles(symbol, '1m', max);
  return candles.sort((a, b) => a.time - b.time);
}

// Compute the instantaneous swing vs previous close using CLOSE prices only
function swingUpPct(currClose, prevClose) {
  return ((currClose - prevClose) / prevClose) * 100;
}
function swingDownPct(currClose, prevClose) {
  return ((prevClose - currClose) / prevClose) * 100;
}

// Detect ASAP pivots on 1m
// - Provisional high pivot at i: swingUpPct(high[i], close[i-1]) >= threshold
// - Confirmed high pivot: at i+1, high[i+1] <= high[i]
// Mirror logic for lows using swingDownPct
function detectAsapPivots(candles, thresholdPct, confirmWithStall, emitProvisional) {
  const pivots = []; // {type:'high'|'low', status:'provisional'|'confirmed', time, price, pivotIndex, swingPct, limitPrice}

  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1];
    const cur = candles[i];

    const up = swingUpPct(cur.close, prev.close);
    const down = swingDownPct(cur.close, prev.close);

    // HIGH provisional (close-to-close)
    if (emitProvisional && up >= thresholdPct) {
      const limitPrice = cur.close * (1 - (SCOUT.limitOffsetPct / 100));
      pivots.push({
        type: 'high',
        status: 'provisional',
        time: cur.time,
        price: cur.close,
        pivotIndex: i,
        swingPct: up,
        limitPrice,
      });
    }

    // LOW provisional (close-to-close)
    if (emitProvisional && down >= thresholdPct) {
      const limitPrice = cur.close * (1 + (SCOUT.limitOffsetPct / 100));
      pivots.push({
        type: 'low',
        status: 'provisional',
        time: cur.time,
        price: cur.close,
        pivotIndex: i,
        swingPct: down,
        limitPrice,
      });
    }

    // Confirmations require seeing i+1
    if (confirmWithStall && i + 1 < candles.length) {
      const nxt = candles[i + 1];

      // HIGH confirmed if next close does not exceed current close
      if (up >= thresholdPct && nxt.close <= cur.close) {
        const limitPrice = cur.close * (1 - (SCOUT.limitOffsetPct / 100));
        pivots.push({
          type: 'high',
          status: 'confirmed',
          time: nxt.time, // confirmation time at close of the stall bar
          price: cur.close,
          pivotIndex: i,
          swingPct: up,
          limitPrice,
        });
      }

      // LOW confirmed if next close does not go below current close
      if (down >= thresholdPct && nxt.close >= cur.close) {
        const limitPrice = cur.close * (1 + (SCOUT.limitOffsetPct / 100));
        pivots.push({
          type: 'low',
          status: 'confirmed',
          time: nxt.time,
          price: cur.close,
          pivotIndex: i,
          swingPct: down,
          limitPrice,
        });
      }
    }
  }

  return pivots;
}

function printPivot(p) {
  const t = formatDualTime(p.time);
  const dir = p.type.toUpperCase();
  const st = p.status === 'confirmed' ? `${colors.green}CONFIRMED${colors.reset}` : `${colors.yellow}PROVISIONAL${colors.reset}`;
  const limTxt = p.type === 'high' ? `Buy limit ≈ ${p.limitPrice.toFixed(2)} (−${SCOUT.limitOffsetPct}%)`
                                   : `Sell limit ≈ ${p.limitPrice.toFixed(2)} (+${SCOUT.limitOffsetPct}%)`;
  console.log(`${colors.magenta}[1m] ${dir} PIVOT ${st}${colors.reset} @ ${p.price.toFixed(2)} | ${t} | Swing(close→close): ${p.swingPct.toFixed(3)}% | ${limTxt}`);
}

async function main() {
  console.log(`${colors.cyan}=== 1-MINUTE PIVOT SCOUT ===${colors.reset}`);
  console.log(`${colors.yellow}Symbol: ${symbol}${colors.reset}`);
  console.log(`${colors.yellow}Mode: ${pivotDetectionMode} (only used elsewhere; scout uses prev-close baseline)${colors.reset}`);
  console.log(`${colors.yellow}Threshold: ${SCOUT.thresholdPct}% | Confirm with stall: ${SCOUT.confirmWithStall} | Emit provisional: ${SCOUT.emitProvisional}${colors.reset}`);

  const candles = await load1mCandles(SCOUT.maxCandles);
  console.log(`${colors.green}Loaded ${candles.length} 1m candles${colors.reset}`);

  const pivots = detectAsapPivots(
    candles,
    SCOUT.thresholdPct,
    SCOUT.confirmWithStall,
    SCOUT.emitProvisional
  );

  if (pivots.length === 0) {
    console.log(`${colors.dim}No pivots detected with threshold ${SCOUT.thresholdPct}%${colors.reset}`);
    return;
  }

  // Show only the most recent N for brevity
  const recent = pivots.slice(-SCOUT.showLastN);
  console.log(`${colors.cyan}\n--- Recent ${recent.length} pivots ---${colors.reset}`);
  recent.forEach(printPivot);

  // Also show the very latest confirmed or provisional
  const latestConfirmed = [...pivots].reverse().find(p => p.status === 'confirmed');
  if (latestConfirmed) {
    console.log(`\n${colors.green}Latest CONFIRMED:${colors.reset}`);
    printPivot(latestConfirmed);
  }
  const latestProvisional = [...pivots].reverse().find(p => p.status === 'provisional');
  if (latestProvisional) {
    console.log(`\n${colors.yellow}Latest PROVISIONAL:${colors.reset}`);
    printPivot(latestProvisional);
  }
}

(async () => {
  try {
    await main();
  } catch (err) {
    console.error('Error in 1m pivot scout:', err);
    process.exit(1);
  }
})();
