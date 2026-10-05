'use strict';

// Barcha sanalar "YYYY-MM-DD" ko'rinishida, kompaniya vaqt zonasida (default Toshkent, UTC+5).
const OFFSET_H = Number(process.env.TZ_OFFSET_HOURS ?? 5);
const OFFSET_MS = OFFSET_H * 3600 * 1000;
const DAY_MS = 86400 * 1000;

// Haqiqiy kalendar sanasi (2026-02-31 kabilar rad etiladi), 2000–2100 oralig'ida
function isDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(s + 'T00:00:00Z');
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s && s >= '2000-01-01' && s <= '2100-12-31';
}

function today() {
  return new Date(Date.now() + OFFSET_MS).toISOString().slice(0, 10);
}

// Unix sekund -> mahalliy sana
function dateOfUnix(sec) {
  return new Date(sec * 1000 + OFFSET_MS).toISOString().slice(0, 10);
}

// Mahalliy kun boshlanishi (unix sekund)
function dayStartUnix(date) {
  return Math.floor((Date.parse(date + 'T00:00:00Z') - OFFSET_MS) / 1000);
}

function addDays(date, n) {
  return new Date(Date.parse(date + 'T00:00:00Z') + n * DAY_MS).toISOString().slice(0, 10);
}

function weekday(date) {
  // 0 = yakshanba ... 6 = shanba
  return new Date(date + 'T00:00:00Z').getUTCDay();
}

// from..to oralig'idagi kunlar soni (ikkala chet ham kiradi)
function daysBetween(from, to) {
  return Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / DAY_MS) + 1;
}

function eachDay(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

function periodRange(period, date, from, to) {
  const [y, m] = date.split('-').map(Number);
  switch (period) {
    case 'day':
      return { from: date, to: date };
    case 'week': {
      const wd = weekday(date);
      const start = addDays(date, wd === 0 ? -6 : 1 - wd); // dushanbadan
      return { from: start, to: addDays(start, 6) };
    }
    case 'year':
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    case 'custom':
      if (isDate(from) && isDate(to) && from <= to) return { from, to };
      return periodRange('month', date);
    case 'month':
    default: {
      const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const mm = String(m).padStart(2, '0');
      return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(last).padStart(2, '0')}` };
    }
  }
}

module.exports = { today, dateOfUnix, dayStartUnix, addDays, weekday, eachDay, daysBetween, periodRange, isDate, OFFSET_H };
