// Trade configuration for backtesting

const day = 0
// const hour = day * 24;
const hour = 0;
const minute = hour * 60;

export const tradeConfig = {
    // Trade direction ('buy' or 'sell' or 'both' or 'alternate')
    direction: 'both',

    // Profit and loss settings (in %)

    takeProfit: 1.3,
    stopLoss: 0.1,

    // takeProfit: 0.9,  real 4h
    // stopLoss: 0.1,       
    // takeProfit: 0.3,  4h   
    // stopLoss: 0.1,       
    // takeProfit: 0.9,     
    // stopLoss: 0.2,       
    // takeProfit: 0.5,     
    // stopLoss: 0.1,       

    // Leverage multiplier
    leverage: 100,        // 1x leverage (spot trading)
    
    // Trading fees
    totalMakerFee: 0.06, // 0.04% maker fee
    
    // Funding rate simulation (for perpetual futures)
    enableFundingRate: false,     // Enable/disable funding rate simulation
    fundingRateHours: 8,         // Funding rate charged every X hours (8 for most exchanges)
    fundingRatePercent: 0.01,    // Funding rate percentage per period (0.01% is typical)
    fundingRateMode: 'fixed',    // 'fixed' or 'variable' (variable uses random rates)
    variableFundingMin: -0.05,   // Minimum funding rate for variable mode (%)
    variableFundingMax: 0.05,    // Maximum funding rate for variable mode (%)

    // Slippage simulation
    enableSlippage: false,        // Enable/disable slippage simulation
    slippagePercent: 0.05,       // Base slippage percentage (0.02% = 2 basis points)
    slippageMode: 'fixed',       // 'fixed', 'variable', or 'market_impact'
    variableSlippageMin: 0.01,   // Minimum slippage for variable mode (%)
    variableSlippageMax: 0.05,   // Maximum slippage for variable mode (%)
    marketImpactFactor: 0.001,   // Market impact factor for large trades (% per 1000 USDT)
     
    
    // Multi-trade settings
    maxConcurrentTrades: 1, // Number of trades that can be open at once (default: 1)
    positionSizingMode: 'percent', // 'percent', 'fixed', or 'minimum'
    amountPerTrade: 100,    // Fixed amount per trade in USDT (only used if positionSizingMode is 'fixed')
    minimumTradeAmount: 100, // Minimum trade amount in USDT (only used if positionSizingMode is 'minimum')
    
    // riskPerTrade = Percentage of capital to risk per trade (100 = full capital)
        // initialCapital: 1000, 
        // riskPerTrade: 50,   
    // initialCapital: 300, 
    // riskPerTrade: 54.39,   
    // initialCapital: 200, 
    // riskPerTrade: 67.235,   
    initialCapital: 100,
    riskPerTrade: 100,
    // initialCapital: 200, 
    // riskPerTrade: 50,   
    
// 2110

    // Display settings

    showCandle: false,
    showPivot: true,
    showLimits: false ,
    showTradeDetails: false,
    
    // Export settings
    saveToFile: true,  // Set to false to disable JSON and CSV exports
    


    // Trade timeout (in minutes) - set to 0 to disable
    maxTradeTimeMinutes: minute,   // Close trade after this many minutes if neither TP nor SL is hit
    // Order settings
    orderDistancePct: 50,     // Percentage of average move to use for order placement (50 = half the distance)
    cancelThresholdPct: 100,   // Percentage of average swing to use for order cancellation (100 = same as average)
    


    performanceMode: false,  // Set to true to disable all console output except completion status
    // Trade settings
    enterAll: false,
};