// Grass and reeds are cut for fiber, fiber is twisted into cordage, and both go into buildings.
import { describe, it, expect } from 'vitest';
import { specOf, FIBER_PER_CORD } from '../../src/sim/band';
import { isFiberPlant, fiberCap } from '../../src/sim/sim';
import { sim, runYears } from '../helpers';

describe('fiber and cordage', () => {
  it('starts every grass and reed clump fully grown', () => {
    const s = sim(1);
    let n = 0;
    for (let k = 0; k < s.propCount; k++) {
      if (!isFiberPlant(s.propType[k])) continue;
      n++;
      expect(s.propVal[k]).toBe(fiberCap(s.propType[k]));
    }
    expect(n).toBeGreaterThan(100);
  });

  it('builds nothing that needs thatch or cordage before it has them', () => {
    const s = runYears(sim(2), 3);
    const book = s.camps[0].ledger!.total;
    expect(book['gathered.fiber']).toBeGreaterThan(10);
    expect(book['twisted']).toBeGreaterThanOrEqual(FIBER_PER_CORD);
    const built = s.buildings.filter((b) => b.built && (b.kind === 'hut' || b.kind === 'leanto' || b.kind === 'storehouse' || b.kind === 'rack'));
    expect(built.length).toBeGreaterThan(1);
    for (const b of built) {
      expect(b.fiber).toBeGreaterThanOrEqual(specOf(b).fiber - 0.5);
      expect(b.cordage).toBeGreaterThanOrEqual(specOf(b).cordage - 0.5);
    }
  });

  it('reads saves from before fiber, with empty fiber stores', () => {
    const s = runYears(sim(3), 1);
    const save = s.serialize();
    for (const c of save.camps ?? []) { delete (c.stock as any).fiber; delete (c.stock as any).cordage; }
    delete (save.camp.stock as any).fiber;
    for (const b of save.buildings) { delete (b as any).fiber; delete (b as any).cordage; }
    const t = new (s.constructor as any)(s.world, save);
    expect(t.camp.stock.fiber).toBe(0);
    expect(t.buildings.every((b: any) => b.fiber === 0 && b.cordage === 0)).toBe(true);
    runYears(t, 1);
    expect(Object.values(t.camp.stock).every((v) => Number.isFinite(v as number))).toBe(true);
  });
});
