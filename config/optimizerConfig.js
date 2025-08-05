// optimizerConfig.js
export const optimizerConfig = {
  takeProfitRange: {
    start: 0.2,  // 0.04%
    end: 4,    // 0.12%
    step: 0.2    // Test every 0.02%
  },
  stopLossRange: {
    start: 0.3,   // 0.1%
    end: 0.4,     // 0.3%
    step: 0.1   // Test every 0.05%
  },
  leverageRange: {
    start: 20,   // 1x
    end: 100,     // 100x
    step: 1   // Test every 1x
  }
};
