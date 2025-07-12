import { colors } from './formatters.js';
import { symbol } from '../config.js';

export const printCandleData = (candlesWithStats, highAvg, mediumAvg, normalAvg, time) => {
  console.log(`\n=== ${symbol} ${time} CANDLE DATA ===\n`);

  candlesWithStats.forEach((c, index) => {
    const candleNum = `[${(index + 1).toString().padStart(3, '0')}]`;
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
      `${colors.cyan}${candleNum}${colors.reset} ${marker} ${c.displayTime} ${colors.cyan}|${colors.reset} ` +
      `${colors.magenta}H${colors.reset}: ${c.high.toFixed(4)} ${colors.magenta}L${colors.reset}: ${c.low.toFixed(4)} ${colors.cyan}|${colors.reset} ` +
      `${colors.yellow}Avg${colors.reset}: ${c.avgPrice} ${colors.cyan}|${colors.reset} ` +
      `${colors.cyan}Diff${colors.reset}: ${diffColor}${c.percentDiff}%${colors.reset} ${colors.cyan}|${colors.reset} ` +
      `${colors.cyan}Close${colors.reset}: ${colors.magenta}${c.close.toFixed(4)}${colors.reset}`
    );
  });
};

export const printSummary = ({
  candlesWithStats,
  highest,
  lowest,
  normalAvg,
  lowAvg,
  mediumAvg,
  highAvg,
  topAvg,
  lowPercentile,
  mediumPercentile,
  highPercentile,
  topPercentile,
  correctionToNormalCount,
  correctionToLowCount,
  totalAvg,
  durationStr,
  fullReversalsUp,
  fullReversalsDown,
  upMoves,
  downMoves,
  totalReversals,
  totalExtremeMoves,
  fullReversalRate,
  avgUpProfit,
  avgDownProfit,
  bestReversal
}) => {
  console.log('\n');
 
  
  
  // Highest and lowest differences with timestamps
  console.log(`${colors.cyan}EXTREMES${colors.reset}`);
  console.log(`▲ Peak: ${colors.red}${highest.percentDiff}%${colors.reset} at ${highest.displayTime} | Price: ${colors.yellow}$${highest.close.toFixed(4)}${colors.reset}`);
  console.log(`▼ Bottom: ${colors.green}${lowest.percentDiff}%${colors.reset} at ${lowest.displayTime} | Price: ${colors.yellow}$${lowest.close.toFixed(4)}${colors.reset}`);
  console.log('═'.repeat(50));
  
  // Percentile analysis
  console.log(`${colors.cyan}VOLATILITY BANDS${colors.reset}`);
  console.log(`► Baseline: ${normalAvg}%`);
  console.log(`▼ Low Band (${(lowPercentile * 100).toFixed(0)}th): ${colors.green}${lowAvg}%${colors.reset}`);
  console.log(`► Mid Band (${(mediumPercentile * 100).toFixed(0)}th): ${colors.yellow}${mediumAvg}%${colors.reset}`);
  console.log(`▲ High Band (${(highPercentile * 100).toFixed(0)}th): ${colors.red}${highAvg}%${colors.reset}`);
  console.log(`▲ Top Band (${(topPercentile * 100).toFixed(1)}th): ${colors.magenta}${topAvg}%${colors.reset}`);
  console.log('═'.repeat(50));
  
  // Correction analysis
  console.log(`${colors.cyan}CORRECTION METRICS${colors.reset}`);
  console.log(`High → Normal Gap: ${colors.magenta}${(parseFloat(highAvg) - parseFloat(normalAvg)).toFixed(2)}%${colors.reset}`);
  console.log(`Normal Corrections: ${colors.green}${correctionToNormalCount}${colors.reset}`);
  console.log(`\nHigh → Low Gap: ${colors.magenta}${(parseFloat(highAvg) - parseFloat(lowAvg)).toFixed(2)}%${colors.reset}`);
  console.log(`Deep Corrections: ${colors.green}${correctionToLowCount}${colors.reset}`);
  console.log('═'.repeat(50));


  console.log('\n');
  console.log('=== Full Reversal Stats ===');
  console.log(`▲ Down→Up: ${fullReversalsUp}/${downMoves} | Avg Profit: ${colors.green}${avgUpProfit}%${colors.reset}`);
  console.log(`▼ Up→Down: ${fullReversalsDown}/${upMoves} | Avg Profit: ${colors.green}${avgDownProfit}%${colors.reset}`);
  console.log('');
  console.log(`${colors.red}Total Reversals: ${totalReversals}${colors.reset}`);
  console.log('');
  if (bestReversal.type) {
    console.log(`${colors.yellow}Best Reversal Opportunity:${colors.reset}`);
    console.log(`Type: ${bestReversal.type === 'up' ? '▲ Down→Up' : '▼ Up→Down'}`);
    console.log(`Entry: $${bestReversal.entryPrice.toFixed(4)} at ${bestReversal.displayTime}`);
    console.log(`Exit: $${bestReversal.exitPrice.toFixed(4)} at ${bestReversal.displayTime}`);
    console.log(`${colors.green}Profit: ${bestReversal.profit.toFixed(2)}%${colors.reset}`);
  }
  console.log('');
  // Get current price from the last candle
  const currentPrice = parseFloat(candlesWithStats[candlesWithStats.length - 1].close);
  
  console.log(`Reversal Boundary (${(highPercentile * 100).toFixed(0)}th): ${colors.red}${highAvg}%${colors.reset}`);
  const upperPrice = currentPrice * (1 + parseFloat(highAvg) / 100);
  const lowerPrice = currentPrice * (1 - parseFloat(highAvg) / 100);
  console.log(`Upper Price: ${colors.yellow}$${upperPrice.toFixed(4)}${colors.reset}  (Sell limit/Take profit)`);
  console.log(`Lower Price: ${colors.yellow}$${lowerPrice.toFixed(4)}${colors.reset}  (Buy limit/Take profit)`);
  console.log(`Current Price: ${colors.cyan}$${currentPrice.toFixed(4)}${colors.reset}`);

  console.log(`
Top Band Boundary (${(topPercentile * 100).toFixed(1)}th): ${colors.magenta}${topAvg}%${colors.reset}`);
  const topUpperPrice = currentPrice * (1 + parseFloat(topAvg) / 100);
  const topLowerPrice = currentPrice * (1 - parseFloat(topAvg) / 100);
  console.log(`Upper Price: ${colors.magenta}$${topUpperPrice.toFixed(4)}${colors.reset}  (Extreme reversal level)`);
  console.log(`Lower Price: ${colors.magenta}$${topLowerPrice.toFixed(4)}${colors.reset}  (Extreme reversal level)`);


  console.log('\n');
  
  // Market overview
  console.log(`${colors.cyan}MARKET OVERVIEW${colors.reset}`);
  console.log(`Average Price: ${colors.yellow}$${totalAvg}${colors.reset}`);
  
  // Get start and end dates and prices
  const firstCandle = candlesWithStats[0];
  const lastCandle = candlesWithStats[candlesWithStats.length - 1];
  
  // Calculate total movements
  const startPrice = firstCandle.close;
  const endPrice = lastCandle.close;
  const totalMovement = ((endPrice - startPrice) / startPrice * 100).toFixed(2);
  const priceMovement = Math.abs(endPrice - startPrice).toFixed(4);
  const movementColor = totalMovement >= 0 ? colors.green : colors.red;
  console.log(`Total Movement: ${movementColor}${totalMovement}%${colors.reset}`); 
  console.log(`Price Movement: ${movementColor} $${priceMovement}${colors.reset}`);
  
  // console.log('Debug - First candle time:', firstCandle.time, typeof firstCandle.time);
  // console.log('Debug - Last candle time:', lastCandle.time, typeof lastCandle.time);
  
  const startDate = new Date(firstCandle.time).toLocaleString('en-US', {
    weekday: 'short',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hour12: true
  });
  const endDate = new Date(lastCandle.time).toLocaleString('en-US', {
    weekday: 'short',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hour12: true
  });
  
  console.log(`Start: ${colors.magenta}${startDate}${colors.reset}`);
  console.log(`End: ${colors.magenta}${endDate}${colors.reset}`);
  console.log(`Duration: ${colors.magenta}${durationStr}${colors.reset}`);
  console.log('═'.repeat(50) + '\n');
};
