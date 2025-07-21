// edgeCache.js
import fs from 'fs';
import path from 'path';

const CACHE_DIR = './data/edges';

// Ensure cache directory exists
if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
}

// Generate cache filename
function getCacheFilename(symbol, timeframe) {
    return path.join(CACHE_DIR, `${symbol}_${timeframe}_edges.json`);
}

// Save edge data to cache
export function saveEdgeData(symbol, timeframe, edgeData) {
    const filename = getCacheFilename(symbol, timeframe);
    const data = {
        symbol,
        timeframe,
        edgeData,
        lastUpdate: Date.now()
    };
    
    fs.writeFileSync(filename, JSON.stringify(data, null, 2));
}

// Get edge data from cache
export function getEdgeData(symbol, timeframe) {
    const filename = getCacheFilename(symbol, timeframe);
    
    if (!fs.existsSync(filename)) {
        return null;
    }
    
    const data = JSON.parse(fs.readFileSync(filename, 'utf8'));
    return data;
}

// Clear edge data from cache
export function clearEdgeData(symbol, timeframe) {
    const filename = getCacheFilename(symbol, timeframe);
    
    if (fs.existsSync(filename)) {
        fs.unlinkSync(filename);
    }
}

export default {
    saveEdgeData,
    getEdgeData,
    clearEdgeData
};
