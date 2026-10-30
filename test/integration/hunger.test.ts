// Hunger with an empty store sends people out for food, the older children too; a store that won't last
// the winter is rationed; and the hungry and cold still keep the fire fed.
import { describe, it, expect } from 'vitest';
import { decide, runTask } from '../../src/sim/ai';
import { seasonOf, hourOf, TICKS_PER_DAY, TICKS_PER_HOUR } from '../../src/sim/time';
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
    for (const k of ['berries', 'meat', 'fish', 'preserved'] as const) c.stock[k] = 0;
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
    for (const k of ['berries', 'meat', 'fish', 'preserved'] as const) c.stock[k] = 0;
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
    for (const k of ['berries', 'meat', 'fish', 'preserved'] as const) c.stock[k] = 0;
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
});
