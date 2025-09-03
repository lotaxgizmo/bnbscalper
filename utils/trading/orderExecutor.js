// Order Execution Utilities
import { signedRequest } from '../../bybitClient.js';
import { getAccountBalance, hasActivePosition, setIsolatedMargin, setLeverage, calcUsableFactor } from './accountManager.js';
import { getMarketPrice, getInstrumentInfo } from './marketData.js';
import { calculateTPSL, calculatePositionSize, calculateContractQty, convertSignalToSide } from './tradingCalculations.js';
import telegramNotifier from '../telegramNotifier.js';

/**
 * Execute a market order with full configuration
 */
export async function executeMarketOrder(config) {
  const {
    symbol,
    signal, // 'long', 'short', 'Buy', 'Sell'
    leverage,
    amountMode = 'percentage',
    usePercentage = 100,
    fixedAmount = 100,
    upperLimit = null,
    slTpMode = 'percentage',
    stopLoss = null,
    takeProfit = null,
    tradeOnActive = false
  } = config;

  // Convert signal to side format
  const side = convertSignalToSide(signal);

  // Check for active positions if tradeOnActive is false
  if (!tradeOnActive) {
    const { hasActive } = await hasActivePosition(symbol);
    if (hasActive) {
      console.log('⚠️ Active position detected and tradeOnActive is false. Skipping order placement.');
      return { success: false, reason: 'Active position exists' };
    }
    console.log('✅ No active positions found. Proceeding with order placement.');
  } else {
    console.log('📝 tradeOnActive is enabled. Will place order regardless of existing positions.');
  }

  // Setup margin and leverage
  await setIsolatedMargin(symbol);
  await setLeverage(symbol, leverage);

  // Get market data
  const entryPrice = await getMarketPrice(symbol);
  const { qtyStep, minOrderQty } = await getInstrumentInfo(symbol);

  // Calculate usable balance
  const usableFactor = calcUsableFactor(leverage);
  console.log(`📊 Usable Factor for ${leverage}x leverage: ${usableFactor.toFixed(4)}`);

  let adjustedBalance;
  if (amountMode === 'percentage') {
    const balance = await getAccountBalance();
    adjustedBalance = balance.availableBalance * usableFactor;
    console.log('Available Balance:', balance.availableBalance, 'USDT');
    console.log('Adjusted Balance (usable):', adjustedBalance.toFixed(4), 'USDT');
  } else {
    adjustedBalance = fixedAmount;
    console.log('Using fixed amount:', adjustedBalance, 'USDT');
  }

  // Calculate position size
  const { baseAmount, notional } = calculatePositionSize(
    { amountMode, usePercentage, fixedAmount, upperLimit },
    adjustedBalance,
    entryPrice,
    leverage
  );

  // Calculate contract quantity
  const contractQty = calculateContractQty(notional, entryPrice, qtyStep, minOrderQty);

  // Calculate SL/TP prices
  const { stopLossPrice, takeProfitPrice } = calculateTPSL(entryPrice, side, stopLoss, takeProfit, slTpMode);

  // Log order details
  console.log('Symbol:', symbol);
  console.log('Side:', side);
  console.log('Signal:', signal);
  console.log('Leverage:', leverage);
  console.log('Entry Price:', entryPrice.toFixed(4));
  console.log('Notional Size (after factor):', notional.toFixed(2), 'USDT');
  console.log('Contract Qty:', contractQty, `(step ${qtyStep}, min ${minOrderQty})`);
  if (stopLossPrice) console.log(`Stop Loss: ${stopLossPrice.toFixed(4)} (${slTpMode === 'percentage' ? stopLoss + '%' : 'fixed'})`);
  if (takeProfitPrice) console.log(`Take Profit: ${takeProfitPrice.toFixed(4)} (${slTpMode === 'percentage' ? takeProfit + '%' : 'fixed'})`);

  // Build order parameters
  const orderParams = {
    category: 'linear',
    symbol,
    side,
    orderType: 'Market',
    qty: contractQty,
    timeInForce: 'IOC',
  };

  // Add stop loss and take profit if configured
  if (stopLossPrice) {
    orderParams.stopLoss = stopLossPrice.toString();
  }
  if (takeProfitPrice) {
    orderParams.takeProfit = takeProfitPrice.toString();
  }

  // Place main market order with SL/TP
  const res = await signedRequest('/v5/order/create', 'POST', orderParams);

  console.log('📩 ORDER RESPONSE:', JSON.stringify(res, null, 2));

  if (res.retCode !== 0) {
    throw new Error(`Order failed: ${res.retMsg}`);
  }

  console.log('✅ Order placed successfully!');
  if (stopLossPrice) console.log(`✅ Stop Loss set at: ${stopLossPrice.toFixed(4)}`);
  if (takeProfitPrice) console.log(`✅ Take Profit set at: ${takeProfitPrice.toFixed(4)}`);

  // Send Telegram notification using existing notifier
  try {
    const direction = side === 'Buy' ? 'long' : 'short';
    await telegramNotifier.notifyTradeOpened({
      id: res.result.orderId,
      direction: direction,
      entryPrice,
      entryTime: Date.now(),
      positionSize: notional,
      capitalUsed: notional / leverage, // Actual capital used (margin)
      leverage,
      stopLossPrice: stopLossPrice || null,
      takeProfitPrice: takeProfitPrice || null
    });
  } catch (error) {
    console.log(`⚠️  Telegram notification failed: ${error.message}`);
  }

  return {
    success: true,
    orderId: res.result.orderId,
    entryPrice,
    contractQty,
    notional,
    stopLossPrice,
    takeProfitPrice,
    response: res
  };
}

/**
 * Quick market order execution with minimal config
 */
export async function quickMarketOrder(symbol, signal, leverage = 80, options = {}) {
  const defaultConfig = {
    symbol,
    signal,
    leverage,
    amountMode: 'percentage',
    usePercentage: 100,
    slTpMode: 'percentage',
    stopLoss: 0.5,
    takeProfit: 1.0,
    tradeOnActive: false,
    ...options
  };

  return await executeMarketOrder(defaultConfig);
}
