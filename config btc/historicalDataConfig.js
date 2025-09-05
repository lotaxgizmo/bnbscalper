// historicalDataConfig.js
export const historicalDataConfig = {
    pairs: ['BTCUSDT'],
    intervals: ['1'],
    months: 1,
    dataPath: './data/historical/',
    // Track last update time for each pair/interval
    lastUpdated: {}  // Will be populated as: { 'BNBUSDT_1m': timestamp, 'BNBUSDT_1h': timestamp, ... }
};
