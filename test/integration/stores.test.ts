// What happens to the band's stores and fire without anyone touching them: food going off by the
// season (slower in a storehouse, hardly at all once dried), the fire eating wood, and fished-out
// water filling again.
import { describe, it, expect } from 'vitest';
import { DAMP_BURN, WINTER_FISH, BITTER_CATCH, isBerry } from '../../src/sim/sim';
import { Stock, specOf } from '../../src/sim/band';
import { TICKS_PER_SEASON, TICKS_PER_DAY, TICKS_PER_HOUR, TICKS_PER_YEAR, isDark, seasonOf, yearOf } from '../../src/sim/time';
import { sim } from '../helpers';
import type { Sim } from '../../src/sim/sim';

const full = (): Stock => ({ berries: 100, meat: 100, fish: 100, preserved: 100, wood: 100, fiber: 100, cordage: 100, mud: 100, stone: 100 });

/** One morning's spoilage of a full store, in a given season (0 spring .. 3 winter). */
function spoilIn(s: Sim, season: number): Stock {
  s.tick = TICKS_PER_YEAR + season * TICKS_PER_SEASON + 6 * TICKS_PER_HOUR;
  const st = full();
  (s as any).spoilNow(st);
  return st;
}

describe('spoilage', () => {
  it('rots berries fastest, then fish, then meat, and the warmer the faster', () => {
    const s = sim(1);
    // fraction kept each morning, by season (spring, summer, autumn, winter)
    const cold = [0.75, 1, 0.75, 0.4];
    for (let season = 0; season < 4; season++) {
      const st = spoilIn(s, season);
      expect(st.berries, `season ${season}`).toBeCloseTo(100 * (1 - 0.06 * cold[season]), 6);
      expect(st.fish, `season ${season}`).toBeCloseTo(100 * (1 - 0.05 * cold[season]), 6);
      expect(st.meat, `season ${season}`).toBeCloseTo(100 * (1 - 0.035 * cold[season]), 6);
      expect(st.preserved, `season ${season}`).toBeCloseTo(99.6, 6);
    }
  });

  it('never touches wood, fiber, cordage, mud or stone', () => {
    const s = sim(1);
    for (let season = 0; season < 4; season++) {
      const st = spoilIn(s, season);
      for (const k of ['wood', 'fiber', 'cordage', 'mud', 'stone'] as const) expect(st[k]).toBe(100);
    }
  });

  it('keeps food longer in a storehouse, and longer still behind daub or stone', () => {
    const s = sim(1);
    const open = spoilIn(s, 1);
    const house = s.newBuilding('storehouse', s.camp.tile + 2, -1);
    house.built = true;
    for (const walls of ['wood', 'daub', 'stone'] as const) {
      house.walls = walls;
      const st = spoilIn(s, 1);
      const keep = specOf(house).keep;
      expect(st.berries, walls).toBeCloseTo(100 * (1 - 0.06 * keep), 6);
      expect(100 - st.berries).toBeLessThan(100 - open.berries);
    }
    expect([specOf({ kind: 'storehouse' }).keep, specOf({ kind: 'storehouse', walls: 'daub' }).keep, specOf({ kind: 'storehouse', walls: 'stone' }).keep]).toEqual([0.6, 0.5, 0.4]);
    // half-built is no use yet
    house.built = false;
    expect(spoilIn(s, 1).berries).toBeCloseTo(open.berries, 6);
  });

  it('books what went off in the band ledger, each morning', () => {
    const s = sim(1);
    s.camp.stock.berries = 50;
    s.camp.stock.preserved = 0;
    const was = s.camp.ledger?.total['spoiled.berries'] ?? 0;
    (s as any).spoil();
    expect(s.camp.ledger!.total['spoiled.berries'] - was).toBeCloseTo(50 - s.camp.stock.berries, 6);
    expect(s.camp.ledger!.total['spoiled.preserved'] ?? 0).toBe(0);
  });
});

describe('the camp fire', () => {
  it('burns more at night and in winter, least on summer days', () => {
    const s = sim(1);
    const h = s.hearth();
    for (const b of s.buildings.filter((b) => b.kind === 'woodshed')) b.built = false;
    const rate = (season: number, hour: number) => {
      s.tick = TICKS_PER_YEAR + season * TICKS_PER_SEASON + 3 * TICKS_PER_DAY + hour * TICKS_PER_HOUR;
      expect(isDark(s.tick)).toBe(hour < 4);
      return s.burnRate(h);
    };
    const k = [0.75, 0.45, 0.75, 1.35];
    for (let season = 0; season < 4; season++) {
      const damp = season >= 2 ? DAMP_BURN : 1;
      expect(rate(season, 1), `night, season ${season}`).toBeCloseTo(0.34 * k[season] * damp, 6);
      expect(rate(season, 12), `day, season ${season}`).toBeCloseTo(0.19 * k[season] * damp, 6);
    }
  });

  it('goes out once the wood is gone, and never below empty', () => {
    const s = sim(1);
    const h = s.hearth();
    h.fuel = 0.05;
    (s as any).burn(h);
    expect(h.fuel).toBe(0);
    expect(s.hearthLit()).toBe(false);
    (s as any).burn(h);
    expect(h.fuel).toBe(0);
  });

  it('eats about nine wood through a winter day and night, with dry wood, burning once an hour', () => {
    // a whole day of burn, hour by hour, with dry wood: what the woodcutters have to keep up with
    const s = sim(1);
    const h = s.hearth();
    s.tick = TICKS_PER_YEAR + 3 * TICKS_PER_SEASON + 4 * TICKS_PER_DAY;
    expect(seasonOf(s.tick)).toBe(3);
    const roof = s.newBuilding('woodshed', s.buildings.find((b) => b.kind === 'stockpile' && b.band === s.camp.id)!.tile, -1);
    roof.built = true;
    h.fuel = 12;
    for (let t = 0; t < TICKS_PER_DAY; t++) {
      s.tick++;
      if (s.tick % TICKS_PER_HOUR === 0) (s as any).hourly();
    }
    const used = 12 - h.fuel;
    expect(used).toBeGreaterThan(8);
    expect(used).toBeLessThan(10);
  });
});

describe('fish', () => {
  it('fill fished-out water again, a little every six hours, never past what it holds', () => {
    const s = sim(1);
    const i = s.fishCap.findIndex((c) => c > 0);
    const cap = s.fishCap[i];
    s.fish[i] = 0;
    s.tick = TICKS_PER_YEAR;
    const seen: number[] = [];
    for (let k = 0; k < 400; k++) {
      s.tick += TICKS_PER_HOUR * 6;
      (s as any).hourly();
      seen.push(s.fish[i]);
    }
    for (let k = 1; k < seen.length; k++) expect(seen[k]).toBeGreaterThanOrEqual(seen[k - 1]);
    expect(seen[0]).toBeGreaterThan(0);
    expect(seen[0]).toBeLessThan(cap * 0.1);
    expect(Math.max(...seen)).toBeLessThanOrEqual(cap);
    expect(seen.at(-1)).toBeGreaterThan(cap * 0.95);
  });

  it('come back slower in winter, and slower still in a bitter one', () => {
    const s = sim(1);
    const i = s.fishCap.findIndex((c) => c > 0);
    /** What six hours bring back to half-empty water, in a season and a year's weather. */
    const regrow = (season: number, anomaly: number) => {
      s.fish[i] = s.fishCap[i] / 2;
      s.tick = TICKS_PER_YEAR + season * TICKS_PER_SEASON + 2 * TICKS_PER_HOUR * 6;
      s.anomaly = anomaly;
      (s as any).hourly();
      return s.fish[i] - s.fishCap[i] / 2;
    };
    const summer = regrow(1, 0);
    expect(summer).toBeGreaterThan(0);
    // (a bitter year's summer is no different)
    expect(regrow(1, -3)).toBeCloseTo(summer, 5);
    expect(regrow(3, 0)).toBeCloseTo(summer * WINTER_FISH, 5);
    expect(regrow(3, -3)).toBeCloseTo(summer * WINTER_FISH * BITTER_CATCH, 5);
  });

  it('only lie deeper in a winter that came in bitter', () => {
    const s = sim(1);
    const at = (season: number, anomaly: number) => {
      s.anomaly = anomaly;
      return s.bitterWinter(TICKS_PER_YEAR + season * TICKS_PER_SEASON + 1);
    };
    expect(at(3, -2.6)).toBe(true);
    expect(at(3, -2.5)).toBe(false);
    expect(at(3, 1)).toBe(false);
    for (const season of [0, 1, 2]) expect(at(season, -3)).toBe(false);
  });

  it('do not come back between the six-hour marks', () => {
    const s = sim(1);
    const i = s.fishCap.findIndex((c) => c > 0);
    s.fish[i] = 0;
    s.tick = TICKS_PER_YEAR + TICKS_PER_HOUR;
    (s as any).hourly();
    expect(s.fish[i]).toBe(0);
  });
});

describe('berries', () => {
  /** The fruit on every bush on the morning they ripen, in an ordinary year, a blighted one or a year of plenty. */
  function crop(year: 'ordinary' | 'blight' | 'plenty') {
    const s = sim(1);
    s.tick = 2 * TICKS_PER_YEAR + 18 * TICKS_PER_DAY + 6 * TICKS_PER_HOUR;
    const y = yearOf(s.tick);
    s.blightYear = year === 'blight' ? y : 0;
    s.plentyYear = year === 'plenty' ? y : 0;
    for (let k = 0; k < s.propCount; k++) if (isBerry(s.propType[k])) s.propVal[k] = 0;
    (s as any).berries(18);
    let total = 0;
    for (let k = 0; k < s.propCount; k++) if (s.propAlive[k] && isBerry(s.propType[k])) total += s.propVal[k];
    return total;
  }

  it('ripen on the bushes in late summer: barely any in a blighted year, twice as many in a year of plenty', () => {
    const usual = crop('ordinary');
    expect(usual).toBeGreaterThan(0);
    expect(crop('blight')).toBeCloseTo(usual * 0.15, 3);
    expect(crop('plenty')).toBeCloseTo(usual * 2, 3);
  });
});

describe('the year\'s fortune', () => {
  /** Early summer's roll of the dice for the year's fruit and fish. */
  function roll(r: number) {
    const s = sim(1);
    s.tick = 2 * TICKS_PER_YEAR + 14 * TICKS_PER_DAY + 6 * TICKS_PER_HOUR;
    const fished = s.fishCap.findIndex((c) => c > 0);
    s.fish[fished] = 0;
    const events = s.events.length;
    (s as any).rWild.next = () => r;
    (s as any).fortune(14);
    return { s, fished, told: s.events.slice(events).map((e) => e.kind), year: yearOf(s.tick) };
  }

  it('is now and then a blight on the berries', () => {
    const { s, told, year, fished } = roll(0.02);
    expect(s.blightYear).toBe(year);
    expect(s.plentyYear).toBe(0);
    expect(told).toContain('blight');
    expect(s.fish[fished]).toBe(0);
  });

  it('is now and then a year of plenty, the water filled with fish again', () => {
    const { s, told, year } = roll(0.1);
    expect(s.plentyYear).toBe(year);
    expect(told).toContain('plenty');
    for (let i = 0; i < s.fish.length; i++) expect(s.fish[i]).toBe(s.fishCap[i]);
  });

  it('is most years nothing out of the ordinary', () => {
    const { s, told, fished } = roll(0.5);
    expect(s.blightYear).toBe(0);
    expect(s.plentyYear).toBe(0);
    expect(told).not.toContain('blight');
    expect(told).not.toContain('plenty');
    expect(s.fish[fished]).toBe(0);
  });
});
