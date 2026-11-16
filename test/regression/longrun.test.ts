// A dozen years of two worlds, checked every day (tools/lib/invariants.ts) and then read back as a
// whole: the counts agree with the people, births and deaths follow the rules of life, the
// chronicle runs forwards, the fire is kept through the winter nights, and every part of the food
// chain is working. These hold whatever the details of a history, so they survive tuning that only
// moves the golden snapshots.
import { describe, it, expect } from 'vitest';
import { InvariantChecker } from '../../tools/lib/invariants';
import { DISCOVERY } from '../../src/sim/know';
import { START_TICK, TICKS_PER_DAY, TICKS_PER_YEAR, TICKS_PER_HOUR, seasonOf, ageYears, isDark } from '../../src/sim/time';
import { sim } from '../helpers';

const YEARS = 12;

describe('a dozen years', () => {
  for (const seed of [4, 9]) {
    it(`of seed ${seed} keeps to the rules of life`, () => {
      const s = sim(seed);
      const checker = new InvariantChecker(s);
      const end = s.tick + YEARS * TICKS_PER_YEAR;
      let winterNights = 0, people = 0;
      const outAtNight: string[] = [], outAtNoon: string[] = [];
      while (s.tick < end) {
        s.step();
        if (s.tick % TICKS_PER_DAY === 0) {
          checker.check();
          // the band only ever grows by births, strangers and newcomers: nobody is lost from the list
          expect(s.people.length).toBeGreaterThanOrEqual(people);
          people = s.people.length;
        }
        // every hour of every winter night: a band with wood in the stores keeps its fire burning
        if (seasonOf(s.tick) === 3 && s.tick % TICKS_PER_HOUR === 0 && isDark(s.tick))
          for (const c of s.liveCamps()) {
            const h = s.hearth(c);
            expect(h.fuel).toBeGreaterThanOrEqual(0);
            winterNights++;
            if (h.fuel <= 0 && c.stock.wood >= 4) outAtNight.push(`${c.name} t${s.tick} wood ${c.stock.wood}`);
          }
        // and by the middle of any day, a band with wood in the stores has it going again
        if (s.tick % TICKS_PER_DAY === 13 * TICKS_PER_HOUR)
          for (const c of s.liveCamps()) if (s.hearth(c).fuel <= 0 && c.stock.wood >= 4) outAtNoon.push(`${c.name} t${s.tick} wood ${c.stock.wood}`);
      }
      expect(checker.report()).toEqual([]);
      expect(s.living().length).toBeGreaterThan(0);

      // the counts agree with the people
      const dead = s.people.filter((p) => !p.alive);
      expect(s.stats.deaths).toBe(dead.length);
      expect(s.stats.starved).toBe(dead.filter((p) => p.cause === 'starvation').length);
      expect(s.stats.froze).toBe(dead.filter((p) => p.cause === 'cold').length);
      // (strangers can bring a child born since the start: only those born here count)
      const told = new Set(s.events.filter((e) => e.kind === 'birth' || e.kind === 'twins').flatMap((e) => e.people.map((id) => `${id}@${e.tick}`)));
      const born = s.people.filter((p) => p.birth >= START_TICK && told.has(`${p.id}@${p.birth}`));
      expect(s.stats.births).toBe(born.length);
      expect(s.stats.births).toBeGreaterThan(0);
      expect(s.stats.peak).toBeGreaterThanOrEqual(s.living().length);

      // births: to a woman of child-bearing age, by a man, never closer together than a pregnancy
      for (const b of born) {
        const m = s.byId.get(b.mother)!;
        expect(m.sex).toBe(0);
        const at = ageYears(b.birth, m.birth);
        expect(at).toBeGreaterThanOrEqual(16);
        expect(at).toBeLessThanOrEqual(45);
        if (b.father >= 0) expect(s.byId.get(b.father)!.sex).toBe(1);
        if (!m.alive) expect(m.death).toBeGreaterThanOrEqual(b.birth);
      }
      for (const m of new Set(born.map((b) => b.mother))) {
        const ticks = [...new Set(born.filter((b) => b.mother === m).map((b) => b.birth))].sort((a, c) => a - c);
        for (let i = 1; i < ticks.length; i++) expect(ticks[i] - ticks[i - 1]).toBeGreaterThanOrEqual(Math.floor(TICKS_PER_YEAR * 0.75));
      }

      // deaths: the cause fits the person
      for (const p of dead) {
        expect(p.death).toBeGreaterThanOrEqual(p.birth);
        expect(p.death).toBeLessThanOrEqual(s.tick);
        const age = ageYears(p.death, p.birth);
        if (p.cause === 'old age') expect(age).toBeGreaterThan(50);
        if (p.cause === 'infancy') expect(age).toBeLessThan(3);
        if (p.cause === 'childbirth') expect(p.sex).toBe(0);
        expect(p.partner === -1 || !s.byId.get(p.partner)?.alive || s.byId.get(p.partner)!.partner !== p.id).toBe(true);
      }
      for (const p of s.living()) expect(s.age(p)).toBeLessThan(110);

      // the chronicle runs forwards, and tells of every death and birth
      for (let i = 1; i < s.events.length; i++) {
        expect(s.events[i].id).toBeGreaterThan(s.events[i - 1].id);
        expect(s.events[i].tick).toBeGreaterThanOrEqual(s.events[i - 1].tick);
      }
      expect(s.events.filter((e) => e.kind === 'death').length).toBe(dead.length);

      // what a band knows, it learned in order
      for (const c of s.camps)
        c.knows.forEach((k, i) => {
          for (const n of DISCOVERY.get(k)?.needs ?? []) expect(c.knows.indexOf(n), `${c.name}: ${k} before ${n}`).toBeGreaterThanOrEqual(0);
          for (const n of DISCOVERY.get(k)?.needs ?? []) expect(c.knows.indexOf(n), `${c.name}: ${k} before ${n}`).toBeLessThan(i);
        });

      // the fire is kept through the winter nights
      expect(winterNights).toBeGreaterThan(0);
      expect(outAtNight).toEqual([]);
      expect(outAtNoon).toEqual([]);

      // every part of the food chain works: berries, meat and fish come in, are eaten, and some go off; wood burns
      const total = (k: string) => s.camps.reduce((a, c) => a + (c.ledger?.total[k] ?? 0), 0);
      for (const k of ['berries', 'meat', 'fish']) {
        expect(total(`gathered.${k}`), `gathered ${k}`).toBeGreaterThan(0);
        expect(total(`eaten.${k}`), `eaten ${k}`).toBeGreaterThan(0);
        expect(total(`spoiled.${k}`), `spoiled ${k}`).toBeGreaterThan(0);
      }
      expect(total('gathered.wood')).toBeGreaterThan(0);
      expect(total('burned')).toBeGreaterThan(0);
      expect(s.stats.felled).toBeGreaterThan(0);
    });
  }
});
