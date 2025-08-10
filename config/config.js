// config.js

// Data source settings
export const useLocalData = true; // true = use CSV files, false = use live API data fetching
export const useEdges = false;    // Use pre-computed edge data; if false, use standard CSV candles

// API settings
export const api = 'bybit'; // 'binance' or 'bybit'
// export const api = 'binance'; // 'binance' or 'bybit'
export const time = '1m';
export const symbol = 'BTCUSDT';

// Timezone settings
// Set the IANA timezone to use for parsing input times and formatting outputs
// Examples: 'UTC', 'America/New_York', 'Europe/London', 'Africa/Lagos', 'Asia/Dubai'
export const timezone = 'Africa/Lagos';

// candle limit below

// Helper function to convert interval string to number of candles per time period
const getIntervalMultiplier = (intervalStr) => {
    // Parse the interval string to get the unit and value
    const unit = intervalStr.slice(-1);
    const value = parseInt(intervalStr.slice(0, -1)) || 1;
    
    // Calculate how many candles represent each time unit based on the interval
    switch(unit) {
        case 'm': // minutes
            return {
                perHour: 60 / value,
                perDay: (24 * 60) / value,
                perWeek: (7 * 24 * 60) / value,
                perMonth: (30 * 24 * 60) / value
            };
        case 'h': // hours
            return {
                perHour: 1 / value,
                perDay: 24 / value,
                perWeek: (7 * 24) / value,
                perMonth: (30 * 24) / value
            };
        case 'd': // days
            return {
                perHour: 1 / (value * 24),
                perDay: 1 / value,
                perWeek: 7 / value,
                perMonth: 30 / value
            };
        case 'w': // weeks
            return {
                perHour: 1 / (value * 7 * 24),
                perDay: 1 / (value * 7),
                perWeek: 1 / value,
                perMonth: 30 / (value * 7)
            };
        default: // default to minutes if unknown
            return {
                perHour: 60,
                perDay: 24 * 60,
                perWeek: 7 * 24 * 60,
                perMonth: 30 * 24 * 60
            };
    }
};

// Get the multipliers based on current interval
const multiplier = getIntervalMultiplier(time);

// Calculate limits in terms of number of candles
const monthlimit = 1; // Base unit - 1 month
const weeklimit = monthlimit * multiplier.perMonth / multiplier.perWeek;
// const weeklimit = 8;
const daylimit = weeklimit * 7;
// const daylimit = 7;
const hourlimit = daylimit * 24;
const minlimit = Math.floor(monthlimit * multiplier.perMonth); // Total candles for the month

export const limit = minlimit;
// export const limit = 10080;

const multiplied = 0;
export const delay = multiplied * 180; // Number of candles to delay (0 = use all available candles)





export const minSwingPct = 0.4;   // minimum % move to mark a pivot 4.85%

// New setting: ignore any pivot that took fewer than this many candles
export const minLegBars = 2;     // e.g. require at least 3 candles per swing

// New setting: number of candles to look back on each side for pivot confirmation
export const pivotLookback = 2;  // 1 = 3-candle pattern, 2 = 5-candle pattern

export const shortWindow    = 6;     // number of recent swings to average
export const longWindow     = 50;    // number of swings for background volatility
export const confirmOnClose = true;  // only confirm pivots on candle-close
// Pivot detection mode: 'close' uses candle close prices, 'extreme' uses high/low prices
export const pivotDetectionMode = 'close';  // 'close' or 'extreme'

// Percentage of average swing size to use as threshold (100 = use exact average)
export const averageSwingThresholdPct = 100;   // e.g. 50 = half of average, 200 = double

// Whether to show detailed information about trades that pass the threshold
export const showThresholdTrades = true;
 