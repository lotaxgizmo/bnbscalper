// optimizerConfig.js
export const optimizerConfig = {
  takeProfitRange: {
    start: 0.08,  // 0.04%
    end: 6,    // 0.12%
    step: 0.01    // Test every 0.02%
  },
  stopLossRange: {
    start: 9,   // 0.1%
    end: 15,     // 0.3%
    step: 0.5    // Test every 0.05%
  }
};
