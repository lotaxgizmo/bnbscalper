// browserCache.js
export async function loadPivotData(symbol, interval, config) {
    const filename = `${symbol}_${interval}_${config.minSwingPct}_${config.shortWindow}_${config.longWindow}_${config.minLegBars}.json`;
    const response = await fetch(`/data/pivots/${filename}`);
    
    if (!response.ok) {
        console.log(`No cached pivot data found for ${symbol}_${interval}`);
        return null;
    }

    const data = await response.json();

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
