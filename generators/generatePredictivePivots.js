 // generatePredictivePivots.js
import {
    api,
    time as interval,
    symbol,
    limit,
    minSwingPct,
    shortWindow,
    longWindow,
    confirmOnClose,
    minLegBars,
    delay
} from '../config/config.js';

import PivotTracker from '../utils/pivotTracker.js';
import { fetchCandles } from '../utils/candleAnalytics.js';
import { savePivotData } from '../utils/pivotCache.js';

async function generatePredictivePivots() {
    console.log(`\n▶ Generating Predictive Pivot Data for ${symbol} [${interval}] using ${api}\n`);

    // Configuration
    const pivotConfig = {
        minSwingPct,
        shortWindow,
        longWindow,
        confirmOnClose,
        minLegBars
    };

    // Fetch historical data
    console.log(`Fetching full history (${limit} candles)...`);
    const candles = await fetchCandles(symbol, interval, limit, api, delay);
    console.log(`Fetched ${candles.length} candles.`);

    if (!candles.length) {
        console.error('❌ No candles fetched. Exiting.');
        process.exit(1);
    }

    // Sort chronologically
    candles.sort((a, b) => a.time - b.time);

    // Prediction results
    const predictions = [];
    const lookbackWindow = 50; // Number of candles to base prediction on
    const predictionWindow = 5; // Number of candles to look ahead for validation

    console.log('\nSimulating real-time prediction...');
    
    // Start from lookbackWindow to have enough historical data
    for (let i = lookbackWindow; i < candles.length - predictionWindow; i++) {
        // Get data available up to this point
        const availableData = candles.slice(0, i + 1);
        const currentCandle = availableData[i];
        
        // Get prediction window for validation
        const futureCandles = candles.slice(i + 1, i + 1 + predictionWindow);
        
        // Create new tracker for this timepoint
        const tracker = new PivotTracker(pivotConfig);
        
        // Process historical data up to current point
        for (const candle of availableData.slice(-lookbackWindow)) {
            tracker.update(candle);
        }

        // Get current market state
        const state = tracker.getCurrentState();
        
        // Make prediction based on current state
        const prediction = {
            time: currentCandle.time,
            price: currentCandle.close,
            type: state.trend === 'up' ? 'high' : 'low',
            swingPct: calculateExpectedMove(state),
            movePct: calculateStrength(state),
            bars: state.legBars,
            prediction: true,
            outcome: validatePrediction(state, futureCandles)
        };

        predictions.push(prediction);

        // Log progress
        if (i % 1000 === 0) {
            console.log(`Processed ${i} predictions...`);
        }
    }

    // Calculate prediction statistics
    const stats = calculateStats(predictions);
    console.log('\nPrediction Statistics:');
    console.log(`- Total Predictions: ${predictions.length}`);
    console.log(`- Accuracy Rate: ${stats.accuracyRate}%`);
    console.log(`- Average Time to Confirmation: ${stats.avgConfirmationTime} candles`);
    console.log(`- False Positive Rate: ${stats.falsePositiveRate}%`);
    console.log(`- Missed Pivot Rate: ${stats.missedRate}%`);

    // Save prediction data
    console.log('\nSaving prediction data...');
    savePivotData(symbol, interval, predictions, pivotConfig, {
        type: 'predictive',
        candles,
        generatedAt: Date.now(),
        lastUpdate: Date.now(),
        stats
    });

    console.log('\n✅ Predictive pivot generation complete!');
}

function calculateStrength(state) {
    // Calculate prediction strength based on:
    // - Recent volatility vs historical
    // - Trend strength
    // - Price action momentum
    const volatilityRatio = state.shortTermVolatility / state.longTermVolatility;
    const trendStrength = Math.abs(state.trendSlope);
    
    return (volatilityRatio * 0.4) + (trendStrength * 0.6);
}

function calculateExpectedMove(state) {
    // Calculate expected price movement based on:
    // - Historical pivot sizes
    // - Current volatility
    // - Trend strength
    return state.averagePivotSize * (state.shortTermVolatility / state.longTermVolatility);
}

function validatePrediction(state, futureCandles) {
    // Validate if prediction materialized in future candles
    let pivotFound = false;
    let timeToConfirmation = 0;
    let actualMoveSize = 0;
    let success = false;

    for (let i = 0; i < futureCandles.length; i++) {
        const candle = futureCandles[i];
        if (state.expectedDirection === 'up' && candle.close > state.pivotPrice * (1 + minSwingPct/100)) {
            pivotFound = true;
            timeToConfirmation = i + 1;
            actualMoveSize = (candle.close - state.pivotPrice) / state.pivotPrice * 100;
            success = actualMoveSize >= 0.08; // Our target move
            break;
        } else if (state.expectedDirection === 'down' && candle.close < state.pivotPrice * (1 - minSwingPct/100)) {
            pivotFound = true;
            timeToConfirmation = i + 1;
            actualMoveSize = (state.pivotPrice - candle.close) / state.pivotPrice * 100;
            success = actualMoveSize >= 0.08; // Our target move
            break;
        }
    }

    return {
        confirmed: pivotFound,
        success: success,
        confirmationTime: timeToConfirmation,
        moveSize: actualMoveSize
    };
}

function calculateStats(predictions) {
    // Calculate overall prediction statistics
    const confirmed = predictions.filter(p => p.outcome.confirmed);
    
    return {
        accuracyRate: (confirmed.length / predictions.length * 100).toFixed(2),
        avgConfirmationTime: (confirmed.reduce((sum, p) => sum + p.outcome.confirmationTime, 0) / confirmed.length).toFixed(1),
        falsePositiveRate: ((predictions.length - confirmed.length) / predictions.length * 100).toFixed(2),
        missedRate: (predictions.filter(p => !p.outcome.confirmed).length / predictions.length * 100).toFixed(2)
    };
}

// Run the generator
generatePredictivePivots().catch(console.error);
