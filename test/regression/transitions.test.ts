// More of the issue #1 kind: goods that changed hands without being carried, or were counted twice.
// Each of these used to happen: a load in hand vanished when someone picked up a spear, wood or meat
// went back to the stores while the person still held it, fish set aside for the rack came back as
// meat, a great hunt's extra deer landed in the stores from far out on the land, and people leaving
// a band handed what they held to whichever camp the sim happened to be looking at.
import { describe, it, expect, beforeEach } from 'vitest';
import { Sim } from '../../src/sim/sim';
import type { Person, Task, Building } from '../../src/sim/band';
import { CARRY, foodTotal } from '../../src/sim/band';
import { abandon, decide, runTask } from '../../src/sim/ai';
import { sim, runTo } from '../helpers';
import { TICKS_PER_DAY, TICKS_PER_HOUR, START_TICK } from '../../src/sim/time';

let s: Sim;
let p: Person;

function task(kind: Task['kind'], more: Partial<Task> = {}): Task {
  return { kind, stage: 0, goal: s.storeSpot().tile, gx: 0, gz: 0, ref: -1, timer: 0, started: s.tick, amount: 0, near: false, ...more };
}

/** Everything a band owns in one number: its stores, plus what its people hold or have set aside. */
function holdings(campId: number) {
  const c = s.campById(campId)!;
  let n = foodTotal(c.stock) + c.stock.wood;
  for (const q of s.people) {
    if (!q.alive || q.band !== campId) continue;
    if (q.carry >= CARRY.Log && q.carry <= CARRY.Fish) n += q.carryAmt;
    const t = q.task;
    // supply, fuel and preserve take their goods out of the store when the job is set up
    if (t && (t.kind === 'supply' || t.kind === 'fuel' || t.kind === 'preserve') && !(q.carry >= CARRY.Log && q.carry <= CARRY.Fish)) n += t.amount;
  }
  return n;
}

beforeEach(() => {
  s = runTo(sim(1), START_TICK + 2 * TICKS_PER_DAY + 50);
  p = s.living().find((q) => s.age(q) >= 16)!;
  s.camp = s.campOf(p);
});

describe('picking up a spear', () => {
  it('puts down the load in hand first instead of losing it', () => {
    // beside the stores with berries and nothing else on: whatever comes next, the berries go in.
    // Try enough adults and hours that some of them choose to go hunting or fishing.
    const adults = s.living().filter((q) => s.age(q) >= 16 && s.age(q) < 50);
    const st = s.storeSpot();
    let spears = 0;
    for (let h = 0; h < 12; h++) {
      runTo(s, s.tick + TICKS_PER_HOUR);
      for (const q of adults) {
        if (!q.alive) continue;
        s.camp = s.campOf(q);
        abandon(s, q);
        q.x = st.x + 1;
        q.z = st.z;
        q.food = 90;
        q.rest = 90;
        q.warmth = 90;
        q.carry = CARRY.Berries;
        q.carryAmt = 4;
        const before = s.camp.stock.berries;
        decide(s, q);
        expect(s.camp.stock.berries, `${q.name} chose ${q.task?.kind}`).toBeCloseTo(before + 4);
        if (q.carry === CARRY.Spear) spears++;
      }
    }
    expect(spears).toBeGreaterThan(0);
  });
});

describe('a job whose place is gone', () => {
  it('a building finished before the wood arrives gets the logs back in the store once', () => {
    const site = s.buildings.find((b) => b.band === s.camp.id && b.kind === 'stockpile')!;
    const b = { ...site, id: 99999, kind: 'hut', built: true } as Building;
    s.buildings.push(b);
    const wood = s.camp.stock.wood;
    p.task = task('supply', { stage: 1, ref: b.id, amount: 5 });
    p.carry = CARRY.Log;
    p.carryAmt = 5;
    runTask(s, p);
    expect(s.camp.stock.wood).toBeCloseTo(wood + 5);
    expect(p.carry).toBe(CARRY.None);
    expect(p.carryAmt).toBe(0);
  });

  it('a rack taken down while meat is on the way gets the meat back in the store once', () => {
    const meat = s.camp.stock.meat;
    p.task = task('preserve', { stage: 1, ref: 99999, amount: 6, fish: 0 });
    p.carry = CARRY.Meat;
    p.carryAmt = 6;
    runTask(s, p);
    expect(s.camp.stock.meat).toBeCloseTo(meat + 6);
    expect(p.carry).toBe(CARRY.None);
  });
});

describe('preserving', () => {
  it('called off, gives back fish as fish and meat as meat', () => {
    const { fish, meat } = s.camp.stock;
    p.task = task('preserve', { stage: 2, amount: 6, fish: 4 });
    abandon(s, p);
    expect(s.camp.stock.fish).toBeCloseTo(fish + 4);
    expect(s.camp.stock.meat).toBeCloseTo(meat + 2);
  });
});

describe('a great hunt', () => {
  it('brings the extra deer home on the backs of hunters, not straight into the stores', () => {
    // a deer with two of its herd beside it, the hunter in range, and one more hunter close by
    const d = s.deer.find((d) => d.alive && s.deer.filter((q) => q !== d && q.alive && q.herd === d.herd && Math.hypot(q.x - d.x, q.z - d.z) < 4).length >= 2);
    if (!d) throw new Error('no herd close enough together');
    const others = s.deer.filter((q) => q !== d && q.alive && q.herd === d.herd && Math.hypot(q.x - d.x, q.z - d.z) < 4).slice(0, 2);
    const mate = s.living().find((q) => q !== p && q.band === p.band && s.age(q) >= 16)!;
    for (const q of [p, mate]) {
      abandon(s, q);
      q.x = d.x + 1;
      q.z = d.z;
      q.health = 100;
      q.carry = CARRY.Spear;
    }
    p.task = task('hunt', { ref: d.id, goal: s.tileOf(d), deadline: s.tick + 500 });
    mate.task = task('hunt', { ref: others[0].id, goal: s.tileOf(others[0]), deadline: s.tick + 500 });
    const meat = s.camp.stock.meat;
    // every roll comes up: the throw hits, and the herd is driven in
    s.rAi.next = () => 0.001;
    runTask(s, p);
    expect(d.alive).toBe(false);
    expect(others.every((q) => !q.alive)).toBe(true);
    expect(s.camp.stock.meat).toBe(meat);
    expect(p.carry).toBe(CARRY.Meat);
    expect(mate.carry).toBe(CARRY.Meat);
    expect(mate.carryAmt).toBe(others[0].fawn ? 4 : 8);
    expect(mate.task!.homeAt).toBe(s.tick);
  });
});

describe('leaving a band', () => {
  it('hands what they hold to their own band, whichever camp the sim is looking at', () => {
    const home = s.camp;
    const st = s.storeSpot();
    p.x = st.x + 1;
    p.z = st.z;
    p.carry = CARRY.Berries;
    p.carryAmt = 4;
    p.task = task('forage', { stage: 2, homeAt: s.tick });
    const berries = home.stock.berries;
    // a second band, far off; the sim's attention is on it when p goes to join it
    const other = s.foundCamp(home.tile + 30, { berries: 0, meat: 0, fish: 0, preserved: 0, wood: 0, fiber: 0, cordage: 0, mud: 0, stone: 0 }, -1, -1);
    s.camp = other;
    (s as any).join([p], other);
    expect(home.stock.berries).toBeCloseTo(berries + 4);
    expect(other.stock.berries).toBe(0);
  });

  it('a whole band moving camp packs up the wood and food set aside for jobs too', () => {
    const c = s.camp;
    // two jobs under way, with their goods out of the store
    for (const q of s.members(c)) {
      abandon(s, q);
      q.carry = CARRY.None;
      q.carryAmt = 0;
    }
    const [a, b] = s.members(c).filter((q) => s.age(q) >= 16);
    a.task = task('fuel', { amount: 4 });
    b.task = task('preserve', { amount: 6, fish: 0 });
    c.stock.wood = 16;
    c.stock.meat = 10;
    const owned = holdings(c.id);
    // force the move: no woods left, and every roll goes the band's way
    (s as any).treesNear = () => 0;
    (s as any).rLife.next = () => 0.001;
    expect((s as any).considerMove(c)).toBe(true);
    const nc = s.camps[s.camps.length - 1];
    expect(nc).not.toBe(c);
    // 80% of everything goes along ("not everything can be carried")
    expect(foodTotal(nc.stock) + nc.stock.wood).toBeCloseTo(owned * 0.8);
  });
});
