// ========== SERVER CONFIGURATION ==========
const SERVER_CONFIG = {
    // Data settings
    maxCandles: 10080,          // Default: 1 week of 1m candles
    defaultTimeframe: '1h',     // Default aggregation timeframe
    
    // VWAP settings
    defaultVwapPeriod: 20,      // VWAP rolling period
    defaultBandPeriod: 20,      // Statistical band period
    
    // Chart settings
    chartWidth: 1200,
    chartHeight: 600,
    
    // Server settings
    port: 3000
};




// server.js
import express from "express";
import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";
import { ChartJSNodeCanvas } from "chartjs-node-canvas";
import { fileURLToPath } from 'url';

// Import your existing system components
import { symbol, useLocalData } from '../config/config.js';
import { getCandles } from '../apis/bybit.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


// ========== VWAP Deviation+ Functions ==========

// RSI
function rsi(prices, length = 14) {
  const out = Array(prices.length).fill(null);
  if (prices.length < length + 1) return out;

  let gain = 0, loss = 0;
  for (let i = 1; i <= length; i++) {
    const ch = prices[i] - prices[i - 1];
    if (ch >= 0) gain += ch; else loss -= ch;
  }
  let avgGain = gain / length;
  let avgLoss = loss / length;
  out[length] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = length + 1; i < prices.length; i++) {
    const ch = prices[i] - prices[i - 1];
    const g = ch > 0 ? ch : 0;
    const l = ch < 0 ? -ch : 0;
    avgGain = (avgGain * (length - 1) + g) / length;
    avgLoss = (avgLoss * (length - 1) + l) / length;
    const rs = avgLoss === 0 ? Infinity : avgGain / avgLoss;
    out[i] = 100 - 100 / (1 + rs);
  }
  return out;
}

// Rolling VWAP
function rollingVWAP(candles, length = 60) {
  const out = Array(candles.length).fill(null);
  let pvSum = 0, vSum = 0;
  const queue = [];

  for (let i = 0; i < candles.length; i++) {
    const p = candles[i].close;
    const v = candles[i].volume;
    const pv = p * v;

    pvSum += pv;
    vSum += v;
    queue.push({ pv, v });

    if (queue.length > length) {
      const { pv: oldPv, v: oldV } = queue.shift();
      pvSum -= oldPv;
      vSum -= oldV;
    }

    if (queue.length === length && vSum > 0) {
      out[i] = pvSum / vSum;
    }
  }
  return out;
}

// Bands
function computeBands(prices, vwapArr, length, mult, logSpace = true) {
  const hi = Array(prices.length).fill(null);
  const lo = Array(prices.length).fill(null);

  for (let i = length - 1; i < prices.length; i++) {
    const win = prices.slice(i - length + 1, i + 1);
    if (logSpace) {
      const logs = win.map(Math.log);
      const mean = logs.reduce((a, b) => a + b, 0) / logs.length;
      const sd = Math.sqrt(logs.reduce((a, b) => a + (b - mean) ** 2, 0) / logs.length);
      hi[i] = Math.exp(Math.log(vwapArr[i]) + mult * sd);
      lo[i] = Math.exp(Math.log(vwapArr[i]) - mult * sd);
    } else {
      const mean = win.reduce((a, b) => a + b, 0) / win.length;
      const sd = Math.sqrt(win.reduce((a, b) => a + (b - mean) ** 2, 0) / win.length);
      hi[i] = vwapArr[i] + mult * sd;
      lo[i] = vwapArr[i] - mult * sd;
    }
  }
  return { hi, lo };
}

// ========== Data Load (Using Backtester System) ==========
async function load1mCandles(maxCandles = SERVER_CONFIG.maxCandles) {
    console.log('Loading 1m candles using backtester system...');
    
    if (!useLocalData) {
        // Use live API data
        const candles = await getCandles(symbol, '1m', maxCandles);
        console.log(`Loaded ${candles.length} 1m candles from API`);
        return candles.sort((a, b) => a.time - b.time);
    } else {
        // Use local CSV data
        const csvPath = path.join(__dirname, '..', 'data', 'historical', symbol, '1m.csv');
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
        
        const limitedCandles = candles.slice(-maxCandles);
        console.log(`Loaded ${limitedCandles.length} 1m candles from CSV`);
        return limitedCandles;
    }
}

// ========== Immediate Aggregation System ==========
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

// ========== Chart Renderer ==========
async function makeChart(candles, vwap, band2, band3) {
  const width = SERVER_CONFIG.chartWidth, height = SERVER_CONFIG.chartHeight;
  const chartJSNodeCanvas = new ChartJSNodeCanvas({ width, height });

  const config = {
    type: "line",
    data: {
      labels: candles.map(c => new Date(c.time).toISOString().slice(5,16)), // month-day hour
      datasets: [
        { label: "Close", data: candles.map(c => c.close), borderColor: "black", borderWidth: 1, fill: false },
        { label: "VWAP", data: vwap, borderColor: "blue", borderWidth: 2, fill: false },
        { label: "2σ Upper", data: band2.hi, borderColor: "green", borderDash: [5,5], fill: false },
        { label: "2σ Lower", data: band2.lo, borderColor: "green", borderDash: [5,5], fill: false },
        { label: "3σ Upper", data: band3.hi, borderColor: "red", borderDash: [5,5], fill: false },
        { label: "3σ Lower", data: band3.lo, borderColor: "red", borderDash: [5,5], fill: false },
      ]
    },
    options: {
      responsive: false,
      plugins: {
        legend: { position: "top" },
        title: { display: true, text: "VWAP Deviation+ (Node.js)" }
      },
      scales: { x: { display: true }, y: { display: true } }
    }
  };

  return chartJSNodeCanvas.renderToBuffer(config);
}

// ========== Express App ==========
const app = express();

app.get("/", async (req, res) => {
  try {
    // Load 1m candles using backtester system
    const oneMinCandles = await load1mCandles(SERVER_CONFIG.maxCandles);
    
    // Get timeframe from query parameter (default from config)
    const timeframeParam = req.query.timeframe || SERVER_CONFIG.defaultTimeframe;
    const timeframeMinutes = parseInt(timeframeParam.replace('m', '')) || 5;
    
    // Build aggregated candles using immediate aggregation
    const candles = buildImmediateAggregatedCandles(oneMinCandles, timeframeMinutes);
    
    if (candles.length === 0) {
      return res.send(`
        <h2>VWAP Deviation+ (Node.js)</h2>
        <p style="color: red;">No complete ${timeframeParam} candles available. Try a smaller timeframe.</p>
      `);
    }
    
    const closes = candles.map(c => c.close);

    // Use config periods or adaptive periods for aggregated data
    const vwapPeriod = Math.min(SERVER_CONFIG.defaultVwapPeriod, Math.floor(candles.length / 3));
    const bandPeriod = Math.min(SERVER_CONFIG.defaultBandPeriod, Math.floor(candles.length / 3));
    
    const vwap = rollingVWAP(candles, vwapPeriod);
    const band2 = computeBands(closes, vwap, bandPeriod, 2, true);
    const band3 = computeBands(closes, vwap, bandPeriod, 3, true);
    const rsiVals = rsi(closes, 14);

    // Latest info
    const latest = {
      time: new Date(candles.at(-1).time),
      close: candles.at(-1).close,
      vwap: vwap.at(-1),
      rsi: rsiVals.at(-1),
    };

    const img = await makeChart(candles, vwap, band2, band3);
    const base64 = img.toString("base64");

    res.send(`
      <h2>VWAP Deviation+ (Node.js) - ${symbol}</h2>
      <p><b>Timeframe:</b> ${timeframeParam} | <b>Candles:</b> ${candles.length} | <b>Data Source:</b> ${useLocalData ? 'CSV' : 'Live API'}</p>
      <p><b>Latest Close:</b> $${latest.close?.toFixed(2)} |
         <b>VWAP:</b> $${latest.vwap?.toFixed(2)} | 
         <b>RSI:</b> ${latest.rsi?.toFixed(2)}</p>
      <p><b>VWAP Period:</b> ${vwapPeriod} | <b>Band Period:</b> ${bandPeriod}</p>
      <p><a href="?timeframe=1m">1m</a> | <a href="?timeframe=5m">5m</a> | <a href="?timeframe=15m">15m</a> | <a href="?timeframe=1h">1h</a></p>
      <img src="data:image/png;base64,${base64}" />
    `);
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).send(`
      <h2>VWAP Deviation+ Error</h2>
      <p style="color: red;">Error: ${error.message}</p>
      <p>Make sure your data files exist or API is accessible.</p>
    `);
  }
});

app.listen(SERVER_CONFIG.port, () => console.log(`Server running on http://localhost:${SERVER_CONFIG.port}`));
