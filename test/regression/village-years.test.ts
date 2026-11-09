// A band that knows all of village life from the start, run for years and checked every day: the
// rules of life hold (tools/lib/invariants.ts), every new custom and craft actually happens, and a
// save made in the middle of it (a feast, a nursing, a necklace, an acorn walk, some mending) carries on identically.
import { describe, it, expect } from 'vitest';
import { InvariantChecker } from '../../tools/lib/invariants';
import { Sim, SaveData } from '../../src/sim/sim';
import { generateWorld } from '../../src/sim/worldgen';
import { TICKS_PER_DAY, TICKS_PER_YEAR } from '../../src/sim/time';
import { sim } from '../helpers';

const KNOWN = ['preserving', 'bedding', 'cloaks', 'roots', 'digstick', 'nuts', 'cooking', 'herbs', 'needles', 'eggs', 'honey', 'mushrooms', 'hats', 'shoes', 'capes', 'bags'];
const YEARS = 4;

function villageSim(seed: number) {
  const s = sim(seed);
  for (const k of KNOWN) if (!s.camp.knows.includes(k)) s.camp.knows.push(k);
  s.giveTools(s.camp, { stick: 2 });
  return s;
}
const total = (s: Sim, k: string) => s.camps.reduce((n, c) => n + (c.ledger?.total?.[k] ?? 0), 0);

describe('village life over the years', () => {
  // hats come from the hides left over once everyone has a cloak and shoes, so a band that took to its traps
  // and hunted little may never get to them: they are looked for across the runs, not in each one
  const hats: number[] = [];
  for (const seed of [1, 5]) {
    it(`of seed ${seed} keeps to the rules, and every part of it happens`, () => {
      const s = villageSim(seed);
      const checker = new InvariantChecker(s);
      const end = s.tick + YEARS * TICKS_PER_YEAR;
      const seen = new Set<string>();
      while (s.tick < end) {
        s.step();
        if (s.tick % 10 === 0) for (const p of s.living()) if (p.task) seen.add(p.task.kind);
        if (s.tick % TICKS_PER_DAY === 0) checker.check();
      }
      expect(checker.report()).toEqual([]);
      expect(s.living().length).toBeGreaterThan(0);
      for (const k of ['nuts', 'herbs', 'gift', 'feast', 'roots', 'bed', 'eggs', 'honey', 'mushrooms', 'mend']) expect(seen, `someone at ${k}`).toContain(k);
      // food comes in and is eaten; the new stores are used, not just piled up
      for (const k of ['nuts', 'roots', 'eggs', 'honey', 'mushrooms']) {
        expect(total(s, `gathered.${k}`), `gathered ${k}`).toBeGreaterThan(0);
        expect(total(s, `eaten.${k}`), `eaten ${k}`).toBeGreaterThan(0);
      }
      expect(total(s, 'gathered.herbs')).toBeGreaterThan(0);
      expect(total(s, 'made.needle')).toBeGreaterThan(0);
      expect(total(s, 'made.cloak')).toBeGreaterThan(0);
      // clothes besides cloaks are sewn, and worn things mended
      for (const k of ['shoes', 'cape']) expect(total(s, `made.${k}`), `made ${k}`).toBeGreaterThan(0);
      hats.push(total(s, 'made.hat') + total(s, 'made.mittens'));
      expect(total(s, 'mended')).toBeGreaterThan(0);
      expect(total(s, 'gifts.given')).toBeGreaterThan(0);
      // a feast or a thin year told of, every midwinter of the run
      const winters = s.events.filter((e) => e.kind === 'feast' || e.kind === 'feast_none').length;
      expect(winters).toBeGreaterThanOrEqual(YEARS - 1);
      expect(total(s, 'feast.ate')).toBeGreaterThan(0);
      // nobody remembers being at two feasts on one night
      for (const p of s.people) {
        const nights = p.memories.filter((m) => m.kind === 'midwinter').map((m) => Math.floor(m.tick / TICKS_PER_DAY));
        expect(new Set(nights).size).toBe(nights.length);
      }
    });
  }
  it('sews hats and mittens in those years', () => {
    expect(hats.length).toBe(2);
    expect(hats.some((n) => n > 0)).toBe(true);
  });
});

/** A save as plain data, with the random streams' words read as unsigned. */
function canonical(save: SaveData) {
  const d = JSON.parse(JSON.stringify(save)) as SaveData;
  for (const k of Object.keys(d.rng) as (keyof SaveData['rng'])[]) d.rng[k] = d.rng[k].map((v) => v >>> 0);
  return d;
}

describe('a save in the middle of village life', () => {
  for (const kind of ['feast', 'nuts', 'herbs', 'gift', 'nurse', 'eggs', 'honey', 'mushrooms', 'mend'] as const) {
    it(`made while someone is at ${kind === 'nuts' ? 'the acorns' : ['eggs', 'honey', 'mushrooms', 'herbs'].includes(kind) ? `the ${kind}` : kind === 'mend' ? 'some mending' : `a ${kind}`} carries on identically`, () => {
      const a = villageSim(1);
      const limit = a.tick + 3 * TICKS_PER_YEAR;
      const busy = () => a.living().some((p) => p.task?.kind === kind && p.task.stage >= 1);
      while (a.tick < limit && !busy()) a.step();
      // (a nursing needs a fever; if none came in three years there is nothing to save mid-way)
      if (kind === 'nurse' && !busy()) return;
      expect(busy()).toBe(true);
      const save = JSON.parse(JSON.stringify(a.serialize())) as SaveData;
      const b = new Sim(generateWorld(save.params), save);
      expect(b.historyHash()).toBe(a.historyHash());
      const end = a.tick + 4 * TICKS_PER_DAY;
      while (a.tick < end) {
        a.step();
        b.step();
        if (a.tick % 40 === 0) expect(b.historyHash(), `diverged at tick ${a.tick}`).toBe(a.historyHash());
      }
      expect(canonical(b.serialize())).toEqual(canonical(a.serialize()));
    });
  }
});
