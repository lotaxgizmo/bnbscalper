// Trade configuration for backtesting

const day = 0
// const hour = day * 24;
const hour = 0;
const minute = hour * 60;

export const tradeConfig = {
    // Trade direction ('buy' or 'sell' or 'both')
    direction: 'both',

    // Profit and loss settings (in %)
    takeProfit: 0.6,    // Take profit at 0.2%
    stopLoss: 1,      // Stop loss at 0.1%

    // Leverage multiplier
    leverage: 1,        // 1x leverage (spot trading)
    
    // Trading fees
    totalMakerFee: 0.06, // 0.04% maker fee
    
    // Capital settings
    // initialCapital = Starting capital in USDT
    
    // Multi-trade settings
    maxConcurrentTrades: 1, // Number of trades that can be open at once (default: 1)
    positionSizingMode: 'percent', // 'percent' or 'fixed'
    amountPerTrade: 100,    // Fixed amount per trade in USDT (only used if positionSizingMode is 'fixed')
    
    // riskPerTrade = Percentage of capital to risk per trade (100 = full capital)
    // initialCapital: 1000, 
    // riskPerTrade: 10,   
    // initialCapital: 300, 
    // riskPerTrade: 54.39,   
    // initialCapital: 200, 
    // riskPerTrade: 67.235,   
    initialCapital: 100, 
    riskPerTrade: 100,   
    // initialCapital: 200, 
    // riskPerTrade: 50,   
    
// 2110

    // Trade timeout (in minutes) - set to 0 to disable
    maxTradeTimeMinutes: minute,   // Close trade after this many minutes if neither TP nor SL is hit
    // Order settings
    orderDistancePct: 50,     // Percentage of average move to use for order placement (50 = half the distance)
    cancelThresholdPct: 100,   // Percentage of average swing to use for order cancellation (100 = same as average)
    

    // Display settings

    showCandle: false,
    showPivot: false,
    showLimits: false ,
    showTradeDetails: false,
    
    // Export settings
    saveToFile: true,  // Set to false to disable JSON and CSV exports
    



    performanceMode: false,  // Set to true to disable all console output except completion status
    // Trade settings
    enterAll: false,
};