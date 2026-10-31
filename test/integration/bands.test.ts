// The lives of bands beyond the everyday: a band grown big splits, young people of neighbouring
// bands pair off and the one who moves teaches what their old band knew, a feud ends in blood and
// exile, an orphaned infant is taken in, hunger grips a camp and eases. Each of these is rare in a
// run, so the tests set the scene and call the step that decides it directly.
import { describe, it, expect } from 'vitest';
import { Sim, SaveData } from '../../src/sim/sim';
import { foodTotal, Person, Stock, CARRY } from '../../src/sim/band';
import { generateWorld } from '../../src/sim/worldgen';
import { TICKS_PER_DAY, TICKS_PER_YEAR, DAYS_PER_SEASON, seasonOf } from '../../src/sim/time';
import { InvariantChecker } from '../../tools/lib/invariants';
import { sim, runTo } from '../helpers';

const empty = (): Stock => ({ berries: 0, meat: 0, fish: 0, preserved: 0, wood: 0, fiber: 0, cordage: 0, mud: 0, stone: 0 });

/** Add grown-ups, none of them kin to anyone, to the band the simulation is looking at. */
function grow(s: Sim, n: number): Person[] {
  const out: Person[] = [];
  for (let i = 0; i < n; i++) {
    const p = s.newPerson((i % 2) as 0 | 1, s.tick - (22 + i) * TICKS_PER_YEAR, -1, -1);
    p.x = s.camp.x + 1;
    p.z = s.camp.z + 1;
    out.push(p);
  }
  return out;
}

/** Make every roll of the dice for a band's life come up yes, while `run` runs. */
function always<T>(s: Sim, run: () => T): T {
  const r = (s as any).rLife;
  const chance = r.chance;
  r.chance = () => true;
  try {
    return run();
  } finally {
    r.chance = chance;
  }
}

/** A second band, a walk away from the first, with nobody in it yet. */
function neighbour(s: Sim) {
  const home = s.camp;
  const tile = s.chooseSite({ from: home, min: 16, max: 36, avoid: 12 });
  expect(tile).toBeGreaterThanOrEqual(0);
  const other = s.foundCamp(tile, empty(), -1, -1);
  s.camp = home;
  return other;
}

describe('a band that splits', () => {
  it('sends a leader off with whole households, a fair share of the stores, and all the band knows', () => {
    const s = sim(2);
    const c = s.camp;
    const all = [...s.members(c), ...grow(s, 10)];
    // a band that gets on: whoever leads, others will follow
    for (const p of all) for (const q of all) if (p !== q) p.rel.set(q.id, 40);
    c.knows.push('huts');
    c.stock.meat = 100;
    c.stock.wood = 60;
    const before = s.members(c).length;
    const food = foodTotal(c.stock), wood = c.stock.wood;
    expect(always(s, () => (s as any).considerSplit(c))).toBe(true);
    const nc = s.camps[s.camps.length - 1];
    expect(nc).not.toBe(c);
    expect(nc.parent).toBe(c.id);
    expect(s.camp).toBe(c);
    const went = s.members(nc), stayed = s.members(c);
    expect(went.length + stayed.length).toBe(before);
    expect(went.length).toBeGreaterThanOrEqual(5);
    expect(stayed.length).toBeGreaterThanOrEqual(6);
    // the one who led them leads the new band
    expect(went.map((p) => p.id)).toContain(nc.leader);
    // nobody leaves a partner behind, and a roof is the next thing to see to
    for (const p of went) {
      if (p.partner >= 0) expect(s.byId.get(p.partner)!.band).toBe(nc.id);
      expect(p.home).toBe(-1);
    }
    // a daughter band knows what its parent knew
    expect(nc.knows).toEqual(c.knows);
    // nothing is lost in the sharing out: a share of the food in proportion, and wood to start a fire
    expect(foodTotal(nc.stock) + foodTotal(c.stock)).toBeCloseTo(food, 6);
    expect(foodTotal(nc.stock)).toBeCloseTo(food * (went.length / before) * 0.85, 6);
    expect(nc.stock.wood + c.stock.wood).toBeCloseTo(wood, 6);
    expect(nc.stock.wood).toBeGreaterThanOrEqual(16);
    // both camps start the clock again on moving on
    expect(c.settled).toBe(s.tick);
    expect(nc.settled).toBe(s.tick);
    expect(['amicable', 'turmoil']).toContain(nc.origin);
    expect(s.events.at(-1)!.kind).toBe('split');
  });

  it('stays together while it is too small to part', () => {
    const s = sim(2);
    const camps = s.camps.length;
    expect(always(s, () => (s as any).considerSplit(s.camp))).toBe(false);
    expect(s.camps.length).toBe(camps);
  });

  it('parts on good terms in a lighter shade of its colour, and in anger in the colour across the wheel', () => {
    const s = sim(2);
    const c = { h: 200, s: 0.68, l: 0.5 };
    const light = s.lighterColor(c);
    expect(light.h).toBe(206);
    expect(light.l).toBeCloseTo(0.61);
    // as light as it goes: a near neighbour on the wheel instead
    expect(s.lighterColor({ h: 350, s: 0.6, l: 0.75 })).toEqual({ h: 24, s: 0.62, l: 0.55 });
    const hue = s.contrastColor(c).h;
    const gap = Math.abs(((hue - c.h + 540) % 360) - 180);
    expect(gap).toBeGreaterThanOrEqual(120);
  });
});

describe('a pairing across bands', () => {
  function match(baby = false) {
    const s = sim(1);
    const home = s.camp;
    const other = neighbour(s);
    home.knows.push('huts');
    expect(other.knows).not.toContain('huts');
    // the single young woman here, with no kin in the band (she came with it from elsewhere)
    const woman = s.members(home).find((p) => p.partner < 0 && p.sex === 0 && s.age(p) >= 16 && s.age(p) <= 36)!;
    expect(s.members(home).some((q) => s.isKin(q, woman))).toBe(false);
    woman.samesex = false;
    // (a widow, it may be, with a baby in her arms)
    const child = baby ? s.newPerson(0, s.tick - TICKS_PER_YEAR / 2, woman.id, -1) : undefined;
    // and a single young man over there, who lives with his mother
    s.camp = other;
    const [mother, man] = grow(s, 2);
    s.camp = home;
    Object.assign(mother, { sex: 0, birth: woman.birth - 25 * TICKS_PER_YEAR });
    Object.assign(man, { sex: 1, samesex: false, birth: woman.birth - 2 * TICKS_PER_YEAR, mother: mother.id });
    mother.children.push(man.id);
    always(s, () => (s as any).considerMatches());
    return { s, home, other, woman, man, child };
  }

  it('pairs them, and the one with fewer kin goes to live with the other', () => {
    const { s, other, woman, man } = match();
    expect(woman.partner).toBe(man.id);
    expect(man.partner).toBe(woman.id);
    // she has no kin at home; he has his mother over there
    expect(woman.band).toBe(other.id);
    expect(man.band).toBe(other.id);
    expect(woman.home).toBe(-1);
    expect(s.events.at(-1)!.kind).toBe('pairing');
  });

  it('takes along a baby still carried, and leaves the rest of the family where it is', () => {
    const { s, home, other, woman, child } = match(true);
    expect(woman.band).toBe(other.id);
    expect(child!.band).toBe(other.id);
    expect(s.members(home).length).toBe(9);
    for (let i = 0; i < 20; i++) s.step();
    expect(Math.hypot(child!.x - woman.x, child!.z - woman.z)).toBeLessThan(0.6);
  });

  it('teaches the new band what the old one knew, a season after coming', () => {
    const { s, home, other, woman } = match();
    expect(other.learning).toEqual([{ k: 'huts', at: s.tick + DAYS_PER_SEASON * TICKS_PER_DAY, by: woman.id }]);
    expect(other.knows).not.toContain('huts');
    runTo(s, s.tick + DAYS_PER_SEASON * TICKS_PER_DAY + TICKS_PER_DAY);
    expect(other.knows).toContain('huts');
    expect(other.learned!.find((l) => l.k === 'huts')).toMatchObject({ how: 'taught', by: woman.id });
    expect(other.learning).toEqual([]);
    expect(s.events.some((e) => e.kind === 'discovery' && e.text === `${woman.name} taught the people of ${other.name} to raise huts.`)).toBe(true);
    // the band she left still knows it too
    expect(home.knows).toContain('huts');
  });

  it('teaches nothing if the newcomer dies before the season is out', () => {
    const { s, other, woman } = match();
    s.kill(woman, 'fever');
    runTo(s, s.tick + DAYS_PER_SEASON * TICKS_PER_DAY + TICKS_PER_DAY);
    expect(other.knows).not.toContain('huts');
    expect(other.learning).toEqual([]);
  });
});

describe('a household', () => {
  it('is a grown-up, their partner, their unpartnered children under twenty, and the little ones they look after', () => {
    const s = sim(1);
    // the first band: a couple with two children, and the woman's mother living with them
    const father = s.members().find((p) => p.partner >= 0 && p.sex === 1 && s.members().some((q) => q.father === p.id))!;
    const mother = s.byId.get(father.partner)!;
    const kids = s.members().filter((q) => q.father === father.id);
    expect(kids.length).toBeGreaterThan(0);
    const ids = (ps: Person[]) => ps.map((p) => p.id).sort((a, b) => a - b);
    expect(ids(s.household(father))).toEqual(ids([father, mother, ...kids]));
    expect(ids(s.household(mother))).toEqual(ids([father, mother, ...kids]));
    // (the grandmother is kin, but heads her own household)
    const gran = s.byId.get(mother.mother)!;
    expect(s.household(father)).not.toContain(gran);
    // a child with a partner of their own has left the household; so has one of twenty
    kids[0].partner = 999;
    expect(s.household(father)).not.toContain(kids[0]);
    kids[0].partner = -1;
    kids[0].birth = s.tick - 21 * TICKS_PER_YEAR;
    expect(s.household(father)).not.toContain(kids[0]);
    // a little one they took in is part of it
    const orphan = s.members().find((q) => s.age(q) < 14 && q.mother !== mother.id)!;
    orphan.carer = mother.id;
    expect(s.household(father)).toContain(orphan);
    // a partner who lives with another band is not
    const other = neighbour(s);
    (s as any).join([mother], other);
    expect(s.household(father)).not.toContain(mother);
  });
});

describe('the last few of a band', () => {
  it('go to live with the nearest band, which learns all they knew', () => {
    const s = sim(1);
    const home = s.camp;
    const near = neighbour(s);
    // (and another band, further off)
    const farTile = s.chooseSite({ from: home, min: 40, max: 120, avoid: 12 });
    expect(farTile).toBeGreaterThanOrEqual(0);
    const far = s.foundCamp(farTile, empty(), -1, -1);
    s.camp = near;
    const few = grow(s, 1);
    s.camp = home;
    near.knows = ['huts', 'preserving'];
    expect(home.knows).not.toContain('huts');
    expect((s as any).considerMerge(near)).toBe(true);
    expect(near.gone).toBe(s.tick);
    for (const p of few) expect(p.band).toBe(home.id);
    expect(s.members(far)).toEqual([]);
    expect(home.knows).toEqual(expect.arrayContaining(['huts', 'preserving']));
    expect(home.learned!.filter((l) => l.how === 'newcomers').map((l) => [l.k, l.from])).toEqual([['huts', near.name], ['preserving', near.name]]);
    expect(s.events.at(-1)!.text).toBe(`The newcomers from ${near.name} showed the people of ${home.name} how to raise huts and dry and smoke meat and fish.`);
  });

  it('stay where they are while they are enough to go on', () => {
    const s = sim(1);
    const home = s.camp;
    const near = neighbour(s);
    s.camp = near;
    grow(s, 4);
    s.camp = home;
    expect((s as any).considerMerge(near)).toBe(false);
    expect(near.gone).toBe(0);
  });
});

describe('a band hungry winter after winter', () => {
  it('looks for land by water with more fish in it', () => {
    let better = 0;
    for (const seed of [1, 2, 3]) {
      const s = sim(seed);
      const c = s.camp;
      const fishAt = (i: number) => (s as any).fishNear(i % s.N, Math.floor(i / s.N), 10);
      const plain = s.chooseSite({ from: c, min: 12, max: 60, avoid: 18, reachFrom: c.tile });
      const fishy = s.chooseSite({ from: c, min: 12, max: 60, avoid: 18, reachFrom: c.tile, fish: true });
      expect(fishy).toBeGreaterThanOrEqual(0);
      expect(fishAt(fishy)).toBeGreaterThanOrEqual(fishAt(plain));
      if (fishAt(fishy) > fishAt(plain)) better++;
    }
    expect(better).toBeGreaterThan(0);
  });
});

describe('someone joining another band', () => {
  it('takes the tool in their hands along, and it belongs to the new band from then on', () => {
    const s = sim(1);
    const home = s.camp;
    const other = neighbour(s);
    const p = s.members(home).find((q) => s.age(q) >= 16)!;
    const tool = s.toolsOf(home)[0];
    tool.holder = p.id;
    (s as any).join([p], other);
    expect(p.band).toBe(other.id);
    expect(tool.holder).toBe(p.id);
    expect(tool.band).toBe(other.id);
    expect(s.toolsOf(home)).not.toContain(tool);
    const checker = new InvariantChecker(s);
    checker.check();
    expect(checker.report()).toEqual([]);
  });
});

describe('a feud', () => {
  /** Two grown-ups of the first band who loathe each other; the healthier, a, strikes first. */
  function feud(regardForKiller: number) {
    const s = sim(1);
    const c = s.camp;
    const [a, b] = s.members(c).filter((p) => s.age(p) >= 16 && p.partner < 0);
    for (const p of [a, b]) p.traits = [];
    a.health = 100;
    b.health = 40;
    a.rel.set(b.id, -90);
    b.rel.set(a.id, -90);
    for (const q of s.members(c)) if (q !== a && q !== b) q.rel.set(a.id, regardForKiller);
    const r = (s as any).rLife;
    const next = r.next;
    r.next = () => 0.5;
    try {
      always(s, () => (s as any).feud(c, s.members(c)));
    } finally {
      r.next = next;
    }
    return { s, c, a, b };
  }

  it('ends in blood, and a killer the band cannot forgive is driven out to a camp of their own', () => {
    const { s, c, a, b } = feud(-20);
    expect(b.alive).toBe(false);
    expect(b.cause).toBe('killed');
    expect(b.killer).toBe(a.id);
    expect(c.lastFight).toBe(s.tick);
    const nc = s.campById(a.band)!;
    expect(nc).not.toBe(c);
    expect(nc.parent).toBe(c.id);
    expect(nc.leader).toBe(a.id);
    expect(nc.origin).toBe('turmoil');
    expect(s.members(nc)).toEqual([a]);
    expect(s.events.at(-1)!.kind).toBe('exile');
    // what they could carry: a little meat and wood
    expect(nc.stock.meat).toBeLessThanOrEqual(6);
    expect(nc.stock.wood).toBeLessThanOrEqual(6);
  });

  it('is let lie by a band that still thinks well of the killer', () => {
    const { s, c, a, b } = feud(60);
    expect(b.alive).toBe(false);
    expect(a.band).toBe(c.id);
    expect(s.events.at(-1)!.kind).toBe('death_quarrel');
    expect(s.events.at(-1)!.text).toBe(`${a.name} killed ${b.name} in a quarrel. The band let it lie.`);
  });
});

describe('an orphaned infant', () => {
  it('is taken in by the kindest grown-up in camp, who carries them from then on', () => {
    const s = sim(1);
    const baby = s.members().find((p) => s.age(p) < 2)!;
    expect(baby).toBeTruthy();
    const kind = s.members().filter((p) => s.age(p) >= 16 && p.id !== baby.mother && p.id !== baby.father).sort((a, b) => b.id - a.id)[0];
    for (const p of s.members()) p.traits = p.traits.filter((t) => t !== 'kind');
    kind.traits.push('kind');
    s.kill(s.byId.get(baby.mother)!, 'fever');
    s.kill(s.byId.get(baby.father)!, 'fever');
    s.step();
    expect(baby.carer).toBe(kind.id);
    expect(baby.home).toBe(kind.home);
    expect(s.events.some((e) => e.kind === 'fostering' && e.people.includes(baby.id))).toBe(true);
    for (let i = 0; i < 20; i++) s.step();
    expect(Math.hypot(baby.x - kind.x, baby.z - kind.z)).toBeLessThan(0.6);
    // taken in once: no second fostering the next tick
    s.step();
    expect(s.events.filter((e) => e.kind === 'fostering').length).toBe(1);
  });
});

describe('a famine', () => {
  it('grips a camp whose store is bare and whose people go hungry, counts the winter, and eases once there is food', () => {
    const s = sim(1);
    while (seasonOf(s.tick) !== 3) runTo(s, s.tick + 200);
    const c = s.camp;
    const winters = c.hungryWinters;
    for (const k of ['berries', 'meat', 'fish', 'preserved'] as const) c.stock[k] = 0;
    for (const p of s.members()) p.food = 10;
    (s as any).life();
    expect(c.famine).toBe(true);
    expect(c.lastFamine).toBe(s.tick);
    expect(c.hungryWinters).toBe(winters + 1);
    expect(s.events.at(-1)!.text).toBe(`Hunger grips ${c.name}.`);
    // it is the one famine, not a new one each morning
    (s as any).life();
    expect(c.hungryWinters).toBe(winters + 1);
    c.stock.preserved = s.members().length * 3 + 1;
    (s as any).life();
    expect(c.famine).toBe(false);
    expect(s.events.some((e) => e.kind === 'famine_end')).toBe(true);
  });

  it('in summer is a famine, but not a hungry winter', () => {
    const s = sim(1);
    while (seasonOf(s.tick) !== 1) runTo(s, s.tick + 200);
    const c = s.camp;
    for (const k of ['berries', 'meat', 'fish', 'preserved'] as const) c.stock[k] = 0;
    for (const p of s.members()) p.food = 10;
    (s as any).life();
    expect(c.famine).toBe(true);
    expect(c.hungryWinters).toBe(0);
  });
});

describe('out on the land alone after dark', () => {
  /** An adult far from camp and everyone, set upon by wolves in a winter night; escape when the odds beat 0.7. */
  function attacked(spear: boolean) {
    const s = sim(1);
    while (seasonOf(s.tick) !== 3) runTo(s, s.tick + 200);
    const c = s.camp;
    const p = s.members().find((q) => s.age(q) >= 16 && s.age(q) <= 60)!;
    p.traits = [];
    const spot = s.chooseSite({ from: c, min: 25, max: 50 });
    Object.assign(p, { x: (spot % s.N) + 0.5, z: Math.floor(spot / s.N) + 0.5, health: 100, carry: spear ? CARRY.Spear : CARRY.None });
    const r = (s as any).rWild;
    r.chance = (q: number) => q < 0.01 || q > 0.7;
    (s as any).wildAttack(p);
    return { s, p, c };
  }

  it('is sometimes set upon, and a spear in hand is the difference between getting away and not', () => {
    const bare = attacked(false);
    expect(bare.p.alive).toBe(false);
    expect(bare.p.cause).toBe('wolves');
    const armed = attacked(true);
    expect(armed.p.alive).toBe(true);
    expect(armed.p.health).toBe(55);
    expect(armed.s.events.at(-1)!.text).toBe(`${armed.p.name} was attacked by wolves and barely got away.`);
  });

  it('never happens near camp, nor with someone close by', () => {
    for (const where of ['camp', 'company'] as const) {
      const s = sim(1);
      const c = s.camp;
      const p = s.members().find((q) => s.age(q) >= 16)!;
      const q = s.members().find((x) => x !== p && s.age(x) >= 16)!;
      const spot = s.chooseSite({ from: c, min: 25, max: 50 });
      Object.assign(p, { x: where === 'camp' ? c.x + 5 : (spot % s.N) + 0.5, z: where === 'camp' ? c.z : Math.floor(spot / s.N) + 0.5, health: 100 });
      if (where === 'company') Object.assign(q, { x: p.x + 2, z: p.z });
      (s as any).rWild.chance = () => false;
      (s as any).wildAttack(p);
      expect(p.alive).toBe(true);
      expect(p.health).toBe(100);
    }
  });
});

describe('a save with several bands', () => {
  it('carries on identically, with each band and what it is about to learn', () => {
    const s = sim(1);
    const home = s.camp;
    const other = neighbour(s);
    other.knows.push('huts');
    other.stock.meat = 30;
    other.stock.wood = 20;
    // a household goes to live at the other camp; a lesson is owed to the first
    const movers = s.household(s.members().find((p) => s.age(p) < 30 && s.age(p) >= 20 && p.partner >= 0)!);
    (s as any).join(movers, other);
    home.learning = [{ k: 'huts', at: s.tick + 3 * TICKS_PER_DAY, by: s.members(home).find((p) => s.age(p) >= 16)!.id }];
    home.leanWinters = 2;
    home.rationedIn = 0;
    runTo(s, s.tick + 2 * TICKS_PER_DAY + 37);
    const b = new Sim(generateWorld(s.world.params), JSON.parse(JSON.stringify(s.serialize())) as SaveData);
    expect(b.liveCamps().map((c) => c.id)).toEqual(s.liveCamps().map((c) => c.id));
    expect(b.camp.id).toBe(s.camp.id);
    expect(b.historyHash()).toBe(s.historyHash());
    const end = s.tick + 6 * TICKS_PER_DAY;
    while (s.tick < end) {
      s.step();
      b.step();
      if (s.tick % TICKS_PER_DAY === 0) expect(b.historyHash(), `diverged at tick ${s.tick}`).toBe(s.historyHash());
    }
    expect(b.campById(home.id)!.knows).toContain('huts');
    expect(b.campById(home.id)!.leanWinters).toBe(2);
    expect(b.events.map((e) => e.text)).toEqual(s.events.map((e) => e.text));
  });
});
