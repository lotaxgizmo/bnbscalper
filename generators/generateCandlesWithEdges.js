import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getCandles } from '../apis/bybit.js';
import { symbol, time as interval, limit } from '../config/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.join(__dirname, '..', 'data');

if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const colors = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    magenta: '\x1b[35m',
};

// --- Edge Calculation Logic (from pivotBacktester.js) ---

const calculateEdges = (candles, timeframes) => {
    const edges = {};
    timeframes.forEach(tf => {
        edges[tf] = {
            upEdges: [],
            downEdges: [],
            rangeTotals: []
        };
    });

    const minuteMultiplier = interval.includes('m') ? parseInt(interval.replace('m', '')) : 60;

    timeframes.forEach(tf => {
        let tfCandles;
        switch(tf) {
            case 'daily': tfCandles = (24 * 60) / minuteMultiplier; break;
            case 'weekly': tfCandles = (24 * 60 * 7) / minuteMultiplier; break;
            case 'biweekly': tfCandles = (24 * 60 * 14) / minuteMultiplier; break;
            case 'monthly': tfCandles = (24 * 60 * 30) / minuteMultiplier; break;
            default: tfCandles = (24 * 60) / minuteMultiplier;
        }

        console.log(`${colors.magenta}[DEBUG] Starting timeframe: ${tf}, Window size: ${tfCandles} candles.${colors.reset}`);

        if (candles.length < tfCandles) {
            console.warn(`Limited data for ${tf} edge calculation. Using all ${candles.length} available candles.`);
            tfCandles = candles.length;
        }

        for (let i = tfCandles; i < candles.length; i++) {
            if ((i - tfCandles) % 5000 === 0 && (i - tfCandles) > 0) {
                console.log(`${colors.magenta}[DEBUG] ... processed ${i - tfCandles} candles for ${tf}...${colors.reset}`);
            }
            const windowStart = i - tfCandles;
            const windowEnd = i;

            let maxPrice = -Infinity;
            let minPrice = Infinity;

            for (let j = windowStart; j < windowEnd; j++) {
                if (candles[j].high > maxPrice) {
                    maxPrice = candles[j].high;
                }
                if (candles[j].low < minPrice) {
                    minPrice = candles[j].low;
                }
            }

            const lastPrice = candles[i - 1].close;
            const referencePrice = candles[windowStart].open;

            const upMove = ((maxPrice - referencePrice) / referencePrice) * 100;
            const downMove = ((minPrice - referencePrice) / referencePrice) * 100;
            const currentMove = ((lastPrice - referencePrice) / referencePrice) * 100;
            const totalRange = upMove + Math.abs(downMove);

            edges[tf].upEdges.push({ time: candles[i].time, price: lastPrice, edgePrice: maxPrice, percentToEdge: upMove, referencePrice: referencePrice, currentMove: currentMove });
            edges[tf].downEdges.push({ time: candles[i].time, price: lastPrice, edgePrice: minPrice, percentToEdge: downMove, referencePrice: referencePrice, currentMove: currentMove });
            edges[tf].rangeTotals.push({ time: candles[i].time, totalRange: totalRange, dominantDirection: upMove > Math.abs(downMove) ? 'up' : 'down' });
        }
        console.log(`${colors.green}[DEBUG] Successfully finished timeframe: ${tf}.${colors.reset}`);
    });

    return edges;
};

const getCurrentEdgeData = (price, edges, timeframes, candleTimestamp) => {
    const edgeData = {};

    timeframes.forEach(tf => {
        if (!edges[tf] || edges[tf].upEdges.length === 0) return;

        // Find the most recent edge data for the current candle's timestamp
        const latestUpEdge = edges[tf].upEdges.filter(e => e.time <= candleTimestamp).pop();
        const latestDownEdge = edges[tf].downEdges.filter(e => e.time <= candleTimestamp).pop();
        
        if (!latestUpEdge || !latestDownEdge) return;

        const currentMove = ((price - latestUpEdge.referencePrice) / latestUpEdge.referencePrice) * 100;

        let lookbackPeriods;
        switch(tf) {
            case 'daily': lookbackPeriods = 7; break;
            case 'weekly': lookbackPeriods = 4; break;
            case 'biweekly': lookbackPeriods = 4; break;
            case 'monthly': lookbackPeriods = 4; break;
            default: lookbackPeriods = 7;
        }

        const rangeTotals = edges[tf].rangeTotals.filter(r => r.time <= candleTimestamp);
        const historicalRanges = rangeTotals.length >= lookbackPeriods ? rangeTotals.slice(-lookbackPeriods) : rangeTotals;
        const averageRangeValue = historicalRanges.reduce((sum, range) => sum + range.totalRange, 0) / (historicalRanges.length || 1);
        const upDirectionCount = historicalRanges.filter(range => range.dominantDirection === 'up').length;
        const averageDirection = upDirectionCount > historicalRanges.length / 2 ? 'up' : 'down';

        edgeData[tf] = {
            currentMove: currentMove,
            upEdge: { price: latestUpEdge.edgePrice, percentToEdge: latestUpEdge.percentToEdge },
            downEdge: { price: latestDownEdge.edgePrice, percentToEdge: latestDownEdge.percentToEdge },
            averageRange: { value: averageRangeValue, direction: averageDirection },
            referencePrice: latestUpEdge.referencePrice
        };
    });

    return edgeData;
};

// --- Main Generator Logic ---

const generateCandlesWithEdges = async () => {
    console.log(`${colors.cyan}--- Starting Candle with Edges Generator ---${colors.reset}`);

    const timeframes = ['daily', 'weekly', 'biweekly', 'monthly'];
    const minuteMultiplier = interval.includes('m') ? parseInt(interval.replace('m', '')) : 60;
    const monthlyWindow = (24 * 60 * 30) / minuteMultiplier;
    const fetchLimit = limit + monthlyWindow;

    console.log(`Fetching ${fetchLimit} candles for ${symbol} to ensure historical data for edge calculation...`);

    const candles = await getCandles(symbol, interval, fetchLimit);
    if (!candles || candles.length < monthlyWindow) {
        console.error(`${colors.red}Failed to fetch sufficient candles for edge calculation. Need at least ${monthlyWindow}, got ${candles?.length || 0}. Exiting.${colors.reset}`);
        return;
    }

    console.log(`${colors.green}Successfully fetched ${candles.length} candles.${colors.reset}`);
    console.log(`Calculating edges for all timeframes...`);

    const allEdges = calculateEdges(candles, timeframes);

    console.log(`Attaching edge data to the latest ${limit} candles...`);

    const candlesWithEdges = [];
    const startIndex = candles.length - limit;

    for (let i = startIndex; i < candles.length; i++) {
        const candle = candles[i];
        const edgeData = getCurrentEdgeData(candle.close, allEdges, timeframes, candle.time);
        
        if (Object.keys(edgeData).length > 0) {
            candlesWithEdges.push({
                ...candle,
                edges: edgeData
            });
        } else {
             console.warn(`${colors.yellow}Warning: No edge data for candle at ${new Date(candle.time).toLocaleString()}${colors.reset}`);
        }
    }

    const outputFileName = `${symbol}_${interval}_${limit}_candles_with_edges.json`;
    const outputPath = path.join(dataDir, outputFileName);

    console.log(`Saving ${candlesWithEdges.length} candles with edge data to ${outputPath}...`);

    fs.writeFileSync(outputPath, JSON.stringify(candlesWithEdges, null, 2));

    console.log(`${colors.green}--- Generation Complete! ---${colors.reset}`);
};

generateCandlesWithEdges();
