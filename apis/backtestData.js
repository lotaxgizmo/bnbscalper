// backtestData.js
import { loadPivotData } from '../utils/pivotCache.js';

export function getBacktestData(symbol, interval, config) {
    const data = loadPivotData(symbol, interval, config);
    if (!data) return null;
    return data.metadata;
}
