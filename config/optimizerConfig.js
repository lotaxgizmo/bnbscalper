// optimizerConfig.js
export const optimizerConfig = {
  takeProfitRange: {
    start: 0.1,  // 0.04%
    end: 6,    // 0.12%
    step: 0.1    // Test every 0.02%
  },
  stopLossRange: {
    start: 0.1,   // 0.1%
    end: 6,     // 0.3%
    step: 0.1    // Test every 0.05%
  }
};
