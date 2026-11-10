// Settling for good: a year's food put by lets a band ease off the food work, coppiced woods grow back near
// camp, and gardens draw the deer back within reach of home.
import { describe, it, expect } from 'vitest';
import { TICKS_PER_DAY, TICKS_PER_YEAR, TICKS_PER_SEASON, DAYS_PER_YEAR, yearOf } from '../../src/sim/time';
import { newPlot, Building } from '../../src/sim/band';
import { DISCOVERY } from '../../src/sim/know';
import { Sim, STUMP_BASE, PROVIDED_FOOD, WOODLOT, GARDEN_EDGE, DAILY_ADULT, DAILY_CHILD, hyp } from '../../src/sim/sim';
import { sim } from '../helpers';

/** A dug plot by the camp. */
function plot(s: Sim, dx = 3, dz = 2): Building {
  const b = s.newBuilding('plot', s.camp.tile + dx + dz * s.N, -1);
  b.built = true;
  b.work = 60;
  b.plot = newPlot();
  return b;
}
const yearOfFood = (s: Sim) => s.members().reduce((n, p) => n + (s.age(p) < 12 ? DAILY_CHILD : DAILY_ADULT), 0) * DAYS_PER_YEAR;
/** A morning in the given season (0 spring .. 3 winter) of the next year. */
const morningIn = (s: Sim, season: number) => (yearOf(s.tick) + 1) * TICKS_PER_YEAR + season * TICKS_PER_SEASON + 2 * TICKS_PER_DAY;

describe('a year in hand', () => {
  it('a band with a year of keeping food in store is provided for, and food steps back in the day', () => {
    const s = sim(3);
    s.tick = morningIn(s, 1);
    s.camp.stock.grain = 0;
    s.plan();
    expect(s.camp.provided).toBe(false);
    const before = s.camp.jobs.food;
    s.camp.stock.grain = yearOfFood(s) * 1.05;
    s.plan();
    expect(s.camp.provided).toBe(true);
    expect(s.camp.jobs.food).toBe(PROVIDED_FOOD);
    expect(s.camp.jobs.food).toBeLessThanOrEqual(before);
    expect(s.camp.plan.some((l) => l.includes("a year's food"))).toBe(true);
    expect(s.events.filter((e) => e.kind === 'provided').length).toBe(1);
  });

  it('a band that moves takes the news with it: the full stores are not told of again', () => {
    const s = sim(3);
    s.tick = morningIn(s, 1);
    s.camp.stock.grain = yearOfFood(s) * 1.5;
    s.plan();
    const c = s.camp;
    c.leanWinters = 3;
    c.settled = s.tick - 3 * TICKS_PER_YEAR;
    let moved = false;
    for (let i = 0; i < 300 && !moved; i++) moved = (s as unknown as { considerMove(c: unknown): boolean }).considerMove(c);
    expect(moved).toBe(true);
    s.plan();
    expect(s.camp).not.toBe(c);
    expect(s.camp.provided).toBe(true);
    expect(s.events.filter((e) => e.kind === 'provided').length).toBe(1);
  });

  it('stays provided for until the stores fall well short of a year, and tells of it only the first time', () => {
    const s = sim(3);
    s.tick = morningIn(s, 1);
    s.camp.stock.grain = yearOfFood(s);
    s.plan();
    s.camp.stock.grain = yearOfFood(s) * 0.9;
    s.plan();
    expect(s.camp.provided).toBe(true);
    s.camp.stock.grain = yearOfFood(s) * 0.5;
    s.plan();
    expect(s.camp.provided).toBe(false);
    s.camp.stock.grain = yearOfFood(s) * 1.2;
    s.plan();
    expect(s.camp.provided).toBe(true);
    expect(s.events.filter((e) => e.kind === 'provided').length).toBe(1);
  });

  it('even in winter, a provided-for band only goes out for a little fresh food', () => {
    const s = sim(3);
    s.tick = morningIn(s, 3);
    s.camp.stock.grain = yearOfFood(s) * 1.5;
    s.plan();
    expect(s.camp.jobs.food).toBe(PROVIDED_FOOD);
    expect(s.camp.rationing).toBe(false);
  });
});

describe('coppiced woods', () => {
  /** Oak stumps: `n` in the woods by camp, `n` far out. */
  function stumps(s: Sim, n: number) {
    const near: number[] = [], far: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      near.push(s.addProp(STUMP_BASE + 1, s.camp.x + Math.cos(a) * 9, 0, s.camp.z + Math.sin(a) * 9, 0, 1));
      far.push(s.addProp(STUMP_BASE + 1, s.camp.x + Math.cos(a) * (WOODLOT + 14), 0, s.camp.z + Math.sin(a) * (WOODLOT + 14), 0, 1));
    }
    return { near, far };
  }
  const springs = (s: Sim, n: number) => { for (let i = 0; i < n; i++) (s as unknown as { trees(d: number): void }).trees(2); };

  it('is a discovery, found by woodcutters', () => {
    const d = DISCOVERY.get('coppice')!;
    expect(d).toBeTruthy();
    expect(d.practice.sprout_tree).toBeGreaterThan(0);
    expect(d.practice.far_tree).toBeGreaterThan(0);
  });

  it('stumps near a coppicing camp send up shoots the next spring; others are slow to, if ever', () => {
    const s = sim(3);
    s.camp.knows = [...s.camp.knows.filter((k) => k !== 'coppice'), 'coppice'];
    const { near, far } = stumps(s, 40);
    springs(s, 1);
    const gone = (ks: number[]) => ks.filter((k) => !s.propAlive[k]).length;
    expect(gone(near)).toBeGreaterThan(20);
    expect(gone(far)).toBe(0);
  });

  it('leave the ground round the fire clear', () => {
    const s = sim(3);
    s.camp.knows = [...s.camp.knows.filter((k) => k !== 'coppice'), 'coppice'];
    const close: number[] = [];
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      close.push(s.addProp(STUMP_BASE + 1, s.camp.x + Math.cos(a) * 3, 0, s.camp.z + Math.sin(a) * 3, 0, 1));
    }
    springs(s, 1);
    expect(close.filter((k) => !s.propAlive[k]).length).toBe(0);
  });

  it('do nothing for a band that has not thought of it', () => {
    const s = sim(3);
    s.camp.knows = s.camp.knows.filter((k) => k !== 'coppice');
    const { near } = stumps(s, 40);
    springs(s, 1);
    expect(near.filter((k) => !s.propAlive[k]).length).toBe(0);
  });

  it('the shoots grow into timber in a few years', () => {
    const s = sim(3);
    s.camp.knows = [...s.camp.knows.filter((k) => k !== 'coppice'), 'coppice'];
    const before = s.propCount;
    stumps(s, 40);
    springs(s, 8);
    let grown = 0;
    for (let k = before; k < s.propCount; k++) if (s.propAlive[k] && s.propNote.get(k)?.startsWith('Sprouted') && Math.floor((s.propType[k] % 12) / 3) >= 2) grown++;
    expect(grown).toBeGreaterThan(10);
  });
});

describe('gardens draw the deer', () => {
  const herdsDaily = (s: Sim, doy: number) => (s as unknown as { herdsDaily(d: number): void }).herdsDaily(doy);

  it('a herd ranging near a band with gardens comes in toward them in summer, but no nearer than the edge', () => {
    const s = sim(3);
    plot(s);
    const h = s.herds.slice().sort((a, b) => hyp(a.hx - s.camp.x, a.hz - s.camp.z) - hyp(b.hx - s.camp.x, b.hz - s.camp.z))[0];
    const d0 = hyp(h.hx - s.camp.x, h.hz - s.camp.z);
    expect(d0).toBeLessThan(30);
    s.tick = morningIn(s, 1);
    for (let i = 0; i < 200; i++) herdsDaily(s, 13);
    const d1 = hyp(h.hx - s.camp.x, h.hz - s.camp.z);
    expect(d1).toBeLessThan(d0);
    expect(d1).toBeGreaterThanOrEqual(GARDEN_EDGE - 0.01);
  });

  it('leaves the herds be where there are no gardens, and in winter', () => {
    const s = sim(3);
    const homes = s.herds.map((h) => [h.hx, h.hz]);
    s.tick = morningIn(s, 1);
    for (let i = 0; i < 20; i++) herdsDaily(s, 13);
    expect(s.herds.map((h) => [h.hx, h.hz])).toEqual(homes);
    plot(s);
    s.tick = morningIn(s, 3);
    for (let i = 0; i < 20; i++) herdsDaily(s, 40);
    expect(s.herds.map((h) => [h.hx, h.hz])).toEqual(homes);
  });

  it('a hunted-out range by the gardens fills again', () => {
    const s = sim(3);
    plot(s);
    const h = s.herds[0];
    h.hx = s.camp.x + 6;
    h.hz = s.camp.z;
    for (const d of s.deer) if (d.herd === h.id) d.alive = false;
    s.tick = morningIn(s, 0);
    for (let i = 0; i < 30 && !s.deer.some((d) => d.alive && d.herd === h.id); i++) herdsDaily(s, 6);
    expect(s.deer.some((d) => d.alive && d.herd === h.id)).toBe(true);
  });
});
