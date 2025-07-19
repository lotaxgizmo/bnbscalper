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

  update(candle) {
    const { high, low, close: price, time } = candle;

    // First-ever initialization
    if (this.pivotPrice === null) {
      this.pivotPrice   = price;
      this.pivotTime    = time;
      this.extremePrice = price;
      this.extremeTime  = time;
      return null;
    }

    // Count candle in this leg
    this.legBars++;

    // Detect initial direction if none yet
    if (!this.direction) {
      const upMove   = (price - this.pivotPrice) / this.pivotPrice;
      const downMove = (this.pivotPrice - price) / this.pivotPrice;
      if (upMove >= this.swingThreshold) {
        this.direction    = 'up';
        this.extremePrice = high;
        this.extremeTime  = time;
      } else if (downMove >= this.swingThreshold) {
        this.direction    = 'down';
        this.extremePrice = low;
        this.extremeTime  = time;
      }
      return null;
    }

    // Update extreme in current direction
    if (this.direction === 'up') {
      if (high > this.extremePrice) {
        this.extremePrice = high;
        this.extremeTime  = time;
      }
      // measure pullback
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
        this.extremeTime  = time;
      }
      // measure bounce
      const reference = this.confirmOnClose ? price : high;
      const retrace   = (reference - this.extremePrice) / this.extremePrice;

      if (retrace >= this.swingThreshold && this.legBars >= this.minLegBars) {
        return this._confirmPivot('low');
      }
    }

    return null;
  }

  _confirmPivot(type) {
    // Create pivot point
    const pivot = {
      type,
      price: this.extremePrice,
      time: this.extremeTime,
      previousPrice: this.pivotPrice,
      previousTime: this.pivotTime
    };

    // Add to history
    this.pivots.push(pivot);

    // Calculate swing percentage
    const swing = type === 'high'
      ? (this.extremePrice - this.pivotPrice) / this.pivotPrice
      : (this.pivotPrice - this.extremePrice) / this.pivotPrice;

    // Update swing history
    this.recentSwingsShort.push(swing);
    this.recentSwingsLong.push(swing);

    // Track by direction
    if (type === 'high') {
      this.upSwingsShort.push(swing);
      this.upSwingsLong.push(swing);
    } else {
      this.downSwingsShort.push(swing);
      this.downSwingsLong.push(swing);
    }

    // Maintain window sizes
    this._maintainWindows();

    // Reset state for next swing
    this.pivotPrice = this.extremePrice;
    this.pivotTime = this.extremeTime;
    this.direction = type === 'high' ? 'down' : 'up';
    this.legBars = 0;

    return pivot;
  }

  _maintainWindows() {
    // Maintain short window sizes
    while (this.recentSwingsShort.length > this.shortWindow) {
      this.recentSwingsShort.shift();
    }
    while (this.upSwingsShort.length > this.shortWindow) {
      this.upSwingsShort.shift();
    }
    while (this.downSwingsShort.length > this.shortWindow) {
      this.downSwingsShort.shift();
    }

    // Maintain long window sizes
    while (this.recentSwingsLong.length > this.longWindow) {
      this.recentSwingsLong.shift();
    }
    while (this.upSwingsLong.length > this.longWindow) {
      this.upSwingsLong.shift();
    }
    while (this.downSwingsLong.length > this.longWindow) {
      this.downSwingsLong.shift();
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
}

// Helper for averages
function avg(arr) {
  return arr.length ? arr.reduce((a,b) => a+b, 0) / arr.length : 0;
}
