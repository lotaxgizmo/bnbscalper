# Test script for Python backtester
import sys
import os

# Add the current directory to Python path
sys.path.insert(0, os.path.dirname(__file__))

try:
    from immediateAggregationBacktester import run_immediate_aggregation_backtest
    print("✓ Successfully imported backtester")
    
    # Run the backtester
    print("Starting backtester test...")
    run_immediate_aggregation_backtest()
    print("✓ Backtester completed successfully")
    
except ImportError as e:
    print(f"✗ Import error: {e}")
except Exception as e:
    print(f"✗ Runtime error: {e}")
    import traceback
    traceback.print_exc()
