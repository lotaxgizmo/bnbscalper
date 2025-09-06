// bybitClient.js
import axios from 'axios';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { HttpsProxyAgent } from 'https-proxy-agent';
dotenv.config();

console.log('Loaded API_KEY:', process.env.BYBIT_API_KEY);  // 👈 Add this for debugging
console.log('Loaded API_SECRET:', process.env.BYBIT_API_SECRET);  // 👈 Add this for 

// =====================
// PROXY CONFIGURATION
// =====================
// Smartproxy credentials
const proxyHost = "81.29.154.198";
const proxyPort = "48323";
const proxyUser = "esELEn9MJXGBpkz";
const proxyPass = "mL9JZEdv2L40YuN";

// Create proxy URL
const proxyUrl = `http://${proxyUser}:${proxyPass}@${proxyHost}:${proxyPort}`;

// Create proxy agent
const proxyAgent = new HttpsProxyAgent(proxyUrl);

// Create Axios instance that uses the proxy
const axiosInstance = axios.create({
    httpsAgent: proxyAgent,
    proxy: false // must be false when using a custom agent
});

const BASE_URL = 'https://api.bybit.com';
// const BASE_URL = 'https://api-testnet.bybit.com';
const API_KEY = process.env.BYBIT_API_KEY;
const API_SECRET = process.env.BYBIT_API_SECRET;

async function publicRequest(endpoint, method = 'GET', params = {}) {
  const url = method === 'GET' && Object.keys(params).length > 0 
    ? `${BASE_URL}${endpoint}?${new URLSearchParams(params).toString()}`
    : `${BASE_URL}${endpoint}`;

  const response = await axiosInstance({
    method,
    url,
    data: method === 'POST' ? params : undefined
  });

  return response.data;
}

async function signedRequest(endpoint, method = 'POST', params = {}) {
  const timestamp = Date.now().toString();
  const recvWindow = '5000';

  let queryString = '';
  let body = '';
  
  if (method === 'GET') {
    // For GET requests, add params to query string
    if (Object.keys(params).length > 0) {
      queryString = new URLSearchParams(params).toString();
    }
    // For GET requests, the signature includes the query parameters
    const signString = timestamp + API_KEY + recvWindow + queryString;
    const sign = crypto.createHmac('sha256', API_SECRET).update(signString).digest('hex');
    
    const headers = {
      'X-BAPI-API-KEY': API_KEY,
      'X-BAPI-TIMESTAMP': timestamp,
      'X-BAPI-RECV-WINDOW': recvWindow,
      'X-BAPI-SIGN': sign
    };

    const url = queryString ? `${BASE_URL}${endpoint}?${queryString}` : `${BASE_URL}${endpoint}`;

    const response = await axiosInstance({
      method: 'GET',
      url,
      headers
    });

    return response.data;
  } else {
    // For POST requests
    body = JSON.stringify(params);
    const signString = timestamp + API_KEY + recvWindow + body;
    const sign = crypto.createHmac('sha256', API_SECRET).update(signString).digest('hex');

    const headers = {
      'X-BAPI-API-KEY': API_KEY,
      'X-BAPI-TIMESTAMP': timestamp,
      'X-BAPI-RECV-WINDOW': recvWindow,
      'X-BAPI-SIGN': sign,
      'Content-Type': 'application/json'
    };

    const response = await axiosInstance({
      method,
      url: `${BASE_URL}${endpoint}`,
      headers,
      data: params
    });

    return response.data;
  }
}

export { publicRequest, signedRequest };
