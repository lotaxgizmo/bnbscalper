// Trade configuration for backtesting

const day = 0
const hour = day * 24;
// const hour = 6;
const minute = hour * 60;

export const tradeConfig = {
    // Trade direction ('buy' or 'sell' or 'both')
    direction: 'both',

    // Profit and loss settings (in %)
    takeProfit: 0.47,    // Take profit at 0.2%
    stopLoss: 10,      // Stop loss at 0.1%

    // Leverage multiplier
    leverage: 8,        // 1x leverage (spot trading)
    
    // Trading fees
    totalMakerFee: 0.06, // 0.04% maker fee
    
    // Capital settings
    initialCapital: 100,  // Starting capital in USDT
    riskPerTrade: 100,   // Percentage of capital to risk per trade (100 = full capital)
    


    // Trade timeout (in minutes) - set to 0 to disable
    maxTradeTimeMinutes: minute,   // Close trade after this many minutes if neither TP nor SL is hit
    // Order settings
    orderDistancePct: 50,     // Percentage of average move to use for order placement (50 = half the distance)
    cancelThresholdPct: 100,   // Percentage of average swing to use for order cancellation (100 = same as average)
    

    // Display settings

    showCandle: false,
    showPivot: false,
    showLimits: false,
    showTradeDetails: true,
    
    // Export settings
    saveToFile: true,  // Set to false to disable JSON and CSV exports
    



    performanceMode: false,  // Set to true to disable all console output except completion status
    // Trade settings
    enterAll: false,
};