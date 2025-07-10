import { colors } from './formatters.js';

export const printCandleData = (candlesWithStats, highAvg, mediumAvg, normalAvg, time) => {
  console.log(`Recent BNB ${time} candles:\n`);

  candlesWithStats.forEach((c, index) => {
    const diff = parseFloat(c.percentDiff);
    let diffColor = colors.reset;
    
    if (diff >= parseFloat(highAvg)) {
      diffColor = colors.red;
    } else if (diff >= parseFloat(mediumAvg)) {
      diffColor = colors.yellow;
    } else if (diff <= parseFloat(normalAvg)) {
      diffColor = colors.green;
    }
    
    console.log(
      `${(index + 1).toString().padStart(4, ' ')}. ${c.time} | ` +
      `H: ${c.high.toFixed(4)} L: ${c.low.toFixed(4)} | ` +
      `Avg: ${c.avgPrice} | ` +
      `Diff: ${diffColor}${c.percentDiff}%${colors.reset} | ` +
      `C: ${colors.cyan}${c.close.toFixed(4)}${colors.reset}`
    );
  });
};

export const printSummary = ({
  highest,
  lowest,
  normalAvg,
  lowAvg,
  mediumAvg,
  highAvg,
  lowPercentile,
  mediumPercentile,
  highPercentile,
  correctionToNormalCount,
  correctionToLowCount,
  totalAvg,
  durationStr
}) => {
  console.log('\n\nSUMMARY:\n');
  
  // Highest and lowest differences
  console.log(colors.red + `Highest difference: ${highest.percentDiff}% at ${highest.time}` + colors.reset);
  console.log(colors.green + `Lowest difference: ${lowest.percentDiff}% at ${lowest.time}` + colors.reset);
  console.log();
  
  // Averages
  console.log(`Normal average diff: ${normalAvg}% (baseline)`);
  console.log(colors.red + `Low average diff: ${lowAvg}% (${(lowPercentile * 100).toFixed(0)}th percentile)` + colors.reset);
  console.log(colors.cyan + `Medium average diff: ${mediumAvg}% (${(mediumPercentile * 100).toFixed(0)}th percentile)` + colors.reset);
  console.log(colors.yellow + `High average diff: ${highAvg}% (${(highPercentile * 100).toFixed(0)}rd percentile)` + colors.reset);
  console.log();
  
  // Corrections
  console.log(colors.magenta + `Difference between high and normal average: ${(parseFloat(highAvg) - parseFloat(normalAvg)).toFixed(2)}%` + colors.reset);
  console.log(colors.green + `Successfully corrected to normal average: ${correctionToNormalCount}` + colors.reset);
  console.log();
  
  console.log(colors.magenta + `Difference between high and low average: ${(parseFloat(highAvg) - parseFloat(lowAvg)).toFixed(2)}%` + colors.reset);
  console.log(colors.green + `Successfully corrected to low average: ${correctionToLowCount}` + colors.reset);
  console.log();
  
  // Summary stats
  console.log(colors.cyan + `Total average price: $${totalAvg}` + colors.reset);
  console.log(colors.yellow + `Time period: ${durationStr}` + colors.reset);
};
