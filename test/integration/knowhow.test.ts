// The finer rules of discovery: what each one needs first, who can have the idea, and where.
import { describe, it, expect } from 'vitest';
import { DISCOVERY, knowHowFor, meets, ELITE } from '../../src/sim/know';
import { SK, Person } from '../../src/sim/band';
import { sim } from '../helpers';

/** Make someone a master of every craft. */
const master = (p: Person) => { p.skills.fill(20); return p; };

describe('know-how', () => {
  it('gains nothing toward a discovery before what it needs is known', () => {
    const s = sim(2);
    const adult = master(s.members().find((p) => s.age(p) >= 20)!);
    // daub and the storehouse both need huts first
    s.practise(adult, 'thatch', 2000);
    s.practise(adult, 'store_food', 5000);
    for (let i = 0; i < 500; i++) s.practise(adult, 'build');
    expect(s.knows('daub')).toBe(false);
    expect(s.knows('storehouse')).toBe(false);
    s.camp.knows.push('huts');
    for (let i = 0; i < 2000 && !s.knows('daub'); i++) s.practise(adult, 'thatch');
    expect(s.knows('daub')).toBe(true);
  });

  it('only finds wattle-and-daub where there is mud, and stonework where there is stone', () => {
    const s = sim(3);
    s.mudSpots.length = 0;
    s.quarryTiles.length = 0;
    s.camp.knows.push('huts');
    const adult = master(s.members().find((p) => s.age(p) >= 20)!);
    for (let i = 0; i < 500; i++) s.practise(adult, 'build');
    expect(s.knows('daub')).toBe(false);
    expect(s.knows('stonework')).toBe(false);
  });

  it('comes only to someone who has mastered the crafts around it, however long they work', () => {
    const s = sim(1);
    const adult = s.members().find((p) => s.age(p) >= 20)!;
    const huts = DISCOVERY.get('huts')!;
    adult.skills[SK.wood] = 11.9;
    adult.skills[SK.weave] = 20;
    expect(meets(adult, huts)).toBe(-1);
    for (let i = 0; i < 5000; i++) s.practise(adult, 'night_out');
    expect(s.knows('huts')).toBe(false);
    adult.skills[SK.wood] = 12;
    expect(meets(adult, huts)).toBe(0);
    for (let i = 0; i < 5000 && !s.knows('huts'); i++) s.practise(adult, 'night_out');
    expect(s.knows('huts')).toBe(true);
    expect(s.events.some((e) => e.kind === 'discovery' && e.people[0] === adult.id)).toBe(true);
  });

  it('comes sooner the further past the mark someone is', () => {
    const tries = (level: number) => {
      let total = 0;
      for (const seed of [1, 2, 3, 4, 5, 6]) {
        const s = sim(seed);
        const adult = s.members().find((p) => s.age(p) >= 20)!;
        adult.skills[SK.fish] = level;
        adult.skills[SK.weave] = 20;
        let i = 0;
        while (i < 5000 && !s.knows('fishtraps')) { s.practise(adult, 'fish_fiber'); i++; }
        total += i;
      }
      return total;
    };
    expect(tries(20)).toBeLessThan(tries(ELITE));
  });

  it('comes only from the work that leads to it', () => {
    const s = sim(1);
    const adult = master(s.members().find((p) => s.age(p) >= 20)!);
    for (let i = 0; i < 500; i++) s.practise(adult, 'grave');
    expect(s.knows('digstick')).toBe(true);
    expect(s.knows('axe')).toBe(false);
    expect(s.knows('snares')).toBe(false);
    for (let i = 0; i < 500 && !s.knows('axe'); i++) s.practise(adult, 'fell_chopper');
    expect(s.knows('axe')).toBe(true);
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
