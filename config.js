// config.js

// API settings
export const api = 'bybit'; // 'binance' or 'bybit'
// export const api = 'binance'; // 'binance' or 'bybit'
export const time = '1m';
export const symbol = 'BNBUSDT';

// candle limit below

const weeklimit = 1;
const daylimit = weeklimit * 7;
// const daylimit = 1;
const hourlimit = daylimit * 24;

// export const limit = hourlimit;
export const limit = 1440;

// delay below
// Limit being 49.1 months
const month = 0;
const day = 0;
const hour =0;
const minute = 0;

const months = month;
const days = month * 30 + day;
const hours = days * 24 + hour;
const minutes = hours * 60 + minute;
export const delay = minutes;

// Renko chart configuration
export const renkoBlockSize = 1; // Size of each Renko block in USDT

// Display settings
export const showFullTimePeriod = true; // if false, only shows hours and minutes

// Percentiles for volatility classification
export const mediumPercentile = 0.85; // 85th percentile
export const highPercentile = 0.93;   // 93rd percentile 
export const lowPercentile = 0.10;    // 10th percentile
export const topPercentile = 0.9955;

export const pricePercentile = 0;

// export const lowPercentile = 0.2;



export const minSwingPct    = 0.1;   // minimum % move to mark a pivot
export const shortWindow    = 4;     // number of recent swings to average
export const longWindow     = 50;    // number of swings for background volatility
export const confirmOnClose = true;  // only confirm pivots on candle-close

// New setting: ignore any pivot that took fewer than this many candles
export const minLegBars = 3;     // e.g. require at least 3 candles per swing