// Bands start with the old ways only, and learn the rest by doing the work that leads to it.
import { describe, it, expect } from 'vitest';
import { DISCOVERIES, knowHowFor } from '../../src/sim/know';
import { START_TICK, TICKS_PER_DAY } from '../../src/sim/time';
import { sim, runTo, runYears } from '../helpers';

describe('discovery', () => {
  it('starts knowing nothing new, and builds only what it has found out', () => {
    for (const seed of [1, 4]) {
      const s = sim(seed);
      expect(s.camp.knows).toEqual([]);
      for (let d = 0; d < 3 * 48; d++) {
        runTo(s, s.tick + TICKS_PER_DAY);
        for (const b of s.buildings) for (const k of knowHowFor(b)) expect(s.campById(b.band)!.knows, `seed ${seed} ${b.kind}`).toContain(k);
      }
      // and a discovery always comes after what it needs
      for (const c of s.camps)
        for (const k of c.knows) for (const n of DISCOVERIES.find((d) => d.key === k)!.needs) expect(c.knows.indexOf(n)).toBeLessThan(c.knows.indexOf(k));
    }
  });

  it('finds huts by the first autumn in most worlds', () => {
    let found = 0;
    const seeds = [1, 2, 3, 4, 5, 6];
    for (const seed of seeds) {
      const s = runTo(sim(seed), START_TICK + 19 * TICKS_PER_DAY);
      if (s.knows('huts', s.camps[0])) found++;
    }
    expect(found).toBeGreaterThanOrEqual(seeds.length - 1);
  });

  it('only builds up experience from adults, and someone always has the idea in the end', () => {
    const s = sim(2);
    const kid = s.members().find((p) => s.age(p) < 14)!;
    s.practise(kid, 'night_out', 50);
    expect(s.camp.practice.huts ?? 0).toBe(0);
    const adult = s.members().find((p) => s.age(p) >= 20)!;
    for (let i = 0; i < 400 && !s.knows('huts'); i++) s.practise(adult, 'night_out');
    expect(s.knows('huts')).toBe(true);
    expect(s.camp.practice.huts).toBeUndefined();
    expect(s.events.some((e) => e.kind === 'discovery' && e.people[0] === adult.id)).toBe(true);
  });

  it('tells the first in the world to find something out as the story, and later bands more quietly', () => {
    const s = sim(2);
    const c = s.camp;
    const stock = { berries: 0, meat: 0, fish: 0, preserved: 0, wood: 0, fiber: 0, cordage: 0, mud: 0, stone: 0 };
    const other = s.foundCamp(c.tile + 40, { ...stock }, -1, -1);
    other.knows.push('huts');
    s.camp = c;
    const adult = s.members().find((p) => s.age(p) >= 20)!;
    for (let i = 0; i < 400 && !s.knows('huts'); i++) s.practise(adult, 'night_out');
    const e = s.events.find((e) => e.kind === 'discovery' && e.people[0] === adult.id)!;
    expect(e.text).toBe(`${adult.name} of ${c.name} worked out how to raise huts, as other bands had before.`);
    expect(e.weight).toBeLessThan(3);
  });

  it('is taught a season after someone who knows it marries in', () => {
    const s = sim(3);
    const c = s.camp;
    const by = s.members().find((p) => s.age(p) >= 20)!;
    c.learning = [{ k: 'huts', at: s.tick + 10, by: by.id }, { k: 'daub', at: s.tick + 10, by: by.id }];
    runTo(s, s.tick + TICKS_PER_DAY + 10);
    expect(c.knows.slice(0, 2)).toEqual(['huts', 'daub']);
    expect(s.events.some((e) => e.kind === 'discovery' && e.text.startsWith(`${by.name} taught the people of ${c.name}`))).toBe(true);
  });

  it('passes what it knows on to a band that splits off, but not to strangers', () => {
    const s = sim(1);
    const c = s.camp;
    c.knows.push('huts', 'preserving');
    const stock = { berries: 0, meat: 0, fish: 0, preserved: 0, wood: 0, fiber: 0, cordage: 0, mud: 0, stone: 0 };
    const daughter = s.foundCamp(c.tile + 40, { ...stock }, c.id, -1);
    expect(daughter.knows).toEqual(['huts', 'preserving']);
    expect(daughter.knows).not.toBe(c.knows);
    s.camp = c;
    expect(s.foundCamp(c.tile + 80, { ...stock }, -1, -1).knows).toEqual([]);
  });

  it('reads older saves: a band knows what it knew and what was never a discovery then', () => {
    const s = runYears(sim(2), 1);
    const save = s.serialize();
    for (const c of save.camps ?? []) { delete (c as any).knows; delete (c as any).practice; (c as any).knowsPreserving = true; }
    const t = new (s.constructor as any)(s.world, save);
    expect(t.camp.knows).toContain('huts');
    expect(t.camp.knows).toContain('preserving');
    // stonework only if it has raised stone already
    expect(t.camp.knows.includes('stonework')).toBe(t.buildings.some((b: any) => b.band === t.camp.id && b.walls === 'stone'));
    runTo(t, t.tick + 10 * TICKS_PER_DAY);
    expect(t.tick).toBeGreaterThan(save.tick);
  });
});
