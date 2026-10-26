// The finer rules of discovery: what each one needs first, where it can happen, and what hurries it.
import { describe, it, expect } from 'vitest';
import { DISCOVERY, knowHowFor } from '../../src/sim/know';
import { seasonOf, START_TICK, TICKS_PER_DAY } from '../../src/sim/time';
import { sim } from '../helpers';

/** The first tick from the start that falls in a season. */
const inSeason = (k: number) => {
  let t = START_TICK;
  while (seasonOf(t) !== k) t += TICKS_PER_DAY;
  return t;
};

describe('know-how', () => {
  it('gains nothing toward a discovery before what it needs is known', () => {
    const s = sim(2);
    const adult = s.members().find((p) => s.age(p) >= 20)!;
    // daub and the storehouse both need huts first
    s.practise(adult, 'thatch', 200);
    s.practise(adult, 'store_food', 500);
    expect(s.camp.practice.daub ?? 0).toBe(0);
    expect(s.camp.practice.storehouse ?? 0).toBe(0);
    expect(s.knows('daub')).toBe(false);
    s.camp.knows.push('huts');
    s.practise(adult, 'thatch', 1);
    expect(s.camp.practice.daub ?? (s.knows('daub') ? 1 : 0)).toBeGreaterThan(0);
  });

  it('only finds wattle-and-daub where there is mud, and stonework where there is stone', () => {
    const s = sim(3);
    s.mudSpots.length = 0;
    s.quarryTiles.length = 0;
    s.camp.knows.push('huts');
    const adult = s.members().find((p) => s.age(p) >= 20)!;
    for (let i = 0; i < 500; i++) s.practise(adult, 'build');
    expect(s.knows('daub')).toBe(false);
    expect(s.knows('stonework')).toBe(false);
    expect(s.camp.practice.daub).toBeUndefined();
    expect(s.camp.practice.stonework).toBeUndefined();
  });

  it('counts each kind of work toward the discoveries it leads to', () => {
    const s = sim(1);
    const adult = s.members().find((p) => s.age(p) >= 20)!;
    const before = { ...s.camp.practice };
    s.practise(adult, 'grave');
    s.practise(adult, 'fell_chopper');
    s.practise(adult, 'damp_fire');
    const gained = (k: string) => s.knows(k) || (s.camp.practice[k] ?? 0) > (before[k] ?? 0);
    expect(gained('digstick')).toBe(true);
    expect(gained('axe')).toBe(true);
    expect(gained('woodshed')).toBe(true);
    // a grave counts three times what a trip's digging does
    if (!s.knows('digstick')) expect(s.camp.practice.digstick! - (before.digstick ?? 0)).toBe(3);
  });

  it('comes faster in hardship: huts and the windbreak in the cold, drying in a hungry year, daub in winter', () => {
    const s = sim(1);
    const c = s.camp;
    const at = (tick: number) => ({ ...s, tick }) as unknown as typeof s;
    const spring = inSeason(0), autumn = inSeason(2), winter = inSeason(3);
    for (const k of ['huts', 'windbreak']) {
      const h = DISCOVERY.get(k)!.hurry!;
      expect(h(at(spring), c)).toBe(1);
      expect(h(at(autumn), c)).toBeGreaterThan(1);
      expect(h(at(winter), c)).toBeGreaterThan(h(at(autumn), c));
    }
    const dry = DISCOVERY.get('preserving')!.hurry!;
    expect(dry(s, { ...c, hungryWinters: 0, famine: false })).toBe(1);
    expect(dry(s, { ...c, hungryWinters: 1 })).toBeGreaterThan(1);
    const daub = DISCOVERY.get('daub')!.hurry!;
    expect(daub(at(winter), c)).toBeGreaterThan(daub(at(spring), c));
    // a storehouse is thought of when food lies spoiling in the summer stores
    const store = DISCOVERY.get('storehouse')!.hurry!;
    const summer = inSeason(1);
    expect(store(at(summer), { ...c, stock: { ...c.stock, berries: 40, fish: 0 } })).toBeGreaterThan(1);
    expect(store(at(summer), { ...c, stock: { ...c.stock, berries: 5, fish: 0 } })).toBe(1);
  });

  it('asks for the right know-how for every building', () => {
    expect(knowHowFor({ kind: 'leanto' })).toEqual([]);
    expect(knowHowFor({ kind: 'hut' })).toEqual(['huts']);
    expect(knowHowFor({ kind: 'hut', walls: 'wood' })).toEqual(['huts']);
    expect(knowHowFor({ kind: 'hut', walls: 'daub' })).toEqual(['huts', 'daub']);
    expect(knowHowFor({ kind: 'storehouse', walls: 'stone' })).toEqual(['storehouse', 'stonework']);
    expect(knowHowFor({ kind: 'rack' })).toEqual(['preserving']);
    expect(knowHowFor({ kind: 'woodshed' })).toEqual(['woodshed']);
    expect(knowHowFor({ kind: 'windbreak' })).toEqual(['windbreak']);
  });
});
