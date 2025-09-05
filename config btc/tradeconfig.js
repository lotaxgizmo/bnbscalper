// Trade configuration for backtesting

const day = 0
// const hour = day * 24;
const hour = 0;
const minute = hour * 60;

export const tradeConfig = {
    // Trade direction ('buy' or 'sell' or 'both' or 'alternate')
    direction: 'both',
    // direction: 'alternate',

    entryDelayMinutes: 0,
    // entryDelayMinutes: 60,


    takeProfit: 0.9,
    stopLoss: 0.4,
    // leverage: 100,
    leverage: 80,

    // Flip mode: close opposite and switch to new confirmed signal 
    // switchOnOppositeSignal: true,       
    switchOnOppositeSignal: false,       
    numberOfOppositeSignal: 1,
    switchPolicy: 'close',                 
    // 'flip': Close opposite trades and open new trade in opposite direction
    // 'close': Only close opposite trades, don't open new trade

    noTradeDays: [],
    // noTradeDays: ['M'],
    // noTradeDays: ['M', 'T', 'W', 'Th', 'F', 'Sa', 'Su'],

    // Trailing stop loss settings
    enableTrailingStopLoss: false,        // Enable trailing stop loss
    trailingStopLossTrigger: 0.5,        // Activate trailing when this % profit reached
    trailingStopLossDistance: 0.5,       // Trail this % behind best price
    
    // Trailing take profit settings
    enableTrailingTakeProfit: false,      // Enable trailing take profit
    trailingTakeProfitTrigger: 0.8,      // Activate trailing when this % profit reached
    trailingTakeProfitDistance: 0.1,     // Trail this % behind best price
    
    showCandle: false,
    showLimits: false,
    // showPivot: true,
    // showTradeDetails: true,
    showPivot: false,
    showTradeDetails: true,
    hideCascades: true,  // Hide cascade confirmation logs (keeps trade execution logs)
 

    // Multi-trade settings
    singleTradeMode: true,      // Only allow one trade at a time (prevents concurrent trades)
    maxConcurrentTrades: 1,     // Number of trades that can be open at once (default: 1)
    positionSizingMode: 'percent', // 'percent', 'fixed', or 'minimum' - legacy
    amountPerTrade: 100,    // Fixed amount per trade in USDT (only used if positionSizingMode is 'fixed')
    minimumTradeAmount: 100, // Minimum trade amount in USDT (only used if positionSizingMode is 'minimum')


 
    initialCapital: 50,
    riskPerTrade: 100,
 

    // Display settings
    // Export settings
    saveToFile: true,  // Set to false to disable JSON and CSV exports
    


    // Trade timeout (in minutes) - set to 0 to disable
    maxTradeTimeMinutes: minute,   // Close trade after this many minutes if neither TP nor SL is hit
    // Order settings
    orderDistancePct: 50,     // Percentage of average move to use for order placement (50 = half the distance)
    cancelThresholdPct: 100,   // Percentage of average swing to use for order cancellation (100 = same as average)


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
    slippagePercent: 0.01,       // Base slippage percentage (0.02% = 2 basis points)
    slippageMode: 'fixed',       // 'fixed', 'variable', or 'market_impact'
    variableSlippageMin: 0.01,   // Minimum slippage for variable mode (%)
    variableSlippageMax: 0.03,   // Maximum slippage for variable mode (%)
    marketImpactFactor: 0.001,   // Market impact factor for large trades (% per 1000 USDT)
     
    

    performanceMode: false,  // Set to true to disable all console output except completion status
    // Trade settings
    enterAll: false,
 
};