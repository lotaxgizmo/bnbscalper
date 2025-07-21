// Shared candle fetching and processing utilities
import { getCandles as getBinanceCandles } from '../apis/binance.js';
import { getCandles as getBybitCandles } from '../apis/bybit.js';
import { colors } from './formatters.js';

// Get the appropriate candle fetching function based on API
export const getCandles = (api) => {
  return api === 'binance' ? getBinanceCandles : getBybitCandles;
};

// Paginated fetch to respect API limits and ensure we get exactly `limit` candles
export async function fetchCandles(symbol, interval, limit, api, delay = 0) {
  const rawGetCandles = getCandles(api);
  
  // When using local data, fetch all at once with no batch limit
  if (typeof rawGetCandles.isUsingLocalData === 'function' && rawGetCandles.isUsingLocalData()) {
    console.log(`Fetching ${limit} candles from local data...`);
    const result = await rawGetCandles(symbol, interval, limit);
    console.log(`Successfully read ${result.length} candles from local data`);
    return result;
  }

  // For API calls, use batching
  console.log('Using API with batching...');
  const maxPerBatch = 500; // common API cap
  let all = [];
  let fetchSince = null;
  
  // Apply delay if configured (only for API calls)
  if (delay > 0) {
    const intervalMs = parseIntervalMs(interval);
    fetchSince = Date.now() - (delay * intervalMs);
  }

  while (all.length < limit) {
    const batchLimit = Math.min(maxPerBatch, limit - all.length);
    const batch = await rawGetCandles(symbol, interval, batchLimit, fetchSince);
    if (!batch.length) break;

    // ensure ascending
    if (batch[0].time > batch[batch.length-1].time) batch.reverse();

    if (!all.length) {
      all = batch;
    } else {
      // avoid overlap at edges
      const oldestTime = all[0].time;
      const newCandles = batch.filter(c => c.time < oldestTime);
      all = newCandles.concat(all);
    }

    fetchSince = all[0].time - 1; // get earlier candles next
  }

  // trim to exactly `limit`
  return all.slice(-limit);
}

// Parse interval (e.g. "1m","1h","1d") to ms
export function parseIntervalMs(interval) {
  const m = interval.match(/(\d+)([mhd])/);
  if (!m) return 60_000;
  const v = +m[1], u = m[2];
  if (u === 'm') return v * 60_000;
  if (u === 'h') return v * 3_600_000;
  if (u === 'd') return v * 86_400_000;
  return 60_000;
}

// Format Date to "Day YYYY-MM-DD hh:mm:ss AM/PM"
export function formatDateTime(dt) {
  // Handle timestamps that are already in milliseconds
  if (typeof dt === 'number') {
    dt = new Date(dt); // Already in milliseconds
  } else if (typeof dt === 'string') {
    dt = new Date(parseInt(dt)); // Already in milliseconds
  } else if (!(dt instanceof Date)) {
    return 'Invalid Date';
  }
  
  // Ensure we have a valid date
  if (isNaN(dt.getTime())) {
    return 'Invalid Date';
  }
  
  const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const pad = n=>n.toString().padStart(2,'0');
  const dayName = days[dt.getDay()];
  let h = dt.getHours(), ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${dayName} ${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())} ` +
         `${pad(h)}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())} ${ampm}`;
}
