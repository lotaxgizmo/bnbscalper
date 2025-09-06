
import { parentPort, workerData } from 'worker_threads';
import { getCandles } from '../apis/bybit.js';

async function loadCandleBatch() {
    try {
        const { symbol, interval, batchSize, endTime, batchId } = workerData;
        
        // Load candles for this batch
        const candles = await getCandles(symbol, interval, batchSize, endTime);
        
        // Send success result back to main thread
        parentPort.postMessage({
            success: true,
            batchId,
            candles,
            count: candles.length
        });
        
    } catch (error) {
        // Send error result back to main thread
        parentPort.postMessage({
            success: false,
            batchId: workerData.batchId,
            error: error.message
        });
    }
}

// Start the batch loading
loadCandleBatch();
