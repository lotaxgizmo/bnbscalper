// backtestExporter.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class BacktestExporter {
  constructor(options = {}) {
    this.options = {
      saveJson: true,
      saveCsv: true,
      outputDir: path.join(dirname(dirname(__dirname)), 'data'),
      config: null,
      ...options
    };
    this.config = this.options.config;
  }

  async saveBacktestData(results, stats) {
    // Create output directory if it doesn't exist
    if (!fs.existsSync(this.options.outputDir)) {
      fs.mkdirSync(this.options.outputDir, { recursive: true });
    }

    if (this.options.saveJson) {
      await this.saveToJson(results, stats);
    }
    if (this.options.saveCsv) {
      await this.saveToCsv(results, stats);
    }
  }

  async saveToJson(results, stats) {
    const chartData = {
      trades: results.trades.map(t => ({
        entry: t.entry,
        exit: t.exit,
        entryTime: t.entryTime,
        exitTime: t.exitTime,
        pnl: t.pnl,
        isLong: t.isLong,
        result: t.result
      })),
      stats: {
        ...stats.basic,
        ...stats.advanced
      }
    };

    const jsonPath = path.join(this.options.outputDir, 'backtest_data.json');
    await fs.writeFileSync(jsonPath, JSON.stringify(chartData, null, 2));
  }

  async saveToCsv(results, stats) {
    const { basic, advanced, excursions } = stats;
    const csvPath = path.join(this.options.outputDir, 'backtest_summary.csv');
    
    const csvHeader = 'take_profit,stop_loss,total_trades,win_rate,failed_trades,total_pnl,avg_pnl,' +
                     'highest_win_pnl,lowest_win_pnl,highest_loss_pnl,lowest_loss_pnl,' +
                     'avg_favorable_excursion,highest_favorable,lowest_favorable,' +
                     'avg_adverse_excursion,highest_adverse,lowest_adverse\n';

    // For single backtest
    if (!Array.isArray(results)) {
      const csvData = `${this.config?.takeProfit || ''},${this.config?.stopLoss || ''},` +
                     `${basic.totalTrades},${basic.winRate},${basic.losses},${basic.totalPnL},${basic.avgPnL},` +
                     `${advanced.highestWinPnL},${advanced.lowestWinPnL},${advanced.highestLossPnL},${advanced.lowestLossPnL},` +
                     `${excursions.avgFavorable},${excursions.highestFavorable},${excursions.lowestFavorable},` +
                     `${excursions.avgAdverse},${excursions.highestAdverse},${excursions.lowestAdverse}\n`;

      await fs.writeFileSync(csvPath, csvHeader + csvData);
    } 
    // For multiple backtests (iteration mode)
    else {
      const csvRows = results.map(result => {
        const stats = result.stats;
        return `${result.config.takeProfit},${result.config.stopLoss},` +
               `${stats.basic.totalTrades},${stats.basic.winRate},${stats.basic.losses},` +
               `${stats.basic.totalPnL},${stats.basic.avgPnL},` +
               `${stats.advanced.highestWinPnL},${stats.advanced.lowestWinPnL},` +
               `${stats.advanced.highestLossPnL},${stats.advanced.lowestLossPnL},` +
               `${stats.excursions.avgFavorable},${stats.excursions.highestFavorable},` +
               `${stats.excursions.lowestFavorable},${stats.excursions.avgAdverse},` +
               `${stats.excursions.highestAdverse},${stats.excursions.lowestAdverse}`;
      }).join('\n');

      await fs.writeFileSync(csvPath, csvHeader + csvRows);
    }
  }
}
