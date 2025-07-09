// binance.js
// Use global axios in browser, import in Node.js
const axiosInstance = (typeof window !== 'undefined') ? window.axios : (await import('axios')).default;

const BASE_URL = 'https://api.binance.com/api/v3';

/**
 * Fetch historical OHLCV candle data from Binance.
 * @param {string} symbol - e.g. 'BNBUSDT'
 * @param {string} interval - e.g. '1s', '1m', '5m', '15m', '1h', '1d'
 * @param {number} limit - max candles
 * @returns {Promise<Array>} - Array of candles (time, open, high, low, close, volume)
 */
export async function getCandles(symbol = 'BNBUSDT', interval = '1m', limit = 100) {
  try {
    const allCandles = [];
    let remainingLimit = limit;
    let endTime = Date.now();

    while (remainingLimit > 0) {
      const batchLimit = Math.min(remainingLimit, 1000);
      const response = await axiosInstance.get(`${BASE_URL}/klines`, {
        params: {
          symbol,
          interval,
          limit: batchLimit,
          endTime
        }
      });

      if (response.data.length === 0) break;

      const candles = response.data.map(c => ({
        time: c[0],
        open: parseFloat(parseFloat(c[1]).toFixed(2)),
        high: parseFloat(parseFloat(c[2]).toFixed(2)),
        low: parseFloat(parseFloat(c[3]).toFixed(2)),
        close: parseFloat(parseFloat(c[4]).toFixed(2)),
        volume: parseFloat(parseFloat(c[5]).toFixed(2))
      }));

      allCandles.unshift(...candles);
      remainingLimit -= candles.length;

      if (candles.length < batchLimit) break;

      // Set endTime to the oldest candle's time minus 1ms
      endTime = candles[0].time - 1;
    }

    return allCandles;
  } catch (error) {
    console.error('Error fetching candles:', error.message);
    return [];
  }
}
