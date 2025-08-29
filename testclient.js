// testRiskLimit.js
import { RestClientV5 } from 'bybit-api';

const client = new RestClientV5({
  testnet: true,
  key: process.env.BYBIT_API_KEY,
  secret: process.env.BYBIT_API_SECRET,
});

(async () => {
  try {
    const res = await client.getRiskLimit({
      category: 'linear', // use 'linear' for USDT/USDC pairs
      symbol: 'SOLUSDT',  // change to your pair
    });
    console.log(JSON.stringify(res, null, 2));
  } catch (err) {
    console.error("❌ Error:", err.message);
  }
})();
