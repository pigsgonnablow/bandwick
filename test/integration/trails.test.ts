import { describe, it, expect } from 'vitest';
import { sim, runTo, flatWorld } from '../helpers';
import { Sim } from '../../src/sim/sim';
import { Grid } from '../../src/sim/path';
import { Trails, TRAIL_EVERY } from '../../src/sim/trails';
import { WATER } from '../../src/sim/types';
import { TICKS_PER_DAY, TICKS_PER_SEASON } from '../../src/sim/time';

const hyp = (x: number, z: number) => Math.hypot(x, z);

describe('footpaths', () => {
  it('wear in around the camp where people walk, and nowhere they have not been', () => {
    const s = runTo(sim(1), sim(1).tick + 10 * TICKS_PER_DAY);
    const c = s.camp, N = s.N;
    let near = 0, far = 0;
    for (let i = 0; i < N * N; i++) {
      if (!s.trails.level[i]) continue;
      expect(s.world.water[i]).toBe(WATER.None);
      if (hyp((i % N) + 0.5 - c.x, Math.floor(i / N) + 0.5 - c.z) < 12) near++;
      else far++;
    }
    expect(near).toBeGreaterThan(10);
    // the camp's yard is beaten bare
    const yard = Math.floor(c.z) * N + Math.floor(c.x);
    let best = 0;
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) best = Math.max(best, s.trails.level[yard + dz * N + dx]);
    expect(best).toBeGreaterThan(200);
    expect(far).toBeLessThan(near * 4);
  });

  it('grow over when nobody walks them, fast in summer and hardly at all in winter', () => {
    const w = flatWorld(8);
    const fade = (start: number) => {
      const t = new Trails(w, new Grid(w));
      for (let k = 0; k < 40; k++) t.tread(9);
      let tick = start;
      for (let k = 0; k < 4 * 6; k++) t.update((tick += TRAIL_EVERY));
      return t.wear[9];
    };
    const summer = fade(TICKS_PER_SEASON), winter = fade(3 * TICKS_PER_SEASON);
    expect(summer).toBeLessThan(40 * 0.6);
    expect(winter).toBeGreaterThan(40 * 0.9);
    // and a path walked every day stays
    const t = new Trails(w, new Grid(w));
    let tick = TICKS_PER_SEASON;
    for (let d = 0; d < 20; d++) {
      for (let k = 0; k < 6; k++) t.tread(9);
      for (let k = 0; k < 4; k++) t.update((tick += TRAIL_EVERY));
    }
    expect(t.level[9]).toBeGreaterThan(128);
  });

  it('leave the water alone', () => {
    const w = flatWorld(8, (x) => (x === 1 ? { water: WATER.River, terrain: 0 } : undefined));
    const t = new Trails(w, new Grid(w));
    t.tread(1);
    t.tread(2);
    expect(t.wear[1]).toBe(0);
    expect(t.wear[2]).toBe(1);
  });

  it('are kept in a save, and the world carries on the same', () => {
    const a = runTo(sim(2), sim(2).tick + 6 * TICKS_PER_DAY + 7);
    const b = new Sim(a.world, JSON.parse(JSON.stringify(a.serialize())));
    expect(Array.from(b.trails.level)).toEqual(Array.from(a.trails.level));
    expect(Array.from(b.trails.wear)).toEqual(Array.from(a.trails.wear));
    runTo(a, a.tick + 2 * TICKS_PER_DAY);
    runTo(b, b.tick + 2 * TICKS_PER_DAY);
    expect(Array.from(b.trails.wear)).toEqual(Array.from(a.trails.wear));
    expect(b.historyHash()).toBe(a.historyHash());
  });
});
