// edgeConsoleLogger.js
import { ConsoleLogger } from './consoleLogger.js';
import { colors, formatDuration } from '../formatters.js';
import { formatDateTime } from '../candleAnalytics.js';

const { reset: COLOR_RESET, red: COLOR_RED, green: COLOR_GREEN, yellow: COLOR_YELLOW, cyan: COLOR_CYAN, magenta: COLOR_MAGENTA, bright: COLOR_BRIGHT, brightCyan: COLOR_BRIGHT_CYAN } = colors;

export class EdgeConsoleLogger extends ConsoleLogger {
  formatEdges(edges) {
    if (!edges) return '';
    
    // Format current edge data
    const currentEdge = ' \n Edges: ' + ['D', 'W', 'M'].map(t => {
      const type = t === 'D' ? 'daily' : t === 'W' ? 'weekly' : 'monthly';
      const edge = edges[type];
      if (!edge) return '';
      
      // Direction should match sign - positive is up, negative is down
      const direction = edge.position >= 0 ? 'U' : 'D';
      const sign = edge.position >= 0 ? '+' : '';  // Negative sign is already included in the number
      return `${t}:${sign}${edge.position.toFixed(1)}%(${direction})`;
    }).filter(Boolean).join(' ');

    // Format average edge data
    const avgEdge = '\n Average Edge ' + ['D', 'W', 'M'].map(t => {
      const type = t === 'D' ? 'daily' : t === 'W' ? 'weekly' : 'monthly';
      const edge = edges[type];
      if (!edge || !edge.averageMove) return '';
      
      const avgMove = type === 'daily' 
        ? edge.averageMove.week  // Use weekly average for daily
        : edge.averageMove;      // Use direct average for weekly/monthly
      
      // Direction should match sign - positive is up, negative is down
      const direction = avgMove >= 0 ? 'U' : 'D';
      const sign = avgMove >= 0 ? '+' : '';  // Negative sign is already included in the number
      return `${t}:${sign}${avgMove.toFixed(1)}%(${direction})`;
    }).filter(Boolean).join(' ');

    // Format total/range edge data
    const totalEdge = '\n Range/Total Edge ' + ['D', 'W', 'M'].map(t => {
      const type = t === 'D' ? 'daily' : t === 'W' ? 'weekly' : 'monthly';
      const edge = edges[type];
      if (!edge || !edge.move) return '';
      
      // Direction should match sign - positive is up, negative is down
      const direction = edge.move >= 0 ? 'U' : 'D';
      const sign = edge.move >= 0 ? '+' : '';  // Negative sign is already included in the number
      return `${t}:${sign}${edge.move.toFixed(1)}%(${direction})`;
    }).filter(Boolean).join(' ');

    return currentEdge + avgEdge + totalEdge;
  }

  logPivot(pivot, candle) {
    // Call original logPivot without edge data
    if (!pivot.edges) {
      super.logPivot(pivot, candle);
      return;
    }

    if (this.performanceMode || !this.showPivot) return;
    
    // Initialize pivot count if it doesn't exist
    if (typeof this.pivotCount === 'undefined') {
      this.pivotCount = 0;
    }
    this.pivotCount++;

    const paddedNumber = String(this.pivotCount).padStart(3, ' ');
    const prefix = `${paddedNumber}.`;
    
    // Pad pivot type to match HIGH length
    const pivotType = pivot.type.toUpperCase().padEnd(4, ' ');
    
    // Ensure we have both timestamps for all pivots
    // For cached pivots, ensure we convert any seconds to milliseconds
    let extremeTime = pivot.time;
    let confirmTime = pivot.confirmationTime;
    
    // Handle legacy format or ensure correct format
    if (!extremeTime) {
      // Legacy pivot with no time property
      extremeTime = pivot.extremeTime ? pivot.extremeTime * 1000 : candle.time;
    } else if (extremeTime < 10000000000) {
      // Time is in seconds, convert to milliseconds
      extremeTime = extremeTime * 1000;
    }
    
    if (!confirmTime) {
      // Legacy pivot with no confirmationTime property
      confirmTime = pivot.confirmTime ? pivot.confirmTime * 1000 : candle.time;
    } else if (confirmTime < 10000000000) {
      // Time is in seconds, convert to milliseconds
      confirmTime = confirmTime * 1000;
    }
    
    // Convert timestamps to Date objects for consistent formatting
    const extremeDate = new Date(extremeTime);
    const confirmDate = new Date(confirmTime);
    
    // Format the timestamps in a readable format
    const extremeTimeStr = extremeDate.toLocaleString();
    const confirmTimeStr = confirmDate.toLocaleString();
    
    // Enhanced pivot with both timestamps - match pivotTimestampTest.js format
    const line = `\n${prefix}[PIVOT] ${pivotType} @ ${pivot.price.toFixed(2)} | ` +
      `Extreme: ${extremeTimeStr} | Confirm: ${confirmTimeStr} | ` +
      `Move: ${pivot.movePct.toFixed(2)}% | ` +
      `Bars: ${String(pivot.bars || 'N/A').padStart(4, ' ')} ` +
      this.formatEdges(pivot.edges);

    console.log((pivot.type === 'high' ? COLOR_GREEN : COLOR_RED) + line + COLOR_RESET);
  }

  logLimitOrder(order, candle, cancelReason) {
    if (this.performanceMode || !this.showLimits) return;
    // Call original logLimitOrder without edge data
    if (!order.edges) {
      super.logLimitOrder(order, candle, cancelReason);
      return;
    }

    if (this.performanceMode || !this.showLimits) return;

    const line = `[ORDER] ${order.type.toUpperCase()} LIMIT @ ${order.price.toFixed(2)} | ` +
      `Reference: ${order.referencePrice.toFixed(2)} | ` +
      `Move: ${order.movePct.toFixed(2)}%` +
      this.formatEdges(order.edges);

    if (cancelReason) {
      console.log( line + ` | Cancelled: ${cancelReason}`  );
    } else {
      console.log( line );
    }
  }

  logLimitOrderCreation(order, pivot, avgMove) {
    if (this.performanceMode || !this.showLimits) return;

    const orderType = order.type ? order.type.toUpperCase() : 'N/A';
    const line = `[ORDER] ${orderType} LIMIT @ ${order.price.toFixed(2)} | ` +
      `Reference: ${(order.referencePrice || pivot.price).toFixed(2)} | ` +
      `Move: ${typeof order.movePct === 'number' ? order.movePct.toFixed(2) : 'N/A'}%` +
      this.formatEdges(order.edges);

    console.log(line);
  }

  logLimitOrderFill(order, candle) {
    const timeStr = formatDateTime(candle.time);
    const line = `[ORDER] ${order.side} LIMIT FILLED @ ${order.price.toFixed(2)} | Current: ${candle.close.toFixed(2)} | Time: ${timeStr} Edges: ${this.formatEdges(order.edges)}`;
    console.log(COLOR_YELLOW + line + COLOR_RESET);
  }

  logLimitOrderClose(order, exitPrice, pnl) {
    if (this.performanceMode || !this.showLimits) return;

    const pnlColor = pnl >= 0 ? COLOR_BRIGHT_CYAN : COLOR_YELLOW;
    const result = pnl >= 0 ? 'PROFIT' : 'LOSS';
    const line = `[ORDER ${order.tradeNumber}] ${order.type.toUpperCase()} LIMIT CLOSED @ ${exitPrice.toFixed(2)} | ` +
      `${result} ${pnl.toFixed(2)}%` +
      this.formatEdges(order.edges);

    console.log(pnlColor + line + COLOR_RESET);
  }
  
  logEdgeProximity(pivot, proximityPct, averageMove, action) {
    if (this.performanceMode) return;
    
    // Use magenta to make it stand out
    console.log(COLOR_MAGENTA + `[EDGE ALERT] Detected proximity to average daily edge!`);
    console.log(`  Current position: ${proximityPct.toFixed(2)}% of average daily move`);
    console.log(`  Average daily move: ${averageMove.toFixed(2)}%`);
    console.log(`  Current move: ${pivot.edges?.daily?.move?.toFixed(2)}%`); // Debug info
    
    // Log the action taken
    if (action === 'noTrade') {
      console.log(`  Action: Not placing order due to edge proximity`);
    } else if (action === 'reverseTrade') {
      console.log(`  Action: Reversing trade direction due to edge proximity`);
    }
    
    // Show the edge data
    if (pivot.edges) {
      console.log(`  Edge Details: ${this.formatEdges(pivot.edges)}`);
    }
    
    console.log(COLOR_RESET);
  }

  logAllPivots(pivots) {
    if (this.performanceMode || !this.showPivot) return;
    if (!pivots || pivots.length === 0) return;
    console.log(`\n${COLOR_BRIGHT}--- Pivot Details ---${COLOR_RESET}`);
    pivots.forEach((pivot, i) => {
        const type = pivot.type === 'high' ? 'HIGH' : 'LOW';
        const typeColor = pivot.type === 'high' ? COLOR_GREEN : COLOR_RED;
        const price = pivot.price.toFixed(2);
        
        // Robustly determine the extreme time, checking for different properties and formats
        let extremeTimestamp = pivot.extremeTime || pivot.time;
        if (extremeTimestamp < 10000000000) { // If timestamp is in seconds
            extremeTimestamp *= 1000;
        }

        const extremeDate = formatDateTime(extremeTimestamp);

        const move = (pivot.move || 0).toFixed(2);
        const bars = (pivot.bars || 0).toString().padStart(5, ' ');

        const edgeString = this.formatEdges(pivot.edges);

        const logLine = `${(i + 1).toString().padStart(3)}.[PIVOT] ${type.padEnd(4)} @ ${String(price).padEnd(10)} | Extreme: ${extremeDate} | Move: ${move}% | Bars: ${bars} |${edgeString}`;

        console.log(typeColor + logLine + COLOR_RESET);
    });
    console.log(`${COLOR_BRIGHT}-----------------------${COLOR_RESET}\n`);
  }

  logTradeDetails(trade, index) {
    if (this.performanceMode || !this.showTradeDetails) return;

    // Handle trades that were not filled (e.g., cancelled orders)
    if (typeof trade.entryPrice === 'undefined' || trade.entryPrice === null) {
      console.log('\n' + '-'.repeat(80));
      console.log(COLOR_YELLOW + `[TRADE ${index + 1}] CANCELLED/NOT FILLED` + COLOR_RESET);
      if (trade.cancellationReason) {
        console.log(COLOR_YELLOW + `  Reason: ${trade.cancellationReason}` + COLOR_RESET);
      }
      // Log basic details if available
      if (trade.side && trade.type) {
        console.log(COLOR_CYAN + `  Side: ${trade.side}, Type: ${trade.type}` + COLOR_RESET);
      }
      console.log('-'.repeat(80));
      return;
    }

    const result = trade.pnl >= 0 ? 'WIN' : 'LOSS';
    const color = result === 'WIN' ? COLOR_GREEN : COLOR_RED;
    const side = trade.side === 'BUY' ? 'LONG' : 'SHORT';

    console.log('\n' + '-'.repeat(80));
    console.log(color + `[TRADE ${index + 1}] ${side} | P&L: ${trade.pnl.toFixed(2)}% | ${result}` + COLOR_RESET);

    // Edge data (if available)
    if (trade.edges) {
      console.log('\nEdges: ' + this.formatCurrentEdges(trade.edges));
      console.log('Average Edge ' + this.formatAverageEdges(trade.edges) + 
                ' | Range/Total Edge ' + this.formatTotalEdges(trade.edges) + '\n');
    }

    // Timing and price details
    console.log(COLOR_CYAN +
      `  Entry: ${formatDateTime(trade.entryTime)} at $${trade.entryPrice.toFixed(4)}\n` +
      `  Exit:  ${formatDateTime(trade.exitTime)} at $${trade.exitPrice.toFixed(4)}\n` +
      `  Duration: ${formatDuration(trade.duration)}` +
      COLOR_RESET
    );
    console.log('-'.repeat(80));
  }

  // Helper methods for formatting different parts of edge data
  formatCurrentEdges(edges) {
    if (!edges) return '';
    
    return ['D', 'W', 'M'].map(t => {
      const type = t === 'D' ? 'daily' : t === 'W' ? 'weekly' : 'monthly';
      const edge = edges[type];
      if (!edge) return '';
      
      const direction = edge.position >= 0 ? 'U' : 'D';
      const sign = edge.position >= 0 ? '+' : '';  // Negative sign is already included
      return `${t}:${sign}${edge.position.toFixed(1)}%(${direction})`;
    }).filter(Boolean).join(' ');
  }

  formatAverageEdges(edges) {
    if (!edges) return '';
    
    return ['D', 'W', 'M'].map(t => {
      const type = t === 'D' ? 'daily' : t === 'W' ? 'weekly' : 'monthly';
      const edge = edges[type];
      if (!edge || !edge.averageMove) return '';
      
      const avgMove = type === 'daily' 
        ? edge.averageMove.week  // Use weekly average for daily
        : edge.averageMove;      // Use direct average for weekly/monthly
      
      const direction = avgMove >= 0 ? 'U' : 'D';
      const sign = avgMove >= 0 ? '+' : '';  // Negative sign is already included
      return `${t}:${sign}${avgMove.toFixed(1)}%(${direction})`;
    }).filter(Boolean).join(' ');
  }

  formatTotalEdges(edges) {
    if (!edges) return '';
    
    return ['D', 'W', 'M'].map(t => {
      const type = t === 'D' ? 'daily' : t === 'W' ? 'weekly' : 'monthly';
      const edge = edges[type];
      if (!edge || !edge.move) return '';
      
      const direction = edge.move >= 0 ? 'U' : 'D';
      const sign = edge.move >= 0 ? '+' : '';  // Negative sign is already included
      return `${t}:${sign}${edge.move.toFixed(1)}%(${direction})`;
    }).filter(Boolean).join(' ');
  }

  logFinalSummary(trades, statistics) {
    // If trade details are enabled, log each one here under a separate header
    if (this.showTradeDetails && trades && trades.length > 0) {
      console.log('\n' + '-'.repeat(42));
      console.log(COLOR_YELLOW + '— Trade Details —' + COLOR_RESET);
      trades.forEach((trade, index) => {
        this.logTradeDetails(trade, index);
      });
    }

    // Call parent for the main summary statistics
    super.logFinalSummary(trades, statistics);
  }
}
