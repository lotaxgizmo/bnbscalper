// Test API data consistency
import { getCandles as getBybitCandles } from '../apis/bybit.js';

const symbol = 'BTCUSDT';
const currentTime = Date.now();

console.log('=== API CONSISTENCY TEST ===');
console.log(`Current Time: ${new Date(currentTime).toLocaleString()}`);
console.log('');

// Test 1: 1-day window (1440 minutes)
const oneDayStart = currentTime - (1440 * 60 * 1000);
console.log(`1-Day Window: ${new Date(oneDayStart).toLocaleString()} → ${new Date(currentTime).toLocaleString()}`);

try {
    const oneDayCandles = await getBybitCandles(symbol, '1h', 24, currentTime, false);
    console.log(`1-Day Result: ${oneDayCandles.length} candles`);
    
    if (oneDayCandles.length > 0) {
        const first = new Date(oneDayCandles[0].time).toLocaleString();
        const last = new Date(oneDayCandles[oneDayCandles.length - 1].time).toLocaleString();
        console.log(`1-Day Range: ${first} → ${last}`);
        
        // Check for 6 PM yesterday candle
        const yesterdayEvening = new Date();
        yesterdayEvening.setDate(yesterdayEvening.getDate() - 1);
        yesterdayEvening.setHours(18, 0, 0, 0);
        
        const foundEvening = oneDayCandles.find(c => 
            Math.abs(c.time - yesterdayEvening.getTime()) < 60 * 60 * 1000
        );
        
        console.log(`Found 6 PM yesterday candle: ${foundEvening ? 'YES' : 'NO'}`);
        if (foundEvening) {
            console.log(`6 PM Candle: ${new Date(foundEvening.time).toLocaleString()} @ $${foundEvening.close}`);
        }
    }
} catch (error) {
    console.error('1-Day API Error:', error.message);
}

console.log('');

// Test 2: 7-day window (11440 minutes) 
const sevenDayStart = currentTime - (11440 * 60 * 1000);
console.log(`7-Day Window: ${new Date(sevenDayStart).toLocaleString()} → ${new Date(currentTime).toLocaleString()}`);

try {
    const sevenDayCandles = await getBybitCandles(symbol, '1h', 200, currentTime, false);
    console.log(`7-Day Result: ${sevenDayCandles.length} candles`);
    
    if (sevenDayCandles.length > 0) {
        const first = new Date(sevenDayCandles[0].time).toLocaleString();
        const last = new Date(sevenDayCandles[sevenDayCandles.length - 1].time).toLocaleString();
        console.log(`7-Day Range: ${first} → ${last}`);
        
        // Check for 6 PM yesterday candle
        const yesterdayEvening = new Date();
        yesterdayEvening.setDate(yesterdayEvening.getDate() - 1);
        yesterdayEvening.setHours(18, 0, 0, 0);
        
        const foundEvening = sevenDayCandles.find(c => 
            Math.abs(c.time - yesterdayEvening.getTime()) < 60 * 60 * 1000
        );
        
        console.log(`Found 6 PM yesterday candle: ${foundEvening ? 'YES' : 'NO'}`);
        if (foundEvening) {
            console.log(`6 PM Candle: ${new Date(foundEvening.time).toLocaleString()} @ $${foundEvening.close}`);
        }
    }
} catch (error) {
    console.error('7-Day API Error:', error.message);
}

console.log('');
console.log('=== TEST COMPLETE ===');
