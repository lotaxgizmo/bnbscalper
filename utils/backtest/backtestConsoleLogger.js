import { colors } from '../formatters.js';

export class BacktestConsoleLogger {
    constructor(config) {
        this.config = config;
    }

    logPivotDetails(pivots) {
        if (!this.config.showPivot) return;
        console.log('\n--- Pivot Details ---');
        pivots.forEach((pivot, i) => {
            const type = pivot.type === 'high' ? 'HIGH' : 'LOW';
            const typeColor = pivot.type === 'high' ? colors.red : colors.green;
            const price = pivot.price.toFixed(2);
            const extremeDate = new Date(pivot.extremeTime).toLocaleString();
            const confirmDate = new Date(pivot.time).toLocaleString();
            const move = (pivot.move || 0).toFixed(2);
            const bars = (pivot.bars || 0).toString().padStart(5, ' ');

            let edgeString = '';
            if (pivot.edges) {
                const edgeParts = [];
                for (const [tf, data] of Object.entries(pivot.edges)) {
                    const key = tf.charAt(0).toUpperCase();
                    const dir = data.direction === 'up' ? '(U)' : '(D)';
                    edgeParts.push(`${key}:${data.position.toFixed(1)}%${dir}`);
                }
                edgeString = `Edges: ${edgeParts.join(' ')}`;
            }

            console.log(
                `${i.toString().padStart(3)}. [${typeColor}PIVOT${colors.reset}] ${typeColor}${type.padEnd(4)}${colors.reset} @ ${price.padEnd(10)} | Extreme: ${extremeDate} | Confirm: ${confirmDate} | Move: ${move}% | Bars: ${bars} | ${edgeString}`
            );
        });
        console.log('---------------------\n');
    }

    logInitialConfig(symbol, interval, api) {
        console.log(`
${colors.bright}Starting Backtest with Executor...${colors.reset}`);
        console.log(`- Symbol: ${symbol}, Interval: ${interval}, API: ${api}`);
        console.log(`- Trade Config: ${this.config.strategyName}`);
    }

    logCacheStatus(isCached) {
        if (isCached) {
            console.log(`- Cache: ${colors.green}Found and loaded cached pivot data.${colors.reset}`);
        } else {
            console.log(`- Cache: ${colors.yellow}No cached data found. Fetching new data...${colors.reset}`);
        }
    }

    logError(message) {
        console.error(`${colors.red}ERROR: ${message}${colors.reset}`);
    }

    logNoTrades() {
        console.log(`${colors.yellow}No trades were executed in this backtest.${colors.reset}`);
    }

    logTradeDetails(trade, index) {
        const resultColor = trade.result === 'WIN' ? colors.green : colors.red;
        console.log(
            `  ${(index + 1).toString().padStart(3)} | ${resultColor}${trade.result.padEnd(4)}${colors.reset} | PNL: ${resultColor}${trade.pnl.toFixed(2)}%${colors.reset} | Side: ${trade.side.padEnd(4)} | Entry: ${trade.entryPrice.toFixed(2)} | Exit: ${trade.exitPrice.toFixed(2)} | Duration: ${(trade.duration / 1000).toFixed(1)}s`
        );
    }

    logFinalSummary(trades, stats) {
        console.log('
--- Backtest Summary ---');
        console.log(`Total Trades: ${stats.totalTrades}`);
        console.log(`Win Rate: ${stats.winRate.toFixed(2)}%`);
        console.log(`Average PNL: ${stats.avgPnl.toFixed(2)}%`);
        console.log(`Total PNL: ${stats.totalPnl.toFixed(2)}%`);
        console.log('------------------------\n');
    }

    logExportStatus() {
        console.log(`${colors.green}Backtest data exported successfully.${colors.reset}`);
    }
}
