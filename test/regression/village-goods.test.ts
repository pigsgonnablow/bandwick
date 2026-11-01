// Village goods change hands only by being carried, and are never counted twice: a necklace or a
// nursing called off gives back what it took, once; acorns and roots dropped beside the stores go in
// and far out are lost; a band's feast or cooked meal never takes more than its stores hold.
import { describe, it, expect, beforeEach } from 'vitest';
import { Sim } from '../../src/sim/sim';
import type { Person, Task } from '../../src/sim/band';
import { CARRY, foodTotal } from '../../src/sim/band';
import { abandon, delivering, runTask } from '../../src/sim/ai';
import { sim, runTo } from '../helpers';
import { TICKS_PER_DAY, START_TICK, dayOf } from '../../src/sim/time';

let s: Sim;
let p: Person;

function task(kind: Task['kind'], more: Partial<Task> = {}): Task {
  return { kind, stage: 0, goal: s.tileOf(p), gx: p.x, gz: p.z, ref: -1, timer: 0, started: s.tick, amount: 0, near: false, ...more };
}
function placeAway(min: number) {
  const st = s.storeSpot();
  const N = s.N;
  for (let r = min; r < min + 20; r++)
    for (let dz = -r; dz <= r; dz++)
      for (let dx = -r; dx <= r; dx++) {
        const x = Math.floor(st.x) + dx, z = Math.floor(st.z) + dz;
        if (x < 0 || z < 0 || x >= N || z >= N || !s.grid.walkable(z * N + x)) continue;
        if (Math.hypot(x + 0.5 - st.x, z + 0.5 - st.z) < min) continue;
        p.x = x + 0.5;
        p.z = z + 0.5;
        return;
      }
  throw new Error('nowhere to stand');
}

beforeEach(() => {
  s = runTo(sim(1), START_TICK + 2 * TICKS_PER_DAY + 50);
  p = s.living().find((q) => s.age(q) >= 16)!;
  s.camp = s.campOf(p);
});

describe('a necklace called off', () => {
  it('puts back its tooth and fiber once, however often it is called off', () => {
    const q = s.living().find((o) => o !== p && o.band === p.band && s.age(o) >= 5)!;
    const st = s.camp.stock;
    st.trinkets = 2;
    st.fiber = 5;
    p.task = task('gift', { ref: q.id, amount: 1 });
    st.trinkets -= 1;
    st.fiber -= 1;
    abandon(s, p);
    expect(st.trinkets).toBe(2);
    expect(st.fiber).toBe(5);
    abandon(s, p);
    expect(st.trinkets).toBe(2);
    expect(st.fiber).toBe(5);
  });

  it('once given, is not given back', () => {
    const q = s.living().find((o) => o !== p && o.band === p.band && s.age(o) >= 5)!;
    q.x = p.x + 0.5;
    q.z = p.z;
    q.task = { ...task('idle'), stage: 1, timer: 9999 };
    const st = s.camp.stock;
    st.trinkets = 0;
    st.fiber = 0;
    p.task = task('gift', { ref: q.id, amount: 1, stage: 3, timer: 1 });
    runTask(s, p);
    expect(q.necklace).toBe(p.id);
    expect(p.task).toBeNull();
    abandon(s, p);
    expect(st.trinkets).toBe(0);
    expect(st.fiber).toBe(0);
  });
});

describe('nursing called off', () => {
  it('puts the herbs back once', () => {
    const q = s.living().find((o) => o !== p && o.band === p.band)!;
    q.sick = 4;
    s.camp.stock.herbs = 0;
    p.task = task('nurse', { ref: q.id, amount: 1 });
    abandon(s, p);
    abandon(s, p);
    expect(s.camp.stock.herbs).toBe(1);
  });
});

describe('acorns, roots and herbs in hand', () => {
  for (const [carry, k] of [[CARRY.Nuts, 'nuts'], [CARRY.Roots, 'roots'], [CARRY.Herbs, 'herbs']] as const) {
    it(`(${k}) go into the stores when put down beside them`, () => {
      const st = s.storeSpot();
      p.x = st.x;
      p.z = st.z;
      p.carry = carry;
      p.carryAmt = 4;
      p.task = task(k as Task['kind'], { stage: 2, homeAt: s.tick });
      const before = s.camp.stock[k];
      abandon(s, p);
      expect(s.camp.stock[k]).toBeCloseTo(before + 4, 6);
      expect(p.carry).toBe(CARRY.None);
    });

    it(`(${k}) are lost to the land when put down far out, and counted as lost`, () => {
      placeAway(12);
      p.carry = carry;
      p.carryAmt = 4;
      p.task = task(k as Task['kind'], { stage: 2, homeAt: s.tick });
      expect(delivering(p)).toBe(true);
      const before = s.camp.stock[k];
      const lost = s.camp.ledger?.now[`spoiled.${k}`] ?? 0;
      abandon(s, p);
      expect(s.camp.stock[k]).toBe(before);
      expect(p.carry).toBe(CARRY.None);
      expect(s.camp.ledger?.now[`spoiled.${k}`] ?? 0).toBeCloseTo(lost + 4, 6);
    });
  }

  it('feed a starving carrier on the way home (acorns), rather than being dropped', () => {
    placeAway(8);
    p.carry = CARRY.Nuts;
    p.carryAmt = 5;
    p.food = 10;
    p.task = task('nuts', { stage: 2, homeAt: s.tick, goal: s.storeSpot().tile, gx: s.storeSpot().x, gz: s.storeSpot().z });
    runTask(s, p);
    expect(p.carryAmt).toBe(4);
    expect(p.food).toBeGreaterThan(50);
  });
});

describe('a meal', () => {
  it('never takes more than the stores hold, cooked or not, and leaves nothing below nothing', () => {
    const c = s.camp;
    c.knows.push('cooking');
    s.hearth().fuel = 30;
    for (const k of ['berries', 'fish', 'meat', 'roots', 'nuts', 'preserved'] as const) c.stock[k] = 0;
    c.stock.nuts = 0.3;
    c.stock.roots = 0.2;
    p.food = 5;
    p.x = c.x + 1;
    p.z = c.z;
    p.task = task('eat');
    for (let i = 0; i < 60 && p.task; i++) { runTask(s, p); s.tick++; }
    expect(foodTotal(c.stock)).toBeGreaterThanOrEqual(0);
    for (const k of ['nuts', 'roots'] as const) expect(c.stock[k]).toBeGreaterThanOrEqual(0);
    expect(foodTotal(c.stock)).toBeCloseTo(0, 6);
    // and what was eaten is what the ledger says
    expect((c.ledger?.now['eaten.nuts'] ?? 0) + (c.ledger?.now['eaten.roots'] ?? 0)).toBeCloseTo(0.5, 6);
  });
});

describe('the feast', () => {
  it('eats only what is in the stores, however many come', () => {
    const c = s.camp;
    c.feastDay = dayOf(s.tick);
    for (const k of ['berries', 'fish', 'meat', 'roots', 'nuts', 'preserved'] as const) c.stock[k] = 0;
    c.stock.meat = 2;
    const guests = s.members(c).filter((q) => s.age(q) >= 12).slice(0, 4);
    for (const q of guests) {
      q.x = c.x + 1.2;
      q.z = c.z;
      q.task = { kind: 'feast', stage: 1, goal: s.tileOf(q), gx: q.x, gz: q.z, ref: -1, timer: 1, started: s.tick, amount: 0, near: false };
      runTask(s, q);
    }
    expect(c.stock.meat).toBeGreaterThanOrEqual(0);
    expect(c.stock.meat).toBeCloseTo(0, 6);
    expect(c.ledger?.now['eaten.meat'] ?? 0).toBeCloseTo(2, 6);
  });

  it('is not held, nor called to, by a band that is not feasting today', () => {
    const c = s.camp;
    c.feastDay = dayOf(s.tick) - 48;
    runTo(s, s.tick + TICKS_PER_DAY);
    for (const q of s.living()) expect(q.task?.kind).not.toBe('feast');
  });
});
