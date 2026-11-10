// Hunger with an empty store sends people out for food, the older children too; a store that won't last
// the winter is rationed; and the hungry and cold still keep the fire fed.
import { describe, it, expect } from 'vitest';
import { decide, runTask } from '../../src/sim/ai';
import { CARRY } from '../../src/sim/band';
import { seasonOf, hourOf, yearOf, isDark, daylight, TICKS_PER_DAY, TICKS_PER_HOUR, TICKS_PER_YEAR } from '../../src/sim/time';
import { sim, runTo } from '../helpers';

describe('hunger', () => {
  it('sends a starving child out to fish rather than play when the store is empty', () => {
    const s = sim(1);
    // winter: no berries to pick or eat
    while (seasonOf(s.tick) !== 3) runTo(s, s.tick + 200);
    // and broad daylight
    while (hourOf(s.tick) < 11 || hourOf(s.tick) > 13) runTo(s, s.tick + 5);
    const c = s.camp;
    const kid = s.members().find((p) => s.age(p) >= 11 && s.age(p) < 14) ?? s.members().find((p) => s.age(p) >= 14)!;
    for (const k of ['berries', 'meat', 'fish', 'preserved', 'roots', 'nuts', 'eggs', 'honey', 'mushrooms'] as const) c.stock[k] = 0;
    let food = 0, play = 0;
    for (let i = 0; i < 40; i++) {
      Object.assign(kid, { food: 12, health: 60, rest: 90, warmth: 90, belonging: 90, task: null, carry: 0 });
      decide(s, kid);
      if (kid.task?.kind === 'fish' || kid.task?.kind === 'hunt' || kid.task?.kind === 'forage') food++;
      if (kid.task?.kind === 'play' || kid.task?.kind === 'idle') play++;
    }
    expect(food).toBeGreaterThan(play);
  });

  it('rations a store that will not last the winter: small shares, a full one only for the very hungry', () => {
    const s = sim(1);
    while (seasonOf(s.tick) !== 3) runTo(s, s.tick + 200);
    const c = s.camp;
    for (const k of ['berries', 'meat', 'fish', 'preserved', 'roots', 'nuts', 'eggs', 'honey', 'mushrooms'] as const) c.stock[k] = 0;
    c.stock.preserved = 40;
    // the plan is made each morning
    runTo(s, s.tick + TICKS_PER_DAY);
    expect(c.rationing).toBe(true);
    expect(c.plan).toContain('Ration the stores until spring');
    const ate = (food: number) => {
      const p = s.members().find((q) => s.age(q) >= 18 && !s.has(q, 'greedy'))!;
      Object.assign(p, { food, task: null, x: c.x, z: c.z, path: null });
      p.task = { kind: 'eat', stage: 1, goal: s.tileOf(p), gx: p.x, gz: p.z, ref: -1, timer: 1, started: s.tick, amount: 0, near: true };
      for (const k of ['berries', 'meat', 'fish'] as const) c.stock[k] = 0;
      c.stock.preserved = 30;
      runTask(s, p);
      return 30 - c.stock.preserved;
    };
    expect(ate(50)).toBeCloseTo(0.5, 6);
    expect(ate(20)).toBeGreaterThan(1);
    // with plenty laid in, nobody goes short
    c.stock.preserved = 2000;
    runTo(s, s.tick + TICKS_PER_DAY);
    expect(c.rationing).toBe(false);
  });

  it('keeps feeding the fire however hungry and cold the one carrying the wood', () => {
    const s = sim(1);
    while (seasonOf(s.tick) !== 3) runTo(s, s.tick + 200);
    const c = s.camp;
    runTo(s, s.tick + TICKS_PER_DAY);
    for (const k of ['berries', 'meat', 'fish', 'preserved', 'roots', 'nuts', 'eggs', 'honey', 'mushrooms'] as const) c.stock[k] = 0;
    c.stock.wood = 20;
    const h = s.hearth();
    h.fuel = 0;
    const p = s.members().find((q) => s.age(q) >= 18)!;
    for (const q of s.members()) if (q !== p && s.age(q) >= 2) Object.assign(q, { task: null, nextThink: s.tick + 1000, x: c.x + 30, z: c.z + 30 });
    Object.assign(p, { food: 3, warmth: 12, health: 50, task: null, path: null });
    decide(s, p);
    // nothing to eat, a cold hearth, wood on the stack: they take it to the fire, and see it lit
    expect(p.task?.kind).toBe('fuel');
    for (let i = 0; i < TICKS_PER_HOUR * 6 && h.fuel <= 0; i++) {
      Object.assign(p, { food: 3, warmth: 12 });
      s.step();
    }
    expect(h.fuel).toBeGreaterThan(0);
  });

  it('counts the winters a band rations running, and a band that rations winter after winter moves', () => {
    const s = sim(1);
    const c = s.camp;
    // the year turns: a winter rationed through adds to the run, a winter with enough ends it
    const toNewYear = () => runTo(s, (Math.floor(s.tick / TICKS_PER_YEAR) + 1) * TICKS_PER_YEAR + 7 * TICKS_PER_HOUR);
    toNewYear();
    c.rationedIn = yearOf(s.tick);
    c.leanWinters = 1;
    toNewYear();
    expect(c.leanWinters).toBe(2);
    // a winter with plenty laid in
    c.stock.preserved = 5000;
    toNewYear();
    expect(c.leanWinters).toBe(0);
    // three lean winters running, settled long enough: in time they give up the camp for better land
    c.leanWinters = 3;
    c.settled = s.tick - 3 * TICKS_PER_YEAR;
    let moved = false;
    // (a band with gardens dug is slow to give them up: it can take many springs of asking)
    for (let i = 0; i < 150 && !moved; i++) moved = (s as any).considerMove(c);
    expect(moved).toBe(true);
    expect(s.events.at(-1)!.text).toContain(`The people of ${c.name} gave up their camp after hard years.`);
  });

  it('brings a half-gathered load home when nightfall, hunger or a change of mind calls them away', () => {
    const s = sim(1);
    const c = s.camp;
    // an autumn evening, just dark
    while (seasonOf(s.tick) !== 2) runTo(s, s.tick + 200);
    while (!isDark(s.tick) || hourOf(s.tick) < 12) runTo(s, s.tick + 1);
    if (!c.knows.includes('roots')) c.knows.push('roots');
    const p = s.members().find((q) => s.age(q) >= 18)!;
    // out digging roots, a few clumps into the round, the next clump still to reach
    const out = (food: number) => {
      Object.assign(p, { food, rest: 80, warmth: 90, health: 90, x: c.x + 9, z: c.z + 3, path: null, carry: CARRY.Roots, carryAmt: 4 });
      p.task = { kind: 'roots', stage: 0, goal: s.tileOf({ x: c.x + 10, z: c.z + 3 }), gx: c.x + 10, gz: c.z + 3, ref: -1, timer: 0, started: s.tick, amount: 0, near: false };
    };
    for (const food of [70, 12]) {
      out(food);
      expect((s as any).urgent(p)).toBe(true);
      decide(s, p);
      // they turn for home with the roots, rather than dropping them where they stand
      expect(p.task?.kind).toBe('roots');
      expect(p.task?.homeAt).toBe(s.tick);
      expect(p.carryAmt).toBe(4);
      // and on the way home, hungry or cold, they see it through (a starving one eats from the load)
      Object.assign(p, { warmth: 14 });
      expect((s as any).urgent(p)).toBe(false);
    }
    const before = c.stock.roots;
    for (let i = 0; i < 200 && p.task?.kind === 'roots'; i++) {
      runTask(s, p);
      if (p.task?.kind === 'roots' && i % 10 === 0) expect((s as any).urgent(p)).toBe(false);
    }
    expect(p.task).toBe(null);
    expect(c.stock.roots - before).toBeGreaterThanOrEqual(3);
  });

  it('sets out after deer only when there is daylight left to reach them', () => {
    const s = sim(1);
    const c = s.camp;
    while (seasonOf(s.tick) !== 1) runTo(s, s.tick + 200);
    const hunter = s.members().find((q) => s.age(q) >= 18 && s.age(q) < 50)!;
    // a hungry band, and the deer a long morning's walk off
    const tries = (hour: number) => {
      runTo(s, Math.floor(s.tick / TICKS_PER_DAY) * TICKS_PER_DAY + TICKS_PER_DAY + hour * TICKS_PER_HOUR);
      for (const k of ['berries', 'meat', 'fish', 'preserved', 'roots', 'nuts', 'eggs', 'honey', 'mushrooms'] as const) c.stock[k] = 0;
      s.plan();
      for (const d of s.deer) if (d.alive) Object.assign(d, { x: c.x + 30, z: c.z + 1 });
      let hunts = 0;
      for (let i = 0; i < 40; i++) {
        Object.assign(hunter, { food: 80, rest: 90, warmth: 90, health: 100, sick: 0, belonging: 90, x: c.x, z: c.z, task: null, carry: 0 });
        decide(s, hunter);
        if (hunter.task?.kind === 'hunt') hunts++;
      }
      return hunts;
    };
    expect(tries(7)).toBeGreaterThan(0);
    // late in the afternoon it would be dark long before they got there: the hunt waits for morning
    expect(tries(daylight(s.tick).sunset - 1.5)).toBe(0);
  });
});
