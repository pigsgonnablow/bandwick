// The longhouse: a long hall of posts and wattle under one thatched roof, a fire down the middle and a high seat at
// its head for the band's leader. The band feasts in it on the longest night, the tales are told in it on cold
// evenings, and everyone who gathers in it with the one in the high seat thinks the better of them.
import { describe, it, expect } from 'vitest';
import { SK, Person, Building, BUILD, HALL_WOOD, HALL_BELONG, HALL_FEAST, HALL_REGARD } from '../../src/sim/band';
import { DISCOVERY, knowHowFor } from '../../src/sim/know';
import { TICKS_PER_DAY, TICKS_PER_HOUR, dayOf, hourOf } from '../../src/sim/time';
import { setup, runTask, hallDoor } from '../../src/sim/ai';
import { seatHolder, HALL_EASE } from '../../src/sim/rule';
import { Sim } from '../../src/sim/sim';
import { sim, runTo, runYears } from '../helpers';

/** A band a few years on, fed and with wood put by, knowing huts and the storehouse. */
function band(seed = 2) {
  const s = runYears(sim(seed), 2);
  const c = s.camp;
  for (const k of ['huts', 'storehouse']) if (!c.knows.includes(k)) c.knows.push(k);
  c.stock.wood += 80;
  c.stock.grain += 2000;
  c.stock.preserved += 500;
  return s;
}
/** The same band with a longhouse standing by its fire. */
function withHall(s: Sim) {
  if (!s.camp.knows.includes('longhouse')) s.camp.knows.push('longhouse');
  const pile = s.buildings.find((b) => b.band === s.camp.id && b.kind === 'stockpile')!;
  const hall: Building = { ...pile, id: s.newId(), kind: 'longhouse', built: true, x: pile.x + 3, tile: pile.tile + 3, builders: [] };
  delete hall.lit;
  s.buildings.push(hall);
  return hall;
}
const adults = (s: Sim) => s.members().filter((q) => s.age(q) >= 18 && s.age(q) <= 50);
/** On to the evening (5 pm) of the day. */
function toEvening(s: Sim) {
  while (hourOf(s.tick) < 17 || hourOf(s.tick) >= 17.5) s.tick++;
}
/** Walk someone through a task from start to finish, noting whether they went indoors. */
function through(s: Sim, p: Person, kind: 'feast' | 'tell' | 'listen', others: Person[] = []) {
  p.task = setup(s, p, kind);
  expect(p.task).not.toBeNull();
  let inside = false;
  for (let k = 0; k < 3000 && p.task?.kind === kind; k++) {
    runTask(s, p);
    for (const q of others) if (q.task) runTask(s, q);
    if (p.indoors) inside = true;
    s.tick++;
  }
  return inside;
}

describe('longhouse', () => {
  it('is thought of by a master builder who can fell trees, once the band has huts and a storehouse', () => {
    const d = DISCOVERY.get('longhouse')!;
    expect(d.needs).toEqual(['huts', 'storehouse']);
    expect(d.requires).toEqual([{ kind: 'skill', skill: SK.build, level: 15 }, { kind: 'skill', skill: SK.wood, level: 12 }]);
    expect(d.practice.build_poles).toBe(1);
    expect(knowHowFor({ kind: 'longhouse' })).toEqual(['longhouse']);
    // (a bigger job than a hut)
    expect(BUILD.longhouse.wood).toBeGreaterThan(BUILD.hut.wood);
    expect(BUILD.longhouse.work).toBeGreaterThan(BUILD.hut.work);
  });

  it('is planned once the band knows it, and only one', () => {
    const s = band();
    runTo(s, s.tick + 2 * TICKS_PER_DAY);
    expect(s.buildings.some((b) => b.band === s.camp.id && b.kind === 'longhouse')).toBe(false);
    s.camp.knows.push('longhouse');
    runTo(s, s.tick + 4 * TICKS_PER_DAY);
    expect(s.buildings.filter((b) => b.band === s.camp.id && b.kind === 'longhouse').length).toBe(1);
    expect(s.camp.plan.some((l) => /longhouse/.test(l)) || s.buildings.some((b) => b.kind === 'longhouse')).toBe(true);
  });

  it('gives its high seat to the ruler, or else to whoever led the band to its camp', () => {
    const s = band();
    const c = s.camp;
    const [a, b] = adults(s);
    c.leader = a.id;
    expect(seatHolder(s, c)).toBe(a);
    c.rule = { kind: 'builder', ruler: b.id, since: s.tick };
    expect(seatHolder(s, c)).toBe(b);
    delete c.rule;
    a.alive = false;
    expect(seatHolder(s, c)).toBeNull();
    a.alive = true;
  });

  it('is where the band feasts on the longest night, and the one in the high seat is thought the better of for it', () => {
    const s = band();
    const c = s.camp;
    const hall = withHall(s);
    const [holder, p] = adults(s);
    c.leader = holder.id;
    toEvening(s);
    c.feastDay = dayOf(s.tick);
    const wood = c.stock.wood;
    // the one in the high seat goes in first, lights the fire, and feasts
    const t = setup(s, holder, 'feast')!;
    const d = hallDoor(hall);
    expect(Math.hypot(t.gx - d.x, t.gz - d.z)).toBeLessThan(1e-6);
    holder.task = null;
    expect(through(s, holder, 'feast')).toBe(true);
    expect(c.stock.wood).toBeLessThanOrEqual(wood - HALL_WOOD + 1e-6);
    expect(holder.memories.some((m) => m.kind === 'highseat')).toBe(true);
    expect(holder.indoors).toBe(false);
    // and the next who feasts there thinks the better of them, and feels the more a part of the band
    const before = s.opinion(p, holder);
    p.belonging = 0;
    expect(through(s, p, 'feast')).toBe(true);
    expect(s.opinion(p, holder)).toBeCloseTo(before + HALL_REGARD, 5);
    expect(p.belonging).toBeGreaterThanOrEqual(30 + HALL_FEAST);
    expect(p.memories.some((m) => m.kind === 'midwinter' && /longhouse/.test(m.text))).toBe(true);
    expect(c.ledger?.total?.['hall.feast']).toBe(2);
  });

  it('eases the band\'s chafing under a ruler who feasts it from the high seat', () => {
    const s = band();
    const c = s.camp;
    withHall(s);
    const [ruler] = adults(s);
    c.rule = { kind: 'builder', ruler: ruler.id, since: s.tick, strain: 20 };
    toEvening(s);
    c.feastDay = dayOf(s.tick);
    through(s, ruler, 'feast');
    expect(c.rule!.strain).toBeCloseTo(20 * HALL_EASE, 5);
  });

  it('feasts out at the fire after all when there is no wood to light it', () => {
    const s = band();
    const c = s.camp;
    withHall(s);
    const p = adults(s)[0];
    toEvening(s);
    c.feastDay = dayOf(s.tick);
    c.stock.wood = 0;
    expect(through(s, p, 'feast')).toBe(false);
    expect(p.memories.some((m) => m.kind === 'midwinter' && /by the fire/.test(m.text))).toBe(true);
  });

  it('is where the tales are told on a cold evening, warming those who listen', () => {
    const s = band();
    const c = s.camp;
    const hall = withHall(s);
    const [teller, q] = adults(s);
    toEvening(s);
    s.anomaly = -40;
    expect(s.hallWeather(c)).toBe(true);
    teller.task = setup(s, teller, 'tell');
    expect(teller.task!.ref).toBe(hall.id);
    q.task = setup(s, q, 'listen');
    const d = hallDoor(hall);
    expect(Math.hypot(q.task!.gx - d.x, q.task!.gz - d.z)).toBeLessThan(1e-6);
    q.warmth = 20;
    q.belonging = 0;
    q.memories = q.memories.filter((m) => m.kind !== 'story');
    let inside = false, warmest = 0;
    for (let k = 0; k < 2000 && teller.task?.kind === 'tell'; k++) {
      runTask(s, teller);
      if (q.task) runTask(s, q);
      if (q.indoors) {
        inside = true;
        warmest = Math.max(warmest, q.warmth);
      }
      s.tick++;
    }
    expect(inside).toBe(true);
    expect(s.hallLit(hall) || (hall.lit ?? 0) > 0).toBe(true);
    expect(warmest).toBeGreaterThan(40);
    expect(q.indoors).toBe(false);
    expect(q.belonging).toBeGreaterThanOrEqual(18 + HALL_BELONG - 1);
    expect(c.ledger?.total?.['hall.tale']).toBe(1);
    expect(q.memories.some((m) => m.kind === 'story' && /longhouse/.test(m.text))).toBe(true);
  });

  it('leaves the tales out at the fire on a mild evening', () => {
    const s = band();
    const c = s.camp;
    withHall(s);
    const teller = adults(s)[0];
    toEvening(s);
    s.anomaly = 40;
    expect(s.hallWeather(c)).toBe(false);
    teller.task = setup(s, teller, 'tell');
    expect(teller.task!.ref).toBe(-1);
  });

  it('is where the band gathers through a winter', () => {
    const s = band(1);
    const c = s.camp;
    const hall = withHall(s);
    // on through the longest night and the cold evenings after it
    const end = s.tick + 360 * TICKS_PER_DAY;
    let lit = 0;
    while (s.tick < end && !(c.ledger?.total?.['hall.feast'] && (c.ledger?.total?.['hall.tale'] ?? 0) > 3)) {
      s.step();
      if (s.tick % TICKS_PER_HOUR === 0 && s.hallLit(hall)) lit++;
      // (nobody indoors there except at a feast or a tale)
      for (const q of s.members()) if (q.indoors && q.task && q.home < 0) expect(s.inHall(q) || q.task.kind === 'sweat').toBe(true);
    }
    expect(c.ledger?.total?.['hall.feast'] ?? 0).toBeGreaterThan(0);
    expect(c.ledger?.total?.['hall.tale'] ?? 0).toBeGreaterThan(3);
    expect(lit).toBeGreaterThan(0);
  });
});
