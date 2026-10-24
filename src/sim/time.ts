// Simulation calendar and climate. Deterministic: piecewise-linear tables only.

export const TICKS_PER_HOUR = 10; // one tick = 6 game minutes
export const TICKS_PER_DAY = 240;
export const DAYS_PER_SEASON = 12;
export const DAYS_PER_YEAR = 48;
export const TICKS_PER_SEASON = TICKS_PER_DAY * DAYS_PER_SEASON;
export const TICKS_PER_YEAR = TICKS_PER_DAY * DAYS_PER_YEAR;
/** The band arrives on the sixth morning of spring. */
export const START_TICK = 5 * TICKS_PER_DAY + 95;

export const yearOf = (t: number) => Math.floor(t / TICKS_PER_YEAR) + 1;
export const seasonOf = (t: number) => Math.floor((t % TICKS_PER_YEAR) / TICKS_PER_SEASON);
/** Continuous 0..4 position in the year (0 = first day of spring). */
export const seasonPos = (t: number) => (t % TICKS_PER_YEAR) / TICKS_PER_SEASON;
export const hourOf = (t: number) => (t % TICKS_PER_DAY) / TICKS_PER_HOUR;
export const dayOf = (t: number) => Math.floor(t / TICKS_PER_DAY);
export const ageYears = (t: number, birth: number) => (t - birth) / TICKS_PER_YEAR;

/** Linear interpolation over [x, y] keys that wrap at `period`. */
function wrapLerp(keys: number[][], x: number, period: number) {
  const n = keys.length;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = keys[i];
    let [x1, y1] = keys[(i + 1) % n];
    let xx = x;
    if (i === n - 1) {
      x1 += period;
      if (xx < x0) xx += period;
    }
    if (xx >= x0 && xx <= x1) return y0 + ((y1 - y0) * (xx - x0)) / (x1 - x0);
  }
  return keys[0][1];
}

// hours of daylight across the year (matches the renderer's sun)
const DAYLEN: number[][] = [[0, 10.2], [0.5, 12], [1.5, 14.6], [2.5, 12], [3.5, 9.4]];
export function daylight(t: number) {
  const len = wrapLerp(DAYLEN, seasonPos(t), 4);
  const noon = 12.5;
  return { sunrise: noon - len / 2, sunset: noon + len / 2 };
}
let darkAt = -1, darkWas = false;
export function isDark(t: number) {
  // asked thousands of times a tick: remember the answer for the current one
  if (t === darkAt) return darkWas;
  const h = hourOf(t);
  const d = daylight(t);
  darkAt = t;
  darkWas = h < d.sunrise - 0.4 || h > d.sunset + 0.4;
  return darkWas;
}

// mean temperature (deg C) across the year, and the swing across a day
const TEMP: number[][] = [[0, 7], [0.5, 11], [1.0, 16], [1.6, 21], [2.1, 17], [2.6, 10], [3.0, 2], [3.5, -5], [3.85, 1]];
const DIURNAL: number[][] = [[0, -3.5], [4.5, -5], [9, -1], [15, 5], [20, 1.5]];
/**
 * @param anomaly this year's climate departure (harsh winters are negative)
 * @param levelsUp terraces above the shore (higher is colder)
 */
let tempAt = -1, tempAnomaly = NaN, tempBase = 0;
export function temperature(t: number, anomaly: number, levelsUp: number) {
  if (t !== tempAt || anomaly !== tempAnomaly) {
    const s = seasonPos(t);
    // anomalies bite hardest in winter
    const winterWeight = s > 2.7 || s < 0.3 ? 1.4 : 0.6;
    tempBase = wrapLerp(TEMP, s, 4) + wrapLerp(DIURNAL, hourOf(t), 24) + anomaly * winterWeight;
    tempAt = t;
    tempAnomaly = anomaly;
  }
  return tempBase - levelsUp * 1.1;
}

/** Berries ripen from mid-summer to late autumn. */
export function berriesRipe(t: number) {
  const s = seasonPos(t);
  return s >= 1.45 && s < 2.85;
}
export function isWinter(t: number) {
  return seasonOf(t) === 3;
}
/** Fresh water is frozen in deep winter (matches the renderer's ice). */
export function freshFrozen(t: number) {
  const s = seasonPos(t);
  return s >= 3.15 && s < 3.8;
}
