// Market Data Utilities
import { publicRequest } from '../../bybitClient.js';

/**
 * Get current market price for a symbol
 */
export async function getMarketPrice(symbol) {
  const res = await publicRequest('/v5/market/tickers', 'GET', {
    category: 'linear',
    symbol,
  });
  return parseFloat(res.result.list[0].lastPrice);
}

/**
 * Get instrument information (qtyStep, minOrderQty, etc.)
 */
export async function getInstrumentInfo(symbol) {
  const res = await publicRequest('/v5/market/instruments-info', 'GET', {
    category: 'linear',
    symbol,
  });

  if (!res.result.list || res.result.list.length === 0) {
    throw new Error(`No instrument info for ${symbol}`);
  }

  const info = res.result.list[0];
  const qtyStep = parseFloat(info.lotSizeFilter.qtyStep);
  const minOrderQty = parseFloat(info.lotSizeFilter.minOrderQty);

  return { qtyStep, minOrderQty, info };
}
