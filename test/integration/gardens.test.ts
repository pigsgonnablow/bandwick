// Gardens: plots dug once a band thinks of them, sown in spring, weeded, raided by beasts, harvested before
// the frost; grain sown from seed kept back; fences and storage pits.
import { describe, it, expect } from 'vitest';
import { TICKS_PER_DAY, TICKS_PER_SEASON, TICKS_PER_YEAR, seasonOf } from '../../src/sim/time';
import { CROP, SEED_PER_PLOT, newPlot, Building } from '../../src/sim/band';
import { Sim } from '../../src/sim/sim';
import { sim, runTo, runYears } from '../helpers';

const total = (s: Sim, k: string) => s.camps.reduce((n, c) => n + (c.ledger?.total?.[k] ?? 0), 0);
/** A dug plot right by the camp. */
function plot(s: Sim, dx = 3, dz = 2): Building {
  const b = s.newBuilding('plot', s.camp.tile + dx + dz * s.N, -1);
  b.built = true;
  b.work = 60;
  b.plot = newPlot();
  return b;
}

describe('gardens', () => {
  it('are not dug before the band thinks of them', () => {
    const s = sim(2);
    s.camp.knows = s.camp.knows.filter((k) => k !== 'garden');
    for (let i = 0; i < 6 * 4; i++) {
      runTo(s, s.tick + TICKS_PER_SEASON / 4);
      for (const c of s.camps) if (!c.knows.includes('garden')) expect(s.plots(c, true).length).toBe(0);
    }
  });

  it('are dug, sown only in spring, and harvested once the band knows them', () => {
    const s = sim(1);
    s.camp.knows.push('garden');
    const sownIn = new Set<number>();
    const end = s.tick + 2 * TICKS_PER_YEAR;
    while (s.tick < end) {
      s.step();
      if (s.tick % 20 === 0) for (const p of s.living()) if (p.task?.kind === 'sow' && p.task.stage >= 1) sownIn.add(seasonOf(s.tick));
    }
    expect(s.plots(s.camp).length).toBeGreaterThanOrEqual(2);
    expect([...sownIn]).toEqual([0]);
    expect(total(s, 'gathered.roots')).toBeGreaterThan(0);
    // nothing is left growing through the winter
    runTo(s, s.tick + 3 * TICKS_PER_SEASON + TICKS_PER_DAY);
    expect(seasonOf(s.tick)).toBe(3);
    for (const b of s.plots(s.camp)) expect(b.plot!.crop).toBe(CROP.None);
  });

  it('give grain from kept seed, and the band keeps back seed for next year', () => {
    const s = sim(1);
    s.camp.knows.push('garden', 'grain');
    s.camp.seed = SEED_PER_PLOT * 4;
    runYears(s, 2);
    expect(total(s, 'gathered.grain')).toBeGreaterThan(20);
    // the seed kept back from the harvest is what the next spring's grain is sown from
    expect(total(s, 'seed')).toBeGreaterThan(SEED_PER_PLOT * 4);
    expect(s.camps.some((c) => s.plots(c).filter((b) => b.plot?.crop === CROP.Grain).length > 3)).toBe(true);
  });

  it('lose to the frost whatever is still in the ground', () => {
    const s = sim(3);
    runTo(s, s.tick + 3 * TICKS_PER_SEASON - 2 * TICKS_PER_DAY);
    const b = plot(s);
    Object.assign(b.plot!, { crop: CROP.Roots, growth: 0.5, sown: s.tick });
    runTo(s, s.tick + 3 * TICKS_PER_DAY);
    expect(seasonOf(s.tick)).toBe(3);
    expect(b.plot!.crop).toBe(CROP.None);
    expect(total(s, 'spoiled.roots')).toBeGreaterThan(0);
  });

  it('are spared by the beasts behind a fence', () => {
    const raids = (fenced: boolean) => {
      const s = sim(4);
      const b = plot(s, 9, 0);
      if (fenced) { const f = s.newBuilding('fence', b.tile, -1); f.built = true; }
      let n = 0;
      for (let i = 0; i < 3000; i++) {
        Object.assign(b.plot!, { crop: CROP.Roots, cond: 1, raided: -1 });
        (s as unknown as { pests(c: unknown, b: Building, dogs: boolean): void }).pests(s.camp, b, false);
        if (b.plot!.raided >= 0) n++;
      }
      return n;
    };
    const open = raids(false);
    expect(open).toBeGreaterThan(30);
    expect(raids(true)).toBeLessThan(open / 5);
  });

  it('keep roots and grain longer in a storage pit', () => {
    const lost = (pit: boolean) => {
      const s = sim(1);
      if (pit) { const b = s.newBuilding('pit', s.camp.tile + 4, -1); b.built = true; }
      const st = s.camp.stock;
      st.roots = 100; st.grain = 100;
      (s as unknown as { spoilNow(x: typeof st): void }).spoilNow(st);
      return { roots: 100 - st.roots, grain: 100 - st.grain };
    };
    const a = lost(false), b = lost(true);
    expect(b.roots).toBeLessThan(a.roots);
    expect(b.grain).toBeLessThan(a.grain);
    // grain keeps far better than roots even without one
    expect(a.grain).toBeLessThan(a.roots);
  });

  it('come through a save and load', () => {
    const s = sim(1);
    s.camp.knows.push('garden', 'grain');
    s.camp.seed = SEED_PER_PLOT * 2;
    runTo(s, s.tick + TICKS_PER_SEASON + 2 * TICKS_PER_DAY);
    const sown = s.plots(s.camp).filter((b) => b.plot?.crop);
    expect(sown.length).toBeGreaterThan(0);
    const t = new Sim(s.world, JSON.parse(JSON.stringify(s.serialize())));
    expect(t.plots(t.camp).map((b) => b.plot)).toEqual(s.plots(s.camp).map((b) => b.plot));
    expect(t.camp.seed).toBe(s.camp.seed);
    runYears(t, 1);
    expect(Object.values(t.camp.stock).every((v) => Number.isFinite(v as number))).toBe(true);
  });
});
