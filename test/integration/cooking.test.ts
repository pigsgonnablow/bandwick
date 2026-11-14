// Cooking in a pot: the band's cook puts a stew on at the fire each evening and everyone eats from it together;
// bone broth from the cracked bones of the kills; and herb brews for fevers and for cold nights.
import { describe, it, expect } from 'vitest';
import { SK, CARRY, SKILLS, CRAFT_TITLES, STEW_GAIN, STEW_MASTER, STEW_BERRIES, BROTH_FILL, BROTH_KEEP, BREW_HERBS, BREW_WARM, BREW_KEEP, HERBS_WANT, HERBS_BREW} from '../../src/sim/band';
import { DISCOVERY, ABLE } from '../../src/sim/know';
import { TICKS_PER_DAY, hourOf } from '../../src/sim/time';
import { runTask, setup } from '../../src/sim/ai';
import { Sim, dishOf } from '../../src/sim/sim';
import { sim, runYears } from '../helpers';

const COOKING = ['pottery', 'cooking', 'herbs', 'stew'];
/** A band a year on that knows the stew pot (and whatever else is asked), with a cooking pot by the fire. */
function band(seed = 2, knows: string[] = []) {
  const s = runYears(sim(seed), 1);
  const c = s.camp;
  for (const k of [...COOKING, ...knows]) if (!c.knows.includes(k)) c.knows.push(k);
  s.items.push({ id: s.newId(), kind: 'cookpot', band: c.id, holder: -1, wear: 0, made: s.tick, maker: -1 });
  for (const k of ['berries', 'greens', 'mushrooms', 'eggs', 'fish', 'meat', 'roots', 'grain', 'nuts', 'preserved'] as const) c.stock[k] = 0;
  s.hearth().fuel = 10;
  return s;
}
const adult = (s: Sim) => s.members().find((q) => s.age(q) >= 18 && s.age(q) <= 50 && q.sick === 0)!;
const stewHour = (s: Sim) => (s as unknown as { stewHour(c: unknown): void }).stewHour(s.camp);
/** Step to the next time of day at this hour. */
function toHour(s: Sim, h: number) {
  do s.step(); while (Math.abs(hourOf(s.tick) - h) > 0.01);
}

describe('the discoveries', () => {
  it('thinks of the stew pot firing a pot by the fire, once the band roasts its food and knows pottery', () => {
    const d = DISCOVERY.get('stew')!;
    expect(d.needs).toEqual(['cooking', 'pottery']);
    expect(d.practice.fire_pot).toBeGreaterThan(0);
    expect(d.requires).toEqual([{ kind: 'skill', skill: SK.pot, level: 7 }, { kind: 'skill', skill: SK.forage, level: ABLE }]);
  });
  it('thinks of broth and brews at the stew pot, the cook who is good at it', () => {
    const broth = DISCOVERY.get('broth')!, brews = DISCOVERY.get('brews')!;
    expect(broth.needs).toEqual(['stew']);
    expect(brews.needs).toEqual(['stew', 'herbs']);
    expect(broth.practice.stew).toBeGreaterThan(0);
    expect(brews.practice.sickbed).toBeGreaterThan(0);
    for (const d of [broth, brews]) expect(d.requires.some((r) => r.kind === 'skill' && r.skill === SK.cook)).toBe(true);
  });
});

describe('the cook', () => {
  it('is a skill shown once the band knows the stew pot, and the best at it is known as the cook', () => {
    expect(SKILLS[SK.cook]).toBe('cooking');
    expect(CRAFT_TITLES[SK.cook]).toBe('cook');
    const s = runYears(sim(2), 1);
    expect(s.shownSkills()).not.toContain(SK.cook);
    s.camp.knows.push('pottery', 'stew');
    expect(s.shownSkills()).toContain(SK.cook);
    const ms = s.members().filter((q) => s.age(q) >= 16);
    for (const q of ms) { q.skills[SK.cook] = 5; for (let k = 0; k < SK.cook; k++) q.skills[k] = Math.min(q.skills[k], 4); delete q.known; }
    ms[0].skills[SK.cook] = 14;
    s.plan();
    expect(ms[0].known).toBe(SK.cook);
    expect(s.titled(ms[0])).toBe(`${ms[0].name}, the cook`);
  });

  it('comes into the world knowing something of cooking from what they know of food', () => {
    const s = sim(3);
    for (const p of s.members()) expect(p.skills[SK.cook]).toBeCloseTo(p.skills[SK.forage] * 0.6, 5);
  });

  it('puts the stew on in the late afternoon, takes it to the pot and stirs it till it is ready', () => {
    const s = band();
    const c = s.camp;
    c.stock.fish = 30;
    toHour(s, 15);
    const p = adult(s);
    p.x = c.x; p.z = c.z;
    expect(s.stewWanted()).toBe(true);
    p.task = setup(s, p, 'cook');
    for (let k = 0; k < 400 && p.task?.kind === 'cook'; k++) { runTask(s, p); s.tick++; }
    expect(c.stew).toBeDefined();
    expect(c.stew!.ready).toBeGreaterThan(0);
    expect(c.stew!.cook).toBe(p.id);
    expect(c.stew!.dish).toBe('fish stew');
    expect(c.stewed).toBe(s.evening());
    expect(s.stewWanted()).toBe(false);
    // (and the pot is a stew nearer cracking)
    expect(s.cookpotOf()!.wear).toBeGreaterThan(0);
  });

  it('feeds the band day after day in a band left to itself', () => {
    const s = band(3);
    const c = s.camp;
    c.stock.fish = 40; c.stock.roots = 40; c.stock.meat = 20;
    let stews = 0, seen: unknown;
    const cooks = new Set<number>();
    const start = s.tick;
    while (s.tick < start + 8 * TICKS_PER_DAY) {
      s.step();
      if (c.stew && c.stew !== seen && c.stew.ready >= 0) { seen = c.stew; stews++; cooks.add(c.stew.cook); }
    }
    expect(stews).toBeGreaterThanOrEqual(6);
    expect(s.stores().now.eaten).toBeGreaterThan(0);
  });
});

describe('the stew', () => {
  it('takes the foods that go off fastest first, enough for the evening and the morning, and fills more than raw', () => {
    const s = band();
    const c = s.camp;
    c.stock.greens = 2; c.stock.fish = 4; c.stock.meat = 50; c.stock.nuts = 50;
    const p = adult(s);
    p.skills[SK.cook] = 0;
    const stew = s.startStew(c, p);
    expect(stew.raw.greens).toBe(2);
    expect(stew.raw.fish).toBe(4);
    expect(stew.raw.meat).toBeGreaterThan(0);
    expect(stew.raw.nuts).toBeUndefined();
    expect(c.stock.greens).toBe(0);
    const raw = Object.values(stew.raw).reduce((a, b) => a + b!, 0);
    expect(stew.fill).toBeGreaterThan(raw * 1.25);
    expect(stew.fill).toBeLessThan(raw * STEW_GAIN + 1e-6);
  });

  it('fills more from a master cook, and puts berries in only for sweetness', () => {
    expect(new Sim(sim(2).world).stewGain('meat', 20)).toBeCloseTo(STEW_GAIN + STEW_MASTER);
    const s = band();
    const c = s.camp;
    c.stock.berries = 100;
    const stew = s.startStew(c, adult(s));
    // (a pot of nothing but berries is a small one: they make up no more than a share of what the band wants)
    expect(stew.raw.berries).toBeGreaterThan(0);
    expect(c.stock.berries).toBeGreaterThan(100 * (1 - STEW_BERRIES));
  });

  it('is called by what most of it is', () => {
    expect(dishOf('fish', { fish: 3 }, false)).toBe('fish stew');
    expect(dishOf('nuts', { nuts: 3 }, false)).toBe('acorn porridge');
    expect(dishOf('meat', { meat: 3, roots: 1 }, true)).toBe('stew of meat and roots in bone broth');
  });

  it('is eaten from the pot with everyone, and what is left by the next noon goes to waste', () => {
    const s = band();
    const c = s.camp;
    c.stock.fish = 30;
    toHour(s, 16);
    const cook = adult(s);
    s.startStew(c, cook);
    s.stewDone(c);
    const p = s.members().find((q) => q !== cook && s.age(q) >= 14)!;
    p.food = 40;
    p.x = c.x + 1; p.z = c.z;
    p.task = setup(s, p, 'eat');
    p.x = p.task!.gx; p.z = p.task!.gz;
    const before = c.stew!.fill, food = p.food;
    runTask(s, p);
    expect(p.carry).toBe(CARRY.Bowl);
    for (let k = 0; k < 40 && p.task; k++) runTask(s, p);
    expect(p.carry).toBe(CARRY.None);
    expect(c.stew!.fill).toBeLessThan(before);
    expect(p.food).toBeGreaterThan(food);
    // the next noon
    const spoiled = s.stores().now.spoiled;
    while (s.evening() === c.stew!.evening) s.tick++;
    stewHour(s);
    expect(c.stew).toBeUndefined();
    expect(s.stores().now.spoiled).toBeGreaterThan(spoiled);
  });
});

describe('bone broth', () => {
  it('boils the bones from the kills into the stew, leaving a few for the tools', () => {
    const s = band(2, ['broth', 'needles']);
    const c = s.camp;
    c.stock.fish = 30;
    c.stock.bones = 6;
    const stew = s.startStew(c, adult(s));
    expect(stew.bones).toBeGreaterThan(0);
    expect(c.stock.bones).toBeGreaterThanOrEqual(BROTH_KEEP);
    expect(stew.dish).toContain('bone broth');
    // (the bones' broth is food from nothing)
    const raw = Object.values(stew.raw).reduce((a, b) => a + b!, 0);
    expect(stew.fill).toBeGreaterThan(raw * STEW_GAIN + stew.bones! * BROTH_FILL - 1e-6);
  });
});

describe('herbal brews', () => {
  it('keeps more herbs once the band brews', () => {
    const s = band();
    expect(s.herbsWanted()).toBe(HERBS_WANT);
    s.camp.knows.push('brews');
    expect(s.herbsWanted()).toBe(HERBS_BREW);
  });

  it('steeps hot herbs with the stew on a cold evening, and warms whoever eats', () => {
    const s = band(2, ['brews']);
    const c = s.camp;
    c.stock.fish = 30;
    c.stock.herbs = 10;
    const cook = adult(s);
    s.tempAt = () => -5;
    const stew = s.startStew(c, cook);
    expect(stew.brew).toBe(true);
    expect(c.stock.herbs).toBeCloseTo(10 - BREW_HERBS);
    s.stewDone(c);
    const p = s.members().find((q) => q !== cook && s.age(q) >= 14)!;
    p.warmth = 30;
    p.food = 40;
    p.x = c.x + 1; p.z = c.z;
    p.task = setup(s, p, 'eat');
    for (let k = 0; k < 40 && p.task; k++) runTask(s, p);
    expect(p.warmth).toBeGreaterThanOrEqual(30 + BREW_WARM - 0.01);
    expect(p.warmed).toBeGreaterThan(s.tick);
    expect(BREW_KEEP).toBeLessThan(1);
  });

  it('has no brew on a warm evening', () => {
    const s = band(2, ['brews']);
    s.camp.stock.fish = 30;
    s.camp.stock.herbs = 10;
    s.tempAt = () => 18;
    expect(s.startStew(s.camp, adult(s)).brew).toBeUndefined();
  });

  it('nurses a fever with a hot brew steeped in the pot, which breaks it sooner', () => {
    const s = band(2, ['brews']);
    const c = s.camp;
    c.stock.herbs = 5;
    const sick = s.members().find((q) => s.age(q) >= 14)!;
    sick.sick = 6;
    sick.x = c.x + 2; sick.z = c.z + 1;
    sick.task = null;
    const nurse = s.members().find((q) => q !== sick && s.age(q) >= 18 && q.sick === 0)!;
    nurse.x = c.x; nurse.z = c.z;
    nurse.task = setup(s, nurse, 'nurse');
    expect(nurse.task!.brew).toBe(true);
    for (let k = 0; k < 400 && nurse.task?.kind === 'nurse'; k++) { runTask(s, nurse); sick.nextThink = s.tick + 100; }
    expect(sick.brewed).toBeGreaterThan(s.tick);
    expect(nurse.carry).toBe(CARRY.None);
  });
});

describe('the cooking pot', () => {
  it('is made by the potters once the band knows the stew pot, and stands at the hearth', () => {
    const s = band();
    s.items = s.items.filter((i) => i.kind !== 'cookpot');
    s.camp.stock.mud = 10;
    expect(s.toolToMake()).toBe('cookpot');
    expect(s.hearthLook(s.hearth())).toEqual({});
    s.items.push({ id: s.newId(), kind: 'cookpot', band: s.camp.id, holder: -1, wear: 0, made: s.tick, maker: -1 });
    expect(s.hearthLook(s.hearth())).toEqual({ look: 'hearthPotEmpty' });
    s.camp.stock.fish = 30;
    s.startStew(s.camp, adult(s));
    expect(s.hearthLook(s.hearth())).toEqual({ look: 'hearthPot' });
    // the cook squats by the pot, just outside the stones, wherever the hearth faces
    for (let r = 0; r < 4; r++) {
      s.hearth().rot = r;
      const at = s.potSpot();
      expect(Math.hypot(at.x - s.camp.x, at.z - s.camp.z)).toBeCloseTo(Math.hypot(0.12, 0.13), 5);
      expect(Math.hypot(at.sx - s.camp.x, at.sz - s.camp.z)).toBeGreaterThan(0.4);
    }
  });
});

describe('old saves', () => {
  it('gives everyone a cooking skill from their foraging', () => {
    const s = runYears(sim(2), 1);
    const d = s.serialize();
    for (const p of d.people) p.skills = p.skills.slice(0, SK.cook);
    const t = new Sim(s.world, d);
    for (const p of t.people) expect(p.skills[SK.cook]).toBeCloseTo(p.skills[SK.forage] * 0.6, 4);
  });
});

