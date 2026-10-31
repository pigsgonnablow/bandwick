// Tools are made, kept on the stockpile, taken out for felling and put back, and wear out.
import { describe, it, expect } from 'vitest';
import { ITEMS, CARRY, RECIPE_KEYS } from '../../src/sim/band';
import { abandon } from '../../src/sim/ai';
import { seasonOf } from '../../src/sim/time';
import { treeStage, isTreeType } from '../../src/sim/sim';
import { TICKS_PER_DAY } from '../../src/sim/time';
import { sim, runTo, runYears } from '../helpers';

describe('tools', () => {
  it('starts the first band with two hand choppers and no axe', () => {
    const s = sim(1);
    expect(s.toolsOf().map((i) => i.kind)).toEqual(['chopper', 'chopper']);
    expect(s.knows('axe')).toBe(false);
  });

  it('fells only small trees with a chopper, and big ones once it has axes', () => {
    for (const seed of [1, 4]) {
      const s = sim(seed);
      for (let d = 0; d < 2 * 48; d++) {
        for (let k = 0; k < TICKS_PER_DAY; k += 10) {
          runTo(s, s.tick + 10);
          for (const p of s.members()) {
            if (p.task?.kind !== 'fell' || p.task.stage < 1 || !s.propAlive[p.task.ref] || !isTreeType(s.propType[p.task.ref])) continue;
            const tool = s.heldBy(p);
            expect(tool, `${p.name} felling with nothing in hand`).toBeTruthy();
            if (tool!.kind === 'chopper') expect(treeStage(s.propType[p.task.ref])).toBeLessThanOrEqual(1);
          }
        }
      }
      // once the band has the axe (a master woodcutter's idea, which can take years), it makes some
      if (!s.knows('axe', s.camps[0])) s.camps[0].knows.push('axe');
      runTo(s, s.tick + 48 * TICKS_PER_DAY);
      expect(s.items.filter((i) => i.kind === 'axe' && i.maker >= 0).length, `seed ${seed}`).toBeGreaterThan(0);
    }
  });

  it('puts tools back on the pile when the work is done, and keeps one in each pair of hands', () => {
    const s = runYears(sim(2), 1);
    for (let d = 0; d < 20; d++) {
      runTo(s, s.tick + TICKS_PER_DAY);
      const held = s.items.filter((i) => i.holder >= 0);
      expect(new Set(held.map((i) => i.holder)).size).toBe(held.length);
      for (const it of held) {
        const p = s.byId.get(it.holder)!;
        // a living holder is at the felling, or on the way back past the pile
        if (p.alive) expect(p.band).toBe(it.band);
      }
    }
    // at night nearly everything is back on the pile
    runTo(s, s.tick + TICKS_PER_DAY - (s.tick % TICKS_PER_DAY) + 3 * 10 * 10);
    const all = s.toolsOf(s.camps[0]);
    expect(all.filter((i) => i.holder < 0).length).toBeGreaterThanOrEqual(all.length - 2);
  });

  it('wears tools out with use', () => {
    const s = sim(3);
    const p = s.members().find((q) => s.age(q) >= 20)!;
    const it = s.toolsOf()[0];
    s.takeTool(p, it);
    let broke = false;
    for (let i = 0; i < ITEMS.chopper.uses && !broke; i++) broke = s.wearTool(it);
    expect(broke).toBe(true);
    expect(s.items.includes(it)).toBe(false);
    expect(s.heldBy(p)).toBeUndefined();
  });

  it('gives bands in older saves the axe and a few tools', () => {
    const s = runYears(sim(2), 1);
    const save = s.serialize();
    delete (save as any).items;
    for (const c of save.camps ?? []) c.knows = c.knows.filter((k) => k !== 'axe');
    const t = new (s.constructor as any)(s.world, save);
    expect(t.knows('axe')).toBe(true);
    expect(t.toolsOf().filter((i: any) => i.kind === 'axe').length).toBe(2);
    runTo(t, t.tick + 5 * TICKS_PER_DAY);
  });

  it('digs a full basket with a digging stick, and less by hand', () => {
    const s = sim(3);
    s.camp.knows.push('huts', 'daub');
    let off = 4;
    const site = () => { const b = s.newBuilding('hut', s.camp.tile + off * s.N, -1); b.walls = 'daub'; off += 2; };
    site();
    const seen = new Set<number>();
    let byHand = 0, withStick = 0, given = false;
    for (let i = 0; i < 48 * 240 && !(withStick && byHand); i++) {
      // until a basket has been dug by hand, the band hasn't thought of the stick
      if (!byHand) {
        s.camp.knows = s.camp.knows.filter((k) => k !== 'digstick');
        for (const it of s.items.filter((i) => i.kind === 'stick')) s.items.splice(s.items.indexOf(it), 1);
      }
      runTo(s, s.tick + 1);
      if (byHand && !given) {
        // the band works the stick out, and has a couple made
        given = true;
        if (!s.knows('digstick')) s.camp.knows.push('digstick');
        s.giveTools(s.camp, { stick: 2 });
        site();
      }
      for (const p of s.members()) {
        const t = p.task;
        if (t?.kind !== 'dig' || t.stage !== 2 || p.carry !== CARRY.Mud || seen.has(t.started * 1000 + p.id)) continue;
        seen.add(t.started * 1000 + p.id);
        const stick = s.heldBy(p)?.kind === 'stick';
        expect(p.carryAmt).toBe(stick ? 3 : 2);
        if (stick) withStick++;
        else byHand++;
      }
    }
    expect(byHand).toBeGreaterThan(0);
    expect(withStick).toBeGreaterThan(0);
    expect(s.items.some((i) => i.kind === 'stick' && i.wear > 0)).toBe(true);
  });

  it('makes only the tools the band is short of, counting the ones being made', () => {
    const s = sim(2);
    const c = s.camp;
    c.knows.push('huts', 'daub', 'axe', 'digstick');
    // plenty of everything a tool takes, so only the plan holds the crafters back
    Object.assign(c.stock, { wood: 200, stone: 40, cordage: 20 });
    const crafter = s.members().find((p) => s.age(p) >= 20)!;
    const sticks = () => s.toolsOf(c, 'stick').length;
    for (const it of s.toolsOf(c)) if (it.kind === 'stick') s.items.splice(s.items.indexOf(it), 1);
    expect(s.toolToMake()).toBe('axe');
    s.giveTools(c, { axe: 4, chopper: 2 });
    expect(s.toolToMake()).toBe('stick');
    // one stick already at the fire: one more is still wanted (two where there is daub to dig)
    crafter.task = { kind: 'craft', stage: 1, goal: 0, gx: 0, gz: 0, ref: RECIPE_KEYS.indexOf('stick'), timer: 5, started: s.tick, amount: 1, near: false };
    expect(s.toolToMake()).toBe('stick');
    s.giveTools(c, { stick: 1 });
    expect(s.toolToMake()).toBeNull();
    crafter.task = null as any;
    s.items.splice(s.items.findIndex((i) => i.band === c.id && i.kind === 'stick'), 1);
    // a few days of crafting with stores to spare never goes past what the band wants
    for (let d = 0; d < 6; d++) {
      runTo(s, s.tick + TICKS_PER_DAY);
      expect(sticks()).toBeLessThanOrEqual(2);
      expect(s.toolsOf(c, 'chopper').length).toBeLessThanOrEqual(4);
      expect(s.toolsOf(c, 'axe').length).toBeLessThanOrEqual(4 + 1);
    }
    expect(sticks()).toBe(2);
  });

  it('gives back what was set aside for a tool when the crafter is called away', () => {
    const s = sim(1);
    const c = s.camp;
    const p = s.members().find((q) => s.age(q) >= 20)!;
    c.stock.stone = 0;
    p.task = { kind: 'craft', stage: 1, goal: 0, gx: 0, gz: 0, ref: RECIPE_KEYS.indexOf('chopper'), timer: 5, started: s.tick, amount: 1, near: false };
    abandon(s, p);
    expect(c.stock.stone).toBe(1);
  });

  it('cannot make an axe or a digging stick before the band has thought of them', () => {
    const s = sim(4);
    Object.assign(s.camp.stock, { wood: 50, stone: 10, cordage: 10 });
    expect(s.canCraft('chopper')).toBe(true);
    expect(s.canCraft('axe')).toBe(false);
    expect(s.canCraft('stick')).toBe(false);
    s.camp.knows.push('axe', 'digstick');
    expect(s.canCraft('axe')).toBe(true);
    expect(s.canCraft('stick')).toBe(true);
    s.camp.stock.cordage = 0;
    expect(s.canCraft('axe')).toBe(false);
  });

  it('never digs in frozen winter ground', () => {
    const s = sim(3);
    s.camp.knows.push('huts', 'daub');
    while (seasonOf(s.tick) !== 3) runTo(s, s.tick + 100);
    const site = s.newBuilding('hut', s.camp.tile + 4 * s.N, -1);
    site.walls = 'daub';
    while (seasonOf(s.tick) === 3) {
      runTo(s, s.tick + 10);
      for (const p of s.members()) if (p.task?.kind === 'dig') expect(seasonOf(p.task.started), `${p.name} digging`).not.toBe(3);
    }
  });

  it('keeps every tool through a save and load', () => {
    const s = runYears(sim(1), 2);
    const save = JSON.parse(JSON.stringify(s.serialize()));
    const t = new (s.constructor as any)(s.world, save);
    expect(t.items).toEqual(s.items);
    expect(t.describeTools(t.toolsOf())).toBe(s.describeTools(s.toolsOf()));
  });

  it('knaps a chopper first when it has nothing left to fell with, even if it knows the axe', () => {
    const s = sim(2);
    const c = s.camp;
    c.knows.push('axe');
    for (const it of s.toolsOf(c)) s.items.splice(s.items.indexOf(it), 1);
    // no wood for a haft, and no wood to be had without something to cut it
    Object.assign(c.stock, { wood: 0, stone: 1, cordage: 2 });
    expect(s.toolToMake()).toBe('chopper');
    c.stock.wood = 5;
    expect(s.toolToMake()).toBe('axe');
    // and it gets one made within a couple of days
    c.stock.wood = 0;
    runTo(s, s.tick + 2 * TICKS_PER_DAY);
    expect(s.toolsOf(c).some((i) => i.kind !== 'stick')).toBe(true);
  });
});
