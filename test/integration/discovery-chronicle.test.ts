// The chronicle keeps how and when each band came to know what it knows, and its Discoveries page reads it.
import { describe, it, expect } from 'vitest';
import { DISCOVERIES } from '../../src/sim/know';
import { TICKS_PER_DAY } from '../../src/sim/time';
import { bandDiscoveries, firstFound } from '../../src/ui/discoveries';
import { sim, runTo, runYears } from '../helpers';

const stock = { berries: 0, meat: 0, fish: 0, preserved: 0, wood: 0, fiber: 0, cordage: 0, mud: 0, stone: 0 };

describe('discoveries in the chronicle', () => {
  it('keeps who worked something out, and when', () => {
    const s = sim(2);
    const adult = s.members().find((p) => s.age(p) >= 20)!;
    adult.skills.fill(20);
    for (let i = 0; i < 400 && !s.knows('huts'); i++) s.practise(adult, 'night_out');
    expect(s.camp.learned).toEqual([{ k: 'huts', tick: s.tick, how: 'found', by: adult.id }]);
    const [band] = bandDiscoveries(s.chronicle());
    expect(band.known).toEqual([{ key: 'huts', label: 'Huts', year: 1, how: ['worked out by ', { id: adult.id }] }]);
    // what it doesn't know yet, and what has to come first
    expect(band.unknown.find((u) => u.key === 'huts')).toBeUndefined();
    expect(band.unknown.find((u) => u.key === 'storehouse')!.needs).toEqual(['Drying and smoking']);
    expect(band.unknown.find((u) => u.key === 'daub')).toBeDefined();
  });

  it('keeps who taught it, when someone marries in', () => {
    const s = sim(3);
    const by = s.members().find((p) => s.age(p) >= 20)!;
    s.camp.learning = [{ k: 'huts', at: s.tick + 10, by: by.id }];
    runTo(s, s.tick + TICKS_PER_DAY + 10);
    const rec = s.camp.learned!.find((l) => l.k === 'huts')!;
    expect(rec).toMatchObject({ how: 'taught', by: by.id });
    const row = bandDiscoveries(s.chronicle())[0].known.find((k) => k.key === 'huts')!;
    expect(row.how).toEqual(['taught by ', { id: by.id }, ', who married in']);
  });

  it('passes the story down to a band that splits off, told as happening at the old camp', () => {
    const s = sim(1);
    const c = s.camp;
    const adult = s.members().find((p) => s.age(p) >= 20)!;
    adult.skills.fill(20);
    for (let i = 0; i < 400 && !s.knows('huts'); i++) s.practise(adult, 'night_out');
    s.tick += 10;
    const daughter = s.foundCamp(c.tile + 40, { ...stock }, c.id, -1);
    expect(daughter.learned).toEqual(c.learned);
    expect(daughter.learned).not.toBe(c.learned);
    const bands = bandDiscoveries(s.chronicle());
    const d = bands.find((b) => b.camp.id === daughter.id)!;
    expect(d.known[0].how).toEqual(['worked out by ', { id: adult.id }, ` at ${c.name}`]);
    // across the land: found once, at the first camp, and known by both
    const huts = firstFound(s.chronicle()).find((f) => f.key === 'huts')!;
    expect(huts.first).toMatchObject({ by: adult.id, band: c.name, year: 1 });
    expect(huts.knownBy).toBe(2);
    expect(huts.of).toBe(2);
  });

  it('says so when a band knows something from before the chronicle kept count', () => {
    const s = sim(1);
    s.camp.knows.push('axe');
    const row = bandDiscoveries(s.chronicle())[0].known[0];
    expect(row).toEqual({ key: 'axe', label: 'Hafted axe', year: 0, how: ['known before the chronicle kept count'] });
    expect(firstFound(s.chronicle()).find((f) => f.key === 'axe')!.first).toBeNull();
  });

  it('accounts for everything every band knows, however it learned it', () => {
    for (const seed of [1, 3]) {
      const s = runYears(sim(seed), 6);
      for (const c of s.camps) {
        expect(c.learned!.map((l) => l.k), `seed ${seed} ${c.name}`).toEqual(c.knows);
        for (const l of c.learned!) if (l.how === 'found' || l.how === 'taught') expect(s.byId.get(l.by), `seed ${seed} ${l.k}`).toBeDefined();
      }
      const bands = bandDiscoveries(s.chronicle());
      expect(bands.length).toBe(s.camps.length);
      for (const b of bands) expect(b.known.length + b.unknown.length).toBe(DISCOVERIES.length);
      // the living bands come first
      const firstGone = bands.findIndex((b) => b.camp.gone);
      if (firstGone >= 0) expect(bands.slice(firstGone).every((b) => b.camp.gone)).toBe(true);
    }
  });
});
