import axios from 'axios';
import { signedRequest } from './bybitClient.js';

async function getMarketPrice(symbol) {
  const res = await axios.get(`https://api-testnet.bybit.com/v5/market/tickers?category=spot&symbol=${symbol}`);
  return parseFloat(res.data.result.list[0].lastPrice);
}

async function placeOrder() {
  const symbol = 'BTCUSDT';
  const side = 'Buy'; 

  const entryPrice = await getMarketPrice(symbol);
  const qty = '1000' 

  const res = await signedRequest('/v5/order/create', 'POST', {
    category: 'spot',
    symbol,
    side,
    orderType: 'Market',
    qty
  });

  console.log('ENTRY PRICE:', entryPrice);
  console.log('QTY:', qty);
  console.log(res);
}

placeOrder().catch(console.error);
