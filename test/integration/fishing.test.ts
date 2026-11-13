// Fishing gear: a barbed harpoon (fewer fish lost off the point), a hook and line (patient, small catches, the one
// way to fish through the ice, and gentle enough for the children and the old) and a net hauled by two or three
// together. Each is a discovery, made at the fire, taken from the pile to the water and worn out with use.
import { describe, it, expect } from 'vitest';
import { SK, ACT, CARRY, Task, Person, ITEMS, NET_CREW, NET_HAND, LINE_AGE } from '../../src/sim/band';
import { DISCOVERY, meets } from '../../src/sim/know';
import { TICKS_PER_DAY, freshFrozen } from '../../src/sim/time';
import { WATER } from '../../src/sim/types';
import { runTask, setup } from '../../src/sim/ai';
import { Sim } from '../../src/sim/sim';
import { sim, runTo } from '../helpers';

const adults = (s: Sim) => s.members().filter((q) => s.age(q) >= 18 && s.age(q) <= 50 && q.alive);
/** A bank to fish from near camp, by fresh water (frozen or not) with fish in it, and the water. */
function bank(s: Sim, fresh = true) {
  const N = s.N;
  for (const spot of s.fishingSpots) {
    const x = (spot % N) + 0.5, z = Math.floor(spot / N) + 0.5;
    if (Math.hypot(x - s.camp.x, z - s.camp.z) > 28) continue;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const w = (Math.floor(spot / N) + dz) * N + (spot % N) + dx;
      if (s.fishCap[w] > 0 && (s.world.water[w] !== WATER.Sea) === fresh) return { spot, w };
    }
  }
  return null;
}
/** Someone standing on the bank with nothing in hand, fishing there. */
function atWater(s: Sim, p: Person, spot: number, w: number, extra: Partial<Task> = {}) {
  p.x = (spot % s.N) + 0.5;
  p.z = Math.floor(spot / s.N) + 0.5;
  p.path = null;
  p.carry = CARRY.None;
  p.carryAmt = 0;
  p.task = { kind: 'fish', stage: 0, goal: spot, gx: p.x, gz: p.z, ref: w, timer: 0, started: s.tick, amount: 0, near: false, bank: spot, ...extra };
}
/** Hand someone a new piece of the band's gear. */
function hand(s: Sim, p: Person, kind: 'harpoon' | 'line' | 'net') {
  s.giveTools(s.camp, { [kind]: 1 });
  const it = s.toolsOf(s.camp, kind).find((i) => i.holder < 0)!;
  s.takeTool(p, it);
  return it;
}
function step(s: Sim, ps: Person[], n: number) {
  for (let i = 0; i < n; i++) {
    for (const p of ps) if (p.task) runTask(s, p);
    s.tick++;
  }
}

describe('the fishing gear discoveries', () => {
  it('come to fishers who can work bone and wood, and weave', () => {
    const s = sim(2);
    const p = adults(s)[0];
    p.skills.fill(0);
    p.skills[SK.fish] = 10;
    p.skills[SK.tool] = 8;
    expect(meets(p, DISCOVERY.get('harpoon')!)).toBeGreaterThanOrEqual(0);
    expect(meets(p, DISCOVERY.get('hooks')!)).toBeGreaterThanOrEqual(0);
    expect(meets(p, DISCOVERY.get('nets')!)).toBe(-1);
    p.skills[SK.fish] = 12;
    p.skills[SK.weave] = 12;
    expect(meets(p, DISCOVERY.get('nets')!)).toBeGreaterThanOrEqual(0);
    // (a net is a trap drawn through the water: it comes after the woven fish trap)
    expect(DISCOVERY.get('nets')!.needs).toEqual(['fishtraps']);
    expect(DISCOVERY.get('harpoon')!.practice.fish_miss).toBeGreaterThan(0);
    expect(DISCOVERY.get('hooks')!.practice.ice).toBeGreaterThan(0);
  });

  it('are made at the fire once known: harpoons from antler and bone, a hook and line, a net', () => {
    const s = sim(2);
    const c = s.camp;
    s.giveTools(c, { axe: 4, chopper: 2 });
    expect(s.toolToMake()).toBeNull();
    c.knows.push('harpoon');
    Object.assign(c.stock, { bones: 0, cordage: 10, sinew: 0, wood: 200, stone: 10 });
    // (no antler or bone, no harpoon)
    expect(s.toolToMake()).toBeNull();
    c.stock.bones = 4;
    expect(s.toolToMake()).toBe('harpoon');
    s.giveTools(c, { harpoon: 3 });
    c.knows.push('hooks', 'fishtraps', 'nets');
    expect(s.toolToMake()).toBe('line');
    s.giveTools(c, { line: 4 });
    expect(s.toolToMake()).toBe('net');
    expect(s.canCraft('net')).toBe(true);
    // (and sinew from the butchering stands in for cord on the harpoon's lashing and the line)
    Object.assign(c.stock, { cordage: 0, sinew: 2 });
    expect(s.canCraft('harpoon')).toBe(true);
    expect(s.canCraft('line')).toBe(true);
    expect(s.canCraft('net')).toBe(false);
  });
});

describe('fishing gear and the water', () => {
  it('is made only by a band with fishing water within a walk of camp', () => {
    const s = sim(2);
    const c = s.camp;
    s.giveTools(c, { axe: 4, chopper: 2 });
    c.knows.push('hooks');
    Object.assign(c.stock, { cordage: 10, wood: 200 });
    expect(s.toolToMake()).toBe('line');
    s.fishingSpots = [];
    expect(s.toolToMake()).toBeNull();
  });

  it('sends a child fishing only with a hook and line', () => {
    const s = sim(2);
    while (freshFrozen(s.tick)) s.tick += TICKS_PER_DAY;
    const kid = s.members().find((q) => s.age(q) >= LINE_AGE && s.age(q) < 11);
    if (!kid) return;
    expect(setup(s, kid, 'fish')).toBeNull();
    s.giveTools(s.camp, { line: 1 });
    expect(setup(s, kid, 'fish')).not.toBeNull();
    expect(s.heldBy(kid)?.kind).toBe('line');
  });
});

describe('fishing with gear', () => {
  it('takes the gear from the pile to the water: a net for a grown-up, a line for a child', () => {
    const s = sim(2);
    runTo(s, s.tick + 4 * TICKS_PER_DAY);
    while (freshFrozen(s.tick)) runTo(s, s.tick + TICKS_PER_DAY);
    s.giveTools(s.camp, { net: 1, harpoon: 1, line: 1 });
    const p = adults(s)[0];
    const t = setup(s, p, 'fish')!;
    expect(t).not.toBeNull();
    expect(s.heldBy(p)?.kind).toBe('net');
    expect(t.bank).toBeGreaterThanOrEqual(0);
    const kid = s.members().find((q) => s.age(q) >= LINE_AGE && s.age(q) < 13);
    if (kid) {
      setup(s, kid, 'fish');
      expect(s.heldBy(kid)?.kind).toBe('line');
    }
  });

  it('fishes the frozen lakes and rivers only with a hook and line', () => {
    const s = sim(2);
    const at = bank(s);
    expect(at).not.toBeNull();
    while (!freshFrozen(s.tick)) s.tick += TICKS_PER_DAY;
    // (no fish in the sea near by, so the open water is no draw)
    for (let w = 0; w < s.fish.length; w++) if (s.world.water[w] === WATER.Sea) s.fish[w] = 0;
    const [a, b] = adults(s);
    for (const q of [a, b]) { q.x = s.camp.x; q.z = s.camp.z; }
    // with a spear, only the sea is open (and there may be none near)
    const t1 = setup(s, a, 'fish');
    if (t1) expect(s.world.water[t1.ref]).toBe(WATER.Sea);
    s.giveTools(s.camp, { line: 1 });
    const t2 = setup(s, b, 'fish')!;
    expect(t2).not.toBeNull();
    expect(s.heldBy(b)?.kind).toBe('line');
    // and sat on the ice, they bring a fish up now and then
    atWater(s, b, at!.spot, at!.w);
    s.fish[at!.w] = s.fishCap[at!.w];
    let sat = false;
    for (let i = 0; i < 120 && b.task?.stage !== 2; i++) {
      runTask(s, b);
      if (b.act === ACT.Sit) sat = true;
      s.tick++;
    }
    expect(sat).toBe(true);
  });

  it('brings home fewer fish on a line than on a spear, but comes home empty less often', () => {
    const tally = (gear: 'line' | null) => {
      let empty = 0, fish = 0;
      for (let k = 0; k < 40; k++) {
        const s = sim(2);
        s.tick += k * 977;
        // (a different throw of the dice each time)
        for (let j = 0; j < k * 7; j++) s.rAi.next();
        while (freshFrozen(s.tick)) s.tick += TICKS_PER_DAY;
        const at = bank(s)!;
        const p = adults(s)[0];
        p.skills[SK.fish] = 4;
        if (gear) hand(s, p, gear);
        atWater(s, p, at.spot, at.w);
        s.fish[at.w] = s.fishCap[at.w] * 0.5;
        for (let i = 0; i < 100 && p.task && p.task.stage < 2; i++) { runTask(s, p); s.tick++; }
        if (p.carry === CARRY.Fish) fish += p.carryAmt;
        else empty++;
      }
      return { empty, fish };
    };
    const spear = tally(null), line = tally('line');
    expect(line.empty).toBeLessThan(spear.empty);
    expect(line.fish / (40 - line.empty)).toBeLessThan(spear.fish / (40 - spear.empty));
  });

  it('sends a spear-fisher out without the band\'s axe', () => {
    const s = sim(2);
    while (freshFrozen(s.tick)) s.tick += TICKS_PER_DAY;
    for (const it of [...s.items]) if (['net', 'line', 'harpoon'].includes(it.kind) && it.band === s.camp.id) s.items.splice(s.items.indexOf(it), 1);
    s.giveTools(s.camp, { chopper: 1 });
    const p = adults(s)[0];
    const chopper = s.toolsOf(s.camp, 'chopper')[0];
    s.takeTool(p, chopper);
    const t = setup(s, p, 'fish');
    expect(t).not.toBeNull();
    expect(s.heldBy(p)).toBeUndefined();
    expect(chopper.holder).toBe(-1);
  });

  it('never brings home a fraction of a fish, or none', () => {
    const s = sim(2);
    while (freshFrozen(s.tick)) s.tick += TICKS_PER_DAY;
    const at = bank(s)!;
    const p = adults(s)[0];
    p.skills[SK.fish] = 12;
    let trips = 0;
    for (let k = 0; k < 60; k++) {
      atWater(s, p, at.spot, at.w);
      for (let i = 0; i < 80 && p.task && p.task.stage < 2; i++) {
        s.fish[at.w] = 0.6 + (k % 3) * 0.7;
        runTask(s, p);
        s.tick++;
      }
      if (p.carry === CARRY.Fish) {
        trips++;
        expect(p.carryAmt).toBeGreaterThanOrEqual(1);
        expect(Number.isInteger(p.carryAmt)).toBe(true);
      }
      p.carry = CARRY.None;
      p.carryAmt = 0;
    }
    expect(trips).toBeGreaterThan(0);
  });

  it('keeps net helpers at the pile until the keeper has the net on its way', () => {
    const s = sim(2);
    while (freshFrozen(s.tick)) s.tick += TICKS_PER_DAY;
    const at = bank(s)!;
    const [keeper, helper] = adults(s);
    hand(s, keeper, 'net');
    atWater(s, keeper, at.spot, at.w, { stage: -1 });
    helper.x = keeper.x + 1;
    helper.z = keeper.z;
    const t = setup(s, helper, 'fish');
    expect(t?.crew).toBeUndefined();
    keeper.task!.stage = 0;
    const t2 = setup(s, helper, 'fish');
    expect(t2?.crew).toBe(keeper.id);
  });

  it('hauls a net with others: a helper comes, and the catch is bigger and shared', () => {
    const s = sim(2);
    while (freshFrozen(s.tick)) s.tick += TICKS_PER_DAY;
    const at = bank(s)!;
    const [keeper, helper] = adults(s);
    keeper.skills[SK.fish] = 10;
    const net = hand(s, keeper, 'net');
    atWater(s, keeper, at.spot, at.w);
    step(s, [keeper], 3);
    expect(keeper.task!.stage).toBe(1);
    expect(keeper.carry).toBe(CARRY.None);
    // someone free comes to help haul it
    helper.x = keeper.x + 2;
    helper.z = keeper.z;
    const ht = setup(s, helper, 'fish')!;
    expect(ht.crew).toBe(keeper.id);
    helper.task = ht;
    s.fish[at.w] = s.fishCap[at.w];
    const before = s.fish.reduce((a, v) => a + v, 0);
    for (let i = 0; i < 200 && keeper.carry !== CARRY.Fish; i++) step(s, [keeper, helper], 1);
    const got = before - s.fish.reduce((a, v) => a + v, 0);
    expect(got).toBeGreaterThan(0);
    // every fish taken from the water is carried home by one of them, none lost to rounding
    expect(keeper.carryAmt + helper.carryAmt).toBeCloseTo(got, 4);
    expect(helper.carryAmt).toBeCloseTo(keeper.carryAmt, 6);
    // shared between them, and more than the keeper would have netted alone at the best
    expect(Math.round(got)).toBeGreaterThanOrEqual(Math.round((4 + 10 / 4) * (1 + NET_HAND) * 0.6));
    expect(net.wear).toBeGreaterThan(0);
    expect(NET_CREW).toBeGreaterThanOrEqual(2);
    expect(ITEMS.net.uses).toBeGreaterThan(0);
  });

  it('wears a harpoon with each trip to the water', () => {
    const s = sim(2);
    while (freshFrozen(s.tick)) s.tick += TICKS_PER_DAY;
    const at = bank(s)!;
    const p = adults(s)[0];
    const h = hand(s, p, 'harpoon');
    atWater(s, p, at.spot, at.w);
    s.fish[at.w] = s.fishCap[at.w];
    for (let i = 0; i < 400 && p.task; i++) { runTask(s, p); s.tick++; }
    expect(h.wear).toBeGreaterThan(0);
  });
});
