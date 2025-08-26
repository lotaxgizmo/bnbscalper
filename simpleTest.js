import { publicRequest, signedRequest } from './bybitClient.js';

console.log('Starting simple test...');

try {
  // Test market price first (public endpoint)
  console.log('Testing market price...');
  const priceRes = await publicRequest('/v5/market/tickers', 'GET', { category: 'linear', symbol: 'BTCUSDT' });
  console.log('Price API works:', priceRes.result?.list?.[0]?.lastPrice);

  // Test balance (signed endpoint)
  console.log('Testing balance...');
  const balanceRes = await signedRequest('/v5/account/wallet-balance', 'GET', { accountType: 'UNIFIED' });
  console.log('Balance response:', JSON.stringify(balanceRes, null, 2));

} catch (error) {
  console.error('Test error:', error.message);
  console.error('Full error:', error);
}
