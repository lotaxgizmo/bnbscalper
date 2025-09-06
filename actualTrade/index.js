// index.js - Orchestrator for cascade detection and trade execution
// Connects immediateAggregationTrade.js with placeOrder.js

import { runImmediateAggregationSnapshot } from './immediateAggregationTrade.js';
import { executeTradeFromSignal } from './placeOrder.js';
import telegramNotifier from '../utils/telegramNotifier.js';

// ===== ORCHESTRATOR CONFIGURATION =====
const ORCHESTRATOR_CONFIG = {
    // Execution settings
    executeOnReady: true,           // Actually execute trades when signals are ready
    dryRun: false,                  // Set to true for testing without real trades
    
    // Monitoring settings
    checkInterval: 10,              // Seconds between cascade checks
    maxExecutionsPerRun: 1,         // Limit executions per check cycle
    
    // Logging
    verbose: true,                  // Detailed logging
    showNoSignals: false,           // Log when no signals are found
};

// ===== EXECUTION TRACKING =====
const executedSignals = new Set(); // Track executed signals to prevent duplicates
let isExecutingTrades = false; // Flag to prevent new cycles during trade execution

function generateSignalKey(signal) {
    // Create unique key based on signal characteristics
    const priceKey = Math.round((signal.price || 0) * 100); // cents precision
    const timeKey = Math.floor((signal.time || Date.now()) / 60000); // minute precision
    return `${signal.id}_${signal.signal}_${priceKey}_${timeKey}`;
}

// ===== MAIN ORCHESTRATOR FUNCTION =====
async function runOrchestrator() {
    console.log('🎯 CASCADE TRADING ORCHESTRATOR STARTED');
    console.log(`⚙️  Config: Execute=${ORCHESTRATOR_CONFIG.executeOnReady}, DryRun=${ORCHESTRATOR_CONFIG.dryRun}, Interval=${ORCHESTRATOR_CONFIG.checkInterval}s`);
    console.log('=' .repeat(60));
    
    // Send startup notification to Telegram
    try {
        const startupMessage = `🚀 *CASCADE ORCHESTRATOR STARTED*\n\n` +
            `⚙️ *Execute Mode:* ${ORCHESTRATOR_CONFIG.executeOnReady ? 'LIVE' : 'DISABLED'}\n` +
            `🧪 *Dry Run:* ${ORCHESTRATOR_CONFIG.dryRun ? 'ON' : 'OFF'}\n` +
            `⏱️ *Check Interval:* ${ORCHESTRATOR_CONFIG.checkInterval}s\n` +
            `📅 *Started:* ${new Date().toLocaleString()}\n\n` +
            `Ready to monitor cascade signals...`;
        
        await telegramNotifier.sendMessage(startupMessage);
        console.log('✅ Startup notification sent to Telegram');
    } catch (error) {
        console.log(`⚠️  Failed to send startup notification: ${error.message}`);
    }
    
    let cycleCount = 0;
    
    while (true) {
        try {
            // Skip cycle if trades are currently being executed
            if (isExecutingTrades) {
                if (ORCHESTRATOR_CONFIG.verbose) {
                    console.log(`⏸️  Skipping cycle - trade execution in progress`);
                }
                await sleep(ORCHESTRATOR_CONFIG.checkInterval * 1000);
                continue;
            }
            
            cycleCount++;
            const startTime = Date.now();
            
            if (ORCHESTRATOR_CONFIG.verbose) {
                console.log(`\n🔄 Cycle #${cycleCount} - ${new Date().toLocaleString()}`);
            }
            
            // Run cascade detection
            const cascadeResult = await runImmediateAggregationSnapshot();
            
            if (!cascadeResult) {
                console.log('⚠️  No cascade result returned');
                await sleep(ORCHESTRATOR_CONFIG.checkInterval * 1000);
                continue;
            }
            
            const { readyToExecute, hasExecutableSignals, currentPrice, analysisTime } = cascadeResult;
            
            if (ORCHESTRATOR_CONFIG.verbose) {
                console.log(`📊 Analysis: Price=$${currentPrice}, Signals=${readyToExecute.length}, Executable=${hasExecutableSignals}`);
            }
            
            if (!hasExecutableSignals) {
                if (ORCHESTRATOR_CONFIG.showNoSignals) {
                    console.log('📭 No executable signals found');
                }
                await sleep(ORCHESTRATOR_CONFIG.checkInterval * 1000);
                continue;
            }
            
            // Debug: Show all ready signals before filtering
            console.log(`\n🔍 DEBUG: Found ${readyToExecute.length} ready signals:`);
            readyToExecute.forEach((signal, index) => {
                console.log(`   [${index}] ${signal.id}: ${signal.signal} @ $${signal.price} | Time: ${new Date(signal.time).toLocaleString()}`);
            });
            
            // Process ready-to-execute signals - prioritize newest windows only
            let executionsThisCycle = 0;
            
            // Filter signals by age - don't execute windows older than 2 minutes
            const currentTime = Date.now();
            const maxAgeMs = 2 * 60 * 1000; // 2 minutes
            
            const freshSignals = readyToExecute.filter(signal => {
                // Never execute W0 - it's always the oldest window
                if (signal.id === 'W0') {
                    console.log(`🚫 Skipping W0 - never execute oldest window`);
                    return false;
                }
                
                const age = currentTime - signal.time;
                const ageMinutes = Math.floor(age / 60000);
                if (age > maxAgeMs) {
                    console.log(`⏰ Skipping stale signal ${signal.id}: ${ageMinutes}m old (max 2m)`);
                    return false;
                }
                return true;
            });
            
            if (freshSignals.length === 0) {
                console.log('⏰ All signals are too old - skipping execution');
                await sleep(ORCHESTRATOR_CONFIG.checkInterval * 1000);
                continue;
            }
            
            // Execute only the newest fresh signal
            const signalsToExecute = [freshSignals[0]];
            
            if (readyToExecute.length > signalsToExecute.length) {
                console.log(`⚠️  Filtered ${readyToExecute.length} signals down to ${signalsToExecute.length} fresh signal(s)`);
                console.log(`✅ Executing newest fresh signal: ${signalsToExecute[0].id}`);
                if (readyToExecute.length > 1) {
                    console.log(`⏭️  Skipping signals: ${readyToExecute.slice(1).map(s => s.id).join(', ')}`);
                }
            }
            
            for (const signal of signalsToExecute) {
                // Check execution limit
                if (executionsThisCycle >= ORCHESTRATOR_CONFIG.maxExecutionsPerRun) {
                    console.log(`⏸️  Execution limit reached (${ORCHESTRATOR_CONFIG.maxExecutionsPerRun}) for this cycle`);
                    break;
                }
                
                // Check for duplicate execution
                const signalKey = generateSignalKey(signal);
                if (executedSignals.has(signalKey)) {
                    if (ORCHESTRATOR_CONFIG.verbose) {
                        console.log(`⏭️  Skipping duplicate signal: ${signal.id} ${signal.signal}`);
                    }
                    continue;
                }
                
                // Set execution flag to block new cycles
                isExecutingTrades = true;
                
                try {
                    // Execute the trade
                    console.log(`\n🚀 EXECUTING SIGNAL: ${signal.id} ${signal.signal?.toUpperCase()} @ $${signal.price}`);
                    
                    if (ORCHESTRATOR_CONFIG.dryRun) {
                        console.log('🧪 DRY RUN MODE - Trade simulation only');
                        console.log(`   Signal: ${signal.signal} @ $${signal.price}`);
                        console.log(`   Window: ${signal.id}`);
                        console.log('   ✅ Simulated execution successful');
                    } else if (ORCHESTRATOR_CONFIG.executeOnReady) {
                        try {
                            const tradeResult = await executeTradeFromSignal({
                                signal: signal.signal,
                                price: signal.price,
                                id: signal.id,
                                confirmations: signal.confirmations || 'N/A',
                                time: signal.time,
                                tpsl: signal.tpsl
                            });
                            
                            if (tradeResult.success) {
                                console.log('✅ Trade execution completed successfully');
                                executionsThisCycle++;
                            } else {
                                console.log(`❌ Trade execution failed: ${tradeResult.reason || tradeResult.error}`);
                            }
                        } catch (error) {
                            console.error(`💥 Trade execution error: ${error.message}`);
                        }
                    } else {
                        console.log('⏸️  Execution disabled - signal detected but not executed');
                    }
                    
                    // Mark signal as processed
                    executedSignals.add(signalKey);
                    
                    // Cleanup old executed signals (keep last 1000)
                    if (executedSignals.size > 1000) {
                        const signalsArray = Array.from(executedSignals);
                        const toRemove = signalsArray.slice(0, signalsArray.length - 500);
                        toRemove.forEach(key => executedSignals.delete(key));
                    }
                } finally {
                    // Always clear execution flag when done
                    isExecutingTrades = false;
                }
            }
            
            const cycleTime = Date.now() - startTime;
            if (ORCHESTRATOR_CONFIG.verbose) {
                console.log(`⏱️  Cycle completed in ${cycleTime}ms | Executions: ${executionsThisCycle}`);
            }
            
        } catch (error) {
            console.error(`💥 Orchestrator error: ${error.message}`);
            console.error(error.stack);
        }
        
        // Wait before next cycle
        await sleep(ORCHESTRATOR_CONFIG.checkInterval * 1000);
    }
}

// ===== UTILITY FUNCTIONS =====
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ===== GRACEFUL SHUTDOWN =====
process.on('SIGINT', () => {
    console.log('\n🛑 Orchestrator shutting down gracefully...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Orchestrator terminated');
    process.exit(0);
});

// ===== START ORCHESTRATOR =====
runOrchestrator().catch(error => {
    console.error('💥 Fatal orchestrator error:', error);
    process.exit(1);
});
