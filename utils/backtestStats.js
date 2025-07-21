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
      excursions: this.calculateExcursions(),
      capital: this.calculateCapitalStats()
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
      winRate,
      wins,
      losses: this.trades.length - wins,
      totalPnL,
      avgPnL,
      highestWinPnL,
      lowestWinPnL,
      highestLossPnL,
      lowestLossPnL
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
      avgMFE,
      avgMAE,
      maxMFE,
      maxMAE
    };
  }

  calculateCapitalStats() {
    const initialCapital = this.trades[0].capitalBefore;
    const finalCapital = this.trades[this.trades.length - 1].capitalAfter;
    const totalReturn = ((finalCapital/initialCapital - 1)*100);

    // Calculate max drawdown
    let peak = initialCapital;
    let maxDrawdown = 0;
    this.trades.forEach(trade => {
      if (trade.capitalAfter > peak) peak = trade.capitalAfter;
      const drawdown = (peak - trade.capitalAfter) / peak * 100;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    });

    return {
      initialCapital,
      finalCapital,
      totalReturn,
      maxDrawdown
    };
  }
}
