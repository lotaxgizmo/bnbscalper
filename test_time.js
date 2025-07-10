// test_time.js
import { getCandles as getBinanceCandles } from './binance.js';
import { getCandles as getBybitCandles } from './bybit.js';
import { time, symbol, limit, showFullTimePeriod } from './config.js';

const formatTimePeriod = (candles) => {
  const getTimeInMinutes = (interval) => {
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

  const minutesPerCandle = getTimeInMinutes(time);
  const totalMinutes = candles * minutesPerCandle;
  const totalHours = Math.floor(totalMinutes / 60);
  const months = Math.floor(totalHours / (30 * 24));
  const days = Math.floor((totalHours % (30 * 24)) / 24);
  const hours = Math.floor(totalHours % 24);
  const minutes = Math.floor(totalMinutes % 60);
  
  const s = n => n === 1 ? '' : 's';
  
  let parts = [];
  if (showFullTimePeriod) {
    if (months > 0) parts.push(`${months} month${s(months)}`);
    if (days > 0) parts.push(`${days} day${s(days)}`);
    if (hours > 0) parts.push(`${hours} hour${s(hours)}`);
    if (minutes > 0) parts.push(`${minutes} minute${s(minutes)}`);
  } else {
    // Simplified display - convert everything to hours and minutes
    const totalDisplayHours = months * 30 * 24 + days * 24 + hours;
    if (totalDisplayHours > 0) parts.push(`${totalDisplayHours} hour${s(totalDisplayHours)}`);
    if (minutes > 0) parts.push(`${minutes} minute${s(minutes)}`);
  }
  return parts.join(', ') || '0 minutes';
};

const testAPI = async (name, getCandlesFunc) => {
  console.log(`\nTesting ${name} API:`);
  console.log('------------------------');
  
  const candles = await getCandlesFunc(symbol, time, limit);
  const totalMinutes = candles.length * (time === '1m' ? 1 : parseInt(time));
  
  console.log('Candles received:', candles.length);
  console.log('Minutes per candle:', time === '1m' ? 1 : parseInt(time));
  console.log('Time period:', formatTimePeriod(totalMinutes));

};

const main = async () => {
  await testAPI('Binance', getBinanceCandles);
  await testAPI('Bybit', getBybitCandles);
};

main();
