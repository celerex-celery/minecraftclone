/**
 * The calendar.
 *
 * Seasons are not a Minecraft mechanic - the real game has no year - so this
 * is a plain layer over the day counter: a season is a span of days, and which
 * span you are in is a division. Nothing here touches the world, the light or
 * the blocks. It exists so the HUD has one place to ask "which season is it,
 * and how many days in" without the answer being worked out twice.
 */

import { CONFIG } from '../../core/Config.js';
import { t } from '../../ui/Lang.js';

export const SEASON_COUNT = 4;

/** Days in each month, February corrected for leap years. */
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Translation keys for the month names, 1-indexed to match how people count. */
const MONTH_KEYS = Array.from({ length: 12 }, (_, i) => `hud.season.month.${i + 1}`);

/**
 * Month (0-indexed) -> season index, January through December.
 *
 * The meteorological grouping, which is the one that matches what people
 * actually call the seasons: March is spring, not winter. It is also the
 * grouping that puts seasons on whole months, so a season's length is a
 * property of the calendar rather than a number somebody chose.
 */
const MONTH_TO_SEASON = [
  3, 3,   // January, February  -> winter
  0, 0, 0,   // March, April, May -> spring
  1, 1, 1,   // June, July, August -> summer
  2, 2, 2,   // September, October, November -> autumn
  3,     // December -> winter
];

/**
 * The month each season starts in, indexed by season. The first day of that
 * month is day one of the season, which is what "day 3 of spring" counts from.
 */
const SEASON_START_MONTH = [2, 5, 8, 11];   // March, June, September, December

/** Weekday names, 0 = Monday. Order is the whole point, so keep them in step. */
const WEEKDAY_KEYS = Array.from({ length: 7 }, (_, i) => `hud.season.weekday.${i}`);

/** st, nd, rd, th - selected by which one a date's day number calls for. */
const ORDINAL_KEYS = [
  'hud.season.ord.0',
  'hud.season.ord.1',
  'hud.season.ord.2',
  'hud.season.ord.3',
];

/**
 * The real Gregorian leap rule: every fourth year, except centuries, except
 * every fourth century. The last clause is what makes 2000 a leap year and
 * 1900 not.
 */
function isLeapYear(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/**
 * Which of st/nd/rd/th a day of the month takes.
 *
 * The teens are the whole difficulty: 11, 12 and 13 are th, not st/nd/rd, so
 * it has to be the last *two* digits that decide. Everything else is the last
 * digit alone.
 */
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

/**
 * Turn a day count into a real date.
 *
 * @param {number} day days since the world was created, 0 = 1 January 2000
 * @returns {{year:number, month:number, dayOfMonth:number, weekday:number}}
 *          `month` is 0-indexed; `weekday` is 0 = Monday
 */
export function calendarOf(day) {
  const d = Math.max(0, Math.floor(day) || 0);

  // The week is a straight 7-day cycle off the epoch, so it needs no calendar
  // maths at all. Advancing the date separately is what keeps them independent.
  const weekday = (d + CONFIG.SEASON.EPOCH_WEEKDAY) % 7;

  // Peel off whole years, then whole months, leaving the day of the month.
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

/**
 * The date as a localised string: "Mon 1st January 2000".
 *
 * Assembled from four translated pieces and a translated format string, so a
 * language is free to put them in a different order. Spanish comes out as
 * "Lun 1º Enero 2000" from the same code, because its ordinal suffixes are all
 * the same mark rather than four different ones.
 *
 * @param {number} day
 * @returns {string}
 */
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

/**
 * The day count of a given date, the inverse of `calendarOf`.
 *
 * Having both directions is what makes the season arithmetic simple. Working
 * out "how many days into winter" from day-of-year subtractions has to special
 * case winter twice over, because it starts in December and runs into the next
 * year: measured within a single year, 1 January comes *before* 1 December and
 * the subtraction goes negative. Comparing two absolute day counts has no such
 * problem, so that is what this is for.
 */
function dayIndexOf(year, month, dayOfMonth) {
  let n = dayOfMonth - 1;
  for (let m = 0; m < month; m++) n += MONTH_DAYS[m] + (m === 1 && isLeapYear(year) ? 1 : 0);
  // Whole years from the epoch, forwards or backwards. The backwards case is
  // not hypothetical: the world starts on 1 January, so the winter containing
  // that date began on 1 December of the year *before* the epoch. A loop that
  // only counted upwards would return that December's day-of-year as if it
  // were a day in the epoch year, putting the season start a whole year late
  // and the day count hundreds of days negative.
  const epoch = CONFIG.SEASON.EPOCH_YEAR;
  if (year >= epoch) {
    for (let y = epoch; y < year; y++) n += isLeapYear(y) ? 366 : 365;
  } else {
    for (let y = year; y < epoch; y++) n -= isLeapYear(y) ? 366 : 365;
  }
  return n;
}

/**
 * Which season a day falls in, and how far through it the date is.
 *
 * A season runs from the first of its start month to the day before the next
 * season starts, so winter begins on 1 December and runs over the year boundary
 * into January and February. Its length therefore depends on whether *either*
 * year it touches is a leap one - 90 days normally, 91 when a February in the
 * middle of it has a 29th.
 *
 * @param {number} day days since the world was created, 0 = 1 January 2000
 * @returns {{index:number, name:string, dayInSeason:number,
 *            daysInSeason:number, year:number}}
 */
export function seasonOf(day) {
  const d = Math.max(0, Math.floor(day) || 0);
  const c = calendarOf(d);
  const index = MONTH_TO_SEASON[c.month];
  const startMonth = SEASON_START_MONTH[index];
  const nextIndex = (index + 1) % SEASON_COUNT;
  const nextMonth = SEASON_START_MONTH[nextIndex];

  // A season that has not reached its start month yet began in the previous
  // year. Only winter is ever in this state, and only in January and February.
  const startYear = c.month >= startMonth ? c.year : c.year - 1;
  // ...and the next season begins in the following year only if it starts
  // earlier in the year than this one does.
  const nextStartYear = nextMonth <= startMonth ? startYear + 1 : startYear;

  const startDay = dayIndexOf(startYear, startMonth, 1);
  const endDay = dayIndexOf(nextStartYear, nextMonth, 1) - 1;

  // The world begins on 1 January, which is thirty-one days into the winter
  // that started the previous December - a season with no history behind it.
  // Clamping to the epoch makes the first winter a partial one that starts at
  // day 0 and runs to the end of February, rather than counting from a
  // December the world never saw and reporting a negative day.
  const from = Math.max(0, startDay);

  return {
    index,
    name: t(CONFIG.SEASON.NAMES[index]),
    dayInSeason: d - from + 1,
    daysInSeason: endDay - from + 1,
    year: c.year,
  };
}

/**
 * Cut one season's icon out of the 2x2 sheet.
 *
 * Returns a fresh canvas rather than caching all four: the sheet is 16x16, so
 * slicing a cell is four drawImage calls, and it only happens when the season
 * actually turns over.
 *
 * @param {HTMLImageElement} sheet
 * @param {number} index 0..3, reading the grid left-to-right then top-to-bottom
 * @returns {HTMLCanvasElement|null} null if the sheet is missing
 */
export function seasonIcon(sheet, index) {
  if (!sheet) return null;
  const cell = Math.floor(sheet.width / CONFIG.SEASON.ICON_COLS);
  const rows = Math.max(1, Math.floor(sheet.height / CONFIG.SEASON.ICON_ROWS));
  const col = index % CONFIG.SEASON.ICON_COLS;
  const row = Math.floor(index / CONFIG.SEASON.ICON_COLS);

  const cv = document.createElement('canvas');
  cv.width = cell;
  cv.height = rows;
  // Named, because the season panel styles its icon by size. The season name
  // and day count are canvases too - that is how the bitmap font draws - so a
  // blanket `#season-panel canvas` size rule would squash the text to the
  // icon's dimensions.
  cv.className = 'season-icon';
  const ctx = cv.getContext('2d');
  // Nearest, or an 8x16 icon turns into a smear at GUI scale.
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(sheet, col * cell, row * rows, cell, rows, 0, 0, cell, rows);
  return cv;
}
