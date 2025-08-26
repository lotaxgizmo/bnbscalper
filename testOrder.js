import { publicRequest, signedRequest } from './bybitClient.js';

async function testOrderFlow() {
  console.log('=== TESTING ORDER FLOW ===');
  
  try {
    // Test 1: Get market price
    console.log('\n1. Testing market price...');
    const priceRes = await publicRequest('/v5/market/tickers', 'GET', { 
      category: 'linear', 
      symbol: 'BTCUSDT' 
    });
    
    if (priceRes.result?.list?.[0]) {
      const price = parseFloat(priceRes.result.list[0].lastPrice);
      console.log('✅ Market price:', price);
      
      // Test 2: Calculate order details
      console.log('\n2. Calculating order details...');
      const fixedAmount = 500;
      const leverage = 1;
      const usdtAmount = fixedAmount * leverage;
      const contractQty = (usdtAmount / price).toFixed(6);
      
      console.log('Fixed Amount:', fixedAmount, 'USDT');
      console.log('Leverage:', leverage + 'x');
      console.log('Position Value:', usdtAmount, 'USDT');
      console.log('Contract Qty:', contractQty, 'BTC');
      
      // Test 3: Prepare order (don't actually place it)
      console.log('\n3. Order would be:');
      const orderParams = {
        category: 'linear',
        symbol: 'BTCUSDT',
        side: 'Buy',
        orderType: 'Market',
        qty: contractQty,
        timeInForce: 'IOC'
      };
      console.log('Order Params:', JSON.stringify(orderParams, null, 2));
      console.log('✅ Order preparation successful');
      
    } else {
      console.log('❌ Failed to get market price');
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

testOrderFlow();
