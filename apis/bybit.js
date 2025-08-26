// bybit.js
// Use global axios in browser, import in Node.js
const axiosLib = (typeof window !== 'undefined') ? window.axios : (await import('axios')).default;

let fs, path, fileURLToPath;
const isNode = typeof window === 'undefined';
if (isNode) {
    try {
        fs = await import('fs');
        path = await import('path');
        ({ fileURLToPath } = await import('url'));
    } catch (err) {
        console.error('Failed to load Node.js modules:', err);
        process.exit(1);
    }
}

import { useLocalData } from '../config/config.js';
import { historicalDataConfig } from '../config/historicalDataConfig.js';

// =====================
// PROXY CONFIGURATION
// =====================
import { HttpsProxyAgent } from 'https-proxy-agent';

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
const axiosInstance = axiosLib.create({
    httpsAgent: proxyAgent,
    proxy: false // must be false when using a custom agent
});

const BASE_URL = 'https://api.bybit.com/v5';

// =====================
// Local candles reader
// =====================
async function readLocalCandles(symbol, interval, limit = 100, customEndTime = null) {
    const fileInterval = interval.endsWith('m') || interval.endsWith('h') || ['D', 'W', 'M'].includes(interval) ? interval : `${interval}m`;
    if (!isNode) {
        console.warn('Local data reading is not supported in browser environment');
        return [];
    }

    try {
        const __dirname = path.dirname(fileURLToPath(import.meta.url));
        const filePath = path.join(__dirname, '..', 'data', 'historical', symbol, `${fileInterval}.csv`);

        if (!fs.existsSync(filePath)) {
            console.error(`No local data found for ${symbol} - ${fileInterval}`);
            return [];
        }

        const fileContent = fs.readFileSync(filePath, 'utf8');
        const lines = fileContent.split('\n');

        const allCandles = [];
        for (let i = lines.length - 1; i > 0; i--) {
            const line = lines[i].trim();
            if (!line) continue;

            const [time, open, high, low, close, volume] = line.split(',').map(parseFloat);
            if (isNaN(time)) continue;

            if (customEndTime && time > customEndTime) continue;

            allCandles.push({
                time,
                open,
                high,
                low,
                close,
                volume
            });
        }

        allCandles.sort((a, b) => a.time - b.time);
        return allCandles.slice(-limit);
    } catch (error) {
        console.error('Error reading local candles:', error);
        return [];
    }
}

export function isUsingLocalData() {
    return useLocalData === true && isNode === true;
}

getCandles.isUsingLocalData = isUsingLocalData;

export async function getCandles(symbol = 'BNBUSDT', interval = '1', limit = 100, customEndTime = null, forceLocal = false) {
    if (forceLocal) {
        return await readLocalCandles(symbol, interval, limit, customEndTime);
    }

    if (forceLocal !== false && isUsingLocalData()) {
        return await readLocalCandles(symbol, interval, limit, customEndTime);
    }

    try {
        const allCandles = [];
        let remainingLimit = limit;
        let endTime = customEndTime || Date.now();

        const intervalMap = {
            '1m': '1',
            '3m': '3',
            '5m': '5',
            '15m': '15',
            '30m': '30',
            '1h': '60',
            '2h': '120',
            '4h': '240',
            '6h': '360',
            '12h': '720',
            '1d': 'D',
            '1M': 'M',
            '1w': 'W'
        };

        const bybitInterval = intervalMap[interval] || interval;

        while (remainingLimit > 0) {
            const batchLimit = Math.min(remainingLimit, 1000);
            const response = await axiosInstance.get(`${BASE_URL}/market/kline`, {
                params: {
                    category: 'linear',
                    symbol,
                    interval: bybitInterval,
                    limit: batchLimit,
                    end: endTime
                }
            });

            if (!response.data?.result?.list?.length) break;

            const candles = response.data.result.list.reverse().map(c => ({
                time: parseInt(c[0]),
                open: parseFloat(parseFloat(c[1]).toFixed(4)),
                high: parseFloat(parseFloat(c[2]).toFixed(4)),
                low: parseFloat(parseFloat(c[3]).toFixed(4)),
                close: parseFloat(parseFloat(c[4]).toFixed(4)),
                volume: parseFloat(parseFloat(c[5]).toFixed(4))
            }));

            allCandles.push(...candles);
            remainingLimit -= candles.length;

            if (candles.length < batchLimit) break;

            endTime = candles[0].time - 1;
        }

        return allCandles;
    } catch (error) {
        console.error('Error fetching candles from Bybit via proxy:', error.message);
        return [];
    }
}
