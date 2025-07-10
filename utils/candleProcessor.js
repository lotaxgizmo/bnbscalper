export const processCandleData = (candles) => {
  // Calculate all percentage differences and averages
  const candlesWithStats = candles.map(c => ({
    ...c,
    time: new Date(c.time).toLocaleTimeString(),
    percentDiff: ((c.high - c.low) / c.low * 100).toFixed(2),
    avgPrice: ((parseFloat(c.high) + parseFloat(c.low)) / 2).toFixed(2)
  }));

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
    highDiffCount: 0,
    correctionToNormalCount: 0,
    highDiffCountLow: 0,
    correctionToLowCount: 0
  };
  
  let inHighDiff = false;
  let inHighDiffLow = false;

  candlesWithStats.forEach((candle) => {
    const diff = parseFloat(candle.percentDiff);
    
    // Check for high volatility start
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
  });

  return {
    ...stats,
    correctionToNormalRate: ((stats.correctionToNormalCount / stats.highDiffCount) * 100).toFixed(1),
    correctionToLowRate: ((stats.correctionToLowCount / stats.highDiffCountLow) * 100).toFixed(1)
  };
};
