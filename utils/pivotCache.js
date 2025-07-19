// pivotCache.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, '../data/pivots');

export function savePivotData(symbol, interval, pivots, config, metadata = {}) {
    const cacheDir = path.resolve(CACHE_DIR);
    if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
    }

    const filename = `${symbol}_${interval}_${config.minSwingPct}_${config.shortWindow}_${config.longWindow}.json`;
    const filepath = path.join(cacheDir, filename);
    
    const data = {
        symbol,
        interval,
        timestamp: Date.now(),
        config,
        metadata,
        pivots
    };

    fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
    console.log(`Saved ${pivots.length} pivots to ${filepath}`);
}

export function loadPivotData(symbol, interval, config) {
    const filename = `${symbol}_${interval}_${config.minSwingPct}_${config.shortWindow}_${config.longWindow}.json`;
    const filepath = path.join(CACHE_DIR, filename);

    if (!fs.existsSync(filepath)) {
        console.log(`No cached pivot data found for ${symbol}_${interval}`);
        return null;
    }

    const data = JSON.parse(fs.readFileSync(filepath, 'utf8'));

    // Validate config matches
    const configMatches = Object.entries(config).every(([key, value]) => 
        data.config[key] === value
    );

    if (!configMatches) {
        console.log('Config mismatch, cached data will be regenerated');
        return null;
    }

    console.log(`Loaded ${data.pivots.length} pivots from cache`);
    return data;
}

export function clearPivotCache(symbol = null, interval = null) {
    const cacheDir = path.resolve(CACHE_DIR);
    if (!fs.existsSync(cacheDir)) return;

    const files = fs.readdirSync(cacheDir);
    for (const file of files) {
        if (symbol && interval) {
            if (file.startsWith(`${symbol}_${interval}`)) {
                fs.unlinkSync(path.join(cacheDir, file));
                console.log(`Cleared cache for ${symbol}_${interval}`);
            }
        } else {
            fs.unlinkSync(path.join(cacheDir, file));
        }
    }
    
    if (!symbol && !interval) {
        console.log('Cleared all pivot cache files');
    }
}
