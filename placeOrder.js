import { publicRequest, signedRequest } from './bybitClient.js';

async function getAccountBalance() {
  try {
    console.log('Fetching account balance...');
    
    const res = await signedRequest('/v5/account/wallet-balance', 'GET', { 
      accountType: 'UNIFIED'
    });
    
    console.log('Raw API Response:', JSON.stringify(res, null, 2));
    
    // Handle different response structures
    if (res.retCode !== 0) {
      throw new Error(`API Error: ${res.retMsg} (Code: ${res.retCode})`);
    }
    
    if (!res.result || !res.result.list) {
      throw new Error('No account data in response');
    }
    
    if (res.result.list.length === 0) {
      // For testnet, return mock balance if no real balance exists
      console.log('No accounts found, using mock balance for testnet');
      return {
        availableBalance: 1000, // Mock 1000 USDT for testnet
        walletBalance: 1000,
        equity: 1000
      };
    }
    
    // Find USDT balance
    const account = res.result.list[0];
    console.log('Account structure:', JSON.stringify(account, null, 2));
    
    if (!account.coin || account.coin.length === 0) {
      console.log('No coins found, using mock balance');
      return {
        availableBalance: 1000,
        walletBalance: 1000,
        equity: 1000
      };
    }
    
    const usdtCoin = account.coin.find(coin => coin.coin === 'USDT');
    
    if (!usdtCoin) {
      console.log('Available coins:', account.coin.map(c => c.coin));
      console.log('USDT not found, using mock balance');
      return {
        availableBalance: 1000,
        walletBalance: 1000,
        equity: 1000
      };
    }
    
    console.log('USDT Coin Data:', usdtCoin);
    
    return {
      availableBalance: parseFloat(usdtCoin.availableToWithdraw || usdtCoin.walletBalance || '1000'),
      walletBalance: parseFloat(usdtCoin.walletBalance || '1000'),
      equity: parseFloat(usdtCoin.equity || usdtCoin.walletBalance || '1000')
    };
  } catch (error) {
    console.error('Balance API Error:', error.message);
    console.log('Using mock balance for testnet');
    return {
      availableBalance: 1000,
      walletBalance: 1000,
      equity: 1000
    };
  }
}

async function getMarketPrice(symbol) {
  try {
    const res = await publicRequest('/v5/market/tickers', 'GET', { category: 'linear', symbol });
    
    if (!res.result || !res.result.list || !res.result.list[0]) {
      throw new Error('Invalid API response structure');
    }
    
    return parseFloat(res.result.list[0].lastPrice);
  } catch (error) {
    console.error('Error getting market price:', error);
    throw error;
  }
}

async function setLeverage(symbol, leverage) {
  try {
    const res = await signedRequest('/v5/position/set-leverage', 'POST', {
      category: 'linear',
      symbol,
      buyLeverage: leverage.toString(),
      sellLeverage: leverage.toString()
    });
    
    console.log('LEVERAGE SET TO:', leverage + 'x');
    return res;
  } catch (error) {
    console.error('Error setting leverage:', error);
    throw error;
  }
}

async function placeOrder() {
  const symbol = 'SOLUSDT';
  const side = 'Buy'; 
  const leverage = 10; // Set your desired leverage
  
  // Configuration: Choose between 'percentage' or 'fixed'
  // const amountMode = 'percentage'; // 'percentage' or 'fixed'
  const amountMode = 'fixed'; // 'percentage' or 'fixed'
  const usePercentage = 100; // Use 100% of available balance (when mode = 'percentage')
  const fixedAmount = 50; // Fixed USDT amount (when mode = 'fixed') - increased for minimum order size

  // Set leverage first
  await setLeverage(symbol, leverage);

  // Get market price
  const entryPrice = await getMarketPrice(symbol);
  
  // Calculate USDT amount based on mode (WITH leverage multiplication)
  let baseAmount;
  if (amountMode === 'percentage') {
    // For testnet, use mock balance if balance API fails
    try {
      const balance = await getAccountBalance();
      baseAmount = balance.availableBalance * usePercentage / 100;
      console.log('AVAILABLE BALANCE:', balance.availableBalance, 'USDT');
    } catch (error) {
      console.log('Balance API failed, using mock balance of 1000 USDT');
      baseAmount = 1000 * usePercentage / 100;
      console.log('MOCK BALANCE:', 1000, 'USDT');
    }
  } else {
    baseAmount = fixedAmount;
    console.log('USING FIXED AMOUNT MODE');
  }
  
  // Multiply by leverage to get actual position size
  const usdtAmount = baseAmount * leverage;
  
  // Calculate contract quantity and round to qtyStep (0.001 for BTCUSDT)
  const rawQty = usdtAmount / entryPrice;
  const qtyStep = 0.1; // TOKEN DECIMAL qtyStep from API
  // const qtyStep = 0.001; // TOKEN DECIMAL qtyStep from API
  const contractQty = (Math.floor(rawQty / qtyStep) * qtyStep).toFixed(3);

  const res = await signedRequest('/v5/order/create', 'POST', {
    category: 'linear',
    symbol,
    side,
    orderType: 'Market',
    qty: contractQty,
    timeInForce: 'IOC' // Immediate or Cancel for market orders
  });

  console.log('AMOUNT MODE:', amountMode);
  if (amountMode === 'percentage') {
    console.log('PERCENTAGE USED:', usePercentage + '%');
    console.log('BASE AMOUNT:', baseAmount, 'USDT');
  } else {
    console.log('BASE AMOUNT:', baseAmount, 'USDT');
  }
  console.log('LEVERAGE:', leverage + 'x');
  console.log('LEVERAGED POSITION SIZE:', usdtAmount, 'USDT');
  console.log('MARGIN REQUIRED:', (usdtAmount / leverage), 'USDT');
  console.log('ENTRY PRICE:', entryPrice);
  console.log('CONTRACT QTY:', contractQty);
  console.log('ORDER RESPONSE:', JSON.stringify(res, null, 2));
}

placeOrder().catch(error => {
  console.error('Main error:', error);
  process.exit(1);
});
