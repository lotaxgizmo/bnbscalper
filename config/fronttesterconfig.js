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
    showHeartbeat: true,        // Show periodic heartbeat messages in live mode
    hideCandles: false,         // Hide candle completion displays (true = only show pivots and trades)
    
    // Display Settings
    hideCandle: true,           // When true, hides intermediate candle fetching messages and price updates
    logCandlesInStreamer: true, // Toggle to show/hide individual candle logs in the historical streamer
    
    // Past Mode Simulation Settings
    pastMode: true,             // Enable past mode simulation (false = live WebSocket mode)
    speedMultiplier: 10000,     // Simulation speed: 1=normal, 2=2x, 10=10x speed
    startFromEnd: true,         // Start simulation from most recent data
    simulationLength: null      // Number of candles to simulate (null = use full limit)
};
