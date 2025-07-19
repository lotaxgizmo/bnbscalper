// bybit.js
// Use global axios in browser, import in Node.js
const axiosInstance = (typeof window !== 'undefined') ? window.axios : (await import('axios')).default;

// Only import Node.js specific modules when not in browser
let fs, path;
const isNode = typeof window === 'undefined';
if (isNode) {
    fs = await import('fs');
    path = await import('path');
}

import { useLocalData } from '../config/config.js';
import { historicalDataConfig } from '../config/historicalDataConfig.js';

const BASE_URL = 'https://api.bybit.com/v5';

/**
 * Fetch historical OHLCV candle data from Bybit.
 * @param {string} symbol - e.g. 'BNBUSDT'
 * @param {string} interval - e.g. '1', '3', '5', '15', '30', '60', '120', '240', '360', '720', 'D', 'M', 'W'
 * @param {number} limit - max candles (max 1000 per request)
 * @returns {Promise<Array>} - Array of candles (time, open, high, low, close, volume)
 */
// Read candles from local CSV file
function readLocalCandles(symbol, interval, limit = 100, customEndTime = null) {
  if (!isNode) {
    console.warn('Local data reading is not supported in browser environment');
    return [];
  }

  try {
    const filePath = path.join(historicalDataConfig.dataPath, symbol, `${interval}.csv`);
    
    if (!fs.existsSync(filePath)) {
      console.error(`No local data found for ${symbol} - ${interval}`);
      return [];
    }

    const fileContent = fs.readFileSync(filePath, 'utf8');
    const lines = fileContent.split('\n').filter(line => line.trim());
    
    // Remove header
    lines.shift();

    // Convert CSV lines to candle objects
    let candles = lines.map(line => {
      const [time, open, high, low, close, volume] = line.split(',');
      return {
        time: parseInt(time),
        open: parseFloat(open),
        high: parseFloat(high),
        low: parseFloat(low),
        close: parseFloat(close),
        volume: parseFloat(volume)
      };
    });

    // Filter by customEndTime if provided
    if (customEndTime) {
      candles = candles.filter(c => c.time <= customEndTime);
    }

    // Return only the requested number of candles
    return candles.slice(-limit);

  } catch (error) {
    console.error(`Error reading local data for ${symbol} - ${interval}:`, error.message);
    return [];
  }
}

// Helper to check if we're using local data
export function isUsingLocalData() {
  return useLocalData && isNode;
}

export async function getCandles(symbol = 'BNBUSDT', interval = '1', limit = 100, customEndTime = null) {
  // Convert interval to format used in CSV files (e.g., '1' to '1m')
  const csvInterval = interval.endsWith('m') ? interval : `${interval}m`;

  // If using local data, try to read from CSV first
  if (isUsingLocalData()) {
    const localCandles = readLocalCandles(symbol, csvInterval, limit, customEndTime);
    if (localCandles.length > 0) {
      // Sort by time ascending for consistency
      localCandles.sort((a, b) => a.time - b.time);
      return localCandles;
    }
  }

  // Fallback to API if local data is not available or not used
  try {
    const allCandles = [];
    let remainingLimit = limit;
    let endTime = customEndTime || Date.now();

    // Convert interval to Bybit format
    const intervalMap = {
      '1m': '1',
      '3m': '3',
      '5m': '5',
      '15m': '15',
      '30m': '30',
      '1h': '60',
      '2h': '120',
      '4h': '240',
      '6h': '360',
      '12h': '720',
      '1d': 'D',
      '1M': 'M',
      '1w': 'W'
    };

    const bybitInterval = intervalMap[interval] || interval;

    while (remainingLimit > 0) {
      const batchLimit = Math.min(remainingLimit, 1000);
      const response = await axiosInstance.get(`${BASE_URL}/market/kline`, {
        params: {
          category: 'linear',
          symbol,
          interval: bybitInterval,
          limit: batchLimit,
          end: endTime
        }
      });

      if (!response.data?.result?.list || response.data.result.list.length === 0) break;

      if (!response?.data?.result?.list) {
        console.error('Invalid response from Bybit API');
        return [];
      }

      // Bybit returns newest first, so we need to reverse the array
      const candles = response.data.result.list.reverse().map(c => ({
        time: parseInt(c[0]), // Bybit API returns timestamps in milliseconds already
        open: parseFloat(parseFloat(c[1]).toFixed(4)),
        high: parseFloat(parseFloat(c[2]).toFixed(4)),
        low: parseFloat(parseFloat(c[3]).toFixed(4)),
        close: parseFloat(parseFloat(c[4]).toFixed(4)),
        volume: parseFloat(parseFloat(c[5]).toFixed(4))
      }));

      allCandles.push(...candles);
      remainingLimit -= candles.length;

      if (candles.length < batchLimit) break;

      // Set endTime to the oldest candle's time minus 1ms
      endTime = candles[0].time - 1;
    }

    return allCandles;
  } catch (error) {
    console.error('Error fetching candles from Bybit:', error.message);
    return [];
  }
}
