import { CONFIG } from '../../core/Config.js';
import { t } from '../../ui/Lang.js';

export const SEASON_COUNT = 4;

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const MONTH_KEYS = Array.from({ length: 12 }, (_, i) => `hud.season.month.${i + 1}`);

const MONTH_TO_SEASON = [
  3, 3,
  0, 0, 0,
  1, 1, 1,
  2, 2, 2,
  3,
];

const SEASON_START_MONTH = [2, 5, 8, 11];

const WEEKDAY_KEYS = Array.from({ length: 7 }, (_, i) => `hud.season.weekday.${i}`);

const ORDINAL_KEYS = [
  'hud.season.ord.0',
  'hud.season.ord.1',
  'hud.season.ord.2',
  'hud.season.ord.3',
];

function isLeapYear(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function ordinalIndex(n) {
  const last2 = n % 100;
  if (last2 >= 11 && last2 <= 13) return 3;
  switch (n % 10) {
    case 1: return 0;
    case 2: return 1;
    case 3: return 2;
    default: return 3;
  }
}

export function calendarOf(day) {
  const d = Math.max(0, Math.floor(day) || 0);

  const weekday = (d + CONFIG.SEASON.EPOCH_WEEKDAY) % 7;

  let year = CONFIG.SEASON.EPOCH_YEAR;
  let left = d;
  for (;;) {
    const len = isLeapYear(year) ? 366 : 365;
    if (left < len) break;
    left -= len;
    year++;
  }

  let month = 0;
  for (; month < 12; month++) {
    const len = MONTH_DAYS[month] + (month === 1 && isLeapYear(year) ? 1 : 0);
    if (left < len) break;
    left -= len;
  }

  return { year, month, dayOfMonth: left + 1, weekday };
}

export function formatDate(day) {
  const c = calendarOf(day);
  const dayNumber = `${c.dayOfMonth}${t(ORDINAL_KEYS[ordinalIndex(c.dayOfMonth)])}`;
  return t(
    'hud.season.date',
    t(WEEKDAY_KEYS[c.weekday]),
    dayNumber,
    t(MONTH_KEYS[c.month]),
    c.year,
  );
}

function dayIndexOf(year, month, dayOfMonth) {
  let n = dayOfMonth - 1;
  for (let m = 0; m < month; m++) n += MONTH_DAYS[m] + (m === 1 && isLeapYear(year) ? 1 : 0);

  const epoch = CONFIG.SEASON.EPOCH_YEAR;
  if (year >= epoch) {
    for (let y = epoch; y < year; y++) n += isLeapYear(y) ? 366 : 365;
  } else {
    for (let y = year; y < epoch; y++) n -= isLeapYear(y) ? 366 : 365;
  }
  return n;
}

export function seasonOf(day) {
  const d = Math.max(0, Math.floor(day) || 0);
  const c = calendarOf(d);
  const index = MONTH_TO_SEASON[c.month];
  const startMonth = SEASON_START_MONTH[index];
  const nextIndex = (index + 1) % SEASON_COUNT;
  const nextMonth = SEASON_START_MONTH[nextIndex];

  const startYear = c.month >= startMonth ? c.year : c.year - 1;

  const nextStartYear = nextMonth <= startMonth ? startYear + 1 : startYear;

  const startDay = dayIndexOf(startYear, startMonth, 1);
  const endDay = dayIndexOf(nextStartYear, nextMonth, 1) - 1;

  const from = Math.max(0, startDay);

  return {
    index,
    name: t(CONFIG.SEASON.NAMES[index]),
    dayInSeason: d - from + 1,
    daysInSeason: endDay - from + 1,
    year: c.year,
  };
}

export function seasonIcon(sheet, index) {
  if (!sheet) return null;
  const cell = Math.floor(sheet.width / CONFIG.SEASON.ICON_COLS);
  const rows = Math.max(1, Math.floor(sheet.height / CONFIG.SEASON.ICON_ROWS));
  const col = index % CONFIG.SEASON.ICON_COLS;
  const row = Math.floor(index / CONFIG.SEASON.ICON_COLS);

  const cv = document.createElement('canvas');
  cv.width = cell;
  cv.height = rows;

  cv.className = 'season-icon';
  const ctx = cv.getContext('2d');

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(sheet, col * cell, row * rows, cell, rows, 0, 0, cell, rows);
  return cv;
}
