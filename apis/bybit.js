// bybit.js
// Use global axios in browser, import in Node.js
const axiosInstance = (typeof window !== 'undefined') ? window.axios : (await import('axios')).default;

// Only import Node.js specific modules when not in browser
let fs, path, fileURLToPath;
const isNode = typeof window === 'undefined';
if (isNode) {
    fs = await import('fs');
    path = await import('path');
    ({ fileURLToPath } = await import('url'));
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
async function readLocalCandles(symbol, interval, limit = 100, customEndTime = null) {
  if (!isNode) {
    console.warn('Local data reading is not supported in browser environment');
    return [];
  }

  try {
                const __dirname = path.dirname(fileURLToPath(import.meta.url));
        const filePath = path.join(__dirname, '..', 'data', 'historical', symbol, `${interval}.csv`);
    
    if (!fs.existsSync(filePath)) {
      console.error(`No local data found for ${symbol} - ${interval}`);
      return [];
    }

    // Read file content in one go for better performance
    const fileContent = fs.readFileSync(filePath, 'utf8');
    const lines = fileContent.split('\n');

    // Skip header and process lines from newest to oldest
    const allCandles = [];
    for (let i = lines.length - 1; i > 0; i--) {
      const line = lines[i].trim();
      if (!line) continue;

      const [time, open, high, low, close, volume] = line.split(',').map(parseFloat);
      if (isNaN(time)) continue;

      // Skip candles after customEndTime if provided
      if (customEndTime && time > customEndTime) continue;

      allCandles.push({
        time: time,
        open: open,
        high: high,
        low: low,
        close: close,
        volume: volume
      });


    }

    // Sort by time ascending for consistency
    allCandles.sort((a, b) => a.time - b.time);

    // Apply the limit to return only the most recent candles
    const limitedCandles = allCandles.slice(-limit);

    console.log(`Loaded ${limitedCandles.length} of ${allCandles.length} available local candles (limit: ${limit}).`);
    return limitedCandles;

  } catch (error) {
    console.error('Error reading local candles:', error);
    return [];
  }
}

// Helper to check if we're using local data
export function isUsingLocalData() {
  return useLocalData === true && isNode === true;
}

// Attach isUsingLocalData to getCandles for candleAnalytics.js to use
getCandles.isUsingLocalData = isUsingLocalData;

export async function getCandles(symbol = 'BNBUSDT', interval = '1', limit = 100, customEndTime = null, forceLocal = false) {
  // Convert interval to format used in CSV files (e.g., '1' to '1m')
  const csvInterval = interval.endsWith('m') ? interval : `${interval}m`;

  // If using local data or forced to use local, only use local CSV
  if (forceLocal || isUsingLocalData()) {
    return await readLocalCandles(symbol, csvInterval, limit, customEndTime);
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
