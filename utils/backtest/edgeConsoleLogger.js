// edgeConsoleLogger.js
import { ConsoleLogger } from './consoleLogger.js';
import { colors } from '../formatters.js';
import { formatDateTime } from '../candleAnalytics.js';

const { reset: COLOR_RESET, red: COLOR_RED, green: COLOR_GREEN, yellow: COLOR_YELLOW, cyan: COLOR_CYAN } = colors;

export class EdgeConsoleLogger extends ConsoleLogger {
  formatEdges(edges) {
    if (!edges) return '';
    
    // Format edge data for daily, weekly, monthly
    return ` Edges: ` + ['D', 'W', 'M'].map(t => {
      const type = t === 'D' ? 'daily' : t === 'W' ? 'weekly' : 'monthly';
      const edge = edges[type];
      if (!edge) return '';
      return `${t}:${edge.position > 0 ? '+' : '-'}${edge.percentToEdge.toFixed(1)}%(${edge.direction[0].toUpperCase()})`;
    }).filter(Boolean).join(' ');
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
    
    const line = `${prefix}[PIVOT] ${pivotType} @ ${pivot.price.toFixed(2)} | ` +
      `Time: ${formatDateTime(candle.time)} | ` +
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
      console.log(COLOR_YELLOW + line + ` | Cancelled: ${cancelReason}` + COLOR_RESET);
    } else {
      console.log(COLOR_CYAN + line + COLOR_RESET);
    }
  }
}
