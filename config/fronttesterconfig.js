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
    hideCandles: true,          // Hide individual candle data in live mode
    timeLoggingInterval: 10,    // Log time progression every X minutes (1=every minute, 60=every hour)
    
    // Display Settings
    hideCandle: true,           // When true, hides intermediate candle fetching messages and price updates
    logCandlesInStreamer: true, // Toggle to show/hide individual candle logs in the historical streamer
    
    // Past Mode Simulation Settings
    pastMode: true,             // Enable past mode simulation (false = live WebSocket mode)
    speedMultiplier: 10000,     // Simulation speed: 1=normal, 2=2x, 10=10x speed
    startFromEnd: true,         // Start simulation from most recent data
    simulationLength: null,     // Number of candles to simulate (null = use full limit)
    
    // Real-time Operation Settings
    refreshInterval: 5,        // Seconds between cascade checks (5-10 recommended)
    executionMode: 'trade',     // 'signal' = show signals only, 'trade' = execute trades
    maxRecentCascades: 3,       // Number of recent cascades to display
    
    // Data Range Settings
    dataLimit: null,            // Override limit from config.js (null = use config.js limit)
    
    // Audio Notifications
    enableBeeps: false,          // Enable audio beeps for notifications
    beepOnCascade: true,        // Beep when cascade is detected
    beepOnTrade: true,          // Beep when trade is executed
    beepVolume: 1               // Beep volume (1-3, 1=single beep, 2=double, 3=triple)
};
