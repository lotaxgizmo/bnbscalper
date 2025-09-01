// Trading Calculations Utilities

/**
 * Calculate Stop Loss and Take Profit prices
 */
export function calculateTPSL(entryPrice, side, stopLoss, takeProfit, slTpMode = 'percentage') {
  let stopLossPrice = null;
  let takeProfitPrice = null;

  if (stopLoss) {
    if (slTpMode === 'percentage') {
      // Calculate percentage-based SL
      if (side === 'Buy' || side === 'long') {
        stopLossPrice = entryPrice * (1 - stopLoss / 100); // SL below entry for long
      } else {
        stopLossPrice = entryPrice * (1 + stopLoss / 100); // SL above entry for short
      }
    } else {
      stopLossPrice = stopLoss; // Fixed price
    }
  }

  if (takeProfit) {
    if (slTpMode === 'percentage') {
      // Calculate percentage-based TP
      if (side === 'Buy' || side === 'long') {
        takeProfitPrice = entryPrice * (1 + takeProfit / 100); // TP above entry for long
      } else {
        takeProfitPrice = entryPrice * (1 - takeProfit / 100); // TP below entry for short
      }
    } else {
      takeProfitPrice = takeProfit; // Fixed price
    }
  }

  return { stopLossPrice, takeProfitPrice };
}

/**
 * Calculate position size based on configuration
 */
export function calculatePositionSize(config, balance, entryPrice, leverage) {
  const { amountMode, usePercentage, fixedAmount, upperLimit } = config;
  
  let baseAmount;
  if (amountMode === 'percentage') {
    baseAmount = balance * usePercentage / 100;
  } else {
    baseAmount = fixedAmount;
  }

  // Cap position size
  let notional = baseAmount * leverage;
  if (upperLimit && notional > upperLimit) {
    console.log(`🚨 Position capped to ${upperLimit} USDT notional`);
    baseAmount = upperLimit / leverage;
    notional = baseAmount * leverage;
  }

  return { baseAmount, notional };
}

/**
 * Calculate contract quantity with proper precision
 */
export function calculateContractQty(notional, entryPrice, qtyStep, minOrderQty) {
  // Raw contracts
  const rawQty = notional / entryPrice;

  // Apply qtyStep precision
  const precision = Math.log10(1 / qtyStep);
  let contractQty = (Math.floor(rawQty / qtyStep) * qtyStep).toFixed(precision);

  // Ensure min order size
  if (parseFloat(contractQty) < minOrderQty) {
    contractQty = minOrderQty.toFixed(precision);
    console.log(`⚠️ Raised to minOrderQty: ${contractQty}`);
  }

  return contractQty;
}

/**
 * Convert signal format (long/short to Buy/Sell)
 */
export function convertSignalToSide(signal) {
  if (signal === 'long' || signal === 'LONG') return 'Buy';
  if (signal === 'short' || signal === 'SHORT') return 'Sell';
  return signal; // Return as-is if already Buy/Sell
}
