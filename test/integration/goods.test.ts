// The band's goods: bowls and beads made in the hours a fed band has free, how well they are made, the
// kiln, the wood left to the woodcutters, and where the goods go (gifts, graves, the feast).
import { describe, it, expect } from 'vitest';
import { SK, GOODS, GOODS_EACH, GOODS_OVER, Item, WOODCUTTER, RECIPE_KEYS, Person, Task, TaskKind, KILN_CRACK, HEARTH_CRACK } from '../../src/sim/band';
import { DISCOVERY, ELITE } from '../../src/sim/know';
import { TICKS_PER_DAY, TICKS_PER_YEAR, dayOf } from '../../src/sim/time';
import { abandon, runTask } from '../../src/sim/ai';
import { Sim } from '../../src/sim/sim';
import { sim, runTo, runYears } from '../helpers';

/** A band two years on, fed, knowing pottery and beads, with clay, stone and wood in hand. */
function fedBand(seed = 2) {
  const s = runYears(sim(seed), 2);
  const c = s.camp;
  for (const k of ['pottery', 'beads']) if (!c.knows.includes(k)) c.knows.push(k);
  c.stock.mud += 30;
  c.stock.stone += 30;
  c.stock.wood += 60;
  c.stock.grain += 2000;
  c.stock.preserved += 500;
  return s;
}
const good = (s: Sim, it: Item) => GOODS.includes(it.kind) && it.band === s.camp.id;
const task = (s: Sim, kind: TaskKind, at: { x: number; z: number }, ref = -1, stage = 0): Task =>
  ({ kind, stage, goal: s.tileOf(at), gx: at.x, gz: at.z, ref, timer: 0, started: s.tick, amount: 0, near: false });
/** Run someone's current task to its end (or for at most `n` ticks), advancing the clock as it goes. */
function finishTask(s: Sim, p: Person, n = 600) {
  const t = p.task;
  for (let i = 0; i < n && p.task === t; i++) {
    runTask(s, p);
    s.tick++;
  }
}
/** An adult of the band in focus. */
const adult = (s: Sim, skip: Person[] = []) => s.members().find((q) => s.age(q) >= 18 && s.age(q) <= 50 && !skip.includes(q))!;
const total = (s: Sim, k: string) => s.camps.reduce((n, c) => n + (c.ledger?.total?.[k] ?? 0), 0);
const mk = (s: Sim, kind: 'bowl' | 'beads', quality: number, wear = 0): Item => {
  const it: Item = { id: s.newId(), kind, band: s.camp.id, holder: -1, wear, made: s.tick, maker: -1, quality };
  s.items.push(it);
  return it;
};
/** Sit someone down to finish making a thing: the materials already set aside, one tick of work left. */
function makeOne(s: Sim, p: Person, key: 'bowl' | 'beads' | 'pot') {
  p.task = { ...task(s, 'craft', p, RECIPE_KEYS.indexOf(key), 1), amount: 1, timer: 1 };
  runTask(s, p);
}
/** A gift under way: the giver has set aside a string of beads for someone dear. */
function giftUnderWay(s: Sim) {
  const p = adult(s), q = adult(s, [p]);
  const bead = mk(s, 'beads', 1);
  bead.tile = -3;
  p.task = { ...task(s, 'gift', p, q.id, 3), timer: 1, good: bead.id };
  q.x = p.x + 0.5; q.z = p.z;
  return { p, q, bead };
}

describe('the band\'s goods', () => {
  it('makes bowls and beads in its free hours, plain, good or fine by the maker\'s skill', () => {
    const s = fedBand();
    const seen = new Set<string>();
    for (let d = 0; d < 20; d++) {
      for (let k = 0; k < TICKS_PER_DAY; k += 20) {
        runTo(s, s.tick + 20);
        for (const p of s.members()) if (p.task?.kind === 'craft') seen.add(RECIPE_KEYS[p.task.ref]);
      }
    }
    expect(seen.has('bowl') || seen.has('beads')).toBe(true);
    const made = s.items.filter((i) => good(s, i));
    expect(made.length).toBeGreaterThan(0);
    for (const it of made) {
      expect([0, 1, 2]).toContain(it.quality);
      expect(it.maker).toBeGreaterThanOrEqual(0);
    }
    // never more on the pile than one for each of the band and a few over
    expect(s.goodsOf().length).toBeLessThanOrEqual(s.members().length * GOODS_EACH + GOODS_OVER);
  });

  it('makes no goods while food is short', () => {
    const s = fedBand();
    for (let d = 0; d < 4; d++) {
      // the stores emptied overnight: the morning's plan is food, not bowls
      for (const k of ['berries', 'meat', 'fish', 'preserved', 'roots', 'nuts', 'eggs', 'honey', 'mushrooms', 'grain', 'greens'] as const) s.camp.stock[k] = 0;
      runTo(s, s.tick + TICKS_PER_DAY);
      expect(s.camp.jobs['craft.bowl'] ?? 0).toBe(0);
      expect(s.camp.jobs['craft.beads'] ?? 0).toBe(0);
    }
  });

  it('makes finer things the more skilled the maker, and a kiln is worth some years to a potter', () => {
    const s = fedBand();
    const p = s.members().find((q) => s.age(q) >= 16)!;
    const mean = () => {
      let t = 0;
      for (let i = 0; i < 400; i++) t += s.qualityFor(p, 'bowl');
      return t / 400;
    };
    p.skills[SK.pot] = 3;
    const novice = mean();
    p.skills[SK.pot] = 18;
    const master = mean();
    p.skills[SK.pot] = 10;
    const mid = mean();
    s.camp.knows.push('kiln');
    s.buildings.push({ ...s.buildings.find((b) => b.band === s.camp.id && b.kind === 'stockpile')!, id: s.newId(), kind: 'kiln', built: true });
    const kiln = mean();
    expect(novice).toBe(0);
    expect(master).toBeGreaterThan(1.5);
    expect(mid).toBeGreaterThan(novice);
    expect(kiln).toBeGreaterThan(mid);
  });

  it('wears a fine thing slower than a plain one', () => {
    const s = fedBand();
    const mk = (quality: number): Item => ({ id: s.newId(), kind: 'bowl', band: s.camp.id, holder: -1, wear: 0, made: s.tick, maker: -1, quality });
    const plain = mk(0), fine = mk(2);
    s.items.push(plain, fine);
    for (let i = 0; i < 50; i++) { s.wearTool(plain); s.wearTool(fine); }
    expect(fine.wear).toBeLessThan(plain.wear * 0.8);
  });

  it('leaves the wood to the woodcutters once the pile is three times what the band wants', () => {
    const s = fedBand(3);
    s.camp.stock.wood = 5000;
    runTo(s, s.tick + TICKS_PER_DAY);
    expect(s.camp.jobs.woodPlenty).toBe(1);
    let novices = 0;
    for (let k = 0; k < TICKS_PER_DAY * 3; k += 5) {
      runTo(s, s.tick + 5);
      s.camp.stock.wood = Math.max(s.camp.stock.wood, 5000);
      for (const p of s.members()) {
        const kind = p.task?.kind;
        if ((kind === 'fell' || kind === 'deadwood') && p.skills[SK.wood] < WOODCUTTER && s.hearth().fuel >= 2 && s.age(p) >= 14) novices++;
      }
    }
    expect(novices).toBe(0);
  });

  it('gives a string of beads from the goods rather than stringing teeth, and it is worn at the neck', () => {
    const s = fedBand();
    s.camp.stock.trinkets = 0;
    const bead: Item = { id: s.newId(), kind: 'beads', band: s.camp.id, holder: -1, wear: 0, made: s.tick, maker: -1, quality: 2 };
    s.items.push(bead);
    for (const p of s.members()) p.gave = -1e9;
    let given = false;
    for (let d = 0; d < 30 && !given; d++) {
      runTo(s, s.tick + TICKS_PER_DAY);
      given = bead.wearer !== undefined;
    }
    expect(given).toBe(true);
    const q = s.byId.get(bead.wearer!)!;
    expect(q.worn?.neck).toBe(bead.id);
    expect(q.memories.some((m) => m.kind === 'gift' && /string of beads/.test(m.text))).toBe(true);
  });

  it('buries the finest of the goods with the dead, and their kin remember it', () => {
    const s = fedBand();
    const fine: Item = { id: s.newId(), kind: 'bowl', band: s.camp.id, holder: -1, wear: 0, made: s.tick, maker: -1, quality: 2 };
    const plain: Item = { id: s.newId(), kind: 'bowl', band: s.camp.id, holder: -1, wear: 0, made: s.tick, maker: -1, quality: 0 };
    s.items.push(plain, fine);
    const dead = s.members().find((p) => s.age(p) >= 30 && s.members().some((q) => q !== p && s.isKin(q, p)))!;
    s.kill(dead, 'old age');
    for (let d = 0; d < 6 && !dead.buried; d++) runTo(s, s.tick + TICKS_PER_DAY);
    expect(dead.buried).toBe(true);
    expect(s.items.includes(fine)).toBe(false);
    expect(s.members().some((q) => q.memories.some((m) => m.kind === 'grave_goods' && m.text.includes(dead.name)))).toBe(true);
  });

  it('finds beads and the kiln as discoveries, the kiln only after pottery and near clay', () => {
    expect(DISCOVERY.get('beads')!.needs).toEqual(['huts']);
    expect(DISCOVERY.get('kiln')!.needs).toEqual(['pottery']);
    expect(DISCOVERY.get('kiln')!.near).toBe('mud');
    const s = fedBand();
    s.camp.knows.push('kiln');
    runTo(s, s.tick + 2 * TICKS_PER_DAY);
    expect(s.buildings.some((b) => b.band === s.camp.id && b.kind === 'kiln')).toBe(true);
  });

  it('sites no kiln or storage pit where there is no clay to be dug, whatever the band was taught', () => {
    const s = fedBand();
    (s as any).mudSpots = [];
    (s as any).nearCache.clear();
    s.camp.knows.push('kiln', 'garden', 'grain', 'pits');
    runTo(s, s.tick + 2 * TICKS_PER_DAY);
    expect(s.buildings.filter((b) => b.band === s.camp.id && (b.kind === 'kiln' || b.kind === 'pit')).map((b) => b.kind)).toEqual([]);
    expect(DISCOVERY.get('pits')!.near).toBe('mud');
  });

  it('rates a thing plain below a sixth of the way into the craft, and always fine at the top of it; the kiln helps only the potter', () => {
    const s = fedBand();
    const p = adult(s);
    const all = (key: 'bowl' | 'beads') => new Set(Array.from({ length: 200 }, () => s.qualityFor(p, key)));
    p.skills[SK.pot] = 6;
    p.skills[SK.tool] = 6;
    expect(all('bowl')).toEqual(new Set([0]));
    expect(all('beads')).toEqual(new Set([0]));
    p.skills[SK.pot] = 17;
    p.skills[SK.tool] = 17;
    expect(all('bowl')).toEqual(new Set([2]));
    expect(all('beads')).toEqual(new Set([2]));
    // a kiln is three years' practice to a potter, and nothing to someone grinding beads
    p.skills[SK.pot] = 3;
    p.skills[SK.tool] = 3;
    s.camp.knows.push('kiln');
    s.buildings.push({ ...s.buildings.find((b) => b.band === s.camp.id && b.kind === 'stockpile')!, id: s.newId(), kind: 'kiln', built: true });
    expect(all('beads')).toEqual(new Set([0]));
    expect(all('bowl')).toEqual(new Set([0]));
    p.skills[SK.pot] = 14;
    expect(all('bowl')).toEqual(new Set([2]));
  });

  it('cracks a beginner\'s bowls in the open embers, a master\'s less, and hardly any in a kiln', () => {
    const rate = (pot: number, kiln: boolean) => {
      const s = fedBand();
      const p = adult(s);
      if (kiln) s.buildings.push({ ...s.buildings.find((b) => b.band === s.camp.id && b.kind === 'stockpile')!, id: s.newId(), kind: 'kiln', built: true });
      const made0 = total(s, 'made.bowl'), cracked0 = total(s, 'cracked.bowl');
      for (let i = 0; i < 600; i++) {
        p.skills[SK.pot] = pot;
        makeOne(s, p, 'bowl');
      }
      const made = total(s, 'made.bowl') - made0, cracked = total(s, 'cracked.bowl') - cracked0;
      expect(made + cracked).toBe(600);
      return cracked / 600;
    };
    expect(rate(0, false)).toBeCloseTo(HEARTH_CRACK, 1);
    expect(rate(18, false)).toBeCloseTo(HEARTH_CRACK * 0.25, 1);
    expect(rate(0, true)).toBeLessThan(KILN_CRACK * 2.5);
  });

  it('teaches the kiln only to potters firing in the open, and a cracked pot teaches them twice over', () => {
    const s = fedBand();
    const p = adult(s);
    const fired: number[] = [];
    const real = s.practise.bind(s);
    s.practise = (q, what, amount = 1) => { if (what === 'fire_pot') fired.push(amount); real(q, what, amount); };
    p.skills[SK.pot] = 5;
    // (counting only these: the band may have fired bowls of its own before)
    const made0 = total(s, 'made.bowl'), cracked0 = total(s, 'cracked.bowl');
    for (let i = 0; i < 40; i++) makeOne(s, p, 'bowl');
    const made = total(s, 'made.bowl') - made0, cracked = total(s, 'cracked.bowl') - cracked0;
    expect(fired.length).toBe(40);
    expect(fired.filter((a) => a === 2).length).toBe(cracked);
    expect(fired.filter((a) => a === 1).length).toBe(made);
    // beads are not fired
    fired.length = 0;
    for (let i = 0; i < 10; i++) makeOne(s, p, 'beads');
    expect(fired).toEqual([]);
    // and with a kiln, nothing more is learned of firing in the open
    s.buildings.push({ ...s.buildings.find((b) => b.band === s.camp.id && b.kind === 'stockpile')!, id: s.newId(), kind: 'kiln', built: true });
    for (let i = 0; i < 10; i++) makeOne(s, p, 'bowl');
    expect(fired).toEqual([]);
  });

  it('when the pile is full, the plainest of the old goods goes into everyday use, and the finest are kept', () => {
    const s = fedBand();
    const p = adult(s);
    for (const it of s.goodsOf()) s.items.splice(s.items.indexOf(it), 1);
    const cap = s.members().length * GOODS_EACH + GOODS_OVER;
    // a fine bowl, well worn; the rest plain, one more worn than the others
    const fine = mk(s, 'bowl', 2, 0.9);
    const worn = mk(s, 'bowl', 0, 0.5);
    for (let i = 2; i < cap; i++) mk(s, 'bowl', 0, 0.1);
    expect(s.goodsWanted()).toBe(0);
    p.skills[SK.tool] = 18;
    makeOne(s, p, 'beads');
    expect(s.goodsOf().length).toBeLessThanOrEqual(cap);
    expect(s.items.includes(fine)).toBe(true);
    expect(s.items.includes(worn)).toBe(false);
    expect(total(s, 'goods.used')).toBeGreaterThan(0);
  });

  it('counts the goods being made against what the band wants', () => {
    const s = fedBand();
    for (const it of s.goodsOf()) s.items.splice(s.items.indexOf(it), 1);
    const want = s.goodsWanted();
    expect(want).toBe(s.members().length * GOODS_EACH + GOODS_OVER);
    const p = adult(s);
    p.task = { ...task(s, 'craft', p, RECIPE_KEYS.indexOf('bowl'), 1), amount: 1, timer: 50 };
    expect(s.goodsWanted()).toBe(want - 1);
    // a beads gift under way: the beads are not on the pile, and not given twice
    const { bead } = giftUnderWay(s);
    expect(s.goodsOf()).not.toContain(bead);
  });

  it('makes no goods it has not thought of', () => {
    const s = runYears(sim(2), 2);
    const c = s.camp;
    c.knows = c.knows.filter((k) => k !== 'pottery' && k !== 'beads');
    // (and whatever goods it made before it forgot)
    for (const it of s.items.filter((i) => GOODS.includes(i.kind))) s.items.splice(s.items.indexOf(it), 1);
    Object.assign(c.stock, { mud: 30, stone: 30, wood: 200, grain: 2000, preserved: 500 });
    for (let d = 0; d < 6; d++) {
      runTo(s, s.tick + TICKS_PER_DAY);
      expect(c.jobs['craft.bowl'] ?? 0).toBe(0);
      expect(c.jobs['craft.beads'] ?? 0).toBe(0);
      expect(s.canCraft('bowl')).toBe(false);
      expect(s.canCraft('beads')).toBe(false);
    }
    expect(s.items.some((i) => GOODS.includes(i.kind))).toBe(false);
  });

  it('keeps everyone at the wood again once the pile drops below three times what the band wants', () => {
    const s = fedBand(3);
    s.camp.stock.wood = 5000;
    runTo(s, s.tick + TICKS_PER_DAY);
    expect(s.camp.jobs.woodPlenty).toBe(1);
    expect(s.camp.plan).toContain('The woodpile is full: the wood is left to the woodcutters');
    s.camp.stock.wood = 5;
    runTo(s, s.tick + TICKS_PER_DAY);
    expect(s.camp.jobs.woodPlenty).toBe(0);
  });

  it('still sends the woodcutters out when the pile is full', () => {
    const s = fedBand(3);
    const ms = s.members().filter((p) => s.age(p) >= 16 && s.age(p) < 50);
    for (const p of ms) p.skills[SK.wood] = WOODCUTTER + 4;
    let cutting = 0;
    for (let k = 0; k < TICKS_PER_DAY * 4; k += 5) {
      runTo(s, s.tick + 5);
      s.camp.stock.wood = Math.max(s.camp.stock.wood, 5000);
      for (const p of ms) if (['fell', 'haul', 'deadwood'].includes(p.task?.kind ?? '')) cutting++;
    }
    expect(s.camp.jobs.woodPlenty).toBe(1);
    expect(cutting).toBeGreaterThan(0);
  });

  it('counts someone a master of a craft at the top of it, only in a craft their band knows', () => {
    const s = fedBand();
    const p = adult(s);
    p.skills[SK.pot] = ELITE - 1;
    p.skills[SK.tool] = 0;
    expect(s.isMaster(p)).toBe(false);
    p.skills[SK.pot] = ELITE;
    expect(s.isMaster(p)).toBe(true);
    s.camp.knows = s.camp.knows.filter((k) => k !== 'pottery');
    expect(s.isMaster(p)).toBe(false);
    p.skills[SK.tool] = ELITE;
    expect(s.isMaster(p)).toBe(true);
  });

  it('leaves a master to their craft in a band with a year\'s food put by', () => {
    const s = fedBand();
    const p = adult(s);
    p.skills[SK.pot] = 18;
    p.skills[SK.tool] = 18;
    let craft = 0, spared = 0, n = 0;
    for (let k = 0; k < TICKS_PER_DAY * 6; k += 4) {
      runTo(s, s.tick + 4);
      Object.assign(s.camp.stock, { mud: Math.max(s.camp.stock.mud, 20), stone: Math.max(s.camp.stock.stone, 20) });
      if (!s.camp.provided || !p.task) continue;
      n++;
      if (p.task.kind === 'craft') craft++;
      if (['fell', 'haul', 'deadwood', 'forage', 'fish', 'hunt', 'dig', 'quarry'].includes(p.task.kind)) spared++;
    }
    expect(n).toBeGreaterThan(50);
    expect(craft).toBeGreaterThan(spared);
  });

  it('puts the beads back with the goods when the gift is given up', () => {
    const s = fedBand();
    const { p, bead } = giftUnderWay(s);
    expect(s.goodsOf()).not.toContain(bead);
    abandon(s, p);
    expect(bead.tile).toBeUndefined();
    expect(s.goodsOf()).toContain(bead);
    expect(bead.wearer).toBeUndefined();
  });

  it('puts beads set aside for a gift back with the goods at day\'s end, if nobody is giving them', () => {
    const s = fedBand();
    const { p, bead } = giftUnderWay(s);
    p.task = null;
    for (const q of s.people) p.gave = q.gave = s.tick; // (and nobody is minded to give them again just yet)
    runTo(s, s.tick + TICKS_PER_DAY);
    expect(bead.tile).toBeUndefined();
    expect(s.goodsOf()).toContain(bead);
  });

  it('gives nothing, and strings no teeth, if the beads set aside are gone', () => {
    const s = fedBand();
    const { p, q, bead } = giftUnderWay(s);
    s.items.splice(s.items.indexOf(bead), 1);
    const trinkets = s.camp.stock.trinkets, given = total(s, 'gifts.given');
    const neck = q.worn?.neck;
    finishTask(s, p);
    expect(p.task?.kind).not.toBe('gift');
    expect(q.worn?.neck).toBe(neck);
    expect(s.items.some((i) => i.kind === 'necklace' && i.wearer === q.id && i.id !== neck)).toBe(false);
    expect(s.camp.stock.trinkets).toBe(trinkets);
    expect(total(s, 'gifts.given')).toBe(given);
  });

  it('a string of beads replaces the necklace worn before, and the card says who gave it and who made it', () => {
    const s = fedBand();
    const { p, q, bead } = giftUnderWay(s);
    const maker = adult(s, [p, q]);
    bead.maker = maker.id;
    const old = s.giveNecklace(q, p.id);
    // (from an even footing: a friendship already near its height has little room to grow)
    q.rel.set(p.id, 0);
    const before = q.rel.get(p.id) ?? 0;
    finishTask(s, p);
    expect(q.worn?.neck).toBe(bead.id);
    expect(bead.wearer).toBe(q.id);
    expect(bead.giver).toBe(p.id);
    expect(s.items.includes(old)).toBe(false);
    expect(total(s, 'gifts.beads')).toBeGreaterThan(0);
    // a good string of beads counts for more than teeth on a cord
    expect((q.rel.get(p.id) ?? 0) - before).toBeGreaterThan(q.id === p.partner ? 6 : 10);
    const card = s.inspectThing({ kind: 'item', id: bead.id })!;
    const line = (l: string) => card.lines.find((x) => x.label === l);
    expect(line('Given by')?.value).toBe(p.name);
    expect(line('Made by')?.value).toBe(maker.name);
    expect(line('Workmanship')?.value).toMatch(/^Good/);
    expect(line('Condition')).toBeUndefined();
    const gear = s.inspect(q.id)!.gear.find((g) => g.slot === 'neck')!.item!;
    expect(gear).toMatchObject({ id: bead.id, given: true, maker: { id: p.id } });
    // and it goes into the grave with them
    s.kill(q, 'old age');
    runTo(s, s.tick + TICKS_PER_DAY);
    expect(s.items.includes(bead)).toBe(false);
  });

  it('keeps a beads gift under way through a save and load, and gives it after', () => {
    const s = fedBand();
    const { p, q, bead } = giftUnderWay(s);
    const r = new Sim(s.world, JSON.parse(JSON.stringify(s.serialize())));
    const rp = r.byId.get(p.id)!, rq = r.byId.get(q.id)!;
    const rb = r.items.find((i) => i.id === bead.id)!;
    expect(rp.task?.good).toBe(bead.id);
    expect(rb.tile).toBe(-3);
    expect(rb.quality).toBe(1);
    r.camp = r.campOf(rp);
    finishTask(r, rp);
    expect(rq.worn?.neck).toBe(bead.id);
  });

  it('keeps the goods and how well each was made through a save and load', () => {
    const s = fedBand();
    mk(s, 'bowl', 2, 0.3);
    mk(s, 'beads', 1);
    const r = new Sim(s.world, JSON.parse(JSON.stringify(s.serialize())));
    expect(r.items).toEqual(s.items);
    expect(r.goodsOf(r.campById(s.camp.id)!).map((i) => i.id)).toEqual(s.goodsOf().map((i) => i.id));
  });

  it('wears the bowls on the pile a little each day, and never the beads', () => {
    const s = fedBand();
    const bowl = mk(s, 'bowl', 0), beads = mk(s, 'beads', 0);
    runTo(s, s.tick + 3 * TICKS_PER_DAY);
    expect(bowl.wear).toBeGreaterThan(0);
    expect(beads.wear).toBe(0);
  });

  it('lays no goods in the grave of a little child', () => {
    const s = fedBand();
    const fine = mk(s, 'bowl', 2);
    const dead = adult(s);
    s.kill(dead, 'fever');
    dead.birth = s.tick - TICKS_PER_YEAR;
    for (let d = 0; d < 6 && !dead.buried; d++) runTo(s, s.tick + TICKS_PER_DAY);
    expect(dead.buried).toBe(true);
    expect(s.items.includes(fine)).toBe(true);
  });

  it('sets the band\'s goods out at the midwinter feast: the more and finer, the prouder the night', () => {
    const feast = (n: number) => {
      const s = fedBand();
      for (const it of s.goodsOf()) s.items.splice(s.items.indexOf(it), 1);
      for (let i = 0; i < n; i++) mk(s, i % 2 ? 'bowl' : 'beads', 2);
      const p = adult(s), c = s.camp;
      c.feastDay = dayOf(s.tick);
      c.stock.meat = 40;
      p.belonging = 0;
      p.x = c.x + 1.2; p.z = c.z;
      p.task = task(s, 'feast', p);
      finishTask(s, p);
      return { belonging: p.belonging, memory: p.memories.filter((m) => m.kind === 'midwinter').at(-1)! };
    };
    const bare = feast(0), proud = feast(40);
    expect(bare.belonging).toBeCloseTo(30, 5);
    expect(proud.belonging).toBeCloseTo(45, 5);
    expect(proud.memory.text).toMatch(/goods set out/);
    expect(bare.memory.text).not.toMatch(/goods set out/);
  });

  it('shows the goods apart from the tools, on the band and on the stockpile', () => {
    const s = fedBand();
    for (const it of s.goodsOf()) s.items.splice(s.items.indexOf(it), 1);
    mk(s, 'bowl', 2); mk(s, 'bowl', 0); mk(s, 'beads', 1); mk(s, 'beads', 0);
    const { bead } = giftUnderWay(s);
    const sum = s.summary(s.camp.id);
    expect(sum.tools).not.toMatch(/bowl|bead/i);
    expect(sum.goods).toBe('2 clay bowls, 2 strings of beads (1 fine)');
    const pile = s.buildings.find((b) => b.band === s.camp.id && b.kind === 'stockpile')!;
    const card = s.inspectThing({ kind: 'building', id: pile.id })!;
    const line = (l: string) => card.lines.find((x) => x.label === l)?.value ?? '';
    expect(line('Goods')).toBe('2 clay bowls, 2 strings of beads');
    expect(line('Tools')).not.toMatch(/bowl|bead/i);
    // (beads set aside for a gift are not a trap out on the land)
    expect(line('Traps set')).not.toMatch(/bead/i);
    expect(bead.tile).toBe(-3);
  });

  it('shows on the kiln who is potting there and the goods of its own band', () => {
    const s = fedBand();
    s.camp.knows.push('kiln');
    const kiln = { ...s.buildings.find((b) => b.band === s.camp.id && b.kind === 'stockpile')!, id: s.newId(), kind: 'kiln' as const, built: true };
    s.buildings.push(kiln);
    for (const it of s.goodsOf()) s.items.splice(s.items.indexOf(it), 1);
    mk(s, 'bowl', 2);
    const p = adult(s);
    p.task = { ...task(s, 'craft', p, RECIPE_KEYS.indexOf('bowl'), 1), amount: 1, timer: 50 };
    // looked at from another band's point of view
    const other = s.camps.find((c) => c.id !== s.camp.id);
    if (other) s.camp = other;
    const card = s.inspectThing({ kind: 'building', id: kiln.id })!;
    expect(card.lines.find((l) => l.label === 'Potting')?.value).toBe(p.name);
    expect(card.lines.find((l) => l.label === 'The band\'s goods')?.value).toBe('1: 1 fine, 0 good');
  });

  it('seats the potters at the kiln once there is one, and the bead-makers still by the fire', () => {
    const s = fedBand();
    const pile = s.buildings.find((b) => b.band === s.camp.id && b.kind === 'stockpile')!;
    const kiln = { ...pile, id: s.newId(), kind: 'kiln' as const, built: true };
    s.buildings.push(kiln);
    let potters = 0, beads = 0;
    for (let k = 0; k < TICKS_PER_DAY * 8; k += 10) {
      runTo(s, s.tick + 10);
      for (const p of s.members()) {
        if (p.task?.kind !== 'craft' || p.task.amount <= 0) continue;
        const key = RECIPE_KEYS[p.task.ref], d = Math.hypot(p.task.gx - (kiln.x + 0.5), p.task.gz - (kiln.z + 0.5));
        if (key === 'bowl') { potters++; expect(d).toBeLessThan(0.8); }
        if (key === 'beads') { beads++; expect(Math.hypot(p.task.gx - s.camp.x, p.task.gz - s.camp.z)).toBeLessThan(2.5); }
      }
    }
    expect(potters).toBeGreaterThan(0);
    expect(beads).toBeGreaterThan(0);
  });

  it('sits the potter before the stoke hole whichever way the kiln was built facing', () => {
    const s = fedBand();
    const p = adult(s);
    const at = (rot: number) => {
      const kiln = { ...s.buildings.find((b) => b.band === s.camp.id && b.kind === 'stockpile')!, kind: 'kiln' as const, x: 10, z: 20, rot };
      const st = s.kilnSeat(kiln, p);
      return { dx: st.x - 10.5, dz: st.z - 20.5 };
    };
    // the stoke hole faces +z in the model; the kiln turns by quarter turns
    const ahead = [at(0).dz, at(1).dx, -at(2).dz, -at(3).dx];
    for (const d of ahead) expect(d).toBeCloseTo(0.42, 5);
    for (let r = 0; r < 4; r++) expect(Math.hypot(at(r).dx, at(r).dz)).toBeLessThan(0.55);
  });

  it('builds the kiln it has sited, from clay, stone and wood', () => {
    const s = fedBand();
    s.camp.knows.push('kiln');
    Object.assign(s.camp.stock, { mud: 60, stone: 30, wood: 300 });
    let built = false;
    for (let d = 0; d < 40 && !built; d++) {
      runTo(s, s.tick + TICKS_PER_DAY);
      built = !!s.kilnOf();
    }
    expect(built).toBe(true);
    expect(s.buildings.filter((b) => b.band === s.camp.id && b.kind === 'kiln')).toHaveLength(1);
  });

  it('thinks of beads only once it has huts and a toolmaker, and the kiln only with a potter who can build', () => {
    const beads = DISCOVERY.get('beads')!, kiln = DISCOVERY.get('kiln')!;
    expect(beads.requires).toEqual([expect.objectContaining({ skill: SK.tool, level: 9 })]);
    expect(beads.practice).toEqual({ gift: 1, knap: 0.2 });
    expect(kiln.requires).toEqual(expect.arrayContaining([expect.objectContaining({ skill: SK.pot, level: 11 }), expect.objectContaining({ skill: SK.build, level: 6 })]));
    expect(kiln.practice).toEqual({ fire_pot: 1 });
  });
});
