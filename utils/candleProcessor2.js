export const processCandleData = (candles) => {
  // Sort candles by timestamp in ascending order
  candles.sort((a, b) => new Date(a.time) - new Date(b.time));
  // Calculate close-to-close differences and averages
  const candlesWithStats = candles.map((c, index) => {
    const prevCandle = index > 0 ? candles[index - 1] : c;
    return {
      ...c,
      time: new Date(c.time).toLocaleTimeString(),
      percentDiff: ((c.close - prevCandle.close) / prevCandle.close * 100).toFixed(2),
      avgPrice: ((parseFloat(c.high) + parseFloat(c.low)) / 2).toFixed(2)
    };
  });

  // Find highest and lowest diff
  const highest = candlesWithStats.reduce((max, curr) => 
    parseFloat(curr.percentDiff) > parseFloat(max.percentDiff) ? curr : max
  );
  const lowest = candlesWithStats.reduce((min, curr) => 
    parseFloat(curr.percentDiff) < parseFloat(min.percentDiff) ? curr : min
  );

  // Calculate total average price and average difference
  const totalAvg = (candlesWithStats.reduce((sum, c) => sum + parseFloat(c.avgPrice), 0) / candlesWithStats.length).toFixed(2);
  const avgDiff = (candlesWithStats.reduce((sum, c) => sum + parseFloat(c.percentDiff), 0) / candlesWithStats.length).toFixed(2);

  return {
    candlesWithStats,
    highest,
    lowest,
    totalAvg,
    avgDiff
  };
};

export const calculatePercentiles = (candlesWithStats, lowPercentile, mediumPercentile, highPercentile) => {
  const sortedDiffs = candlesWithStats.map(c => parseFloat(c.percentDiff)).sort((a, b) => a - b);
  return {
    normalAvg: (candlesWithStats.reduce((sum, c) => sum + parseFloat(c.percentDiff), 0) / candlesWithStats.length).toFixed(2),
    lowAvg: (sortedDiffs[Math.floor(sortedDiffs.length * lowPercentile)]).toFixed(2),
    mediumAvg: (sortedDiffs[Math.floor(sortedDiffs.length * mediumPercentile)]).toFixed(2),
    highAvg: (sortedDiffs[Math.floor(sortedDiffs.length * highPercentile)]).toFixed(2)
  };
};

export const trackCorrections = (candlesWithStats, highAvg, normalAvg, lowAvg) => {
  let stats = {
    // Normal corrections
    highDiffCount: 0,
    correctionToNormalCount: 0,
    highDiffCountLow: 0,
    correctionToLowCount: 0,
    
    // Full reversals
    upMoves: 0,
    downMoves: 0,
    fullReversalsUp: 0,    // Down to Up
    fullReversalsDown: 0,  // Up to Down
    
    // Profit tracking
    upProfits: [],        // Profits from Down→Up reversals
    downProfits: [],      // Profits from Up→Down reversals
    lastExtremePrice: null,
    lastExtremeTime: null,
    bestReversal: {
      type: null,         // 'up' or 'down'
      profit: 0,
      entryPrice: 0,
      exitPrice: 0,
      entryTime: '',
      exitTime: ''
    }
  };
  
  let inHighDiff = false;
  let inHighDiffLow = false;
  let lastExtremeMove = null;  // 'up' or 'down'

  candlesWithStats.forEach((candle) => {
    const diff = parseFloat(candle.percentDiff);
    
    // Track normal corrections
    if (diff >= parseFloat(highAvg)) {
      if (!inHighDiff) {
        stats.highDiffCount++;
        inHighDiff = true;
      }
      if (!inHighDiffLow) {
        stats.highDiffCountLow++;
        inHighDiffLow = true;
      }
    } else {
      // Check correction to normal average
      if (diff <= parseFloat(normalAvg) && inHighDiff) {
        stats.correctionToNormalCount++;
        inHighDiff = false;
      }
      // Check correction to low average
      if (diff <= parseFloat(lowAvg) && inHighDiffLow) {
        stats.correctionToLowCount++;
        inHighDiffLow = false;
      }
    }
    
    // Track full reversals and calculate guaranteed profits
    const currentPrice = parseFloat(candle.close);
    const currentTime = candle.time;
    
    if (diff >= parseFloat(highAvg)) {
      if (lastExtremeMove === 'down') {
        stats.fullReversalsUp++;
        // Calculate guaranteed profit from lower to upper boundary
        // If price moves from -highAvg to +highAvg, that's our guaranteed profit
        const basePrice = 100; // Use 100 as base for easy percentage calc
        const entryPrice = basePrice * (1 - parseFloat(highAvg) / 100); // Price at lower boundary
        const exitPrice = basePrice * (1 + parseFloat(highAvg) / 100);  // Price at upper boundary
        const guaranteedProfit = ((exitPrice - entryPrice) / entryPrice) * 100;
        
        // Check if this is the best reversal (they should all have same profit)
        if (guaranteedProfit > stats.bestReversal.profit) {
          stats.bestReversal = {
            type: 'up',
            profit: guaranteedProfit,
            entryPrice: currentPrice * (1 - parseFloat(highAvg) / 100), // Estimated entry at boundary
            exitPrice: currentPrice * (1 + parseFloat(highAvg) / 100),  // Estimated exit at boundary
            entryTime: stats.lastExtremeTime || currentTime,
            exitTime: currentTime
          };
        }
      }
      lastExtremeMove = 'up';
      stats.lastExtremeTime = currentTime;
      stats.upMoves++;
    } else if (diff <= -parseFloat(highAvg)) {
      if (lastExtremeMove === 'up') {
        stats.fullReversalsDown++;
        // Calculate guaranteed profit from upper to lower boundary
        const basePrice = 100; // Use 100 as base for easy percentage calc
        const entryPrice = basePrice * (1 + parseFloat(highAvg) / 100);  // Price at upper boundary
        const exitPrice = basePrice * (1 - parseFloat(highAvg) / 100);   // Price at lower boundary
        const guaranteedProfit = ((entryPrice - exitPrice) / entryPrice) * 100;
        
        // Check if this is the best reversal (they should all have same profit)
        if (guaranteedProfit > stats.bestReversal.profit) {
          stats.bestReversal = {
            type: 'down',
            profit: guaranteedProfit,
            entryPrice: currentPrice * (1 + parseFloat(highAvg) / 100), // Estimated entry at boundary
            exitPrice: currentPrice * (1 - parseFloat(highAvg) / 100),  // Estimated exit at boundary
            entryTime: stats.lastExtremeTime || currentTime,
            exitTime: currentTime
          };
        }
      }
      lastExtremeMove = 'down';
      stats.lastExtremeTime = currentTime;
      stats.downMoves++;
    }
  });

  // Calculate guaranteed profit (same for all reversals of same type)
  const basePrice = 100;
  const upPrice = basePrice * (1 + parseFloat(highAvg) / 100);
  const downPrice = basePrice * (1 - parseFloat(highAvg) / 100);
  
  const guaranteedUpProfit = ((upPrice - downPrice) / downPrice * 100).toFixed(2);
  const guaranteedDownProfit = ((upPrice - downPrice) / upPrice * 100).toFixed(2);
  
  const avgUpProfit = stats.fullReversalsUp > 0 ? guaranteedUpProfit : '0.00';
  const avgDownProfit = stats.fullReversalsDown > 0 ? guaranteedDownProfit : '0.00';

  const totalReversals = stats.fullReversalsUp + stats.fullReversalsDown;
  const totalExtremeMoves = stats.upMoves + stats.downMoves;

  return {
    ...stats,
    correctionToNormalRate: ((stats.correctionToNormalCount / stats.highDiffCount) * 100).toFixed(1),
    correctionToLowRate: ((stats.correctionToLowCount / stats.highDiffCountLow) * 100).toFixed(1),
    totalReversals,
    totalExtremeMoves,
    fullReversalRate: totalExtremeMoves > 0 ? ((totalReversals / totalExtremeMoves) * 100).toFixed(1) : '0.0',
    avgUpProfit,
    avgDownProfit
  };
};
