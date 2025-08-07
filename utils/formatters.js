// ANSI color codes
export const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  bright: '\x1b[1;37m',
  brightCyan: '\x1b[1;36m'
};

export const formatDuration = (ms, showFullTimePeriod = true) => {
  if (ms < 0) ms = 0;
  const totalSeconds = Math.floor(ms / 1000);
  const totalMinutes = Math.floor(totalSeconds / 60);
  const totalHours = Math.floor(totalMinutes / 60);
  const days = Math.floor(totalHours / 24);

  const hours = totalHours % 24;
  const minutes = totalMinutes % 60;

  const s = n => n === 1 ? '' : 's';
  let parts = [];

  if (showFullTimePeriod) {
    if (days > 0) parts.push(`${days} day${s(days)}`);
    if (hours > 0) parts.push(`${hours} hour${s(hours)}`);
    if (minutes > 0) parts.push(`${minutes} minute${s(minutes)}`);
  } else {
    // Simplified mode can be just total hours and minutes
    if (totalHours > 0) parts.push(`${totalHours} hour${s(totalHours)}`);
    if (minutes > 0) parts.push(`${minutes} minute${s(minutes)}`);
  }

  if (parts.length === 0) {
    return '< 1 minute';
  }

  return parts.join(', ');
};

export const getTimeInMinutes = (interval) => {
  const value = parseInt(interval);
  const unit = interval.slice(-1);
  switch(unit) {
    case 's': return value / 60; // seconds to minutes
    case 'm': return value; // minutes
    case 'h': return value * 60; // hours to minutes
    case 'd': return value * 24 * 60; // days to minutes
    case 'w': return value * 7 * 24 * 60; // weeks to minutes
    default: return value; // assume minutes
  }
};

// Format numbers with commas for thousands separator
export const formatNumber = (num, decimals = 2) => {
  if (typeof num !== 'number') return num;
  return num.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
};
