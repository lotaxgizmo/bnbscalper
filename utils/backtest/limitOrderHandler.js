// limitOrderHandler.js
// Specialized utility for managing limit orders with proper edge data

import path from 'path';
import fs from 'fs';
import { formatDateTime } from '../candleAnalytics.js';
import { colors } from '../formatters.js';
import { symbol as configSymbol, time as configInterval } from '../../config/config.js';

// Define timeframes for edge calculation (same as in generateEnhancedPivotData.js)
const timeframes = {
  daily: 24 * 60 * 60 * 1000,      // 24 hours
  weekly: 7 * 24 * 60 * 60 * 1000,  // 7 days
  monthly: 30 * 24 * 60 * 60 * 1000  // 30 days (simplified from generateEnhancedPivotData.js)
};

// Historical data cache to avoid repeated reads
const historicalDataCache = new Map();

export class LimitOrderHandler {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.historicalDataPath = path.join(process.cwd(), 'data', 'historical');
  }

  /**
   * Create a limit order from a pivot
   * @param {Object} pivot - The pivot that triggered the order
   * @param {Object} candle - The current candle
   * @param {Boolean} isLong - Direction of the order
   * @param {Number} limitPrice - Calculated limit price
   * @param {Number} avgMove - Average move used for distance calculation
   * @returns {Object} - The created order with inherited edge data
   */
  createOrderFromPivot(pivot, candle, isLong, limitPrice, avgMove) {
    // Inherit edge data from pivot
    const edges = pivot.edges ? JSON.parse(JSON.stringify(pivot.edges)) : null;
    
    const order = {
      type: isLong ? 'buy' : 'sell',
      price: limitPrice,
      time: pivot.time, 
      isLong,
      pivotPrice: pivot.price,
      edges, // Direct inheritance of edge data
      referencePrice: pivot.price,
      movePct: avgMove * this.config.orderDistancePct/100,
      pivotId: pivot.id || `${pivot.type}-${pivot.time}-${pivot.price}` // Track relationship
    };

    // If edge data is missing, log warning
    if (!edges || !edges.daily || !edges.weekly || !edges.monthly) {
      this.logger?.logError(`Warning: Creating order with incomplete edge data from pivot. Will generate synthetic data.`);
    }
    
    return order;
  }
  
  /**
   * Load historical candle data for a symbol and interval
   * @param {String} symbol - Trading symbol (optional, uses config if not provided)
   * @param {String} interval - Time interval (optional, uses config if not provided)
   * @returns {Array} - Historical candle data
   */
  loadHistoricalData(symbol, interval) {
    // Use provided values or fall back to config values
    const useSymbol = symbol || this.config?.symbol || configSymbol;
    const useInterval = interval || this.config?.interval || configInterval;
    
    if (!useSymbol) {
      this.logger?.logError('Symbol not provided and not found in config');
      return [];
    }
    
    const cacheKey = `${useSymbol}_${useInterval}`;
    
    // Return from cache if available
    if (historicalDataCache.has(cacheKey)) {
      return historicalDataCache.get(cacheKey);
    }
    
    try {
      // Ensure directory structure exists
      if (!fs.existsSync(this.historicalDataPath)) {
        this.logger?.logError(`Historical data directory not found at ${this.historicalDataPath}`);
        return [];
      }
      
      // Load historical data file - keep original case for directory
      const filePath = path.join(this.historicalDataPath, useSymbol.toUpperCase(), `${useInterval}.csv`);
      if (!fs.existsSync(filePath)) {
        this.logger?.logError(`Historical data file not found at ${filePath}`);
        return [];
      }
      
      // Parse CSV data and cache
      const fileContent = fs.readFileSync(filePath, 'utf8');
      const lines = fileContent.split('\n');
      const data = [];
      
      // Skip header and process lines
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const [time, open, high, low, close, volume] = line.split(',').map(parseFloat);
        if (isNaN(time)) continue;

        data.push({
          time: time,
          open: open,
          high: high,
          low: low,
          close: close,
          volume: volume
        });
      }
      
      // Sort by time ascending for consistency
      data.sort((a, b) => a.time - b.time);
      historicalDataCache.set(cacheKey, data);
      
      return data;
    } catch (error) {
      this.logger?.logError(`Error loading historical data: ${error.message}`);
      return [];
    }
  }
  
  /**
   * Calculate move within a specific time window (from generateEnhancedPivotData.js)
   */
  calculateMove(candles, windowStart, windowEnd) {
    const windowCandles = candles.filter(c => c.time >= windowStart && c.time <= windowEnd);
    
    if (!windowCandles.length) return null;
    
    // Get reference price from start of period
    const referencePrice = windowCandles[0].open;
    const currentPrice = windowCandles[windowCandles.length - 1].close;
    
    // Track high and low for total range
    let highPrice = windowCandles[0].high;
    let lowPrice = windowCandles[0].low;
    let highTime = windowCandles[0].time;
    let lowTime = windowCandles[0].time;
    
    for (const candle of windowCandles) {
      if (candle.high > highPrice) {
        highPrice = candle.high;
        highTime = candle.time;
      }
      if (candle.low < lowPrice) {
        lowPrice = candle.low;
        lowTime = candle.time;
      }
    }
    
    // Calculate position relative to reference (start of period)
    const positionPct = ((currentPrice - referencePrice) / referencePrice) * 100;
    
    // Calculate total range relative to reference
    const totalRange = ((highPrice - lowPrice) / referencePrice) * 100;
    
    // Direction is based on position relative to reference, not short-term movement
    const direction = positionPct >= 0 ? 'U' : 'D';

    return {
      high: highPrice,
      highTime: highTime,
      low: lowPrice,
      lowTime: lowTime,
      current: currentPrice,
      reference: referencePrice,
      // Total range is always positive
      move: parseFloat(totalRange.toFixed(2)),
      // Position maintains its sign to show where we are relative to reference
      position: parseFloat(positionPct.toFixed(2))
    };
  }

  /**
   * Calculate average move for a timeframe (from generateEnhancedPivotData.js)
   */
  calculateAverageMove(candles, endTime, periodMs, count) {
    const moves = [];
    for (let i = 1; i <= count; i++) {
      const periodEnd = endTime - (i - 1) * periodMs;
      const periodStart = periodEnd - periodMs;
      const result = this.calculateMove(candles, periodStart, periodEnd);
      if (result) {
        moves.push(result.move);
      }
    }
    return moves.length ? parseFloat((moves.reduce((a, b) => a + b, 0) / moves.length).toFixed(2)) : null;
  }

  /**
   * Calculate edge data for a specific timestamp (from generateEnhancedPivotData.js)
   */
  calculateEdgeData(candles, timestamp) {
    const edgeData = {};
    
    for (const [timeframe, duration] of Object.entries(timeframes)) {
      const windowEnd = timestamp;
      const windowStart = windowEnd - duration;
      
      const move = this.calculateMove(candles, windowStart, windowEnd);
      if (!move) continue;

      let averageMove = null;
      if (timeframe === 'daily') {
        averageMove = {
          week: this.calculateAverageMove(candles, windowEnd, duration, 7),
          twoWeeks: this.calculateAverageMove(candles, windowEnd, duration, 14),
          month: this.calculateAverageMove(candles, windowEnd, duration, 30)
        };
      } else if (timeframe === 'weekly') {
        averageMove = this.calculateAverageMove(candles, windowEnd, duration, 4);
      } else if (timeframe === 'monthly') {
        averageMove = this.calculateAverageMove(candles, windowEnd, duration, 3);
      }

      edgeData[timeframe] = {
        ...move,
        averageMove
      };
    }

    return edgeData;
  }

  // No synthetic data generation as all historical files are present

  /**
   * Update edge data for an active order based on new candle
   * @param {Object} order - The existing order
   * @param {Object} candle - The new candle
   * @returns {Object} - Updated order with current edge data
   */
  updateOrderEdgeData(order, candle) {
    try {
      // Get historical data - pass symbol and interval from config if available
      const historicalData = this.loadHistoricalData(this.config?.symbol, this.config?.interval);
      
      if (historicalData.length === 0) {
        // If historical data is not available, log an error and keep original edge data
        this.logger?.logError(`No historical data found for edge calculation. Using original pivot edge data.`);
        // Keep the original edge data from the parent pivot
        return order;
      }
      
      // Calculate edge data using historical candles
      order.edges = this.calculateEdgeData(historicalData, candle.time);
      
      return order;
    } catch (error) {
      this.logger?.logError(`Error updating order edge data: ${error.message}`);
      // Keep original edge data on error
      this.logger?.logError(`Using original pivot edge data due to calculation error.`);
      return order;
    }
  }
  
  /**
   * Process a limit order with the new candle data
   * @param {Object} order - Current limit order
   * @param {Object} candle - New candle data
   * @returns {Object} - Result with filled/cancelled status and updated order
   */
  processOrder(order, candle) {
    // Update order's edge data with latest market information
    const updatedOrder = this.updateOrderEdgeData(order, candle);
    
    // Check fill condition
    const filled = order.isLong 
      ? candle.low <= order.price
      : candle.high >= order.price;
      
    if (filled) {
      // Log the fill with updated edge data
      this.logger?.logLimitOrderFill(updatedOrder, candle);
      
      const trade = {
        entry: order.price,
        entryTime: candle.time,
        isLong: order.isLong,
        orderTime: order.time,
        edges: updatedOrder.edges, // Use updated edge data for trade
        pivotId: order.pivotId // Maintain connection to original pivot
      };
      
      return { cancelled: false, filled: true, trade };
    }
    
    // Check cancellation based on average swing
    // Note: This would be handled by the calling code that has access to avgSwing
    
    return { cancelled: false, filled: false, order: updatedOrder };
  }
}

export default LimitOrderHandler;
