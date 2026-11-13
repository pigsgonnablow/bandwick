// Pottery for the stores and the evenings: pots that keep the quick-spoiling foods, clay lamps that let the
// band work by the fire after dark, and storage jars fired in the kiln for the dry stores.
import { describe, it, expect } from 'vitest';
import { SK, RECIPE_KEYS, Task, TaskKind, Stock, POT_HOLDS, POT_KEEP, JAR_HOLDS, JAR_KEEP, LAMP_FAT, ITEMS, Item, ItemKind } from '../../src/sim/band';
import { DISCOVERY, meets } from '../../src/sim/know';
import { TICKS_PER_DAY, isDark, seasonOf, dayOf } from '../../src/sim/time';
import { runTask } from '../../src/sim/ai';
import { Sim } from '../../src/sim/sim';
import { sim, runTo, runYears } from '../helpers';

/** A band two years on, knowing pottery, with clay, wood and food in hand. */
function potters(seed = 2, knows: string[] = ['pottery']) {
  const s = runYears(sim(seed), 2);
  const c = s.camp;
  for (const k of knows) if (!c.knows.includes(k)) c.knows.push(k);
  c.stock.mud += 30;
  c.stock.wood += 60;
  c.stock.meat += 40;
  return s;
}
const spoil = (s: Sim, st: Stock) => (s as unknown as { spoilNow(x: Stock): void }).spoilNow(st);
const give = (s: Sim, kind: ItemKind, n: number) => s.giveTools(s.camp, { [kind]: n });
const clear = (s: Sim, kind: ItemKind) => { for (const it of s.toolsOf(s.camp, kind)) s.items.splice(s.items.indexOf(it), 1); };
/** A built kiln by the band's stockpile. */
function kiln(s: Sim) {
  const pile = s.buildings.find((b) => b.band === s.camp.id && b.kind === 'stockpile')!;
  const k = { ...pile, id: s.newId(), kind: 'kiln' as const, built: true };
  s.buildings.push(k);
  return k;
}
const task = (s: Sim, kind: TaskKind, at: { x: number; z: number }, ref = -1, stage = 0): Task =>
  ({ kind, stage, goal: s.tileOf(at), gx: at.x, gz: at.z, ref, timer: 0, started: s.tick, amount: 0, near: false });
const adult = (s: Sim) => s.members().find((q) => s.age(q) >= 18 && s.age(q) <= 50)!;
/** On to the next evening, after dark (stepping the world there). */
function toNight(s: Sim) {
  while (!isDark(s.tick) || (s.tick % TICKS_PER_DAY) < TICKS_PER_DAY / 2) s.step();
}

describe('pots for the stores', () => {
  it('keep greens, eggs, berries and mushrooms, the quickest to spoil first', () => {
    const s = potters();
    clear(s, 'pot');
    const fresh = { greens: 10, eggs: 10, berries: 10, mushrooms: 10 };
    const lost = (pots: number) => {
      clear(s, 'pot');
      give(s, 'pot', pots);
      const st = { ...s.camp.stock, ...fresh };
      spoil(s, st);
      return Object.fromEntries(Object.entries(fresh).map(([k, v]) => [k, v - st[k as keyof typeof fresh]]));
    };
    const open = lost(0);
    // two pots hold twelve: all the greens and two of the eggs
    const two = lost(2);
    expect(POT_HOLDS * 2).toBe(12);
    expect(two.greens).toBeCloseTo(open.greens * POT_KEEP, 5);
    expect(two.eggs).toBeLessThan(open.eggs);
    expect(two.eggs).toBeGreaterThan(open.eggs * POT_KEEP);
    expect(two.berries).toBeCloseTo(open.berries, 5);
    // with pots enough for everything, it all keeps
    const many = lost(8);
    for (const k of Object.keys(fresh)) expect(many[k], k).toBeCloseTo(open[k] * POT_KEEP, 5);
  });

  it('wear only while they hold something', () => {
    const s = potters();
    clear(s, 'pot');
    give(s, 'pot', 3);
    const st = { ...s.camp.stock, greens: 4, eggs: 0, berries: 0, mushrooms: 0 };
    spoil(s, st);
    const worn = s.toolsOf(s.camp, 'pot').filter((i) => i.wear > 0).length;
    expect(worn).toBe(1);
    expect(s.toolsOf(s.camp, 'pot')[0].wear).toBeCloseTo(1 / ITEMS.pot.uses, 6);
  });

  it('are wanted in greater number once the band keeps greens, eggs or mushrooms', () => {
    const s = potters();
    clear(s, 'pot');
    const c = s.camp;
    c.knows = c.knows.filter((k) => !['garden', 'eggs', 'mushrooms'].includes(k));
    // give the band every other thing it might want first, so the plan comes to the pots
    const enough = (n: number) => { clear(s, 'pot'); give(s, 'pot', n); };
    const want = () => {
      let n = 0;
      for (; n < 20; n++) {
        enough(n);
        if (s.toolToMake(c) !== 'pot') break;
      }
      return n;
    };
    // (only if the band isn't short of something it wants before pots)
    enough(0);
    if (s.toolToMake(c) !== 'pot') return;
    const before = want();
    c.knows.push('garden', 'eggs', 'mushrooms');
    expect(want()).toBe(before + 3);
  });
});

describe('clay lamps', () => {
  it('are thought of by a potter who knows hides, at work by the fire after dark', () => {
    const d = DISCOVERY.get('lamps')!;
    expect(d.needs).toEqual(['pottery']);
    expect(d.practice.night_work).toBeGreaterThan(0);
    const s = potters();
    const p = adult(s);
    p.skills[SK.pot] = 10;
    p.skills[SK.hide] = 6;
    expect(meets(p, d)).toBeGreaterThanOrEqual(0);
    p.skills[SK.pot] = 9;
    expect(meets(p, d)).toBe(-1);
  });

  it('are made once the band knows them, a few for the band', () => {
    const s = potters(2, ['pottery', 'lamps']);
    clear(s, 'lamp');
    let made = false;
    for (let d = 0; d < 30 && !made; d++) {
      runTo(s, s.tick + TICKS_PER_DAY);
      made = s.toolsOf(s.camp, 'lamp').length > 0;
    }
    expect(made).toBe(true);
    give(s, 'lamp', 10);
    expect(s.toolToMake(s.camp)).not.toBe('lamp');
  });

  it('are lit for work after dark, burning fat from the stores, and set back on the pile after', () => {
    const s = potters(2, ['pottery', 'lamps']);
    clear(s, 'lamp');
    give(s, 'lamp', 1);
    const lamp = s.toolsOf(s.camp, 'lamp')[0];
    const p = adult(s);
    toNight(s);
    const meat = s.camp.stock.meat + s.camp.stock.fish + s.camp.stock.preserved;
    p.task = { ...task(s, 'craft', p, RECIPE_KEYS.indexOf('cordage'), 1), amount: 1, timer: 20 };
    s.camp.stock.fiber += 3;
    runTask(s, p);
    expect(s.heldBy(p)).toBe(lamp);
    expect(p.thought).toMatch(/lamplight/);
    expect(meat - (s.camp.stock.meat + s.camp.stock.fish + s.camp.stock.preserved)).toBeCloseTo(LAMP_FAT, 5);
    expect(lamp.wear).toBeGreaterThan(0);
    // a second sitter finds no lamp free
    expect(s.lampToLight()).toBeUndefined();
    for (let i = 0; i < 30 && p.task; i++) { runTask(s, p); s.tick++; }
    expect(s.heldBy(p)).toBeUndefined();
    expect(lamp.holder).toBe(-1);
  });

  it('are filled once an evening, burning on for whoever picks them up again that night', () => {
    const s = potters(2, ['pottery', 'lamps']);
    clear(s, 'lamp');
    give(s, 'lamp', 1);
    const lamp = s.toolsOf(s.camp, 'lamp')[0];
    const [p, q] = s.members().filter((m) => s.age(m) >= 18 && s.age(m) <= 50);
    toNight(s);
    const fat = () => s.camp.stock.meat + s.camp.stock.fish + s.camp.stock.preserved;
    const before = fat();
    expect(s.lightLamp(p)).toBe(true);
    const wear = lamp.wear;
    s.putOutLamp(p);
    // later the same night, with the stores bare, it is still burning for the next sitter
    Object.assign(s.camp.stock, { meat: 0, fish: 0, preserved: 0 });
    expect(s.lightLamp(q)).toBe(true);
    expect(s.heldBy(q)).toBe(lamp);
    expect(lamp.wear).toBe(wear);
    s.putOutLamp(q);
    expect(before - LAMP_FAT).toBeGreaterThan(0);
    // the next evening it needs filling again
    s.camp.stock.meat = 5;
    s.tick += TICKS_PER_DAY;
    expect(s.lightLamp(p)).toBe(true);
    expect(s.camp.stock.meat).toBeCloseTo(5 - LAMP_FAT, 5);
    expect(lamp.wear).toBeGreaterThan(wear);
  });

  it('are not lit by day, nor without fat to burn', () => {
    const s = potters(2, ['pottery', 'lamps']);
    clear(s, 'lamp');
    give(s, 'lamp', 1);
    const p = adult(s);
    while (isDark(s.tick)) s.tick++;
    p.task = { ...task(s, 'craft', p, RECIPE_KEYS.indexOf('cordage'), 1), amount: 1, timer: 20 };
    runTask(s, p);
    expect(s.heldBy(p)?.kind).not.toBe('lamp');
    toNight(s);
    Object.assign(s.camp.stock, { meat: 0, fish: 0, preserved: 0 });
    expect(s.lampToLight()).toBeUndefined();
    expect(s.lightLamp(p)).toBe(false);
  });

  it('keep those not yet tired up on a winter evening, making and mending by the fire', () => {
    const count = (lamps: boolean) => {
      const s = potters(2, lamps ? ['pottery', 'lamps'] : ['pottery']);
      // (without lamps, a band that worked them out on its own forgets them for the test)
      if (!lamps) s.camp.knows = s.camp.knows.filter((k) => k !== 'lamps');
      // on into the winter, when the evenings are long
      while (seasonOf(s.tick) !== 3) s.step();
      clear(s, 'lamp');
      if (lamps) give(s, 'lamp', 6);
      let n = 0;
      for (let k = 0; k < TICKS_PER_DAY * 12; k += 2) {
        // fiber to twist and no cordage put by: there is always sitting work wanted
        s.camp.stock.fiber = Math.max(s.camp.stock.fiber, 30);
        s.camp.stock.cordage = Math.min(s.camp.stock.cordage, 1);
        s.camp.stock.meat = Math.max(s.camp.stock.meat, 20);
        // (no stories told: they would draw everyone from their work to listen, lamps or no lamps)
        s.camp.storyNight = dayOf(s.tick);
        if (!lamps) s.camp.knows = s.camp.knows.filter((k) => k !== 'lamps');
        runTo(s, s.tick + 2);
        if (isDark(s.tick)) n += s.members().filter((q) => (q.task?.kind === 'craft' || q.task?.kind === 'mend') && q.task.stage === 1).length;
      }
      return n;
    };
    const lit = count(true), dark = count(false);
    expect(lit).toBeGreaterThan(dark * 1.25);
  });

  it('give the potters the idea at their evening work', () => {
    const s = potters();
    const p = adult(s);
    p.skills[SK.pot] = 14;
    p.skills[SK.hide] = 10;
    p.traits = ['curious'];
    toNight(s);
    let tries = 0;
    while (!s.camp.knows.includes('lamps') && tries++ < 400) {
      p.task = { ...task(s, 'craft', p, RECIPE_KEYS.indexOf('cordage'), 1), amount: 1, timer: 1 };
      runTask(s, p);
    }
    expect(s.camp.knows).toContain('lamps');
  });
});

describe('storage jars', () => {
  it('are thought of by a skilled potter once the band has a kiln', () => {
    const d = DISCOVERY.get('jars')!;
    expect(d.needs).toEqual(['kiln']);
    expect(d.near).toBe('mud');
  });

  it('are fired only in a kiln, and only as many as the dry stores want', () => {
    const s = potters(2, ['pottery', 'kiln', 'jars']);
    const c = s.camp;
    Object.assign(c.stock, { grain: 0, nuts: 0, herbs: 0 });
    expect(s.canCraft('jar')).toBe(false);
    kiln(s);
    expect(s.canCraft('jar')).toBe(true);
    expect(s.jarsWanted()).toBe(1);
    c.stock.grain = JAR_HOLDS * 3 + 1;
    expect(s.jarsWanted()).toBe(5);
    c.stock.grain = 10000;
    expect(s.jarsWanted()).toBe(10);
    // the band's other wants met, it comes to the jars
    for (const k of ['axe', 'chopper', 'stick', 'basket', 'pot'] as const) give(s, k, 10);
    const make = s.toolToMake(c);
    if (make) expect(['jar', 'cloak', 'hat', 'mittens', 'shoes', 'bag', 'cape', 'furcloak', 'needle']).toContain(make);
  });

  it('keep the herbs, then the grain, then the acorns', () => {
    const s = potters();
    clear(s, 'jar');
    const dry = { herbs: 5, grain: 30, nuts: 30 };
    const lost = (jars: number) => {
      clear(s, 'jar');
      give(s, 'jar', jars);
      const st = { ...s.camp.stock, ...dry };
      spoil(s, st);
      return Object.fromEntries(Object.entries(dry).map(([k, v]) => [k, v - st[k as keyof typeof dry]]));
    };
    const open = lost(0);
    const one = lost(1); // twenty: the five herbs and fifteen of the grain
    expect(one.herbs).toBeCloseTo(open.herbs * JAR_KEEP, 6);
    expect(one.grain).toBeLessThan(open.grain);
    expect(one.grain).toBeGreaterThan(open.grain * JAR_KEEP);
    expect(one.nuts).toBeCloseTo(open.nuts, 6);
    const many = lost(4);
    for (const k of Object.keys(dry)) expect(many[k], k).toBeCloseTo(open[k] * JAR_KEEP, 6);
  });

  it('are made at the kiln, and come out whole nearly always', () => {
    const s = potters(2, ['pottery', 'kiln', 'jars']);
    const k = kiln(s);
    clear(s, 'jar');
    s.camp.stock.grain = 200;
    let made = 0, seen = false;
    for (let d = 0; d < 30 && made < 2; d++) {
      for (let t = 0; t < TICKS_PER_DAY; t += 10) {
        runTo(s, s.tick + 10);
        for (const p of s.members()) if (p.task?.kind === 'craft' && p.task.amount > 0 && RECIPE_KEYS[p.task.ref] === 'jar') {
          seen = true;
          expect(Math.hypot(p.task.gx - (k.x + 0.5), p.task.gz - (k.z + 0.5))).toBeLessThan(0.8);
        }
      }
      made = s.toolsOf(s.camp, 'jar').length;
    }
    expect(seen).toBe(true);
    expect(made).toBeGreaterThan(0);
  });

  it('stand by the stockpile, storehouse or not', () => {
    const s = potters();
    clear(s, 'jar');
    give(s, 'jar', 3);
    const pile = s.packPiles().find((q) => q.id === s.buildings.find((b) => b.band === s.camp.id && b.kind === 'stockpile')!.id)!;
    expect(pile.jars).toBe(3);
  });

  it('have a card that says what they do', () => {
    const s = potters();
    clear(s, 'jar');
    clear(s, 'lamp');
    give(s, 'jar', 1);
    give(s, 'lamp', 1);
    for (const kind of ['jar', 'lamp'] as const) {
      const it = s.toolsOf(s.camp, kind)[0] as Item;
      const card = s.inspectThing({ kind: 'item', id: it.id })!;
      expect(card.lines.find((l) => l.label === 'Good for')?.value, kind).toBeTruthy();
    }
  });
});
