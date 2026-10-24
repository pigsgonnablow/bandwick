// Issue #1: carriers used to give up on the walk home and their goods reached the stores anyway,
// from anywhere on the map. Now they see the delivery through, and goods dropped on the way
// only count if they are dropped beside the stores.
import { describe, it, expect, beforeEach } from 'vitest';
import { Sim } from '../../src/sim/sim';
import type { Person, Task } from '../../src/sim/band';
import { CARRY } from '../../src/sim/band';
import { abandon, delivering, runTask } from '../../src/sim/ai';
import { sim, runTo } from '../helpers';
import { TICKS_PER_DAY, START_TICK } from '../../src/sim/time';

let s: Sim;
let p: Person;

/** Put p down on a walkable tile at least `min` (and under `max`) tiles from the stores. */
function placeAway(min: number, max: number, wood = false) {
  const st = s.storeSpot(wood);
  const N = s.N;
  for (let r = min; r < max; r++)
    for (let dz = -r; dz <= r; dz++)
      for (let dx = -r; dx <= r; dx++) {
        const x = Math.floor(st.x) + dx, z = Math.floor(st.z) + dz;
        if (x < 0 || z < 0 || x >= N || z >= N || !s.grid.walkable(z * N + x)) continue;
        const d = Math.hypot(x + 0.5 - st.x, z + 0.5 - st.z);
        if (d < min || d >= max) continue;
        p.x = x + 0.5;
        p.z = z + 0.5;
        return;
      }
  throw new Error(`no walkable tile ${min}..${max} from the stores`);
}

function carrying(kind: number, amount: number, task: Partial<Task> | null = null) {
  p.carry = kind;
  p.carryAmt = amount;
  p.task = task && { kind: 'forage', stage: 2, goal: s.storeSpot().tile, gx: 0, gz: 0, ref: -1, timer: 0, started: s.tick, amount: 0, near: false, ...task };
}

const spoiled = (k: string) => s.camp.ledger?.now[`spoiled.${k}`] ?? 0;

beforeEach(() => {
  // a couple of days in, so the camp is set up and everyone is busy
  s = runTo(sim(1), START_TICK + 2 * TICKS_PER_DAY + 50);
  p = s.living().find((q) => s.age(q) >= 16)!;
  s.camp = s.campOf(p);
});

describe('dropping a load', () => {
  it('far from the stores, food is lost rather than teleported home', () => {
    placeAway(10, 30);
    const before = { ...s.camp.stock }, wasted = spoiled('meat');
    carrying(CARRY.Meat, 5);
    abandon(s, p);
    expect(s.camp.stock.meat).toBe(before.meat);
    expect(spoiled('meat')).toBeCloseTo(wasted + 5);
    expect(p.carry).toBe(CARRY.None);
  });

  it('far from the stores, logs are left in a pile for someone to haul', () => {
    placeAway(10, 30, true);
    const wood = s.camp.stock.wood, props = s.propCount;
    carrying(CARRY.Log, 3);
    abandon(s, p);
    expect(s.camp.stock.wood).toBe(wood);
    expect(s.propCount).toBe(props + 1);
    expect(s.propVal[props]).toBe(3);
  });

  it('beside the stores, the load goes in', () => {
    const st = s.storeSpot();
    p.x = st.x + 1;
    p.z = st.z;
    const berries = s.camp.stock.berries;
    carrying(CARRY.Berries, 4);
    abandon(s, p);
    expect(s.camp.stock.berries).toBeCloseTo(berries + 4);
  });
});

describe('the walk home', () => {
  it('counts as delivering only with goods in hand on the way to the stores', () => {
    carrying(CARRY.Berries, 2, { homeAt: s.tick });
    expect(delivering(p)).toBe(true);
    carrying(CARRY.None, 0, { homeAt: s.tick });
    expect(delivering(p)).toBe(false);
    carrying(CARRY.Berries, 2, { homeAt: undefined });
    expect(delivering(p)).toBe(false);
  });

  it('is not cut short by the general task time limit', () => {
    placeAway(10, 30);
    carrying(CARRY.Berries, 3, { started: s.tick - 800, homeAt: s.tick - 100 });
    runTask(s, p);
    expect(p.task).not.toBeNull();
    expect(p.carry).toBe(CARRY.Berries);
  });

  it('has its own limit, after which the load is dropped', () => {
    placeAway(10, 30);
    carrying(CARRY.Berries, 3, { started: s.tick - 2000, homeAt: s.tick - 1300 });
    runTask(s, p);
    expect(p.task).toBeNull();
    expect(p.carry).toBe(CARRY.None);
  });

  it('lets a starving carrier eat from the load instead of dropping it', () => {
    placeAway(10, 30);
    carrying(CARRY.Meat, 3, { kind: 'hunt', homeAt: s.tick - 10 });
    p.food = 10;
    runTask(s, p);
    expect(p.carryAmt).toBe(2);
    expect(p.food).toBeGreaterThan(10);
  });
});
