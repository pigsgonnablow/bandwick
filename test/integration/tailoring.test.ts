// Clothes from the hides and reeds: hats, mittens, shoes, capes and bags sewn by the fire, handed out to
// whoever needs them most, worn until they wear through, and mended on the way. And what everyone wears,
// shown in the Gear tab and the band's summary.
import { describe, it, expect, beforeEach } from 'vitest';
import { Sim } from '../../src/sim/sim';
import type { Person, Item, ItemKind, Task } from '../../src/sim/band';
import { CARRY, GARMENTS, BAG_LOAD, NUTS_LOAD, SHOES_REST, MEND_AT, MEND_CORD, CLOAK_WARM, ACT, SLOTS, ITEMS, isGarment, SK, MEND_MAX, EGGS_LOAD, SHOES_WEAR_EVERY } from '../../src/sim/band';
import { abandon, deposit, runTask } from '../../src/sim/ai';
import { isTreeType, treeSpecies, treeStage } from '../../src/sim/sim';
import { generateWorld } from '../../src/sim/worldgen';
import type { SaveData } from '../../src/sim/sim';
import { sim, runTo } from '../helpers';
import { TICKS_PER_DAY, TICKS_PER_SEASON, START_TICK } from '../../src/sim/time';

let s: Sim;
let p: Person;

const priv = (x: Sim) => x as unknown as { handOut(c: Sim['camp']): void; needs(q: Person): void; dressAndBed(): void };
function garment(kind: ItemKind, on?: Person, wear = 0): Item {
  const it: Item = { id: s.newId(), kind, band: s.camp.id, holder: -1, wear, made: s.tick, maker: -1 };
  s.items.push(it);
  if (on) s.dress(on, it);
  return it;
}
function task(kind: Task['kind'], more: Partial<Task> = {}): Task {
  return { kind, stage: 0, goal: s.tileOf(p), gx: p.x, gz: p.z, ref: -1, timer: 0, started: s.tick, amount: 0, near: false, ...more };
}
/** Take off everything the band wears and put away every garment, so a test starts from nothing. */
function undress() {
  for (const q of s.people) delete q.worn;
  s.items = s.items.filter((i) => !isGarment(i.kind));
}

beforeEach(() => {
  s = runTo(sim(1), START_TICK + 2 * TICKS_PER_DAY + 50);
  p = s.living().find((q) => s.age(q) >= 16 && s.age(q) <= 50)!;
  s.camp = s.campOf(p);
  undress();
});

describe('what keeps off the cold', () => {
  it('adds up the way layers do: each lets through only part of what the last let through', () => {
    expect(s.coldKept(p)).toBe(0);
    garment('cloak', p);
    expect(s.coldKept(p)).toBeCloseTo(CLOAK_WARM, 9);
    garment('hat', p);
    garment('mittens', p);
    garment('shoes', p);
    const through = (1 - GARMENTS.cloak.warm) * (1 - GARMENTS.hat.warm) * (1 - GARMENTS.mittens.warm) * (1 - GARMENTS.shoes.warm);
    expect(s.coldKept(p)).toBeCloseTo(1 - through, 9);
    // never all of it, however much is worn
    expect(s.coldKept(p)).toBeLessThan(1);
    // and a bag keeps off nothing
    const before = s.coldKept(p);
    garment('bag', p);
    expect(s.coldKept(p)).toBeCloseTo(before, 9);
  });

  it('is what the cold takes from them in the dead of winter', () => {
    const needs = (q: Person) => priv(s).needs(q);
    runTo(s, s.tick + 3 * TICKS_PER_SEASON + 2 * TICKS_PER_DAY);
    undress();
    p.x = s.camp.x + 20;
    p.z = s.camp.z + 20;
    expect(s.tempAt(p)).toBeLessThan(10);
    const loss = () => { p.warmth = 80; p.indoors = false; needs(p); return 80 - p.warmth; };
    const bare = loss();
    garment('cape', p);
    garment('hat', p);
    expect(loss()).toBeCloseTo(bare * (1 - s.coldKept(p)), 5);
    expect(loss()).toBeLessThan(bare);
  });

  it('a reed cape is warmer than nothing, but not so warm as a hide cloak', () => {
    expect(GARMENTS.cape.warm).toBeGreaterThan(0);
    expect(GARMENTS.cape.warm).toBeLessThan(GARMENTS.cloak.warm);
  });
});

describe('putting something on', () => {
  it('puts it in its place, and takes off what was there', () => {
    const cape = garment('cape', p);
    expect(p.worn?.body).toBe(cape.id);
    expect(cape.wearer).toBe(p.id);
    const cloak = garment('cloak', p);
    expect(p.worn?.body).toBe(cloak.id);
    expect(cape.wearer).toBeUndefined();
    // a hat goes on the head, and leaves the cloak on
    const hat = garment('hat', p);
    expect(p.worn?.head).toBe(hat.id);
    expect(p.worn?.body).toBe(cloak.id);
    expect(s.wornBy(p).map((i) => i.kind).sort()).toEqual(['cloak', 'hat']);
  });

  it('does nothing with a thing that is not worn', () => {
    const axe = garment('axe');
    s.dress(p, axe);
    expect(p.worn ?? {}).toEqual({});
    expect(axe.wearer).toBeUndefined();
  });
});

describe('handing out', () => {
  it('gives the warm things to whoever feels the cold most: the youngest and the oldest first', () => {
    const ms = s.members(s.camp).filter((q) => s.age(q) >= 1);
    const need = (q: Person) => (s as unknown as { coldNeed(q: Person): number }).coldNeed(q);
    const hat = garment('hat');
    priv(s).handOut(s.camp);
    const wearer = s.byId.get(hat.wearer!)!;
    expect(wearer).toBeDefined();
    expect(need(wearer)).toBeCloseTo(Math.max(...ms.map(need)), 9);
    // and the next one to whoever feels it most of those left
    const hat2 = garment('hat');
    priv(s).handOut(s.camp);
    const w2 = s.byId.get(hat2.wearer!)!;
    expect(w2).not.toBe(wearer);
    expect(need(w2)).toBeCloseTo(Math.max(...ms.filter((q) => q !== wearer).map(need)), 9);
  });

  it('gives shoes to the grown walkers before children, and bags only to those old enough to gather', () => {
    const shoes = garment('shoes');
    const bag = garment('bag');
    priv(s).handOut(s.camp);
    const w = s.byId.get(shoes.wearer!)!;
    expect(s.age(w)).toBeGreaterThanOrEqual(14);
    expect(s.age(w)).toBeLessThan(60);
    const b = s.byId.get(bag.wearer!)!;
    expect(s.age(b)).toBeGreaterThanOrEqual(9);
    // the bag goes to the best gatherer of those old enough
    const best = Math.max(...s.members(s.camp).filter((q) => s.age(q) >= 9).map((q) => q.skills[SK.forage]));
    expect(b.skills[SK.forage]).toBeCloseTo(best, 9);
  });

  it('a better thing replaces a worse one, which goes back on the pile for the next person', () => {
    const ms = s.members(s.camp).filter((q) => s.age(q) >= 1);
    // everyone in a reed cape
    const capes = ms.map((q) => garment('cape', q));
    const cloak = garment('cloak');
    priv(s).handOut(s.camp);
    const w = s.byId.get(cloak.wearer!)!;
    expect(w.worn?.body).toBe(cloak.id);
    // their cape is free again (nobody else lacks one, so it waits on the pile)
    const freed = capes.find((c) => c.wearer === undefined)!;
    expect(freed).toBeDefined();
    expect(freed.holder).toBe(-1);
    expect(capes.filter((c) => c.wearer !== undefined).length).toBe(ms.length - 1);
  });

  it('never takes a cloak off someone to give them a cape', () => {
    const ms = s.members(s.camp).filter((q) => s.age(q) >= 1);
    for (const q of ms) garment('cloak', q);
    const cape = garment('cape');
    priv(s).handOut(s.camp);
    expect(cape.wearer).toBeUndefined();
    for (const q of ms) expect(s.wornIn(q, 'body')?.kind).toBe('cloak');
  });

  it('hands out at most one of a kind to anyone, and each thing to one person', () => {
    for (let i = 0; i < 30; i++) garment((['hat', 'mittens', 'shoes', 'bag', 'cape', 'cloak'] as const)[i % 6]);
    priv(s).handOut(s.camp);
    const seen = new Set<number>();
    for (const q of s.people) {
      for (const slot of SLOTS) {
        const id = q.worn?.[slot];
        if (id === undefined) continue;
        expect(seen.has(id)).toBe(false);
        seen.add(id);
        const it = s.items.find((i) => i.id === id)!;
        expect(GARMENTS[it.kind as keyof typeof GARMENTS].slot).toBe(slot);
        expect(it.wearer).toBe(q.id);
      }
    }
  });

  it('happens each morning, and takes things back from the dead', () => {
    const hat = garment('hat');
    runTo(s, s.tick + TICKS_PER_DAY);
    const w = s.byId.get(hat.wearer!)!;
    expect(w).toBeDefined();
    s.kill(w, 'test');
    runTo(s, s.tick + TICKS_PER_DAY);
    expect(w.worn?.head).toBeUndefined();
    expect(hat.wearer === undefined || hat.wearer !== w.id).toBe(true);
  });
});

describe('shoes', () => {
  it('make a long walk easier on the legs', () => {
    const needs = (q: Person) => priv(s).needs(q);
    const walk = () => {
      p.rest = 80;
      p.act = ACT.Walk;
      p.task = task('forage', { stage: 0 });
      needs(p);
      return 80 - p.rest;
    };
    const bare = walk();
    garment('shoes', p);
    const shod = walk();
    expect(bare).toBeGreaterThan(0);
    expect(shod).toBeCloseTo(bare * SHOES_REST, 5);
  });

  it('wear out with the walking, not with the days', () => {
    const shoes = garment('shoes', p);
    p.indoors = false;
    for (let i = 0; i < 2000; i++) { p.act = ACT.Walk; priv(s).needs(p); s.tick++; }
    expect(shoes.wear).toBeGreaterThan(0);
    // and sitting still does them no harm
    const w = shoes.wear;
    for (let i = 0; i < 2000; i++) { p.act = ACT.Sit; priv(s).needs(p); s.tick++; }
    expect(shoes.wear).toBe(w);
  });
});

describe('a hide bag', () => {
  it('brings home a bigger load of acorns', () => {
    const oak = s.nearestProp(p.x, p.z, 80, (k) => isTreeType(s.propType[k]) && treeSpecies(s.propType[k]) === 1 && treeStage(s.propType[k]) >= 2);
    expect(oak).toBeGreaterThanOrEqual(0);
    const gather = () => {
      s.nutsTaken.clear();
      p.x = s.propX[oak];
      p.z = s.propZ[oak];
      p.carry = CARRY.Nuts;
      p.carryAmt = NUTS_LOAD - 0.5;
      p.task = task('nuts', { ref: oak, stage: 1, timer: 1 });
      runTask(s, p);
      return p.carryAmt;
    };
    const without = gather();
    garment('bag', p);
    const withBag = gather();
    expect(without).toBeCloseTo(NUTS_LOAD, 6);
    expect(withBag).toBeGreaterThan(without);
    expect(withBag).toBeLessThanOrEqual(NUTS_LOAD * BAG_LOAD + 1e-9);
  });

  it('wears with each load of gathered food brought home in it, but not with wood or meat', () => {
    const bag = garment('bag', p);
    p.carry = CARRY.Berries;
    p.carryAmt = 3;
    deposit(s, p);
    const after = bag.wear;
    expect(after).toBeGreaterThan(0);
    p.carry = CARRY.Log;
    p.carryAmt = 1;
    deposit(s, p);
    expect(bag.wear).toBe(after);
  });
});

describe('mending', () => {
  function mendTask(it: Item, more: Partial<Task> = {}) {
    s.camp.stock.cordage -= MEND_CORD;
    return task('mend', { ref: it.id, amount: 1, ...more });
  }

  it('is wanted for the worn things only, most worn first', () => {
    const q = s.living().find((o) => o !== p && o.band === p.band)!;
    const a = garment('cloak', p, 0.5);
    const b = garment('hat', q, 0.9);
    garment('mittens', p, 0.1);
    expect(s.toMend(s.camp).map((i) => i.id)).toEqual([b.id, a.id]);
    for (const it of s.toMend(s.camp)) expect(it.wear).toBeGreaterThanOrEqual(MEND_AT);
  });

  it('patches a worn thing by the fire, with a little cord, and its wearer is grateful', () => {
    const q = s.living().find((o) => o !== p && o.band === p.band)!;
    const cloak = garment('cloak', q, 0.8);
    s.camp.stock.cordage = 3;
    const before = s.opinion(q, p);
    p.x = s.camp.x + 1.4;
    p.z = s.camp.z;
    p.task = mendTask(cloak, { stage: 1, timer: 1 });
    runTask(s, p);
    expect(cloak.wear).toBeLessThan(0.8);
    expect(cloak.mended).toBe(1);
    expect(cloak.mender).toBe(p.id);
    expect(s.camp.stock.cordage).toBeCloseTo(3 - MEND_CORD, 9);
    expect(s.camp.ledger?.now['mended']).toBe(1);
    expect(p.task).toBeNull();
    expect(s.opinion(q, p)).toBeGreaterThan(before);
  });

  it('is not wanted twice for the same thing at once', () => {
    const cloak = garment('cloak', p, 0.8);
    s.camp.stock.cordage = 3;
    expect(s.toMend(s.camp).map((i) => i.id)).toContain(cloak.id);
    p.task = mendTask(cloak);
    expect(s.toMend(s.camp).map((i) => i.id)).not.toContain(cloak.id);
  });

  it('called off gives back its cord, once', () => {
    const cloak = garment('cloak', p, 0.8);
    s.camp.stock.cordage = 3;
    p.task = mendTask(cloak);
    expect(s.camp.stock.cordage).toBeCloseTo(3 - MEND_CORD, 9);
    abandon(s, p);
    abandon(s, p);
    expect(s.camp.stock.cordage).toBeCloseTo(3, 9);
    expect(cloak.mended ?? 0).toBe(0);
  });

  it('is let go if the thing is gone', () => {
    const cloak = garment('cloak', p, 0.8);
    s.camp.stock.cordage = 3;
    p.task = mendTask(cloak, { stage: 1, timer: 5 });
    s.items = s.items.filter((i) => i !== cloak);
    delete p.worn;
    runTask(s, p);
    expect(p.task).toBeNull();
    expect(s.camp.stock.cordage).toBeCloseTo(3, 9);
  });

  it('is a job the band takes up when something is worn and there is cord', () => {
    const jobs = (x: Sim) => x as unknown as { plan(c: Sim['camp']): void };
    garment('cloak', p, 0.9);
    s.camp.stock.cordage = 4;
    jobs(s).plan(s.camp);
    expect(s.camp.jobs.mend ?? 0).toBeGreaterThan(0);
    s.camp.stock.cordage = 0;
    jobs(s).plan(s.camp);
    expect(s.camp.jobs.mend ?? 0).toBe(0);
  });
});

describe('what the band makes', () => {
  function allKnown() {
    for (const k of ['cloaks', 'hats', 'shoes', 'bags', 'capes']) if (!s.camp.knows.includes(k)) s.camp.knows.push(k);
  }

  it('makes nothing to wear that it has not thought of', () => {
    s.camp.knows = s.camp.knows.filter((k) => !['cloaks', 'hats', 'shoes', 'bags', 'capes'].includes(k));
    s.camp.stock.hides = 10;
    s.camp.stock.cordage = 10;
    s.camp.stock.fiber = 20;
    const k = s.toolToMake(s.camp);
    expect(k === null || !isGarment(k)).toBe(true);
  });

  it('makes cloaks first, then shares the hides out among the smaller things once three in four are clothed', () => {
    allKnown();
    s.camp.stock.hides = 10;
    s.camp.stock.cordage = 10;
    // (all the tools a band wants, so only clothes are left to make)
    s.giveTools(s.camp, { axe: 6, chopper: 3, stick: 4, basket: 4, needle: 3, pot: 8 });
    expect(s.toolToMake(s.camp)).toBe('cloak');
    const ms = s.members(s.camp).filter((q) => s.age(q) >= 1);
    const half = ms.slice(0, Math.ceil(ms.length / 2));
    for (const q of half) garment('cloak', q);
    // (half is not enough: the hides still go to cloaks)
    expect(s.toolToMake(s.camp)).toBe('cloak');
    for (const q of ms.slice(half.length, Math.ceil(ms.length * 0.75))) garment('cloak', q);
    const next = s.toolToMake(s.camp);
    expect(['shoes', 'hat', 'mittens', 'bag']).toContain(next);
  });

  it('knots reed capes when there are no hides for a cloak', () => {
    allKnown();
    s.giveTools(s.camp, { axe: 6, chopper: 3, stick: 4, basket: 4, needle: 3, pot: 8 });
    s.camp.stock.hides = 0; // (a single hide would go to shoes or a hat first)
    s.camp.stock.cordage = 10;
    s.camp.stock.fiber = 20;
    expect(s.toolToMake(s.camp)).toBe('cape');
  });
});

describe('the Gear tab', () => {
  it('shows each place on the body, what is worn there, who made it and how it has worn', () => {
    const q = s.living().find((o) => o !== p && o.band === p.band)!;
    const hat = garment('hat', p, 0.7);
    hat.maker = q.id;
    hat.mended = 2;
    hat.mender = q.id;
    garment('shoes', p, 0.05);
    const d = s.inspect(p.id)!;
    expect(d.gear.map((g) => g.slot)).toEqual([...SLOTS]);
    const head = d.gear.find((g) => g.slot === 'head')!.item!;
    expect(head.label).toBe(ITEMS.hat.label);
    expect(head.condition).toBe('well worn');
    expect(head.maker).toEqual({ id: q.id, name: q.name });
    expect(head.mended).toBe(2);
    expect(head.mender?.name).toBe(q.name);
    expect(head.warm).toBe(GARMENTS.hat.warm);
    expect(d.gear.find((g) => g.slot === 'feet')!.item!.condition).toBe('new');
    expect(d.gear.find((g) => g.slot === 'body')!.item).toBeNull();
    expect(d.coldKept).toBeCloseTo(s.coldKept(p), 9);
  });

  it('shows the tool in hand, and the band\'s summary counts who wears what', () => {
    // (whatever they were working with is put down first: one tool in hand at a time)
    for (const it of s.items) if (it.holder === p.id) it.holder = -1;
    const axe = garment('axe');
    axe.holder = p.id;
    expect(s.inspect(p.id)!.toolDetail?.kind).toBe('axe');
    garment('cloak', p);
    garment('shoes', p);
    const sum = s.summary();
    expect(sum.clothes.cloak).toBe(1);
    expect(sum.clothes.shoes).toBe(1);
    expect(sum.clothes.hat).toBe(0);
    // what is worn is not counted among the tools, and spare shoes are not 'shoess'
    expect(sum.tools).not.toMatch(/cloak/);
    expect(s.describeTools([garment('shoes'), garment('shoes'), garment('mittens'), garment('mittens')])).toBe('2 hide mittens, 2 hide shoes');
  });
});

describe('a save', () => {
  it('keeps what everyone wears, and how worn and mended it is', () => {
    const cloak = garment('cloak', p, 0.4);
    cloak.mended = 1;
    cloak.mender = p.id;
    garment('bag', p, 0.2);
    const save = JSON.parse(JSON.stringify(s.serialize())) as SaveData;
    const b = new Sim(generateWorld(save.params), save);
    const q = b.byId.get(p.id)!;
    expect(q.worn).toEqual(p.worn);
    const c2 = b.items.find((i) => i.id === cloak.id)!;
    expect(c2.wear).toBe(0.4);
    expect(c2.mended).toBe(1);
    expect(c2.mender).toBe(p.id);
    expect(b.coldKept(q)).toBeCloseTo(s.coldKept(p), 9);
  });

  it('from before there was more than a cloak to wear still has the cloak on', () => {
    const cloak = garment('cloak', p);
    const save = JSON.parse(JSON.stringify(s.serialize())) as SaveData;
    // an old save: a cloak field on the person, nothing worn anywhere
    const op = save.people.find((x) => x.id === p.id)! as unknown as Record<string, unknown>;
    delete op.worn;
    op.cloak = cloak.id;
    const b = new Sim(generateWorld(save.params), save);
    const q = b.byId.get(p.id)!;
    expect(q.worn?.body).toBe(cloak.id);
    expect((q as unknown as Record<string, unknown>).cloak).toBeUndefined();
    expect(b.cloakOf(q)?.id).toBe(cloak.id);
  });
});

describe('the rules of what is worn', () => {
  it('hold for a band dressed properly, and catch each way of getting it wrong', async () => {
    const { InvariantChecker } = await import('../../tools/lib/invariants');
    for (const k of ['cloaks', 'hats']) if (!s.camp.knows.includes(k)) s.camp.knows.push(k);
    const q = s.living().find((o) => o !== p && o.band === p.band)!;
    const hat = garment('hat', p);
    garment('cloak', q);
    const ok = new InvariantChecker(s);
    ok.check();
    expect(ok.report()).toEqual([]);
    const broken = (fn: () => void, undo: () => void, words: RegExp) => {
      fn();
      const c = new InvariantChecker(s);
      c.check();
      expect(c.report().join('\n')).toMatch(words);
      undo();
    };
    // a hat on someone's feet
    broken(() => { p.worn!.feet = hat.id; delete p.worn!.head; }, () => { p.worn!.head = hat.id; delete p.worn!.feet; }, /wrong place/);
    // the same hat on two heads
    broken(() => { q.worn!.head = hat.id; }, () => { delete q.worn!.head; }, /does not know its wearer/);
    // worn and carried in the hand at once
    broken(() => { hat.holder = p.id; }, () => { hat.holder = -1; }, /worn and held/);
    // patched more often than a thing can be, or by someone who never was
    broken(() => { hat.mended = MEND_MAX + 1; }, () => { delete hat.mended; }, /past all patching/);
    broken(() => { hat.mender = 999999; }, () => { delete hat.mender; }, /mended by nobody known/);
    // a tool is not mended like clothes
    const axe = garment('axe');
    broken(() => { axe.mended = 1; }, () => { delete axe.mended; }, /mended like clothes/);
    s.items = s.items.filter((i) => i !== axe);
    const after = new InvariantChecker(s);
    after.check();
    expect(after.report()).toEqual([]);
  });
});

describe('found in review', () => {
  it('a thing patched over and over is mended no more, and is worn until it wears through', () => {
    const cloak = garment('cloak', p, 0.8);
    cloak.mended = MEND_MAX;
    expect(s.toMend(s.camp).map((i) => i.id)).not.toContain(cloak.id);
    cloak.mended = MEND_MAX - 1;
    expect(s.toMend(s.camp).map((i) => i.id)).toContain(cloak.id);
    // and the band takes up no mending for it
    cloak.mended = MEND_MAX;
    s.camp.stock.cordage = 5;
    (s as unknown as { plan(c: Sim['camp']): void }).plan(s.camp);
    expect(s.camp.jobs.mend ?? 0).toBe(0);
  });

  it('a reed cape is knotted by a band that has never thought of cloaks, whatever hides it has', () => {
    s.camp.knows = s.camp.knows.filter((k) => k !== 'cloaks');
    if (!s.camp.knows.includes('capes')) s.camp.knows.push('capes');
    s.giveTools(s.camp, { axe: 6, chopper: 3, stick: 4, basket: 4, needle: 3, pot: 8 });
    s.camp.stock.hides = 6;
    s.camp.stock.fiber = 20;
    s.camp.stock.cordage = 10;
    expect(s.toolToMake(s.camp)).toBe('cape');
  });

  it('honeycomb comes home on its bark, the same with a bag or without; eggs fill the bag', () => {
    const chance = s.rAi.chance;
    s.rAi.chance = () => false; // (no stings for this)
    try {
      const fill = (kind: 'honey' | 'eggs', start: number) => {
        const k = s.nearestProp(p.x, p.z, 80, (k) => isTreeType(s.propType[k]) && treeStage(s.propType[k]) >= 3);
        expect(k).toBeGreaterThanOrEqual(0);
        s.hivesTaken.clear();
        s.eggsTaken.clear();
        p.x = s.propX[k];
        p.z = s.propZ[k];
        p.carry = kind === 'honey' ? CARRY.Honey : CARRY.Eggs;
        p.carryAmt = start;
        p.task = task(kind, { ref: k, stage: 1, timer: 1 });
        runTask(s, p);
        return p.carryAmt;
      };
      const honeyBare = fill('honey', 3.5);
      const eggsBare = fill('eggs', EGGS_LOAD - 0.2);
      garment('bag', p);
      expect(fill('honey', 3.5)).toBeCloseTo(honeyBare, 9);
      expect(fill('eggs', EGGS_LOAD - 0.2)).toBeGreaterThan(eggsBare);
      expect(eggsBare).toBeCloseTo(EGGS_LOAD, 9);
    } finally {
      s.rAi.chance = chance;
    }
  });
});

describe('wear and tear', () => {
  const daily = () => priv(s).dressAndBed();
  it('a cloak, hat and mittens wear on cold days only; shoes and a bag not by the day at all', () => {
    const cloak = garment('cloak', p), hat = garment('hat', p), mitts = garment('mittens', p), shoes = garment('shoes', p), bag = garment('bag', p);
    const cold = s.tempAt(p) < 10;
    daily();
    for (const it of [cloak, hat, mitts]) expect(it.wear > 0, it.kind).toBe(cold);
    expect(shoes.wear).toBe(0);
    expect(bag.wear).toBe(0);
    // in the dead of winter they all wear
    runTo(s, s.tick + 3 * TICKS_PER_SEASON + 2 * TICKS_PER_DAY);
    for (const it of [cloak, hat, mitts]) it.wear = 0;
    p.x = s.camp.x + 20;
    p.z = s.camp.z + 20;
    if (s.tempAt(p) < 10) {
      daily();
      for (const it of [cloak, hat, mitts]) expect(it.wear, it.kind).toBeCloseTo(1 / ITEMS[it.kind].uses, 9);
    }
  });

  it('a thing worn through is gone from its place, and its wearer remembers it', () => {
    const hat = garment('hat', p, 0.9995);
    const before = p.memories.length;
    expect(s.wearTool(hat)).toBe(true);
    expect(p.worn?.head).toBeUndefined();
    expect(s.items).not.toContain(hat);
    expect(s.coldKept(p)).toBe(0);
    // (the shoes and the daily wear tell it as a memory)
    const shoes = garment('shoes', p, 0.9995);
    p.act = ACT.Walk;
    for (let i = 0; i < SHOES_WEAR_EVERY && p.worn?.feet !== undefined; i++) { p.act = ACT.Walk; priv(s).needs(p); s.tick++; }
    expect(p.worn?.feet).toBeUndefined();
    expect(s.items).not.toContain(shoes);
    expect(p.memories.length).toBeGreaterThan(before);
  });

  it('nobody under a year old, and nobody dead, is handed anything', () => {
    const dead = s.living().find((o) => o !== p && o.band === p.band)!;
    s.kill(dead, 'test');
    for (let i = 0; i < 40; i++) garment((['hat', 'mittens', 'cloak', 'cape', 'shoes', 'bag'] as const)[i % 6]);
    priv(s).handOut(s.camp);
    for (const it of s.items) if (it.wearer !== undefined) {
      const w = s.byId.get(it.wearer)!;
      expect(w.alive).toBe(true);
      expect(s.age(w)).toBeGreaterThanOrEqual(1);
    }
  });

  it('a better mender takes back more of the wear, and a needle makes quicker work of it', () => {
    const mend = (skill: number, needle: boolean) => {
      undress();
      s.items = s.items.filter((i) => i.kind !== 'needle');
      if (needle) s.giveTools(s.camp, { needle: 1 });
      const it = garment('cloak', p, 0.8);
      s.camp.stock.cordage = 3;
      p.skills[SK.hide] = skill;
      p.x = s.camp.x + 1.4;
      p.z = s.camp.z;
      p.task = task('mend', { ref: it.id, amount: 1, gx: p.x, gz: p.z, goal: s.tileOf(p) });
      let ticks = 0;
      while (p.task && ticks < 500) { runTask(s, p); ticks++; }
      return { wear: it.wear, ticks };
    };
    const novice = mend(0, false), master = mend(20, false), withNeedle = mend(0, true);
    expect(master.wear).toBeLessThan(novice.wear);
    expect(novice.wear).toBeLessThan(0.8);
    expect(master.ticks).toBeLessThan(novice.ticks);
    expect(withNeedle.ticks).toBeLessThan(novice.ticks);
    expect(withNeedle.wear).toBeCloseTo(novice.wear, 9);
  });
});
