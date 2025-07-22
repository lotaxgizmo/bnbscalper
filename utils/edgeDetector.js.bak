// edgeDetector.js
import { edgeThresholds, edgeConfig } from '../config/config.js';

export class EdgeDetector {
    constructor() {
        this.thresholds = edgeThresholds;
        this.config = edgeConfig;
    }

    // Calculate percentage move from lowest to highest in a period
    calculateMove(candles) {
        if (!candles.length) return 0;
        
        const high = Math.max(...candles.map(c => c.high));
        const low = Math.min(...candles.map(c => c.low));
        return ((high - low) / low) * 100;
    }

    // Get candles for different timeframes
    getTimeframedCandles(candles, currentTime) {
        const day = 24 * 60 * 60 * 1000;
        const dailyCandles = candles.filter(c => c.time >= currentTime - day);
        const weeklyCandles = candles.filter(c => c.time >= currentTime - (7 * day));
        const monthlyCandles = candles.filter(c => c.time >= currentTime - (30 * day));

        return {
            daily: dailyCandles,
            weekly: weeklyCandles,
            monthly: monthlyCandles
        };
    }

    // Check if we're near an edge for a specific timeframe
    isTimeframeEdge(move, threshold) {
        return move >= threshold * this.config.sensitivity;
    }

    // Analyze all timeframes for edge conditions
    analyze(candles) {
        if (!this.config.enabled || !candles.length) {
            return {
                isEdge: false,
                details: {}
            };
        }

        const currentTime = candles[candles.length - 1].time;
        const timeframedCandles = this.getTimeframedCandles(candles, currentTime);

        // Calculate moves for each timeframe
        const moves = {
            daily: this.calculateMove(timeframedCandles.daily),
            weekly: this.calculateMove(timeframedCandles.weekly),
            monthly: this.calculateMove(timeframedCandles.monthly)
        };

        // Check each timeframe for edge condition
        const edges = {
            daily: this.isTimeframeEdge(moves.daily, this.thresholds.daily),
            weekly: this.isTimeframeEdge(moves.weekly, this.thresholds.weekly),
            monthly: this.isTimeframeEdge(moves.monthly, this.thresholds.monthly)
        };

        // Determine if we're at an edge based on configuration
        const edgeCount = Object.values(edges).filter(Boolean).length;
        const isEdge = this.config.requireMultiple ? edgeCount > 1 : edgeCount > 0;

        return {
            isEdge,
            details: {
                moves,
                edges,
                edgeCount
            }
        };
    }
}

export default EdgeDetector;
