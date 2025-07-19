// testRateLimits.js
import fs from 'fs';
import { getCandles } from './bybit.js';

const TEST_PAIR = 'BNBUSDT';
const TEST_INTERVAL = '1';
const LOG_FILE = './rateLimit_test_results.txt';

// Function to sleep for a specified duration
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Function to log results
function logResult(message) {
    const timestamp = new Date().toISOString();
    const logMessage = `${timestamp}: ${message}\n`;
    console.log(logMessage.trim());
    fs.appendFileSync(LOG_FILE, logMessage);
}

// Test rapid sequential requests
async function testSequentialRequests(count = 10, delayMs = 100) {
    logResult(`\n=== Testing ${count} Sequential Requests with ${delayMs}ms delay ===`);
    const results = [];
    
    for (let i = 0; i < count; i++) {
        const startTime = Date.now();
        try {
            await getCandles(TEST_PAIR, TEST_INTERVAL, 100);
            const duration = Date.now() - startTime;
            results.push({ success: true, duration });
            logResult(`Request ${i + 1}/${count}: Success - ${duration}ms`);
        } catch (error) {
            results.push({ success: false, error: error.message });
            logResult(`Request ${i + 1}/${count}: Failed - ${error.message}`);
        }
        await sleep(delayMs);
    }
    
    return results;
}

// Test concurrent requests
async function testConcurrentRequests(count = 5) {
    logResult(`\n=== Testing ${count} Concurrent Requests ===`);
    const promises = [];
    
    for (let i = 0; i < count; i++) {
        const promise = (async () => {
            const startTime = Date.now();
            try {
                await getCandles(TEST_PAIR, TEST_INTERVAL, 100);
                const duration = Date.now() - startTime;
                logResult(`Concurrent Request ${i + 1}/${count}: Success - ${duration}ms`);
                return { success: true, duration };
            } catch (error) {
                logResult(`Concurrent Request ${i + 1}/${count}: Failed - ${error.message}`);
                return { success: false, error: error.message };
            }
        })();
        promises.push(promise);
    }
    
    return Promise.all(promises);
}

// Main test function
async function runRateLimitTests() {
    // Clear previous log file
    fs.writeFileSync(LOG_FILE, '');
    logResult('Starting Rate Limit Tests...');
    
    try {
        // Test 1: Quick sequential requests with 100ms delay
        await testSequentialRequests(10, 100);
        await sleep(2000); // Cool down
        
        // Test 2: Quick sequential requests with 500ms delay
        await testSequentialRequests(10, 500);
        await sleep(2000); // Cool down
        
        // Test 3: Concurrent requests
        await testConcurrentRequests(5);
        
        logResult('\nAll tests completed!');
        
    } catch (error) {
        logResult(`Test suite error: ${error.message}`);
    }
}

// Run the tests
runRateLimitTests().catch(console.error);
