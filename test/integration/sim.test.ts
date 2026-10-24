import { describe, it, expect } from 'vitest';
import { Sim, SaveData } from '../../src/sim/sim';
import { generateWorld } from '../../src/sim/worldgen';
import { TICKS_PER_DAY, TICKS_PER_YEAR, START_TICK } from '../../src/sim/time';
import { runChecked } from '../../tools/lib/invariants';
import { sim, world, runTo, runYears } from '../helpers';

describe('a new band', () => {
  it('arrives with ten people, a hearth and a stockpile', () => {
    const s = sim(1);
    expect(s.tick).toBe(START_TICK);
    expect(s.living().length).toBe(10);
    expect(s.liveCamps().length).toBe(1);
    const kinds = s.buildings.map((b) => b.kind);
    expect(kinds).toContain('hearth');
    expect(kinds).toContain('stockpile');
    for (const p of s.living()) {
      expect(p.band).toBe(s.camp.id);
      expect(s.grid.walkable(s.tileOf(p))).toBe(true);
    }
  });
});

describe('the simulation', () => {
  // every game day for a few years, nothing impossible happens (tools/invariants.ts runs this for decades)
  for (const seed of [1, 2, 3]) {
    it(`keeps every invariant for 4 years on seed ${seed}`, () => {
      const s = sim(seed);
      const checker = runChecked(s, 4);
      expect(checker.report()).toEqual([]);
      expect(s.living().length).toBeGreaterThan(0);
    });
  }

  it('gets on with life in the first year: people work, build and eat', () => {
    const s = runYears(sim(2), 1);
    const sum = s.summary();
    expect(sum.homes).toBeGreaterThan(0);
    expect(s.events.length).toBeGreaterThan(0);
    const total = (k: string) => s.camps.reduce((a, c) => a + (c.ledger?.total[k] ?? 0), 0);
    expect(total('gathered.wood')).toBeGreaterThan(0);
    expect(total('burned')).toBeGreaterThan(0);
    expect(['berries', 'meat', 'fish', 'preserved'].reduce((a, k) => a + total(`eaten.${k}`), 0)).toBeGreaterThan(0);
  });

  it('runs the same history twice from the same seed', () => {
    const a = sim(5), b = new Sim(generateWorld({ ...world(5).params }));
    const end = START_TICK + TICKS_PER_YEAR;
    while (a.tick < end) {
      a.step();
      b.step();
      if (a.tick % TICKS_PER_DAY === 0) expect(b.historyHash()).toBe(a.historyHash());
    }
    expect(b.events.map((e) => e.text)).toEqual(a.events.map((e) => e.text));
  });

  it('runs different histories from different seeds', () => {
    expect(runYears(sim(1), 1).historyHash()).not.toBe(runYears(sim(2), 1).historyHash());
  });
});

/** A save as plain data, with the random streams' words read as unsigned (Rng.getState can hand back either sign for the same bits). */
function canonical(save: SaveData) {
  const d = JSON.parse(JSON.stringify(save)) as SaveData;
  for (const k of Object.keys(d.rng) as (keyof SaveData['rng'])[]) d.rng[k] = d.rng[k].map((v) => v >>> 0);
  return d;
}

describe('saving and loading', () => {
  // save mid-walk and mid-task, reload into a fresh simulation, and both must carry on identically
  for (const [seed, year] of [[3, 1], [7, 2]]) {
    it(`continues seed ${seed} identically after a save in year ${year + 1}`, () => {
      const a = runTo(sim(seed), year * TICKS_PER_YEAR + 137);
      const save = JSON.parse(JSON.stringify(a.serialize())) as SaveData;
      expect(save.tick).toBe(a.tick);
      expect(save.worldHash).toBe(a.world.hash);
      const b = new Sim(generateWorld(save.params), save);
      expect(b.historyHash()).toBe(a.historyHash());
      const end = a.tick + TICKS_PER_YEAR;
      while (a.tick < end) {
        a.step();
        b.step();
        if (a.tick % TICKS_PER_DAY === 0) expect(b.historyHash(), `diverged at tick ${a.tick}`).toBe(a.historyHash());
      }
      expect(JSON.stringify(b.history)).toBe(JSON.stringify(a.history));
      expect(canonical(b.serialize())).toEqual(canonical(a.serialize()));
    });
  }
});
