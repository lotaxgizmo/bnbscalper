// ANSI color codes
export const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m'
};

export const formatDuration = (totalMinutes, showFullTimePeriod = true) => {
  const totalHours = Math.floor(totalMinutes / 60);
  const days = Math.floor(totalHours / 24);
  const hours = Math.floor(totalHours % 24);
  const minutes = Math.floor(totalMinutes % 60);
  
  const s = n => n === 1 ? '' : 's';  // Format duration string
  let parts = [];
  
  if (showFullTimePeriod) {
    if (days > 0) parts.push(`${days} day${s(days)}`);
    if (hours > 0) parts.push(`${hours} hour${s(hours)}`);
    if (minutes > 0) parts.push(`${minutes} minute${s(minutes)}`);
  } else {
    // In simplified mode, convert everything to hours and always show minutes
    parts.push(`${totalHours} hour${s(totalHours)}`);
    parts.push(`${minutes} minute${s(minutes)}`);
  }
  
  return parts.join(', ') || '0 minutes';
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
