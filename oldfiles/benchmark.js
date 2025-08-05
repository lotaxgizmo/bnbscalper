// took appprox 4 minutes for 1000 iterations

import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Performance measurement utilities
const measurePerformance = (startTime) => {
    const endTime = process.hrtime.bigint();
    return Number(endTime - startTime) / 1e6; // Convert to milliseconds
};

// Worker thread function
if (!isMainThread) {
    const runBacktest = async () => {
        // Redirect console.log to prevent 'Done' messages
        const originalLog = console.log;
        console.log = (...args) => {
            if (args[0]?.includes('pivots from cache')) {
                originalLog(...args);
            }
        };

        // Import and run backtest
        await import('./backtest.js');
        
        // Restore console.log
        console.log = originalLog;
    };

    runBacktest()
        .then(() => {
            parentPort.postMessage({ type: 'success' });
            process.exit(0); // Exit cleanly
        })
        .catch(error => {
            parentPort.postMessage({ type: 'error', error: error.message });
            process.exit(1);
        });
}

// Main thread
if (isMainThread) {
    const runBenchmark = async (iterations = 5, maxWorkers = os.cpus().length) => {
        console.log(`Starting benchmark with ${iterations} iterations`);
        console.log(`Using ${maxWorkers} worker threads`);
        console.log('System:', os.type(), os.release());
        console.log('CPU Cores:', os.cpus().length);
        console.log('Memory:', Math.round(os.totalmem() / (1024 * 1024 * 1024)), 'GB');
        console.log('');

        const startTime = process.hrtime.bigint();
        const maxConcurrentWorkers = maxWorkers; // Limit to CPU core count
        let completedIterations = 0;
        let activeWorkers = 0;
        let nextIteration = 0;

        // Create a promise that resolves when all iterations are complete
        return new Promise((resolveAll, rejectAll) => {
            const startNextWorker = () => {
                if (nextIteration >= iterations) {
                    if (activeWorkers === 0) {
                        resolveAll();
                    }
                    return;
                }

                const currentIteration = nextIteration++;
                activeWorkers++;

                const worker = new Worker('./benchmark.js');

                worker.on('message', (message) => {
                    if (message.type === 'success') {
                        completedIterations++;
                        console.log(`Completed ${completedIterations}/${iterations} (Worker ${currentIteration})`);
                        worker.terminate();
                        activeWorkers--;
                        startNextWorker(); // Start next worker when this one finishes
                    } else {
                        console.error(`Worker ${currentIteration} error:`, message.error);
                        worker.terminate();
                        activeWorkers--;
                        startNextWorker();
                    }
                });

                worker.on('error', (error) => {
                    console.error(`Worker ${currentIteration} error:`, error);
                    worker.terminate();
                    activeWorkers--;
                    startNextWorker();
                });

                worker.on('exit', (code) => {
                    if (code !== 0 && code !== null) {
                        console.error(`Worker ${currentIteration} exited with code ${code}`);
                    }
                });
            };

            // Start initial batch of workers
            for (let i = 0; i < maxConcurrentWorkers && i < iterations; i++) {
                startNextWorker();
            }
        }).then(() => {
            const totalTime = measurePerformance(startTime);
            console.log('\nBenchmark Results:');
            console.log('-----------------');
            console.log(`Total Time: ${(totalTime / 1000).toFixed(2)} seconds`);
            console.log(`Average Time per Iteration: ${(totalTime / iterations).toFixed(2)}ms`);
            console.log(`Iterations per Second: ${(1000 / (totalTime / iterations)).toFixed(2)}`);
        });
    };

    // Command line arguments
    const iterations = parseInt(process.argv[2]) || 5;
    const maxWorkers = parseInt(process.argv[3]) || os.cpus().length;
    runBenchmark(iterations, maxWorkers).catch(console.error);
}
