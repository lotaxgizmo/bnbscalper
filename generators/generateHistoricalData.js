// generateHistoricalData.js
import fs from 'fs';
import path from 'path';
import { api, symbol } from '../config/config.js';
import { getCandles as getBinanceCandles } from '../apis/binance.js';
import { getCandles as getBybitCandles } from '../apis/bybit.js';

// Get the appropriate candle fetching function
const getCandles = api === 'binance' ? getBinanceCandles : getBybitCandles;
import { historicalDataConfig } from '../config/historicalDataConfig.js';

// Ensure directory exists
function ensureDirectoryExists(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

// Get file path for a pair and interval
function getFilePath(pair, interval) {
    // Ensure minute-based intervals have 'm' suffix
    const formattedInterval = interval.endsWith('h') || interval.endsWith('d') || interval.endsWith('w') ? interval : `${interval}m`;
    const fullPath = path.resolve(historicalDataConfig.dataPath, pair, `${formattedInterval}.csv`);
    console.log('Full path:', fullPath);
    return fullPath;
}

// Get last update time for a pair and interval
function getLastUpdateTime(pair, interval) {
    const key = `${pair}_${interval}`;
    return historicalDataConfig.lastUpdated[key] || 0;
}

// Save last update time
function saveLastUpdateTime(pair, interval, timestamp) {
    const key = `${pair}_${interval}`;
    historicalDataConfig.lastUpdated[key] = timestamp;
    // Save to a JSON file to persist between runs
    const configPath = path.join(historicalDataConfig.dataPath, 'lastUpdated.json');
    fs.writeFileSync(configPath, JSON.stringify(historicalDataConfig.lastUpdated, null, 2));
}

// Load last update times from file
function loadLastUpdateTimes() {
    const configPath = path.join(historicalDataConfig.dataPath, 'lastUpdated.json');
    if (fs.existsSync(configPath)) {
        const data = fs.readFileSync(configPath, 'utf8');
        historicalDataConfig.lastUpdated = JSON.parse(data);
    }
}

// Validate and sort candles
function validateAndSortCandles(candles) {
    // Remove any duplicates based on timestamp
    const uniqueCandles = Array.from(new Map(candles.map(c => [c.time, c])).values());
    
    // Sort by timestamp in ascending order
    return uniqueCandles.sort((a, b) => a.time - b.time);
}

// Load existing candles from CSV
function loadExistingCandles(filePath) {
    if (!fs.existsSync(filePath)) {
        console.log(`File does not exist: ${filePath}`);
        return [];
    }

    try {
        console.log(`Reading file: ${filePath}`);
        
        // Create backup of existing file
        const backupPath = `${filePath}.backup`;
        fs.copyFileSync(filePath, backupPath);
        console.log(`Created backup at: ${backupPath}`);

        // Read and clean the content
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content
            .split('\n')
            .map(line => line.trim())
            .filter(line => {
                // Must have content and proper structure
                if (!line || line === 'timestamp,open,high,low,close,volume') return false;
                
                // Basic validation: should have 6 comma-separated values
                const parts = line.split(',');
                if (parts.length < 5) return false;
                
                // First value should be a valid timestamp
                const timestamp = parseInt(parts[0]);
                if (isNaN(timestamp) || timestamp <= 0) return false;
                
                return true;
            });
        
        const candles = [];
        for (const line of lines) {
            try {
                const [time, open, high, low, close, volume] = line.split(',');
                const candle = {
                    time: parseInt(time),
                    open: parseFloat(open),
                    high: parseFloat(high),
                    low: parseFloat(low),
                    close: parseFloat(close),
                    volume: parseFloat(volume || '0')
                };
                
                // Additional validation
                if (!isNaN(candle.time) && 
                    !isNaN(candle.open) && 
                    !isNaN(candle.high) && 
                    !isNaN(candle.low) && 
                    !isNaN(candle.close)) {
                    candles.push(candle);
                } else {
                    console.log(`Skipping invalid candle data: ${line}`);
                }
            } catch (err) {
                console.log(`Error parsing line: ${line}`);
            }
        }
        
        if (candles.length > 0) {
            console.log(`Successfully loaded ${candles.length} valid candles`);
            return candles;
        } else {
            console.log('No valid candles found in file');
            return [];
        }
    } catch (error) {
        console.error(`Error reading file ${filePath}:`, error.message);
        return [];
    }
}

// Save candles to CSV
function saveCandlesToCSV(candles, filePath) {
    const validatedCandles = validateAndSortCandles(candles);
    const csvData = validatedCandles.map(c => 
        `${c.time},${c.open},${c.high},${c.low},${c.close},${c.volume}`
    ).join('\n');

    const header = 'timestamp,open,high,low,close,volume\n';
    fs.writeFileSync(filePath, header + csvData);

    return validatedCandles;
}

// Find missing time ranges
function findMissingRanges(existingCandles, targetStartTime, now, intervalMs) {
    if (existingCandles.length === 0) {
        return [{ start: targetStartTime, end: now }];
    }

    const sortedCandles = validateAndSortCandles(existingCandles);
    const ranges = [];
    let currentTime = targetStartTime;

    // Check if we need to fetch data before the earliest existing candle
    if (sortedCandles[0].time - intervalMs > targetStartTime) {
        ranges.push({
            start: targetStartTime,
            end: sortedCandles[0].time
        });
    }

    // Check for gaps in the middle
    for (let i = 0; i < sortedCandles.length - 1; i++) {
        const gap = sortedCandles[i + 1].time - sortedCandles[i].time;
        if (gap > intervalMs * 2) { // If gap is more than 2 intervals
            ranges.push({
                start: sortedCandles[i].time + intervalMs,
                end: sortedCandles[i + 1].time
            });
        }
    }

    // Check if we need to fetch data after the latest existing candle
    if (now - sortedCandles[sortedCandles.length - 1].time > intervalMs * 2) {
        ranges.push({
            start: sortedCandles[sortedCandles.length - 1].time + intervalMs,
            end: now
        });
    }

    return ranges;
}

// Fetch historical data for a pair and interval
async function fetchHistoricalData(pair, interval, clearExisting = false) {
    // Keep original interval format for file paths
    const cleanInterval = interval;
    console.log(`Processing ${pair} - ${cleanInterval}`);
    
    const filePath = getFilePath(pair, cleanInterval);
    ensureDirectoryExists(path.dirname(filePath));

    // Data is already in UTC+1, no offset needed
    const now = Date.now();
    const monthsInMs = historicalDataConfig.months * 30 * 24 * 60 * 60 * 1000;
    const targetStartTime = now - monthsInMs;
    const intervalMs = getIntervalMs(cleanInterval);

    try {
        // Handle existing data
        let existingCandles = [];
        if (!clearExisting) {
            console.log(`Loading existing data for ${pair} - ${cleanInterval}...`);
            existingCandles = loadExistingCandles(filePath);
            console.log(`Found ${existingCandles.length} existing candles`);
        } else {
            console.log(`Clearing existing data for ${pair} - ${cleanInterval}...`);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        }

        // Find missing ranges
        const missingRanges = findMissingRanges(existingCandles, targetStartTime, now, intervalMs);
        
        if (missingRanges.length === 0) {
            console.log('Data is up to date, no new fetching needed');
            return;
        }

        console.log(`Found ${missingRanges.length} missing time ranges to fetch`);
        let allNewCandles = [];
        let consecutiveErrors = 0;
        const MAX_RETRIES = 3;

        // Fetch each missing range
        for (const range of missingRanges) {
            console.log(`Fetching range: ${new Date(range.start).toISOString()} to ${new Date(range.end).toISOString()}`);
            let endTime = range.end;
            let oldestTime = range.end;

            while (oldestTime > range.start && consecutiveErrors < MAX_RETRIES) {
                try {
                    console.log(`Fetching batch for ${pair} - ${cleanInterval}, end time: ${new Date(endTime).toISOString()}`);
                    const candles = await getCandles(pair, cleanInterval, 10000, endTime);
                    
                    if (!candles || candles.length === 0) {
                        console.log(`No more data available before ${new Date(endTime).toISOString()}`);
                        break;
                    }

                    // Validate candle data
                    if (!candles.every(c => c.time && c.open && c.high && c.low && c.close)) {
                        throw new Error('Invalid candle data received');
                    }

                    // Update oldest time from this batch
                    oldestTime = candles[0].time;
                    
                    // Set next end time to just before oldest candle
                    endTime = oldestTime - 1;

                    // Add new candles to collection
                    allNewCandles = [...candles, ...allNewCandles];

                    console.log(`Fetched ${candles.length} candles, oldest: ${new Date(oldestTime).toISOString()}`);
                    
                    // Reset error counter on successful fetch
                    consecutiveErrors = 0;
                    
                    // Add small delay to avoid rate limits
                    await new Promise(resolve => setTimeout(resolve, 300));
                } catch (error) {
                    consecutiveErrors++;
                    console.error(`Error in batch (attempt ${consecutiveErrors}/${MAX_RETRIES}):`, error.message);
                    if (consecutiveErrors < MAX_RETRIES) {
                        await new Promise(resolve => setTimeout(resolve, 1000 * consecutiveErrors));
                    }
                }
            }
        }

        if (allNewCandles.length > 0) {
            // Merge new candles with existing ones
            const mergedCandles = validateAndSortCandles([...existingCandles, ...allNewCandles]);
            
            // Save all candles to CSV
            const savedCandles = saveCandlesToCSV(mergedCandles, filePath);
            saveLastUpdateTime(pair, cleanInterval, now);
            
            // Calculate actual date range
            const startDate = new Date(savedCandles[0].time);
            const endDate = new Date(savedCandles[savedCandles.length-1].time);
            const durationDays = Math.round((endDate - startDate) / (24 * 60 * 60 * 1000));
            
            console.log(`Successfully saved ${savedCandles.length} candles for ${pair} - ${cleanInterval}`);
            console.log(`Data range: ${startDate.toISOString()} to ${endDate.toISOString()} (${durationDays} days)`);
            
            // Validate data completeness
            const expectedCandles = Math.ceil((endDate - startDate) / intervalMs);
            const completeness = (savedCandles.length / expectedCandles * 100).toFixed(2);
            console.log(`Data completeness: ${completeness}% (${savedCandles.length}/${expectedCandles} candles)`);
            console.log(`Added ${allNewCandles.length} new candles to existing ${existingCandles.length} candles`);
        }
    } catch (error) {
        console.error(`Error fetching data for ${pair} - ${interval}:`, error.message);
    }
}

// Get interval duration in milliseconds
function getIntervalMs(interval) {
    const unit = interval.slice(-1);
    const value = parseInt(interval);
    switch(unit) {
        case 'h': return value * 60 * 60 * 1000;
        case 'd': return value * 24 * 60 * 60 * 1000;
        case 'w': return value * 7 * 24 * 60 * 60 * 1000; // weeks
        default: return value * 60 * 1000; // minutes
    }
}

// Main function to fetch all historical data
async function fetchAllHistoricalData() {
    loadLastUpdateTimes();
    
    for (const pair of historicalDataConfig.pairs) {
        for (const interval of historicalDataConfig.intervals) {
            try {
                await fetchHistoricalData(pair, interval);
                // Add a small delay between requests to avoid rate limits
                await new Promise(resolve => setTimeout(resolve, 1000));
            } catch (error) {
                console.error(`Failed to fetch data for ${pair} - ${interval}:`, error.message);
                // Continue with next interval despite error
                continue;
            }
        }
    }
}

// Run the data fetcher
fetchAllHistoricalData().then(() => {
    console.log('Historical data update complete');
}).catch(error => {
    console.error('Error updating historical data:', error);
});
