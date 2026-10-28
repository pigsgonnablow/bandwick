// A person's needs tick by tick: hunger, tiredness, cold, the fire's warmth, a roof, and what each
// does to health, down to death and what it is put down to. These pin the per-tick rates, so a change
// to any of them shows up here as well as in the golden histories.
import { describe, it, expect } from 'vitest';
import { WARM_RADIUS } from '../../src/sim/sim';
import { ACT, HEALTH, Person, specOf } from '../../src/sim/band';
import { TICKS_PER_YEAR } from '../../src/sim/time';
import { sim } from '../helpers';
import type { Sim } from '../../src/sim/sim';

/** Run one tick of a person's needs, at a temperature we choose. */
function tick(s: Sim, p: Person, temp: number) {
  s.camp = s.campOf(p);
  s.tempAt = () => temp;
  (s as any).needs(p);
}

/** A grown-up of the first band, out of reach of the fire, with every need comfortable and nothing remembered. */
function adult(s: Sim, over: Partial<Person> = {}) {
  const p = s.members().find((q) => s.age(q) >= 18 && s.age(q) < 50)!;
  Object.assign(p, {
    food: 60, rest: 60, warmth: 60, belonging: 60, safety: 60, health: 60, sick: 0,
    act: ACT.Idle, indoors: false, memories: [], traits: [],
    x: s.camp.x + 20, z: s.camp.z + 20,
    ...over,
  });
  return p;
}

describe('hunger and tiredness', () => {
  it('eats into food and rest a little every tick, faster at hard work', () => {
    const s = sim(1);
    const p = adult(s);
    tick(s, p, 20);
    expect(60 - p.food).toBeCloseTo(0.2, 6);
    expect(60 - p.rest).toBeCloseTo(0.48, 6);
    expect(60 - p.belonging).toBeCloseTo(0.09, 6);
    for (const act of [ACT.Chop, ACT.Build, ACT.Hunt, ACT.Dig]) {
      Object.assign(p, { food: 60, rest: 60, act });
      tick(s, p, 20);
      expect(60 - p.food).toBeCloseTo(0.27, 6);
      expect(60 - p.rest).toBeCloseTo(0.62, 6);
    }
  });

  it('lets children go hungry more slowly and the greedy faster', () => {
    const s = sim(1);
    const kid = s.members().find((q) => s.age(q) >= 2 && s.age(q) < 12)!;
    Object.assign(kid, { food: 60, act: ACT.Idle, traits: [], memories: [] });
    tick(s, kid, 20);
    expect(60 - kid.food).toBeCloseTo(0.2 * 0.8, 6);
    const p = adult(s, { traits: ['greedy'] });
    tick(s, p, 20);
    expect(60 - p.food).toBeCloseTo(0.2 * 1.1, 6);
  });

  it('rests while asleep', () => {
    const s = sim(1);
    const p = adult(s, { act: ACT.Sleep });
    tick(s, p, 20);
    expect(p.rest).toBe(60);
  });
});

describe('cold and warmth', () => {
  it('warms up in mild weather and chills below 15 degrees, the more the colder', () => {
    const s = sim(1);
    const p = adult(s);
    tick(s, p, 18);
    expect(p.warmth).toBeCloseTo(60.5, 6);
    p.warmth = 60;
    tick(s, p, 5);
    expect(60 - p.warmth).toBeCloseTo(10 * 0.018, 6);
    p.warmth = 60;
    tick(s, p, -5);
    expect(60 - p.warmth).toBeCloseTo(20 * 0.018, 6);
  });

  it('chills the very young and the old faster', () => {
    const s = sim(1);
    const old = s.members().find((q) => s.age(q) > 50)!;
    // the band's elder is in their late fifties: age them past sixty
    old.birth = s.tick - 62 * TICKS_PER_YEAR;
    Object.assign(old, { warmth: 60, act: ACT.Idle, indoors: false, x: s.camp.x + 20, z: s.camp.z + 20 });
    tick(s, old, 5);
    expect(60 - old.warmth).toBeCloseTo(10 * 0.018 * 1.25, 6);
  });

  it('warms anyone close to a lit fire, and nobody once it is out', () => {
    const s = sim(1);
    const h = s.hearth();
    const p = adult(s, { x: s.camp.x + 0.5, z: s.camp.z + 0.5 });
    h.fuel = 5;
    tick(s, p, 5);
    expect(p.warmth - 60).toBeCloseTo(1.3 - 10 * 0.018, 6);
    // just outside the circle
    Object.assign(p, { warmth: 60, x: s.camp.x + WARM_RADIUS + 0.1, z: s.camp.z });
    tick(s, p, 5);
    expect(p.warmth).toBeLessThan(60);
    Object.assign(p, { warmth: 60, x: s.camp.x + 0.5, z: s.camp.z + 0.5 });
    h.fuel = 0;
    tick(s, p, 5);
    expect(p.warmth).toBeLessThan(60);
  });

  it('keeps out most of the cold under a roof, by how much shelter the home gives', () => {
    const s = sim(1);
    const p = adult(s);
    const hut = s.newBuilding('hut', s.camp.tile + 3, p.id);
    hut.built = true;
    Object.assign(p, { home: hut.id, indoors: true });
    tick(s, p, 5);
    const shelter = specOf(hut).shelter;
    expect(p.warmth - 60).toBeCloseTo(-10 * 0.018 * (1 - shelter) + 0.15, 6);
    // a hard frost: still losing heat inside, and no small comfort from the roof
    p.warmth = 60;
    tick(s, p, -10);
    expect(60 - p.warmth).toBeCloseTo(25 * 0.018 * (1 - shelter), 6);
  });
});

describe('health', () => {
  it('mends slowly while fed and warm', () => {
    const s = sim(1);
    const p = adult(s);
    tick(s, p, 20);
    expect(p.health).toBeCloseTo(60.012, 6);
  });

  it('suffers from hunger, cold, frost and fever, each at its own rate', () => {
    const s = sim(1);
    const cases: [Partial<Person>, number][] = [
      [{ food: HEALTH.starving - 1 }, 0.045],
      [{ warmth: HEALTH.cold - 1 }, 0.05],
      [{ warmth: HEALTH.freezing - 1 }, 0.17],
      [{ sick: 3 }, 0.03],
      [{ food: 2, warmth: 2, sick: 3 }, 0.045 + 0.17 + 0.03],
    ];
    for (const [over, dmg] of cases) {
      const p = adult(s, over);
      // warm enough out that warmth does not move into another band
      tick(s, p, 15);
      expect(60 - p.health, JSON.stringify(over)).toBeCloseTo(dmg, 6);
    }
  });

  it('neither mends nor suffers when only middling hungry or cold', () => {
    const s = sim(1);
    const p = adult(s, { food: HEALTH.mend - 1 + 0.2 });
    tick(s, p, 15);
    expect(p.health).toBe(60);
  });

  it('keeps every need between 0 and 100', () => {
    const s = sim(1);
    const p = adult(s, { food: 0.05, rest: 0.05, warmth: 99.9, belonging: 0.01, safety: 99.9, health: 99.995 });
    s.hearth().fuel = 5;
    Object.assign(p, { x: s.camp.x + 0.5, z: s.camp.z + 0.5 });
    tick(s, p, 25);
    for (const k of ['food', 'rest', 'warmth', 'belonging', 'safety', 'health', 'mood'] as const) {
      expect(p[k], k).toBeGreaterThanOrEqual(0);
      expect(p[k], k).toBeLessThanOrEqual(100);
    }
    expect(p.food).toBe(0);
    expect(p.warmth).toBe(100);
  });

  it('sets mood from the needs, weighted', () => {
    const s = sim(1);
    const p = adult(s);
    tick(s, p, 20);
    const want = p.food * 0.24 + p.rest * 0.16 + p.warmth * 0.18 + p.belonging * 0.16 + p.safety * 0.1 + p.health * 0.16;
    expect(p.mood).toBeCloseTo(want, 6);
  });
});

describe('dying of hunger and cold', () => {
  it('puts a death down to starvation, counts it, and tells of it', () => {
    const s = sim(1);
    const p = adult(s, { food: 0, health: 0.01 });
    const before = { ...s.stats };
    tick(s, p, 20);
    expect(p.alive).toBe(false);
    expect(p.cause).toBe('starvation');
    expect(p.death).toBe(s.tick);
    expect(p.task).toBeNull();
    expect(s.stats.deaths).toBe(before.deaths + 1);
    expect(s.stats.starved).toBe(before.starved + 1);
    expect(s.stats.froze).toBe(before.froze);
    expect(s.events.at(-1)!.text).toContain(`${p.name}, `);
    expect(s.events.at(-1)!.text).toContain('starved');
  });

  it('puts it down to the cold when cold is doing at least as much harm as hunger', () => {
    const s = sim(1);
    const p = adult(s, { food: 0, warmth: 0, health: 0.01 });
    tick(s, p, -10);
    expect(p.alive).toBe(false);
    expect(p.cause).toBe('cold');
    expect(s.stats.froze).toBe(1);
    expect(s.stats.starved).toBe(0);
    // merely chilly (not freezing) still edges out hunger
    const q = adult(s, { food: 0, warmth: HEALTH.cold - 1, health: 0.01 });
    tick(s, q, 15);
    expect(q.cause).toBe('cold');
    expect(s.stats.froze).toBe(2);
  });

  it('puts it down to fever, or weakness, when neither hunger nor cold is to blame', () => {
    const s = sim(1);
    const p = adult(s, { sick: 2, health: 0.01 });
    tick(s, p, 20);
    expect(p.cause).toBe('fever');
    const q = adult(s, { health: 0 });
    // no harm this tick and nothing mends at zero health: a body worn out to nothing
    q.food = HEALTH.mend;
    tick(s, q, 20);
    expect(q.alive).toBe(false);
    expect(q.cause).toBe('weakness');
  });
});
