# Issues Log

## Edge calculation using wrong reference point

### Issue:
The edge calculation was using the wrong reference point and direction logic, causing inconsistent signs in the edge percentages:
- Used lowest price as reference instead of period start price
- Determined direction based on recent price action instead of position relative to reference
- Multiplied by arbitrary direction (-1/1) instead of using natural sign from calculation

### Before:
```javascript
const move = ((highCandle.high - lowCandle.low) / lowCandle.low) * 100;
const currentMove = ((currentPrice - lowCandle.low) / lowCandle.low) * 100;

const hourAgo = windowEnd - (60 * 60 * 1000);
const recentCandles = candles.filter(c => c.time >= hourAgo && c.time <= windowEnd);
const direction = recentCandles.length > 1 ? 
    (recentCandles[recentCandles.length-1].close > recentCandles[0].close ? 1 : -1) : 0;

move: parseFloat((direction * move).toFixed(2)),
position: parseFloat((direction * currentMove).toFixed(2))
```

### After:
```javascript
// Calculate position relative to reference (start of period)
const positionPct = ((currentPrice - referencePrice) / referencePrice) * 100;

// Calculate total range - always positive
const totalRange = ((highPrice - lowPrice) / referencePrice) * 100;

// Total range is always positive
move: parseFloat(totalRange.toFixed(2)),
// Position maintains its sign to show where we are relative to reference
position: parseFloat(positionPct.toFixed(2))
```

### Fix:
The fix was implemented in `pivotWorker.js` by changing the `calculateMove` function to use the period start price as reference, and to maintain the natural sign of the position calculation. This ensures that the edge percentages are consistent in their sign (positive above reference, negative below reference).
