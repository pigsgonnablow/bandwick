// Grass bedding in the homes, hide cloaks against the cold, and roots dug in autumn for the winter stores.
import { describe, it, expect } from 'vitest';
import { TICKS_PER_DAY, TICKS_PER_SEASON, TICKS_PER_YEAR, seasonOf } from '../../src/sim/time';
import { BED_DAYS, CARRY, CLOAK_WARM } from '../../src/sim/band';
import { DISCOVERY } from '../../src/sim/know';
import { deposit, runTask } from '../../src/sim/ai';
import { sim, runTo } from '../helpers';

describe('grass bedding', () => {
  it('is laid in the homes from the band\'s fiber, makes for a deeper sleep, and goes flat', () => {
    const s = sim(1);
    s.camp.knows.push('bedding');
    s.camp.stock.fiber += 30;
    let laid = false;
    for (let d = 0; d < 30 && !laid; d++) {
      runTo(s, s.tick + TICKS_PER_DAY);
      laid = s.buildings.some((b) => (b.bedding ?? 0) > 0);
    }
    expect(laid).toBe(true);
    expect(s.camp.ledger?.total?.['bedding'] ?? 0).toBeGreaterThan(0);
    // only homes get it
    for (const b of s.buildings) if ((b.bedding ?? 0) > 0) expect(['hut', 'leanto']).toContain(b.kind);
    const b = s.buildings.find((q) => (q.bedding ?? 0) > 0)!;
    expect(b.bedding).toBeLessThanOrEqual(BED_DAYS);
    // a night on fresh grass rests someone more than one on the bare ground
    const sleeper = s.living().find((p) => s.age(p) >= 16)!;
    s.camp = s.campOf(sleeper);
    const run = (bedding: number) => {
      b.bedding = bedding;
      sleeper.rest = 40;
      sleeper.indoors = true;
      sleeper.task = { kind: 'sleep', stage: 1, goal: b.tile, gx: b.x + 0.5, gz: b.z + 0.5, ref: b.id, timer: 0, started: s.tick, amount: 0, near: false };
      for (let k = 0; k < 10; k++) runTask(s, sleeper);
      return sleeper.rest;
    };
    expect(run(BED_DAYS)).toBeGreaterThan(run(0));
  });

  it('goes a day staler every morning', () => {
    const s = sim(1);
    runTo(s, s.tick + TICKS_PER_DAY);
    const b = s.buildings.find((q) => q.kind === 'leanto' || q.kind === 'hut' || q.kind === 'hearth')!;
    b.bedding = 3;
    runTo(s, s.tick + TICKS_PER_DAY);
    expect(b.bedding).toBe(2);
  });
});

describe('hide cloaks', () => {
  it('keeps the hides of deer brought home once the band knows how to sew them', () => {
    const s = sim(1);
    const p = s.living().find((q) => s.age(q) >= 18)!;
    s.camp = s.campOf(p);
    const hunt = () => {
      p.task = { kind: 'hunt', stage: 1, goal: 0, gx: 0, gz: 0, ref: -1, timer: 0, started: s.tick, amount: 0, near: false };
      p.carry = CARRY.Meat;
      p.carryAmt = 8;
      deposit(s, p);
    };
    hunt();
    expect(s.camp.stock.hides).toBe(0);
    s.camp.knows.push('preserving', 'cloaks');
    hunt();
    expect(s.camp.stock.hides).toBe(1);
    // a hare from a snare is no deer
    p.task = { kind: 'trap', stage: 1, goal: 0, gx: 0, gz: 0, ref: -1, timer: 0, started: s.tick, amount: 0, near: false };
    p.carry = CARRY.Meat;
    p.carryAmt = 1;
    deposit(s, p);
    expect(s.camp.stock.hides).toBe(1);
  });

  it('are sewn from hides and worn, one each, the young and the old first', () => {
    const s = sim(2);
    // late summer, with the cold to come: when cloaks are wanted most
    runTo(s, s.tick + 1.6 * TICKS_PER_SEASON);
    s.camp.knows.push('preserving', 'cloaks');
    s.camp.stock.hides = 8;
    s.camp.stock.cordage += 6;
    for (let d = 0; d < 24 && s.living().filter((p) => p.worn?.body !== undefined).length < 4; d++) runTo(s, s.tick + TICKS_PER_DAY);
    const worn = s.living().filter((p) => p.worn?.body !== undefined);
    expect(worn.length).toBeGreaterThanOrEqual(3);
    // each wearer's cloak is theirs alone, and the item knows who wears it
    expect(new Set(worn.map((p) => p.worn!.body)).size).toBe(worn.length);
    for (const p of worn) expect(s.items.find((i) => i.id === p.worn!.body)?.wearer).toBe(p.id);
    // nobody under a year old got one; if any small child or elder went without, nobody else got one first
    for (const p of worn) expect(s.age(p)).toBeGreaterThanOrEqual(1);
    const frail = (a: number) => a < 3 || a > 60;
    if (s.living().some((p) => p.worn?.body === undefined && frail(s.age(p)) && s.age(p) >= 1)) for (const p of worn) expect(frail(s.age(p))).toBe(true);
    expect(s.camp.ledger?.total?.['made.cloak'] ?? 0).toBeGreaterThanOrEqual(worn.length);
  });

  it('keeps off some of the cold, and goes back to the pile when its wearer dies', () => {
    const s = sim(1);
    const p = s.living().find((q) => s.age(q) >= 18 && s.age(q) <= 50)!;
    s.camp = s.campOf(p);
    const needs = (q: typeof p) => (s as unknown as { needs(q: typeof p): void }).needs(q);
    // the dead of winter, away from the fire
    runTo(s, s.tick + 3 * TICKS_PER_SEASON + 2 * TICKS_PER_DAY);
    p.x = s.camp.x + 20;
    p.z = s.camp.z + 20;
    expect(s.tempAt(p)).toBeLessThan(10);
    // measured against nothing on their back (they may have made themselves something by now)
    if (p.worn) delete p.worn.body;
    const loss = () => { p.warmth = 80; p.indoors = false; needs(p); return 80 - p.warmth; };
    const bare = loss();
    s.items.push({ id: s.newId(), kind: 'cloak', band: p.band, holder: -1, wear: 0, made: s.tick, maker: -1, wearer: p.id });
    p.worn = { ...p.worn, body: s.items[s.items.length - 1].id };
    const cloaked = loss();
    expect(bare).toBeGreaterThan(0);
    expect(cloaked).toBeCloseTo(bare * (1 - CLOAK_WARM), 5);
    const it = s.items[s.items.length - 1];
    s.kill(p, 'test');
    runTo(s, s.tick + TICKS_PER_DAY);
    // back on the pile, and someone else may have it now
    expect(it.wearer === undefined || it.wearer !== p.id).toBe(true);
    expect(p.worn?.body).toBeUndefined();
  });
});

describe('roots', () => {
  it('are dug with a digging stick in autumn only, and keep well in the stores', () => {
    const s = sim(1);
    s.camp.knows.push('digstick', 'roots');
    s.giveTools(s.camp, { stick: 3 });
    const taskSeasons = new Set<number>();
    const end = s.tick + TICKS_PER_YEAR;
    while (s.tick < end) {
      s.step();
      if (s.tick % 20 === 0) for (const p of s.living()) if (p.task?.kind === 'roots' && p.task.stage >= 1) taskSeasons.add(seasonOf(p.task.started));
    }
    expect(s.camp.ledger?.total?.['gathered.roots'] ?? 0).toBeGreaterThan(10);
    expect([...taskSeasons]).toEqual([2]);
    // spoiling: a store of roots loses far less in a day than the same of berries
    const st = s.camp.stock;
    st.roots = 100;
    st.berries = 100;
    (s as unknown as { spoilNow(x: typeof st): void }).spoilNow(st);
    expect(100 - st.roots).toBeLessThan((100 - st.berries) / 3);
  });

  it('teach the digging stick to whoever finds them without one', () => {
    const s = sim(1);
    expect(s.camp.knows).not.toContain('digstick');
    const p = s.living().find((q) => s.age(q) >= 18)!;
    (s as unknown as { discover(c: unknown, d: unknown, p: unknown): void }).discover(s.camp, DISCOVERY.get('roots'), p);
    expect(s.camp.knows).toContain('roots');
    expect(s.camp.knows).toContain('digstick');
  });
});
