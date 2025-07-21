# Issues and Solutions Log

## 2. Backtest Code Organization
**Issue**: Backtest-specific utilities were mixed with general utilities in the utils directory, making it harder to identify which utils were specific to backtesting functionality.

**Solution**: 
1. Moved backtest-specific utils to a dedicated directory:
```bash
mv utils/backtestEngine.js utils/backtestExporter.js utils/backtestStats.js utils/consoleLogger.js utils/backtest/
```

2. Fixed import paths in moved files:
```javascript
// In backtestEngine.js
import PivotTracker from '../pivotTracker.js';
import { colors } from '../formatters.js';

// In consoleLogger.js
import { colors, formatDuration } from '../formatters.js';
import { formatDateTime } from '../candleAnalytics.js';
```

And updated imports in backtest.js:
```javascript
import { BacktestEngine } from './utils/backtest/backtestEngine.js';
import { BacktestStats } from './utils/backtest/backtestStats.js';
import { BacktestExporter } from './utils/backtest/backtestExporter.js';
import { ConsoleLogger } from './utils/backtest/consoleLogger.js';
```

**Benefits**:
- Better code organization
- Clearer separation between general and backtest-specific utils
- Easier to maintain and understand code responsibilities
- Improved module cohesion

## 1. Console Output Modularization
**Issue**: Console output code was mixed with business logic in backtest.js, making it hard to maintain and modify output formats.

**Solution**: 
- Created dedicated ConsoleLogger class in utils/consoleLogger.js
- Moved all console output formatting and display logic to the logger
- Made output configurable through performance mode
- Improved code organization and maintainability

**Benefits**:
- Easier to modify output formats
- Consistent styling across all console output
- Better separation of concerns
- Reduced code duplication
- Simpler testing of business logic
