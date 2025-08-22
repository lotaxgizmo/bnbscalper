// multiPivotConfig.js
// Configuration for multi-timeframe pivot confirmation system

export const multiPivotConfig = {
    // Enable/disable multi-timeframe analysis
    enabled: true,
    
    // Timeframes to analyze (in hierarchical order - largest to smallest)
    // The system will cascade from largest to smallest timeframe
    timeframes: [

        // {
        //     interval: '4h',
        //     role: 'primary',   // Additional confirmation
        //     minSwingPct: 0.3,   // Same settings for easy testing
        //     lookback: 1,
        //     minLegBars: 1,          // Same settings for easy testing
        //     weight: 1,
        //     opposite: false
        // },
         

        {
            interval: '3m',
            role: 'primary',   // Additional confirmation
            minSwingPct: 0.001,   // Same settings for easy testing
            lookback: 1,
            minLegBars: 1,          // Same settings for easy testing
            weight: 1,
            opposite: false
        },


        {
            interval: '1m',
            role: 'execution',      // Final execution timeframe
            minSwingPct: 0.001,       // Same settings for easy testing
            lookback: 1,
            minLegBars: 1,          // Same settings for easy testing
            weight: 1,
            opposite: false
        }
    ],
    
    // Cascade confirmation settings
    cascadeSettings: {
        // How long to wait for confirmation from smaller timeframes (in minutes)
        minTimeframesRequired: 2,      // 🔧 REQUIRE: Primary + 2 others (3/4 timeframes)
        confirmationWindow: {
            // '4h': 3,
            '4h': 230,
            '20m': 20,
            '10m': 10,
            '1h': 60,  
            '15m': 15,
            '5m': 5,   
            '3m': 2,
            '1m': 1
        },
        
        // Require all timeframes to confirm, or allow partial confirmation
        requireAllTimeframes: false,  // 🔧 RELAXED: Allow partial confirmation
        
        // If partial confirmation allowed, minimum number of timeframes needed
        
        // Must include primary timeframe in confirmation
        requirePrimaryTimeframe: true,

        requireHierarchicalValidation: false
    },
    
    // Signal strength and filtering
    signalSettings: {
        // Minimum signal strength to proceed with cascade
        minSignalStrength: 0.5,
        
        // Maximum age of signals before they expire (in minutes)
        maxSignalAge: {
            '4h': 240,      // 8 hours
            '1h': 60,      // 2 hours
            '15m': 60,      // 1 hour
            '5m': 30,       // 30 minutes
            '1m': 1        // 15 minutes
        },
        
        // Require trend alignment across timeframes
        requireTrendAlignment: true
    },
    
    // Debug and display settings
    debug: {
        showCascadeProcess: true,       // Show the cascade confirmation process
        showTimeframeAnalysis: true,    // Show individual timeframe analysis
        showSignalStrength: true,       // Show signal strength calculations
        showConfirmationTiming: true,   // Show timing of confirmations
        logFailedCascades: true,        // Log when cascades fail
        
        // 🎯 CASCADE LOGGING CONTROLS
        cascadeLogging: {
            enabled: true,                    // Master switch for cascade logging
            showAllCascades: false,           // Show all cascade attempts (true) or only successful ones (false)
            
            // Minimum confirmations required to display cascade details
            minConfirmationsToShow: 1,       // Show cascades with at least N confirmations (1-5)
            
            // What to show for each cascade
            showDetails: {
                primarySignal: true,         // Show "Primary Signal: SHORT from 4h at..."
                confirmationBreakdown: true, // Show "[1h] ✓ CONFIRMED, [15m] ✗ FAILED"
                finalResult: true,           // Show "CASCADE SUCCESS/FAILED"
                confirmedSignalSummary: true, // Show "🎯 CONFIRMED CASCADE" line
                signalStrength: true,        // Show strength percentage (75%)
                confirmingTimeframes: true,  // Show "Confirming TFs: 1h, 1m"
                price: true,                 // Show price at signal time
                timestamp: true              // Show full timestamp
            },
            
            // Progress and summary controls
            showProgress: true,              // Show "Progress: 75.5% (40/53 signals processed)"
            showProgressEvery: 10,           // Show progress every N signals
            showFinalSummary: true,          // Show final results summary
            
            // Filter by confirmation count
            filterByConfirmations: {
                show1Confirmation: true,     // Show cascades with exactly 1 confirmation
                show2Confirmations: true,    // Show cascades with exactly 2 confirmations  
                show3Confirmations: true,    // Show cascades with exactly 3 confirmations
                show4Confirmations: true,    // Show cascades with exactly 4 confirmations
                show5Confirmations: true     // Show cascades with exactly 5+ confirmations
            }
        }
    }
};

// 🎯 QUICK LOGGING PRESETS
export const loggingPresets = {
    // Show everything (current behavior)
    verbose: {
        enabled: true,
        showAllCascades: true,
        minConfirmationsToShow: 1,
        showDetails: { primarySignal: true, confirmationBreakdown: true, finalResult: true, confirmedSignalSummary: true }
    },
    
    // Only show successful cascades
    successOnly: {
        enabled: true,
        showAllCascades: false,
        minConfirmationsToShow: 3,
        showDetails: { primarySignal: false, confirmationBreakdown: false, finalResult: false, confirmedSignalSummary: true }
    },
    
    // Minimal logging - only final summary
    minimal: {
        enabled: true,
        showAllCascades: false,
        minConfirmationsToShow: 5,
        showDetails: { primarySignal: false, confirmationBreakdown: false, finalResult: false, confirmedSignalSummary: false }
    },
    
    // Silent mode - no cascade logging
    silent: {
        enabled: false,
        showAllCascades: false,
        minConfirmationsToShow: 10,
        showDetails: { primarySignal: false, confirmationBreakdown: false, finalResult: false, confirmedSignalSummary: false }
    }
};

// Preset configurations for different trading styles
export const multiPivotPresets = {
    // Conservative: Fewer timeframes, longer confirmation windows
    conservative: {
        timeframes: [
            { interval: '1d', role: 'primary', lookback: 5, minSwingPct: 0.8, minLegBars: 5, weight: 4 },
            { interval: '4h', role: 'secondary', lookback: 5, minSwingPct: 0.5, minLegBars: 3, weight: 3 },
            { interval: '1h', role: 'execution', lookback: 5, minSwingPct: 0.3, minLegBars: 2, weight: 2 }
        ],
        cascadeSettings: {
            confirmationWindow: { '1d': 1440, '4h': 480, '1h': 120 },
            requireAllTimeframes: true
        }
    },
    
    // Aggressive: More timeframes, shorter confirmation windows
    aggressive: {
        timeframes: [
            { interval: '4h', role: 'primary', lookback: 5, minSwingPct: 0.4, minLegBars: 3, weight: 3 },
            { interval: '1h', role: 'secondary', lookback: 5, minSwingPct: 0.3, minLegBars: 2, weight: 2 },
            { interval: '15m', role: 'confirmation', lookback: 5, minSwingPct: 0.2, minLegBars: 2, weight: 1 },
            { interval: '5m', role: 'confirmation', lookback: 5, minSwingPct: 0.15, minLegBars: 1, weight: 1 },
            { interval: '1m', role: 'execution', lookback: 5, minSwingPct: 0.1, minLegBars: 1, weight: 1 }
        ],
        cascadeSettings: {
            confirmationWindow: { '4h': 120, '1h': 30, '15m': 15, '5m': 10, '1m': 5 },
            requireAllTimeframes: false,
            minTimeframesRequired: 3
        }
    },
    
    // Scalping: Fast timeframes, quick confirmations
    scalping: {
        timeframes: [
            { interval: '1h', role: 'primary', lookback: 5, minSwingPct: 0.3, minLegBars: 2, weight: 3 },
            { interval: '15m', role: 'secondary', lookback: 5, minSwingPct: 0.2, minLegBars: 2, weight: 2 },
            { interval: '5m', role: 'confirmation', lookback: 5, minSwingPct: 0.15, minLegBars: 1, weight: 1 },
            { interval: '1m', role: 'execution', lookback: 5, minSwingPct: 0.1, minLegBars: 1, weight: 1 }
        ],
        cascadeSettings: {
            confirmationWindow: { '1h': 30, '15m': 15, '5m': 10, '1m': 5 },
            requireAllTimeframes: true
        }
    },
    
    // Swing: Longer timeframes, patient confirmations
    swing: {
        timeframes: [
            { interval: '1w', role: 'primary', lookback: 5, minSwingPct: 2.0, minLegBars: 7, weight: 5 },
            { interval: '1d', role: 'secondary', lookback: 5, minSwingPct: 1.0, minLegBars: 5, weight: 4 },
            { interval: '4h', role: 'execution', lookback: 5, minSwingPct: 0.5, minLegBars: 3, weight: 3 }
        ],
        cascadeSettings: {
            confirmationWindow: { '1w': 10080, '1d': 2880, '4h': 720 }, // 1 week, 2 days, 12 hours
            requireAllTimeframes: true
        }
    }
};

// Helper function to load a preset configuration
export const loadPreset = (presetName) => {
    const preset = multiPivotPresets[presetName];
    if (!preset) {
        throw new Error(`Preset '${presetName}' not found. Available presets: ${Object.keys(multiPivotPresets).join(', ')}`);
    }

    return {
        ...multiPivotConfig,
        ...preset
    };
};

// Helper function to validate configuration
export const validateConfig = (config) => {
    if (!config.timeframes || config.timeframes.length === 0) {
        throw new Error('At least one timeframe must be configured');
    }
    
    // Ensure timeframes are in descending order (largest to smallest)
    const intervals = config.timeframes.map(tf => tf.interval);
    // Add validation logic here if needed
    
    return true;
};
