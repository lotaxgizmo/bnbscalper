// backtestStats.js
export class BacktestStats {
  constructor(trades, config) {
    this.trades = trades;
    this.config = config;
  }

  calculate() {
    return {
      basic: this.calculateBasicStats(),
      advanced: this.calculateAdvancedStats(),
      excursions: this.calculateExcursions()
    };
  }

  calculateBasicStats() {
    const wins = this.trades.filter(t => t.result === 'WIN').length;
    const winRate = (wins / this.trades.length * 100);
    const totalPnL = this.trades.reduce((sum, t) => sum + t.pnl, 0);
    const avgPnL = totalPnL / this.trades.length;

    // Calculate P&L statistics for wins and losses
    const winningTrades = this.trades.filter(t => t.result === 'WIN');
    const losingTrades = this.trades.filter(t => t.result === 'LOSS');
    
    const highestWinPnL = winningTrades.length ? Math.max(...winningTrades.map(t => t.pnl)) : 0;
    const lowestWinPnL = winningTrades.length ? Math.min(...winningTrades.map(t => t.pnl)) : 0;
    const highestLossPnL = losingTrades.length ? Math.max(...losingTrades.map(t => t.pnl)) : 0;
    const lowestLossPnL = losingTrades.length ? Math.min(...losingTrades.map(t => t.pnl)) : 0;

    return {
      totalTrades: this.trades.length,
      winRate: Number(winRate.toFixed(2)),
      wins,
      losses: this.trades.length - wins,
      totalPnL: Number(totalPnL.toFixed(2)),
      avgPnL: Number(avgPnL.toFixed(2)),
      highestWinPnL: Number(highestWinPnL.toFixed(2)),
      lowestWinPnL: Number(lowestWinPnL.toFixed(2)),
      highestLossPnL: Number(highestLossPnL.toFixed(2)),
      lowestLossPnL: Number(lowestLossPnL.toFixed(2))
    };
  }

  calculateAdvancedStats() {
    const winningTrades = this.trades.filter(t => t.result === 'WIN');
    const losingTrades = this.trades.filter(t => t.result === 'LOSS');
    
    const highestWinPnL = winningTrades.length ? Math.max(...winningTrades.map(t => t.pnl)) : 0;
    const lowestWinPnL = winningTrades.length ? Math.min(...winningTrades.map(t => t.pnl)) : 0;
    const highestLossPnL = losingTrades.length ? Math.max(...losingTrades.map(t => t.pnl)) : 0;
    const lowestLossPnL = losingTrades.length ? Math.min(...losingTrades.map(t => t.pnl)) : 0;

    // Calculate Sharpe Ratio
    const returns = this.trades.map(t => t.pnl);
    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const stdDev = Math.sqrt(returns.map(r => Math.pow(r - avgReturn, 2)).reduce((a, b) => a + b, 0) / returns.length);
    const sharpeRatio = (avgReturn / stdDev).toFixed(2);

    return {
      highestWinPnL: highestWinPnL.toFixed(2),
      lowestWinPnL: lowestWinPnL.toFixed(2),
      highestLossPnL: highestLossPnL.toFixed(2),
      lowestLossPnL: lowestLossPnL.toFixed(2),
      sharpeRatio
    };
  }

  calculateExcursions() {
    const avgMFE = this.trades.reduce((sum, t) => sum + t.maxFavorableExcursion, 0) / this.trades.length;
    const avgMAE = this.trades.reduce((sum, t) => sum + t.maxAdverseExcursion, 0) / this.trades.length;
    const maxMFE = Math.max(...this.trades.map(t => t.maxFavorableExcursion));
    const maxMAE = Math.max(...this.trades.map(t => t.maxAdverseExcursion));

    return {
      avgFavorable: Number(avgMFE.toFixed(2)),
      highestFavorable: Number(maxMFE.toFixed(2)),
      lowestFavorable: Number(Math.min(...this.trades.map(t => t.maxFavorableExcursion)).toFixed(2)),
      avgAdverse: Number(avgMAE.toFixed(2)),
      highestAdverse: Number(maxMAE.toFixed(2)),
      lowestAdverse: Number(Math.min(...this.trades.map(t => t.maxAdverseExcursion)).toFixed(2))
    };
  }


}
