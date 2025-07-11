// config.js

// API settings
export const api = 'bybit'; // 'binance' or 'bybit'
// export const api = 'binance'; // 'binance' or 'bybit'
export const time = '1m';
export const symbol = 'BNBUSDT';
// export const limit = 10080;
export const limit = 1440;

const hours = 0;
const minutes = hours * 60;
export const delay = minutes;





// Display settings
export const showFullTimePeriod = true; // if false, only shows hours and minutes

// Percentiles for volatility classification
export const mediumPercentile = 0.85; // 85th percentile
export const highPercentile = 0.93;   // 93rd percentile 
export const lowPercentile = 0.10;    // 10th percentile
export const topPercentile = 0.9955;

export const pricePercentile = 0.9955;

// export const lowPercentile = 0.2;


