// file: allInOrder.js
import { publicRequest, signedRequest } from './bybitClient.js';

// ==========================
// TRADING CONFIGURATION - EDIT HERE
// ==========================
const TRADING_CONFIG = {
  symbol: 'SOLUSDT',           // change symbol here
  side: 'Buy',                 // 'Buy' = long, 'Sell' = short
  leverage: 80,               // leverage to use
  amountMode: 'fixed',    // 'percentage' or 'fixed'
  // amountMode: 'percentage',    // 'percentage' or 'fixed'
  usePercentage: 100,          // 100% = all-in (before buffer)
  fixedAmount: 100,            // USDT amount if fixed mode
  upperLimit: 50000,           // Max notional cap
};

// ==========================
// Auto-calc usable factor from leverage
// ==========================
function calcUsableFactor(leverage) {
  // Power law fit from tested data
  const factor = 1 - (3.5 / Math.pow(leverage, 0.6));
  // Clamp between 0.85 and 0.99 to be safe
  return Math.max(0.85, Math.min(0.99, factor));
}

// ==========================
// Get account balance
// ==========================
async function getAccountBalance() {
  const res = await signedRequest('/v5/account/wallet-balance', 'GET', { accountType: 'UNIFIED' });

  if (res.retCode !== 0) throw new Error(`API Error: ${res.retMsg}`);

  const account = res.result.list[0];
  const usdtCoin = account.coin.find(c => c.coin === 'USDT');
  if (!usdtCoin) throw new Error('USDT not found in account');

  const equity = parseFloat(usdtCoin.equity || usdtCoin.walletBalance);
  const totalPositionIM = parseFloat(usdtCoin.totalPositionIM || 0);
  const totalOrderIM = parseFloat(usdtCoin.totalOrderIM || 0);
  const calculatedAvailable = equity - totalPositionIM - totalOrderIM;
  const totalAvailable = account.totalAvailableBalance
    ? parseFloat(account.totalAvailableBalance)
    : calculatedAvailable;

  const availableBalance = Math.max(totalAvailable, calculatedAvailable, 0);

  return {
    availableBalance,
    walletBalance: parseFloat(usdtCoin.walletBalance),
    equity,
    totalPositionIM,
    totalOrderIM,
  };
}

// ==========================
// Get market price
// ==========================
async function getMarketPrice(symbol) {
  const res = await publicRequest('/v5/market/tickers', 'GET', {
    category: 'linear',
    symbol,
  });
  return parseFloat(res.result.list[0].lastPrice);
}

// ==========================
// Get instrument info (qtyStep, minOrderQty)
// ==========================
async function getInstrumentInfo(symbol) {
  const res = await publicRequest('/v5/market/instruments-info', 'GET', {
    category: 'linear',
    symbol,
  });

  if (!res.result.list || res.result.list.length === 0) {
    throw new Error(`No instrument info for ${symbol}`);
  }

  const info = res.result.list[0];
  const qtyStep = parseFloat(info.lotSizeFilter.qtyStep);
  const minOrderQty = parseFloat(info.lotSizeFilter.minOrderQty);

  return { qtyStep, minOrderQty };
}

// ==========================
// Set margin mode
// ==========================
async function setIsolatedMargin(symbol) {
  await signedRequest('/v5/position/switch-isolated', 'POST', {
    category: 'linear',
    symbol,
    tradeMode: 1, // 1 = Isolated
    buyLeverage: '1',
    sellLeverage: '1',
  });
  console.log('✅ Margin Mode: Isolated');
}

// ==========================
// Set leverage
// ==========================
async function setLeverage(symbol, leverage) {
  await signedRequest('/v5/position/set-leverage', 'POST', {
    category: 'linear',
    symbol,
    buyLeverage: leverage.toString(),
    sellLeverage: leverage.toString(),
  });
  console.log(`✅ Leverage set: ${leverage}x`);
}

// ==========================
// Place order (all-in or fixed)
// ==========================
async function placeOrder() {
  const { symbol, side, leverage, amountMode, usePercentage, fixedAmount, upperLimit } = TRADING_CONFIG;

  await setIsolatedMargin(symbol);
  await setLeverage(symbol, leverage);

  const entryPrice = await getMarketPrice(symbol);
  const { qtyStep, minOrderQty } = await getInstrumentInfo(symbol);

  const usableFactor = calcUsableFactor(leverage);
  console.log(`📊 Usable Factor for ${leverage}x leverage: ${usableFactor.toFixed(4)}`);

  let baseAmount;
  if (amountMode === 'percentage') {
    const balance = await getAccountBalance();
    const adjustedBalance = balance.availableBalance * usableFactor;

    baseAmount = adjustedBalance * usePercentage / 100;
    console.log('Available Balance:', balance.availableBalance, 'USDT');
    console.log('Adjusted Balance (usable):', adjustedBalance.toFixed(4), 'USDT');
  } else {
    baseAmount = fixedAmount;
    console.log('Using fixed amount:', baseAmount, 'USDT');
  }

  // Cap position size
  let notional = baseAmount * leverage;
  if (upperLimit && notional > upperLimit) {
    console.log(`🚨 Position capped to ${upperLimit} USDT notional`);
    baseAmount = upperLimit / leverage;
    notional = baseAmount * leverage;
  }

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

  console.log('Symbol:', symbol);
  console.log('Side:', side);
  console.log('Leverage:', leverage);
  console.log('Entry Price:', entryPrice);
  console.log('Notional Size (after factor):', notional.toFixed(2), 'USDT');
  console.log('Contract Qty:', contractQty, `(step ${qtyStep}, min ${minOrderQty})`);

  const res = await signedRequest('/v5/order/create', 'POST', {
    category: 'linear',
    symbol,
    side,
    orderType: 'Market',
    qty: contractQty,
    timeInForce: 'IOC',
  });

  console.log('📩 ORDER RESPONSE:', JSON.stringify(res, null, 2));
}

placeOrder().catch(err => {
  console.error('❌ Error:', err.message);
});
