// binance.js
import axios from 'axios';

const BASE_URL = 'https://api.binance.com/api/v3';

/**
 * Fetch historical OHLCV candle data from Binance.
 * @param {string} symbol - e.g. 'BNBUSDT'
 * @param {string} interval - e.g. '1s', '1m', '5m', '15m', '1h', '1d'
 * @param {number} limit - max 1000 candles
 * @returns {Promise<Array>} - Array of candles (time, open, high, low, close, volume)
 */
export async function getCandles(symbol = 'BNBUSDT', interval = '1m', limit = 100) {
  try {
    const response = await axios.get(`${BASE_URL}/klines`, {
      params: { symbol, interval, limit }
    });

    return response.data.map(c => ({
      time: c[0],            // Unix timestamp in ms
      open: parseFloat(c[1]),
      high: parseFloat(c[2]),
      low: parseFloat(c[3]),
      close: parseFloat(c[4]),
      volume: parseFloat(c[5])
    }));
  } catch (error) {
    console.error('Error fetching candles:', error.message);
    return [];
  }
}
