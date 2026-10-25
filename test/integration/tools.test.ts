// Tools are made, kept on the stockpile, taken out for felling and put back, and wear out.
import { describe, it, expect } from 'vitest';
import { ITEMS } from '../../src/sim/band';
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
      // within two years the band has found the axe and made some
      expect(s.knows('axe', s.camps[0]), `seed ${seed}`).toBe(true);
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
});
