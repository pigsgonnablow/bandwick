// Births and deaths: who can have children, what a newborn starts with, and everything a death
// sets in motion (the partner left alone, the home passed on, the grief, the count).
import { describe, it, expect } from 'vitest';
import { CARRY, Person } from '../../src/sim/band';
import { TICKS_PER_YEAR } from '../../src/sim/time';
import { sim } from '../helpers';
import type { Sim } from '../../src/sim/sim';

/** The first band's younger couple (both in their late twenties). */
function couple(s: Sim): [Person, Person] {
  const mother = s.members().find((p) => p.sex === 0 && p.partner >= 0 && s.age(p) < 30)!;
  return [mother, s.byId.get(mother.partner)!];
}

describe('a birth', () => {
  it('brings a newborn into the mother\'s band and home, close to its kin', () => {
    const s = sim(1);
    const [mother, father] = couple(s);
    mother.pregnantUntil = s.tick;
    mother.babyFather = father.id;
    mother.home = s.newBuilding('hut', s.camp.tile + 3, mother.id).id;
    const before = s.people.length, births = s.stats.births, events = s.events.length;
    s.camp = s.campOf(mother);
    (s as any).birth(mother);
    expect(mother.pregnantUntil).toBe(0);
    const babies = s.people.slice(before);
    expect(babies.length).toBeLessThanOrEqual(2);
    expect(s.stats.births).toBe(births + babies.length);
    const told = s.events.slice(events).map((e) => e.kind);
    if (babies.length) expect(told).toContain(babies.length === 2 ? 'twins' : 'birth');
    else expect(told).toContain('stillbirth');
    for (const b of babies) {
      expect(b.alive).toBe(true);
      expect(b.birth).toBe(s.tick);
      expect(s.age(b)).toBe(0);
      expect(b.mother).toBe(mother.id);
      expect(b.father).toBe(father.id);
      expect(b.band).toBe(mother.band);
      expect(b.home).toBe(mother.home);
      expect([b.x, b.z]).toEqual([mother.x, mother.z]);
      expect(b.partner).toBe(-1);
      expect(s.isKin(b, mother) && s.isKin(b, father)).toBe(true);
      expect(s.opinion(b, mother)).toBe(50);
      expect(s.opinion(mother, b)).toBe(50);
      expect(b.food).toBeGreaterThan(0);
      expect(b.health).toBeGreaterThan(0);
    }
  });

  it('comes when the time is up, at the morning count', () => {
    const s = sim(1);
    const [mother, father] = couple(s);
    mother.pregnantUntil = s.tick - 1;
    mother.babyFather = father.id;
    s.camp = s.campOf(mother);
    const before = s.people.length;
    (s as any).life();
    expect(mother.pregnantUntil).toBe(0);
    expect(s.people.length + s.events.filter((e) => e.kind === 'stillbirth').length).toBeGreaterThan(before);
  });

  it('waits three quarters of a year after it is conceived', () => {
    // run the band forward until someone conceives, then check when the child is due
    const s = sim(1);
    let due = -1, at = -1;
    for (let day = 0; day < 48 * 4 && due < 0; day++) {
      for (let t = 0; t < 240; t++) s.step();
      const m = s.living().find((p) => p.pregnantUntil > 0);
      if (m) {
        due = m.pregnantUntil;
        at = s.tick;
      }
    }
    expect(due).toBeGreaterThan(0);
    // found on the first morning after it happened, so within a day of 0.75 of a year
    expect(due - at).toBeLessThanOrEqual(Math.floor(TICKS_PER_YEAR * 0.75));
    expect(due - at).toBeGreaterThan(Math.floor(TICKS_PER_YEAR * 0.75) - 240);
  });
});

describe('a death', () => {
  it('leaves the partner free, passes the home to them, and grieves the kin', () => {
    const s = sim(1);
    const [a, b] = couple(s);
    const hut = s.newBuilding('hut', s.camp.tile + 3, a.id);
    hut.built = true;
    a.home = b.home = hut.id;
    const kid = s.people.find((p) => p.mother === a.id || p.father === a.id);
    s.camp = s.campOf(a);
    s.kill(a, 'fever');
    expect(a.alive).toBe(false);
    expect(a.cause).toBe('fever');
    expect(a.death).toBe(s.tick);
    expect(b.partner).toBe(-1);
    expect(hut.owner).toBe(b.id);
    expect(s.camp.lastDeath).toBe(s.tick);
    const grief = b.memories.find((m) => m.kind === 'death' && m.subject === a.id)!;
    expect(grief.weight).toBe(-55);
    // a child still growing up takes it as hard as the partner does
    expect(kid).toBeTruthy();
    expect(s.age(kid!)).toBeLessThan(14);
    expect(kid!.memories.find((m) => m.kind === 'death' && m.subject === a.id)?.weight).toBe(-55);
    const e = s.events.at(-1)!;
    expect(e.kind).toBe('death');
    expect(e.text).toBe(`${a.name}, ${Math.floor(s.age(a))}, died of fever.`);
    expect(e.weight).toBe(3);
  });

  it('grieves a grown child like other kin, and a young one like a partner', () => {
    const s = sim(1);
    const [a] = couple(s);
    const kid = s.people.find((p) => p.mother === a.id || p.father === a.id)!;
    kid.birth = s.tick - 20 * TICKS_PER_YEAR;
    s.camp = s.campOf(a);
    s.kill(a, 'fever');
    expect(kid.memories.find((m) => m.kind === 'death' && m.subject === a.id)?.weight).toBe(-40);
  });

  it('passes a home with no partner left to the eldest grown-up living in it', () => {
    const s = sim(1);
    const elder = s.members().find((p) => s.age(p) > 50)!;
    const [a, b] = couple(s);
    const hut = s.newBuilding('hut', s.camp.tile + 3, elder.id);
    hut.built = true;
    for (const p of [elder, a, b]) p.home = hut.id;
    elder.partner = -1;
    s.camp = s.campOf(elder);
    s.kill(elder, 'old age');
    // a and b are the same generation: the elder of the two takes it on
    expect(hut.owner).toBe([a, b].sort((x, y) => x.birth - y.birth)[0].id);
  });

  it('counts only once, however often it is told', () => {
    const s = sim(1);
    const p = s.members()[0];
    s.kill(p, 'accident');
    s.kill(p, 'accident');
    expect(s.stats.deaths).toBe(1);
    expect(s.events.filter((e) => e.kind === 'death').length).toBe(1);
  });

  it('marks violent ends as momentous, and an infant\'s death as less so', () => {
    const s = sim(1);
    const adults = s.members().filter((p) => s.age(p) >= 14);
    s.kill(adults[0], 'wolves');
    expect(s.events.at(-1)!.weight).toBe(4);
    expect(s.events.at(-1)!.text).toContain('was killed by wolves');
    s.kill(adults[1], 'killed', adults[2]);
    expect(adults[1].killer).toBe(adults[2].id);
    expect(s.events.at(-1)!.text).toContain(`was killed by ${adults[2].name}`);
    expect(s.events.at(-1)!.people).toContain(adults[2].id);
    const baby = s.members().find((p) => s.age(p) < 2)!;
    s.kill(baby, 'infancy');
    expect(s.events.at(-1)!.weight).toBe(2);
  });

  it('leaves a carried log on the ground and loses carried food to spoilage', () => {
    const s = sim(1);
    const [a, b] = couple(s);
    a.carry = CARRY.Log;
    a.carryAmt = 3;
    const props = s.propCount;
    s.kill(a, 'accident');
    expect(a.carry).toBe(CARRY.None);
    expect(s.propCount).toBe(props + 1);
    expect(s.propVal[props]).toBe(3);
    b.carry = CARRY.Meat;
    b.carryAmt = 4;
    const spoiled = s.camp.ledger?.total['spoiled.meat'] ?? 0;
    s.kill(b, 'accident');
    expect(b.carryAmt).toBe(0);
    expect(s.camp.ledger!.total['spoiled.meat'] - spoiled).toBe(4);
  });
});
