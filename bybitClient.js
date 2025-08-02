// bybitClient.js
import axios from 'axios';
import crypto from 'crypto';
import dotenv from 'dotenv';
dotenv.config();

console.log('Loaded API_KEY:', process.env.BYBIT_API_KEY);  // 👈 Add this for debugging
console.log('Loaded API_SECRET:', process.env.BYBIT_API_SECRET);  // 👈 Add this for 

const BASE_URL = 'https://api-testnet.bybit.com';
const API_KEY = process.env.BYBIT_API_KEY;
const API_SECRET = process.env.BYBIT_API_SECRET;

async function signedRequest(endpoint, method = 'POST', params = {}) {
  const timestamp = Date.now().toString();
  const recvWindow = '5000';

  const body = method === 'POST' ? JSON.stringify(params) : '';
  const signString = timestamp + API_KEY + recvWindow + body;

  const sign = crypto.createHmac('sha256', API_SECRET).update(signString).digest('hex');

  const headers = {
    'X-BAPI-API-KEY': API_KEY,
    'X-BAPI-TIMESTAMP': timestamp,
    'X-BAPI-RECV-WINDOW': recvWindow,
    'X-BAPI-SIGN': sign,
    'Content-Type': 'application/json'
  };

  const response = await axios({
    method,
    url: `${BASE_URL}${endpoint}`,
    headers,
    data: method === 'POST' ? params : undefined
  });

  return response.data;
}

export { signedRequest };
