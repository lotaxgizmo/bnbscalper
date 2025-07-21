// consoleLogger.js
import { colors, formatDuration } from '../formatters.js';
import { formatDateTime } from '../candleAnalytics.js';

const { reset: COLOR_RESET, red: COLOR_RED, green: COLOR_GREEN, yellow: COLOR_YELLOW, cyan: COLOR_CYAN } = colors;

export class ConsoleLogger {
  constructor(config = {}) {
    this.performanceMode = config.performanceMode || false;
    this.showPivot = config.showPivot || false;
    this.showLimits = config.showLimits || false;
  }

  logInitialConfig(symbol, interval, api, tradeConfig) {
    if (this.performanceMode) return;
    
    console.log(`\n▶ Backtesting ${tradeConfig.direction.toUpperCase()} Strategy on ${symbol} [${interval}] using ${api}\n`);
    console.log('Trade Settings:');
    console.log(`- Direction: ${tradeConfig.direction}`);
    console.log(`- Take Profit: ${tradeConfig.takeProfit}%`);
    console.log(`- Stop Loss: ${tradeConfig.stopLoss}%`);
    console.log(`- Leverage: ${tradeConfig.leverage}x`);
    console.log(`- Maker Fee: ${tradeConfig.totalMakerFee}%`);
    console.log(`- Initial Capital: $${tradeConfig.initialCapital}`);
    console.log(`- Risk Per Trade: ${tradeConfig.riskPerTrade}%`);
    console.log('');
  }

  logCacheStatus(isCached) {
    if (this.performanceMode) return;
    console.log(isCached ? 'Using cached pivot data...' : 'No cache found, fetching fresh data...');
  }

  logFetchDetails(candles, limit, delay) {
    if (this.performanceMode) return;
    console.log(`Using delay of ${delay} intervals for historical data`);
    console.log(`Fetched ${candles.length} candles (limit=${limit}).`);
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
        `${trade.result}` + COLOR_RESET
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

  logPivot(pivot, candle) {
    if (this.performanceMode || !this.showPivot) return;
    
    const line = `[PIVOT] ${pivot.type.toUpperCase()} @ ${pivot.price.toFixed(2)} | ` +
      `Time: ${formatDateTime(candle.time)} | ` +
      `Move: ${pivot.movePct.toFixed(2)}% | ` +
      `Bars: ${pivot.bars || 'N/A'}`;

    console.log((pivot.type === 'high' ? COLOR_GREEN : COLOR_RED) + line + COLOR_RESET);
  }

  logLimitOrder(order, candle, cancelReason) {
    if (this.performanceMode || !this.showLimits) return;

    const priceMove = order.type === 'buy' 
      ? ((candle.close/order.price - 1)*100)
      : ((1 - candle.close/order.price)*100);

    console.log(`[ORDER] CANCEL ${order.type.toUpperCase()} LIMIT @ ${order.price.toFixed(2)} | ` +
      `Current: ${candle.close.toFixed(2)} | ` +
      `Move: ${priceMove.toFixed(2)}% | ` +
      `Reason: ${cancelReason}`);
  }

  logLimitOrderCreation(order, pivot, avgMove) {
    if (this.performanceMode || !this.showLimits) return;

    console.log(COLOR_YELLOW + 
      `[ORDER] ${order.isLong ? 'BUY' : 'SELL'} LIMIT @ ${order.price.toFixed(2)} | ` +
      `Reference: ${pivot.price.toFixed(2)} | Move: ${(avgMove * 100).toFixed(2)}%` +
      COLOR_RESET
    );
  }

  logLimitOrderFill(order, candle) {
    if (this.performanceMode || !this.showLimits) return;

    console.log(COLOR_GREEN + 
      `[ORDER] ${order.type.toUpperCase()} LIMIT FILLED @ ${order.price.toFixed(2)} | ` +
      `Current: ${candle.close.toFixed(2)} | ` +
      `Time: ${formatDateTime(candle.time)}` +
      COLOR_RESET
    );
  }

  logFinalSummary(trades, statistics) {
    if (this.performanceMode) return;

    console.log('\n' + '-'.repeat(42));
    console.log(COLOR_YELLOW + '— Final Summary —' + COLOR_RESET);
    
    // Date range
    const firstTrade = trades[0];
    const lastTrade = trades[trades.length - 1];
    const elapsedMinutes = Math.floor((lastTrade.exitTime - firstTrade.orderTime) / (60 * 1000));
    
    console.log(`\nDate Range:\n${formatDateTime(firstTrade.orderTime)} → ${formatDateTime(lastTrade.exitTime)}`);
    console.log(`\nElapsed Time: ${formatDuration(elapsedMinutes)}`);
    
    console.log('\n' + '-'.repeat(80) + '\n');
    console.log(COLOR_CYAN + `Total Trades: ${trades.length}` + COLOR_RESET + '\n');

    // Win/Loss Statistics
    console.log(COLOR_GREEN + `Win Rate: ${statistics.basic.winRate.toFixed(1)}% (${statistics.basic.wins}/${trades.length})` + COLOR_RESET);
    console.log(`Failed Trades: ${statistics.basic.losses}`);
    
    // Overall P&L
    const pnlColor = statistics.basic.totalPnL >= 0 ? COLOR_GREEN : COLOR_RED;
    console.log(`${pnlColor}Total P&L: ${statistics.basic.totalPnL.toFixed(2)}%${COLOR_RESET}`);
    console.log(`${pnlColor}Average P&L per Trade: ${statistics.basic.avgPnL.toFixed(2)}%${COLOR_RESET}`);
    
    console.log('-'.repeat(80));
    
    // Winning Trades Analysis
    console.log(COLOR_GREEN + '\nWinning Trades P&L Analysis:' + COLOR_RESET);
    console.log(`  Highest Win: +${statistics.basic.highestWinPnL.toFixed(2)}%`);
    console.log(`  Lowest Win: +${statistics.basic.lowestWinPnL.toFixed(2)}%`);
    
    // Losing Trades Analysis
    console.log(COLOR_RED + '\nLosing Trades P&L Analysis:' + COLOR_RESET);
    console.log(`  Highest Loss: ${statistics.basic.highestLossPnL.toFixed(2)}%`);
    console.log(`  Lowest Loss: ${statistics.basic.lowestLossPnL.toFixed(2)}%`);
    
    console.log('-'.repeat(80));
    
    // Excursion Analysis
    console.log(COLOR_GREEN + 'Favorable Excursion Analysis (Price Movement in Our Favor):' + COLOR_RESET);
    console.log(`  Average Movement: +${statistics.excursions.avgFavorable.toFixed(2)}%`);
    console.log(`  Highest Movement: +${statistics.excursions.highestFavorable.toFixed(2)}%`);

    console.log(COLOR_RED + '\nAdverse Excursion Analysis (Price Movement Against Us):' + COLOR_RESET);
    console.log(`  Average Movement: -${statistics.excursions.avgAdverse.toFixed(2)}%`);
    console.log(`  Highest Movement: -${statistics.excursions.highestAdverse.toFixed(2)}%`);

    console.log('-'.repeat(80) + '\n');
    
    // Capital Analysis
    console.log(COLOR_CYAN + `Starting Capital: $${statistics.capital.initialCapital.toFixed(2)}` + COLOR_RESET);
    console.log(COLOR_CYAN + `Final Capital: $${statistics.capital.finalCapital.toFixed(2)}` + COLOR_RESET);
    const growthColor = statistics.capital.totalReturn >= 0 ? COLOR_GREEN : COLOR_RED;
    console.log(growthColor + `Total Return: ${statistics.capital.totalReturn.toFixed(2)}%` + COLOR_RESET);
  }

  logExportStatus() {
    if (!this.performanceMode) {
      console.log('\nResults saved successfully');
    }
  }

  logNoTrades() {
    console.log('No trades executed.');
  }

  logError(message) {
    console.error('❌ ' + message);
  }
}
