// trade/tradeconfig.js - Configuration for the Live Trade Simulator

export const tradeConfig = {
    // --- Capital ---
    // The initial capital for the trading simulator.
    // This is the starting equity, cash, and balance.
    initialCapital: 1000,

    // --- Slippage Simulation ---
    // Simulates the difference between the expected price and the actual execution price.
    enableSlippage: true,        // Master switch for slippage simulation.
    slippageMode: 'fixed',        // 'fixed' or 'variable'.
    slippagePercent: 0.05,        // The percentage of slippage to apply.
};