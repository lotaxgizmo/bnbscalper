// Trade configuration for backtesting
export const tradeConfig = {
    // Trade direction ('buy' or 'sell')
    direction: 'sell',

    // Profit and loss settings (in %)
    takeProfit: 0.15,    // Take profit at 0.2%
    stopLoss: 11,      // Stop loss at 0.1%

    // Leverage multiplier
    leverage: 8,        // 1x leverage (spot trading)

    // Trading fees
    totalMakerFee: 0.04, // 0.04% maker fee

    // Capital settings
    initialCapital: 100,  // Starting capital in USDT
    riskPerTrade: 100,   // Percentage of capital to risk per trade (100 = full capital)

    // Order settings
    orderDistancePct: 50,     // Percentage of average move to use for order placement (50 = half the distance)
    cancelThresholdPct: 100,   // Percentage of average swing to use for order cancellation (100 = same as average)

    // Display settings
    showPivot: true,
    showLimits: true,
    showTradeDetails: true,
    
    // Export settings
    saveToFile: true,  // Set to false to disable JSON and CSV exports
    



    performanceMode: false,  // Set to true to disable all console output except completion status
    // Trade settings
    enterAll: false,
};