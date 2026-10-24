import { describe, it, expect } from 'vitest';
import {
  TICKS_PER_DAY, TICKS_PER_YEAR, TICKS_PER_SEASON, TICKS_PER_HOUR, START_TICK,
  yearOf, seasonOf, seasonPos, hourOf, dayOf, ageYears, daylight, isDark, temperature,
  berriesRipe, isWinter, freshFrozen,
} from '../../src/sim/time';

const at = (season: number, day: number, hour: number) => season * TICKS_PER_SEASON + day * TICKS_PER_DAY + hour * TICKS_PER_HOUR;

describe('calendar', () => {
  it('has consistent units', () => {
    expect(TICKS_PER_DAY).toBe(24 * TICKS_PER_HOUR);
    expect(TICKS_PER_YEAR).toBe(4 * TICKS_PER_SEASON);
  });

  it('starts the band on a spring morning of year 1', () => {
    expect(yearOf(START_TICK)).toBe(1);
    expect(seasonOf(START_TICK)).toBe(0);
    expect(dayOf(START_TICK)).toBe(5);
    expect(hourOf(START_TICK)).toBeCloseTo(9.5);
  });

  it('rolls over years and seasons at the right ticks', () => {
    expect(yearOf(TICKS_PER_YEAR - 1)).toBe(1);
    expect(yearOf(TICKS_PER_YEAR)).toBe(2);
    expect(seasonOf(TICKS_PER_SEASON - 1)).toBe(0);
    expect(seasonOf(3 * TICKS_PER_SEASON)).toBe(3);
    expect(seasonOf(TICKS_PER_YEAR)).toBe(0);
    expect(seasonPos(TICKS_PER_SEASON * 2.5)).toBeCloseTo(2.5);
  });

  it('measures age in years', () => {
    expect(ageYears(10 * TICKS_PER_YEAR, 0)).toBe(10);
    expect(ageYears(TICKS_PER_YEAR / 2, 0)).toBe(0.5);
  });
});

describe('daylight and dark', () => {
  it('has the longest days in summer and the shortest in winter', () => {
    const len = (t: number) => { const d = daylight(t); return d.sunset - d.sunrise; };
    const summer = len(at(1, 6, 12)), winter = len(at(3, 6, 12)), spring = len(at(0, 6, 12));
    expect(summer).toBeGreaterThan(spring);
    expect(spring).toBeGreaterThan(winter);
  });

  it('is dark at midnight and light at noon in every season', () => {
    for (let s = 0; s < 4; s++) {
      expect(isDark(at(s, 3, 0))).toBe(true);
      expect(isDark(at(s, 3, 12))).toBe(false);
    }
  });
});

describe('temperature', () => {
  it('is warmer in summer than winter, and in the afternoon than before dawn', () => {
    expect(temperature(at(1, 6, 15), 0, 0)).toBeGreaterThan(temperature(at(3, 6, 15), 0, 0));
    expect(temperature(at(0, 6, 15), 0, 0)).toBeGreaterThan(temperature(at(0, 6, 4), 0, 0));
  });

  it('gets colder uphill and in harsh years', () => {
    const t = at(3, 4, 12);
    expect(temperature(t, 0, 5)).toBeLessThan(temperature(t, 0, 0));
    expect(temperature(t, -3, 0)).toBeLessThan(temperature(t, 0, 0));
  });

  it('gives the same answer from its cache as from a cold call', () => {
    const t = at(2, 1, 7);
    const first = temperature(t, 0.5, 2);
    temperature(t + 1, 0, 0);
    expect(temperature(t, 0.5, 2)).toBe(first);
  });
});

describe('seasons of plenty and frost', () => {
  it('ripens berries in late summer and autumn only', () => {
    expect(berriesRipe(at(0, 6, 12))).toBe(false);
    expect(berriesRipe(at(1, 9, 12))).toBe(true);
    expect(berriesRipe(at(2, 3, 12))).toBe(true);
    expect(berriesRipe(at(3, 6, 12))).toBe(false);
  });

  it('freezes fresh water only within winter', () => {
    expect(isWinter(at(3, 0, 0))).toBe(true);
    for (let t = 0; t < TICKS_PER_YEAR; t += TICKS_PER_DAY) if (freshFrozen(t)) expect(isWinter(t)).toBe(true);
    expect(freshFrozen(at(3, 6, 12))).toBe(true);
  });
});
