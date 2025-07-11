// bybit.js
// Use global axios in browser, import in Node.js
const axiosInstance = (typeof window !== 'undefined') ? window.axios : (await import('axios')).default;

const BASE_URL = 'https://api.bybit.com/v5';

/**
 * Fetch historical OHLCV candle data from Bybit.
 * @param {string} symbol - e.g. 'BNBUSDT'
 * @param {string} interval - e.g. '1', '3', '5', '15', '30', '60', '120', '240', '360', '720', 'D', 'M', 'W'
 * @param {number} limit - max candles (max 1000 per request)
 * @returns {Promise<Array>} - Array of candles (time, open, high, low, close, volume)
 */
export async function getCandles(symbol = 'BNBUSDT', interval = '1', limit = 100, customEndTime = null) {
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

      // Bybit returns newest first, so we need to reverse the array
      const candles = response.data.result.list.reverse().map(c => ({
        time: parseInt(c[0]),
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
