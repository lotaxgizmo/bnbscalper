// utils/pivotTracker.js
/**
 * PivotTracker detects swing highs and lows based on percentage movements,
 * with a configurable minimum number of candles per swing.
 */
export default class PivotTracker {
  constructor({
    minSwingPct,
    shortWindow,
    longWindow,
    confirmOnClose,
    minLegBars
  }) {
    // Settings
    this.swingThreshold = minSwingPct / 100;
    this.shortWindow    = shortWindow;
    this.longWindow     = longWindow;
    this.confirmOnClose = confirmOnClose;
    this.minLegBars     = minLegBars;

    // Current-swing state
    this.direction    = null;    // 'up' or 'down'
    this.pivotPrice   = null;
    this.pivotTime    = null;
    this.extremePrice = null;
    this.extremeTime  = null;
    this.legBars      = 0;       // candle count in current swing

    // History
    this.pivots           = [];
    this.recentSwingsShort = [];
    this.recentSwingsLong  = [];
    this.upSwingsShort     = [];
    this.downSwingsShort   = [];
    this.upSwingsLong      = [];
    this.downSwingsLong    = [];
  }

  loadPivots(pivots) {
    // Replace internal pivot array with pre-calculated pivots
    this.pivots = pivots;
  }

  update(candle) {
    const { high, low, close: price, time } = candle;

    // First-ever initialization
    if (this.pivotPrice === null) {
      this.pivotPrice   = price;
      this.pivotTime    = time;
      this.extremePrice = price;
      this.extremeTime  = time;
      this.direction    = null;
      return null;
    }

    // Find matching pivot in loaded data
    const loadedPivot = this.pivots.find(p => p.time === time && Math.abs(p.price - price) < 0.01);

    // Count candle in this leg
    this.legBars++;

    // Detect initial direction if none yet
    if (!this.direction) {
      const upMove   = (price - this.pivotPrice) / this.pivotPrice;
      const downMove = (this.pivotPrice - price) / this.pivotPrice;
      if (upMove >= this.swingThreshold) {
        this.direction    = 'up';
        this.extremePrice = high;
        this.extremeTime  = time; // Already in seconds
      } else if (downMove >= this.swingThreshold) {
        this.direction    = 'down';
        this.extremePrice = low;
        this.extremeTime  = time; // Already in seconds
      }
      return null;
    }

    // Update extreme in current direction
    if (this.direction === 'up') {
      if (high > this.extremePrice) {
        this.extremePrice = high;
        this.extremeTime  = time; // Already in seconds
      }
      // measure pullback
      // When confirmOnClose is true, use closing price for confirmation
      // but still track the actual high as the pivot price
      const reference = this.confirmOnClose ? price : low;
      const retrace   = (this.extremePrice - reference) / this.extremePrice;

      // **Only confirm** if both percent and min bars criteria met
      if (retrace >= this.swingThreshold && this.legBars >= this.minLegBars) {
        return this._confirmPivot('high');
      }
    } else {
      // direction === 'down'
      if (low < this.extremePrice) {
        this.extremePrice = low;
        this.extremeTime  = time; // Already in seconds
      }
      // measure bounce
      // When confirmOnClose is true, use closing price for confirmation
      // but still track the actual low as the pivot price
      const reference = this.confirmOnClose ? price : high;
      const retrace   = (reference - this.extremePrice) / this.extremePrice;

      if (retrace >= this.swingThreshold && this.legBars >= this.minLegBars) {
        return this._confirmPivot('low');
      }
    }

    return null;
  }

  _confirmPivot(type) {
    // Calculate swing percentage
    const movePct = Math.abs((this.extremePrice - this.pivotPrice) / this.pivotPrice);

    // Find matching pivot in loaded data
    const loadedPivot = this.pivots.find(p => p.time === this.extremeTime && Math.abs(p.price - this.extremePrice) < 0.01);

    // Create pivot point with all necessary properties
    const pivot = {
      type,
      price: this.extremePrice,
      time: this.extremeTime,
      previousPrice: this.pivotPrice,
      previousTime: this.pivotTime,
      movePct,
      bars: this.legBars,
      edges: loadedPivot?.edges, // Preserve edge data if found
      // Add additional data for validation and debugging
      confirmedOnClose: this.confirmOnClose,
      displayTime: new Date(this.extremeTime * 1000).toLocaleTimeString() // Convert timestamp to readable format
    };

    // Record swing data
    this._recordSwing(movePct, type);
    
    // Add to pivot history
    this.pivots.push(pivot);

    // Reset state for next swing
    this.direction = type === 'high' ? 'down' : 'up';
    this.pivotPrice = pivot.price;
    this.pivotTime = pivot.time;
    this.extremePrice = pivot.price;
    this.extremeTime = pivot.time;
    this.legBars = 0;

    return pivot;
  }

  _recordSwing(pct, type) {
    const pushTrim = (arr, v, max) => { arr.push(v); if (arr.length > max) arr.shift(); };

    pushTrim(this.recentSwingsShort, pct, this.shortWindow);
    pushTrim(this.recentSwingsLong, pct, this.longWindow);

    if (type === 'high') {
      pushTrim(this.upSwingsShort, pct, this.shortWindow);
      pushTrim(this.upSwingsLong, pct, this.longWindow);
    } else {
      pushTrim(this.downSwingsShort, pct, this.shortWindow);
      pushTrim(this.downSwingsLong, pct, this.longWindow);
    }
  }

  /**
   * Add an existing pivot to the tracker's history.
   * Used when loading historical pivot data.
   * @param {Object} pivot - The pivot point to add
   */
  addExistingPivot(pivot) {
    // Add to pivots array
    this.pivots.push(pivot);
    
    // Calculate and update swing statistics
    if (pivot.type === 'high') {
      const swing = (pivot.price - pivot.previousPrice) / pivot.previousPrice;
      this.upSwingsShort.push(swing);
      this.upSwingsLong.push(swing);
      this.recentSwingsShort.push(swing);
      this.recentSwingsLong.push(swing);
    } else {
      const swing = (pivot.previousPrice - pivot.price) / pivot.previousPrice;
      this.downSwingsShort.push(swing);
      this.downSwingsLong.push(swing);
      this.recentSwingsShort.push(swing);
      this.recentSwingsLong.push(swing);
    }
    
    // Maintain window sizes
    this._maintainWindows();
    
    // Update current state if this is the first pivot
    if (this.pivots.length === 1) {
      this.pivotPrice = pivot.price;
      this.pivotTime = pivot.time;
      this.direction = pivot.type === 'high' ? 'down' : 'up';
      this.extremePrice = pivot.price;
      this.extremeTime = pivot.time;
      this.legBars = 0;
    }
  }

  // Averages for optional downstream logic
  get avgShort()    { return avg(this.recentSwingsShort); }
  get avgLong()     { return avg(this.recentSwingsLong); }
  get avgUpShort()  { return avg(this.upSwingsShort); }
  get avgDownShort(){ return avg(this.downSwingsShort); }
  get avgUpLong()   { return avg(this.upSwingsLong); }
  get avgDownLong() { return avg(this.downSwingsLong); }

  // Get the current average swing size
  getAverageSwing() {
    return this.avgShort || 0;
  }

  // Get current market state for prediction
  getCurrentState() {
    return {
      trend: this.direction,
      pivotPrice: this.pivotPrice,
      legBars: this.legBars,
      shortTermVolatility: this.avgShort || 0,
      longTermVolatility: this.avgLong || 0,
      averagePivotSize: this.getAverageSwing(),
      trendSlope: this.direction === 'up' ? 1 : -1,
      expectedDirection: this.direction === 'up' ? 'down' : 'up'
    };
  }

  /**
   * Add an existing pivot to the tracker's history.
   * Used when loading historical pivot data.
   * @param {Object} pivot - The pivot point to add
   */
  addExistingPivot(pivot) {
    // Add to pivots array
    this.pivots.push(pivot);
    
    // Record swing data using existing _recordSwing method
    this._recordSwing(pivot.movePct, pivot.type);
    
    // Update current state if this is the most recent pivot
    if (this.pivots.length === 1 || pivot.time > this.pivotTime) {
      this.pivotPrice = pivot.price;
      this.pivotTime = pivot.time;
      this.direction = pivot.type === 'high' ? 'down' : 'up';
      this.extremePrice = pivot.price;
      this.extremeTime = pivot.time;
      this.legBars = 0;
    }
  }
}

// Helper for averages
function avg(arr) {
  return arr.length ? arr.reduce((a,b) => a+b, 0) / arr.length : 0;
}
