// optimizerConfig.js

export const optimizerConfig = {
  // time: '1h', '3m', '1m', '5m', '15m', '30m', '4h', '1d', '1w', '1M',
  takeProfitRange: {
    start: 1,  // 0.04%
    end: 1,    // 0.12%
    step: 1    // Test every 0.02%
  },
  stopLossRange: {
    start: 0.2,   // 0.1%
    end: 1,     // 0.3%
    step: 0.1   // Test every 0.05%
  },
  minSwingPctRange: {
    start: 1,   // 0.1%
    end: 1,     // 0.3%
    step: 1   // Test every 0.05%
  },
  minLegBarsRange: {
    start: 2,   // 1x
    end: 8,     // 100x
    step: 1   // Test every 1x
  },
  pivotLookbackRange: {
    start: 2,   // 1x
    end: 8,     // 100x
    step: 1   // Test every 1x
  },
  leverageRange: {
    start: 1,   // 1x
    end: 1,     // 100x
    step: 1   // Test every 1x
  }
};
