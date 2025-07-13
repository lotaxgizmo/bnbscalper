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
export const limit = 120;

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
export const renkoBlockSize = 1.3; // Size of each Renko block in USDT

// Display settings
export const showFullTimePeriod = true; // if false, only shows hours and minutes

// Percentiles for volatility classification
export const mediumPercentile = 0.85; // 85th percentile
export const highPercentile = 0.93;   // 93rd percentile 
export const lowPercentile = 0.10;    // 10th percentile
export const topPercentile = 0.9955;

export const pricePercentile = 0;

// export const lowPercentile = 0.2;