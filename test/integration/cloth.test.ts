// Cloth: thread spun from fiber on a spindle, a loom in its own shed, and what is woven there (tunics to
// wear under a cloak, blankets to sleep under, and patterned sashes for the band's goods).
import { describe, it, expect } from 'vitest';
import { SK, RECIPE_KEYS, RECIPES, Person, Task, TaskKind, Item, ItemKind, GARMENTS, GOODS, THREAD_TRY, THREAD_KEPT, TUNIC_WARM, BLANKET_WARM, ACT, Building } from '../../src/sim/band';
import { DISCOVERY } from '../../src/sim/know';
import { TICKS_PER_DAY } from '../../src/sim/time';
import { runTask } from '../../src/sim/ai';
import { Sim } from '../../src/sim/sim';
import { sim, runTo, runYears } from '../helpers';

/** A band two years on, fed, with fiber, stone and wood in hand, knowing how to spin. */
function spinners(seed = 2) {
  const s = runYears(sim(seed), 2);
  const c = s.camp;
  for (const k of ['huts', 'spinning']) if (!c.knows.includes(k)) c.knows.push(k);
  c.stock.fiber += 80;
  c.stock.stone += 20;
  c.stock.wood += 80;
  c.stock.grain += 2000;
  c.stock.preserved += 500;
  return s;
}
/** The same band with a loom shed standing beside its camp. */
function weavers(seed = 2) {
  const s = spinners(seed);
  s.camp.knows.push('loom');
  const pile = s.buildings.find((b) => b.band === s.camp.id && b.kind === 'stockpile')!;
  const loom: Building = { ...pile, id: s.newId(), kind: 'loom', built: true, x: pile.x + 2, tile: pile.tile + 2, builders: [] };
  s.buildings.push(loom);
  return { s, loom };
}
const task = (s: Sim, kind: TaskKind, at: { x: number; z: number }, ref = -1, stage = 0): Task =>
  ({ kind, stage, goal: s.tileOf(at), gx: at.x, gz: at.z, ref, timer: 0, started: s.tick, amount: 0, near: false });
const adult = (s: Sim, skip: Person[] = []) => s.members().find((q) => s.age(q) >= 18 && s.age(q) <= 50 && !skip.includes(q))!;
const mk = (s: Sim, kind: ItemKind): Item => {
  const it: Item = { id: s.newId(), kind, band: s.camp.id, holder: -1, wear: 0, made: s.tick, maker: -1, quality: 0 };
  s.items.push(it);
  return it;
};
/** Sit someone down to finish making a thing: the materials already set aside, one tick of work left. */
function makeOne(s: Sim, p: Person, key: (typeof RECIPE_KEYS)[number]) {
  p.task = { ...task(s, 'craft', p, RECIPE_KEYS.indexOf(key), 1), amount: 1, timer: 1 };
  runTask(s, p);
}
/** Watch the band for some days: what is made at the fire and the loom. */
function watch(s: Sim, days: number) {
  const seen = new Set<string>();
  for (let d = 0; d < days; d++)
    for (let k = 0; k < TICKS_PER_DAY; k += 10) {
      runTo(s, s.tick + 10);
      for (const p of s.members()) if (p.task?.kind === 'craft') seen.add(RECIPE_KEYS[p.task.ref]);
    }
  return seen;
}

describe('cloth', () => {
  it('finds spinning by twisting cord, and the loom only after it, by spinning and weaving', () => {
    const spin = DISCOVERY.get('spinning')!, loom = DISCOVERY.get('loom')!;
    expect(spin.needs).toEqual(['huts']);
    expect(Object.keys(spin.practice)).toEqual(['twist']);
    expect(spin.requires).toEqual([{ kind: 'skill', skill: SK.weave, level: 11 }]);
    expect(loom.needs).toEqual(['spinning']);
    expect(Object.keys(loom.practice).sort()).toEqual(['spin', 'twist', 'weave']);
  });

  it('spins a few hanks to try the spindle before there is a loom, and weaves nothing', () => {
    const s = spinners();
    const seen = watch(s, 12);
    expect(seen.has('thread')).toBe(true);
    expect(s.camp.stock.thread).toBeGreaterThan(0);
    // a hank or two over, at most, from spinners already at it when the want was met
    expect(s.camp.stock.thread).toBeLessThanOrEqual(THREAD_TRY + 3);
    for (const k of ['tunic', 'blanket', 'sash']) {
      expect(seen.has(k)).toBe(false);
      expect(s.canCraft(k as 'tunic')).toBe(false);
    }
  });

  it('spins nothing at a camp that does not know how', () => {
    const s = spinners();
    s.camp.knows = s.camp.knows.filter((k) => k !== 'spinning');
    const seen = watch(s, 8);
    expect(seen.has('thread')).toBe(false);
    expect(s.camp.stock.thread).toBe(0);
  });

  it('turns two fiber into a hank of thread, and books it', () => {
    const s = spinners();
    const p = adult(s);
    const before = s.camp.stock.thread;
    makeOne(s, p, 'thread');
    expect(s.camp.stock.thread).toBe(before + 1);
    expect(RECIPES.thread.uses).toEqual({ fiber: 2 });
    expect(s.camp.ledger?.now?.spun ?? 0).toBeGreaterThan(0);
  });

  it('raises a loom shed once the band knows the loom', () => {
    const s = spinners();
    s.camp.knows.push('loom');
    runTo(s, s.tick + 2 * TICKS_PER_DAY);
    const shed = s.buildings.filter((b) => b.band === s.camp.id && b.kind === 'loom');
    expect(shed.length).toBe(1);
    // and only the one
    runTo(s, s.tick + 2 * TICKS_PER_DAY);
    expect(s.buildings.filter((b) => b.band === s.camp.id && b.kind === 'loom').length).toBe(1);
  });

  it('weaves a tunic for everyone, then a blanket each, at the loom, and hands them out', () => {
    const { s, loom } = weavers();
    s.camp.stock.thread = THREAD_KEPT;
    let atLoom = false;
    const dressed = () => s.members().filter((p) => s.age(p) >= 1);
    for (let d = 0; d < 120 && dressed().some((p) => p.worn?.bed === undefined); d++) {
      for (let k = 0; k < TICKS_PER_DAY; k += 10) {
        runTo(s, s.tick + 10);
        for (const p of s.members()) {
          const t = p.task;
          if (t?.kind === 'craft' && t.stage === 1 && ['tunic', 'blanket'].includes(RECIPE_KEYS[t.ref]) && Math.hypot(p.x - loom.x - 0.5, p.z - loom.z - 0.5) < 0.6) atLoom = true;
        }
      }
      s.camp.stock.fiber = Math.max(s.camp.stock.fiber, 40);
    }
    expect(atLoom).toBe(true);
    const ms = dressed();
    expect(ms.filter((p) => p.worn?.torso !== undefined).length).toBe(ms.length);
    expect(ms.filter((p) => p.worn?.bed !== undefined).length).toBe(ms.length);
    for (const p of ms) {
      expect(s.wornIn(p, 'torso')!.kind).toBe('tunic');
      expect(s.wornIn(p, 'bed')!.kind).toBe('blanket');
    }
  });

  it('keeps the cold off with a tunic always, and a blanket only while asleep', () => {
    const s = spinners();
    const p = adult(s);
    p.worn = {};
    s.dress(p, mk(s, 'tunic'));
    p.act = ACT.Idle;
    expect(s.coldKept(p)).toBeCloseTo(TUNIC_WARM, 5);
    s.dress(p, mk(s, 'blanket'));
    expect(s.coldKept(p)).toBeCloseTo(TUNIC_WARM, 5);
    p.act = ACT.Sleep;
    expect(s.coldKept(p)).toBeCloseTo(1 - (1 - TUNIC_WARM) * (1 - BLANKET_WARM), 5);
    // a tunic goes under a cloak, not in place of it
    expect(GARMENTS.tunic.slot).not.toBe(GARMENTS.cloak.slot);
  });

  it('sleeps deeper under a blanket', () => {
    const s = spinners();
    const p = adult(s), q = adult(s, [p]);
    p.worn = {};
    q.worn = {};
    s.dress(q, mk(s, 'blanket'));
    const gain = (who: Person) => {
      who.rest = 20;
      who.task = { ...task(s, 'sleep', who, -1, 1) };
      runTask(s, who);
      return who.rest - 20;
    };
    expect(gain(q)).toBeGreaterThan(gain(p) * 1.1);
  });

  it('weaves patterned sashes for the band\'s goods in its free hours, and a master weaver is a master craftsman', () => {
    const { s } = weavers();
    expect(GOODS).toContain('sash');
    s.camp.stock.thread = THREAD_KEPT;
    // everyone dressed and bedded already: the loom's work is the goods
    for (const p of s.members()) {
      s.dress(p, mk(s, 'tunic'));
      s.dress(p, mk(s, 'blanket'));
    }
    const seen = watch(s, 30);
    expect(seen.has('sash')).toBe(true);
    expect(s.goodsOf().some((i) => i.kind === 'sash')).toBe(true);
    const p = adult(s);
    p.skills[SK.weave] = 16;
    expect(s.isMaster(p)).toBe(true);
  });

  it('gives bands in older saves an empty store of thread, and plays on', () => {
    const s = spinners();
    const save = s.serialize();
    for (const c of save.camps ?? []) delete (c.stock as any).thread;
    const t = new (s.constructor as any)(s.world, save) as Sim;
    for (const c of t.camps) expect(c.stock.thread).toBe(0);
    runTo(t, t.tick + 3 * TICKS_PER_DAY);
    expect(Number.isFinite(t.camp.stock.thread)).toBe(true);
  });
});
