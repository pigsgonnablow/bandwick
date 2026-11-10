// The band's goods: bowls and beads made in the hours a fed band has free, how well they are made, the
// kiln, the wood left to the woodcutters, and where the goods go (gifts, graves, the feast).
import { describe, it, expect } from 'vitest';
import { SK, GOODS, GOODS_EACH, GOODS_OVER, Item, WOODCUTTER, RECIPE_KEYS } from '../../src/sim/band';
import { DISCOVERY } from '../../src/sim/know';
import { TICKS_PER_DAY } from '../../src/sim/time';
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
});
