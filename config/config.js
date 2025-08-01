// config.js

// Data source settings
export const useLocalData = true;  // Force API data fetching

// API settings
export const api = 'bybit'; // 'binance' or 'bybit'
// export const api = 'binance'; // 'binance' or 'bybit'
export const time = '1m';
export const symbol = 'BTCUSDT';

// candle limit below

const weeklimit = 4;
const daylimit = weeklimit * 7;
// const daylimit = 7;
const hourlimit = daylimit * 24;
const minlimit = hourlimit * 60;
 
export const limit = minlimit;
// export const limit = 110;

// delay below
// Limit being 49.1 months
const month = 0;
const day = 0;
const hour =0;
const minute = 0;

const months = month;
const days = months * 30 + day;
const hours = days * 24 + hour;
const minutes = hours * 60 + minute;
export const delay = minutes;

// Renko chart configuration
export const renkoBlockSize = 100; // Size of each Renko block in USDT

// Display settings
export const showFullTimePeriod = true; // if false, only shows hours and minutes

// Percentiles for volatility classification
export const mediumPercentile = 0.85; // 85th percentile
export const highPercentile = 0.93;   // 93rd percentile 
export const lowPercentile = 0.10;    // 10th percentile
export const topPercentile = 0.9955;

export const pricePercentile = 0;

// export const lowPercentile = 0.2;



export const minSwingPct    = 0.4;   // minimum % move to mark a pivot
export const shortWindow    = 6;     // number of recent swings to average
export const longWindow     = 50;    // number of swings for background volatility
export const confirmOnClose = true;  // only confirm pivots on candle-close

// New setting: ignore any pivot that took fewer than this many candles
export const minLegBars = 3;     // e.g. require at least 3 candles per swing

// New setting: number of candles to look back on each side for pivot confirmation
export const pivotLookback = 3;  // 1 = 3-candle pattern, 2 = 5-candle pattern

// Percentage of average swing size to use as threshold (100 = use exact average)
export const averageSwingThresholdPct = 100;   // e.g. 50 = half of average, 200 = double

// Whether to show detailed information about trades that pass the threshold
export const showThresholdTrades = true;
export const logCandlesInStreamer = true; // Toggle to show/hide individual candle logs in the historical streamer

// Edge proximity settings
export const edgeProximityEnabled = false;  // Enable/disable edge proximity check
export const edgeProximityThreshold = 0;   // Percentage of average daily edge to trigger action (e.g. 90 = 90%)
export const edgeProximityAction = 'noTrade'; // Action to take: 'noTrade' or 'reverseTrade'