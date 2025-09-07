// Account Management Utilities
import { signedRequest } from '../../bybitClient.js';

/**
 * Calculate usable factor based on leverage
 * Linear formula: 100x→90%, 80x→91%
 */
export function calcUsableFactor(leverage) {
  let factor;
  
  if (leverage <= 50) {
    // For 1x-50x: 1x=100%, 50x=94.5%
    // Using: factor = -0.001122 * leverage + 1.001122
    factor = -0.001122 * leverage + 1.001122;
  } else {
    // For 51x-100x: 50x=94.5%, 100x=90%
    // Using: factor = -0.0009 * leverage + 0.99
    factor = -0.0009 * leverage + 0.99;
  }
  
  // Clamp between 0.85 and 0.99 to be safe
  return Math.max(0.85, Math.min(0.99, factor));
}

/**
 * Get account balance information
 */
export async function getAccountBalance() {
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

/**
 * Check for active positions on a symbol
 */
export async function hasActivePosition(symbol) {
  const res = await signedRequest('/v5/position/list', 'GET', {
    category: 'linear',
    symbol
  });

  if (res.retCode !== 0) throw new Error(`API Error: ${res.retMsg}`);

  const positions = res.result.list || [];
  const activePositions = positions.filter(pos => parseFloat(pos.size) > 0);
  
  if (activePositions.length > 0) {
    console.log(`🔍 Found ${activePositions.length} active position(s) for ${symbol}:`);
    activePositions.forEach(pos => {
      console.log(`   Side: ${pos.side}, Size: ${pos.size}, Entry: ${pos.avgPrice}, PnL: ${pos.unrealisedPnl}`);
    });
    return { hasActive: true, positions: activePositions };
  }
  
  return { hasActive: false, positions: [] };
}

/**
 * Set margin mode to isolated
 */
export async function setIsolatedMargin(symbol) {
  await signedRequest('/v5/position/switch-isolated', 'POST', {
    category: 'linear',
    symbol,
    tradeMode: 1, // 1 = Isolated
    buyLeverage: '1',
    sellLeverage: '1',
  });
  console.log('✅ Margin Mode: Isolated');
}

/**
 * Set leverage for a symbol
 */
export async function setLeverage(symbol, leverage) {
  await signedRequest('/v5/position/set-leverage', 'POST', {
    category: 'linear',
    symbol,
    buyLeverage: leverage.toString(),
    sellLeverage: leverage.toString(),
  });
  console.log(`✅ Leverage set: ${leverage}x`);
}
