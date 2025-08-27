// historicalDataConfig.js
export const historicalDataConfig = {
    pairs: ['BTCUSDT', 'BNBUSDT', 'XRPUSDT', 'ETHUSDT', 'SOLUSDT'],
    // pairs: ['BTCUSDT', 'BNBUSDT'],
    intervals: ['1', '3', '5', '15', '30', '1h', '4h', '1d', '1w'],
    months: 1,
    dataPath: './data/historical/',
    // Track last update time for each pair/interval
    lastUpdated: {}  // Will be populated as: { 'BNBUSDT_1m': timestamp, 'BNBUSDT_1h': timestamp, ... }
};
