// edgeConsoleLogger.js
import { ConsoleLogger } from './consoleLogger.js';
import { colors, formatDuration } from '../formatters.js';
import { formatDateTime } from '../candleAnalytics.js';

const { reset: COLOR_RESET, red: COLOR_RED, green: COLOR_GREEN, yellow: COLOR_YELLOW, cyan: COLOR_CYAN, magenta: COLOR_MAGENTA, bright: COLOR_BRIGHT, brightCyan: COLOR_BRIGHT_CYAN } = colors;

export class EdgeConsoleLogger extends ConsoleLogger {
  formatEdges(edges) {
    if (!edges) return '';
    
    // Format current edge data
    const currentEdge = ' Edges: ' + ['D', 'W', 'M'].map(t => {
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
    const totalEdge = ' | Range/Total Edge ' + ['D', 'W', 'M'].map(t => {
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
    
    // Increment pair count when we see a new high after a low or vice versa
    if (this.lastPivotType !== pivot.type) {
      if (pivot.type === 'high') this.pivotPairCount++;
      this.lastPivotType = pivot.type;
    }
    
    // Only show number for lows (start of pair)
    const paddedNumber = pivot.type === 'low' ? String(Math.ceil(this.pivotPairCount)).padStart(3, ' ') : '   ';
    const prefix = pivot.type === 'low' ? `${paddedNumber}.` : '    ';
    
    // Pad pivot type to match HIGH length
    const pivotType = pivot.type.toUpperCase().padEnd(4, ' ');
    
    // Use pivot.time directly for timestamp display (already in seconds)
    // This fixes the timestamp discrepancy issue
    const pivotTime = pivot.displayTime || formatDateTime(pivot.time * 1000);
    
    const line = `${prefix}[PIVOT] ${pivotType} @ ${pivot.price.toFixed(2)} | ` +
      `Time: ${pivotTime} | ` +
      `Candle Time: ${formatDateTime(candle.time)} | ` +
      `Move: ${pivot.movePct.toFixed(2)}% | ` +
      `Bars: ${String(pivot.bars || 'N/A').padStart(4, ' ').padEnd(4, ' ')} | ` +
      this.formatEdges(pivot.edges);

    console.log((pivot.type === 'high' ? COLOR_GREEN : COLOR_RED) + line + COLOR_RESET);
  }

  logLimitOrder(order, candle, cancelReason) {
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

    const line = `[ORDER] ${order.type.toUpperCase()} LIMIT @ ${order.price.toFixed(2)} | ` +
      `Reference: ${order.referencePrice.toFixed(2)} | ` +
      `Move: ${order.movePct.toFixed(2)}%` +
      this.formatEdges(order.edges);

    console.log(line);
  }

  logLimitOrderFill(order, candle) {
    if (this.performanceMode || !this.showLimits) return;

    const line = `[ORDER] ${order.type.toUpperCase()} LIMIT FILLED @ ${order.price.toFixed(2)} | ` +
      `Current: ${candle.close.toFixed(2)} | ` +
      `Time: ${formatDateTime(candle.time)}` +
      this.formatEdges(order.edges);

    console.log(COLOR_CYAN + line + COLOR_RESET);
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

  logTradeDetails(trade, index) {
    if (!this.performanceMode) {
      console.log('\n' + '-'.repeat(80));

      const color = trade.result === 'WIN' ? COLOR_GREEN : COLOR_RED;
      const rawPriceMove = trade.isLong
        ? ((trade.exit - trade.entry) / trade.entry * 100)
        : ((trade.entry - trade.exit) / trade.entry * 100);

      // Trade header
      console.log(color + `[TRADE ${index+1}] ${trade.isLong ? 'LONG' : 'SHORT'} | ` +
        `Entry: ${trade.entry.toFixed(2)} | ` +
        `Exit: ${trade.exit.toFixed(2)} | ` +
        `Move: ${rawPriceMove.toFixed(2)}% | ` +
        `P&L: ${trade.pnl.toFixed(2)}% | ` +
        `Capital: $${trade.capitalBefore.toFixed(2)} → $${trade.capitalAfter.toFixed(2)} | ` +
        `${trade.result}` + `\n\n` +
        (trade.edges ? this.formatEdges(trade.edges) : '') +
        COLOR_RESET
      );

      // Excursion analysis
      console.log(COLOR_YELLOW +
        `  Max Favorable: +${trade.maxFavorableExcursion.toFixed(2)}%\n` +
        `  Max Adverse:   -${trade.maxAdverseExcursion.toFixed(2)}%` +
        COLOR_RESET
      );

      // Timing details
      console.log(COLOR_CYAN +
        `  Order Time: ${formatDateTime(trade.orderTime)}\n` +
        `  Entry Time: ${formatDateTime(trade.entryTime)}\n` +
        `  Exit Time:  ${formatDateTime(trade.exitTime)}\n` +
        `  Duration:   ${formatDuration(Math.floor((trade.exitTime - trade.entryTime) / (60 * 1000)))}` +
        COLOR_RESET
      );
      console.log('-'.repeat(80));
    }
  }
}
