import { colors } from './formatters.js';

export const printCandleData = (candlesWithStats, highAvg, mediumAvg, normalAvg, time) => {
  console.log(`\n=== BNB ${time} CANDLE DATA ===\n`);

  candlesWithStats.forEach((c, index) => {
    const diff = parseFloat(c.percentDiff);
    let diffColor = colors.reset;
    let marker = '•';
    
    if (diff >= parseFloat(highAvg)) {
      diffColor = colors.red;
      marker = '▲';
    } else if (diff >= parseFloat(mediumAvg)) {
      diffColor = colors.yellow;
      marker = '►';
    } else if (diff <= parseFloat(normalAvg)) {
      diffColor = colors.green;
      marker = '▼';
    }
    
    console.log(
      `${marker} ${c.time} ${colors.cyan}|${colors.reset} ` +
      `${colors.magenta}H${colors.reset}: ${c.high.toFixed(4)} ${colors.magenta}L${colors.reset}: ${c.low.toFixed(4)} ${colors.cyan}|${colors.reset} ` +
      `${colors.yellow}Avg${colors.reset}: ${c.avgPrice} ${colors.cyan}|${colors.reset} ` +
      `${colors.cyan}Diff${colors.reset}: ${diffColor}${c.percentDiff}%${colors.reset} ${colors.cyan}|${colors.reset} ` +
      `${colors.cyan}Close${colors.reset}: ${colors.magenta}${c.close.toFixed(4)}${colors.reset}`
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
  const separator = '═'.repeat(50);
  console.log(`\n${separator}`);
  console.log(`${' '.repeat(20)}ANALYSIS${' '.repeat(20)}`);
  console.log(separator + '\n');
  
  // Highest and lowest differences with timestamps
  console.log(`${colors.cyan}EXTREMES${colors.reset}`);
  console.log(`▲ Peak: ${colors.red}${highest.percentDiff}%${colors.reset} at ${highest.time}`);
  console.log(`▼ Bottom: ${colors.green}${lowest.percentDiff}%${colors.reset} at ${lowest.time}`);
  console.log(separator);
  
  // Percentile analysis
  console.log(`${colors.cyan}VOLATILITY BANDS${colors.reset}`);
  console.log(`► Baseline: ${normalAvg}%`);
  console.log(`▼ Low Band (${(lowPercentile * 100).toFixed(0)}th): ${colors.green}${lowAvg}%${colors.reset}`);
  console.log(`► Mid Band (${(mediumPercentile * 100).toFixed(0)}th): ${colors.yellow}${mediumAvg}%${colors.reset}`);
  console.log(`▲ High Band (${(highPercentile * 100).toFixed(0)}th): ${colors.red}${highAvg}%${colors.reset}`);
  console.log(separator);
  
  // Correction analysis
  console.log(`${colors.cyan}CORRECTION METRICS${colors.reset}`);
  console.log(`High → Normal Gap: ${colors.magenta}${(parseFloat(highAvg) - parseFloat(normalAvg)).toFixed(2)}%${colors.reset}`);
  console.log(`Normal Corrections: ${colors.green}${correctionToNormalCount}${colors.reset}`);
  console.log(`\nHigh → Low Gap: ${colors.magenta}${(parseFloat(highAvg) - parseFloat(lowAvg)).toFixed(2)}%${colors.reset}`);
  console.log(`Deep Corrections: ${colors.green}${correctionToLowCount}${colors.reset}`);
  console.log(separator);
  
  // Market overview
  console.log(`${colors.cyan}MARKET OVERVIEW${colors.reset}`);
  console.log(`Average Price: ${colors.yellow}$${totalAvg}${colors.reset}`);
  console.log(`Time Window: ${colors.magenta}${durationStr}${colors.reset}`);
  console.log(separator + '\n');
};
