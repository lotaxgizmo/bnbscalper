// fronttesterconfig.js
// Configuration for pivotFronttester.js debug output and display options

export const fronttesterconfig = {
    // Debug Output Controls
    showDebug: false,           // Show/hide debug output (pivot checking, buffer analysis)
    showPivotChecking: false,   // Show detailed pivot checking logs
    showBufferAnalysis: false,  // Show buffer re-analysis debug info
    showEdgeData: false,        // Show edge data calculations
    showSystemStatus: true,     // Show system status messages (startup, WebSocket connection)
    showProgress: true,         // Show simulation progress in past mode
    showHeartbeat: false,       // Show periodic heartbeat messages in live mode
    hideCandles: false,          // Hide individual candle data in live mode
    timeLoggingInterval: 1,    // Log time progression every X minutes (1=every minute, 60=every hour)
    
    // Display Settings
    hideCandle: true,           // When true, hides intermediate candle fetching messages and price updates
    logCandlesInStreamer: true, // Toggle to show/hide individual candle logs in the historical streamer
    hideTimeDisplay: true,     // Hide time progression display (⏰ Wed, Aug 6, 05:00 PM...)
    hideProgressDisplay: true, // Hide progress percentage display (Progress: 15.4%...)
    
    showTrades: true,          // Show/hide trade opening and closing logs
    showWindow: true,          // Show/hide window opening, confirmation, and execution logs
    showRecentCascades: true,  // Show/hide recent cascades display section
    showAllTrades: true,        // Show/hide "All Trades Taken" detailed summary section
    
    // Past Mode Simulation Settings
    pastMode: false,             // Enable past mode simulation (false = live WebSocket mode)
    speedMultiplier: 100000,     // Simulation speed: 1=normal, 2=2x, 10=10x speed
    startFromEnd: true,         // Start simulation from most recent data
    simulationLength: null,     // Number of candles to simulate (null = use full limit)
    
    // Real-time Operation Settings
    refreshInterval: 5,        // Seconds between cascade checks (5-10 recommended)
    candleCheckInterval: 20,   // Seconds between candle checks in live mode (20-60 recommended)
    executionMode: 'trade',     // 'signal' = show signals only, 'trade' = execute trades
    enableTrading: true,        // Enable/disable actual trade execution
    maxRecentCascades: 3,       // Number of recent cascades to display
    
    // Data Range Settings
    dataLimit: null,            // Override limit from config.js (null = use config.js limit)
    
    // Audio Notifications
    enableBeeps: false,          // Enable audio beeps for notifications
    beepOnCascade: true,        // Beep when cascade is detected
    beepOnTrade: true,          // Beep when trade is executed
    beepVolume: 1,              // Beep volume (1-3, 1=single beep, 2=double, 3=triple)
    
    // Telegram Notification Controls
    showTelegramTrades: false,    // Send Telegram notifications for trades (open/close)
    showTelegramCascades: false   // Send Telegram notifications for cascade confirmations
};
