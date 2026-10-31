// Huts and storehouses can be raised in wood, wattle-and-daub or stone, chosen by the band.
import { describe, it, expect } from 'vitest';
import { specOf, labelOf, MATERIALS } from '../../src/sim/band';
import { seasonPos, TICKS_PER_DAY } from '../../src/sim/time';
import { sim, runTo, runYears } from '../helpers';

describe('walls', () => {
  it('names and costs each kind of wall', () => {
    expect(labelOf({ kind: 'hut' })).toBe('Hut');
    expect(labelOf({ kind: 'hut', walls: 'stone' })).toBe('Stone hut');
    expect(labelOf({ kind: 'storehouse', walls: 'daub' })).toBe('Wattle-and-daub storehouse');
    expect(specOf({ kind: 'hut', walls: 'daub' }).mud).toBeGreaterThan(0);
    expect(specOf({ kind: 'hut', walls: 'stone' }).shelter).toBeGreaterThan(specOf({ kind: 'hut' }).shelter);
    // walls only change huts and storehouses
    expect(specOf({ kind: 'rack', walls: 'stone' })).toBe(specOf({ kind: 'rack' }));
  });

  it('never raises stone before the band knows stonework, nor builds before every material is in', () => {
    let other = 0;
    for (const seed of [3, 4]) {
      const s = runYears(sim(seed), 8);
      const built = s.buildings.filter((b) => b.built && (b.kind === 'hut' || b.kind === 'storehouse'));
      // daub and stone are discoveries now: not every band finds them, but some do
      other += built.filter((b) => b.walls && b.walls !== 'wood').length;
      for (const b of s.buildings) {
        // (knowledge, once a band has it, is never lost)
        if (b.walls === 'stone') expect(s.campById(b.band)!.knows).toContain('stonework');
        if (b.built && b.kind !== 'hearth' && b.kind !== 'stockpile') for (const m of MATERIALS) expect(b[m]).toBeGreaterThanOrEqual(specOf(b)[m] - 0.5);
      }
    }
    expect(other).toBeGreaterThan(0);
  });

  it('picks wood when there is nothing else to hand', () => {
    const s = sim(3);
    s.mudSpots.length = 0;
    s.quarryTiles.length = 0;
    s.camp.knows.push('stonework', 'daub');
    const b = s.newBuilding('hut', s.camp.tile + 3, -1);
    expect(s.chooseWalls(b, false)).toBe('');
    expect(b.walls).toBe('wood');
  });

  it('reads saves from before walls as wooden buildings', () => {
    const s = runYears(sim(2), 1);
    const save = s.serialize();
    for (const b of save.buildings) { delete (b as any).walls; delete (b as any).mud; delete (b as any).stone; }
    for (const c of save.camps ?? []) { delete (c.stock as any).mud; delete (c.stock as any).stone; delete (c as any).knows; delete (c as any).practice; }
    const t = new (s.constructor as any)(s.world, save);
    expect(t.buildings.every((b: any) => specOf(b) === specOf({ kind: b.kind }) && b.mud === 0)).toBe(true);
    expect(t.camp.stock.stone).toBe(0);
    runYears(t, 1);
    expect(Object.values(t.camp.stock).every((v) => Number.isFinite(v as number))).toBe(true);
  });

  it('never chooses walls the band does not know, nor daub once the ground is freezing', () => {
    const s = sim(3);
    // mud and stone right by camp
    for (let k = 1; k < 6; k++) { s.mudSpots.push(s.camp.tile + k); s.quarryTiles.push(s.camp.tile - k); }
    const b = s.newBuilding('hut', s.camp.tile + 3 * s.N, -1);
    s.camp.knows.push('huts');
    for (let i = 0; i < 20; i++) {
      s.chooseWalls(b, i % 2 === 0);
      expect(b.walls).toBe('wood');
    }
    s.camp.knows.push('daub', 'stonework');
    const seen = new Set<string>();
    // through a year: daub is never picked from late autumn on
    for (let d = 0; d < 48; d++) {
      runTo(s, s.tick + TICKS_PER_DAY);
      s.chooseWalls(b, false);
      seen.add(b.walls!);
      if (seasonPos(s.tick) >= 2.5) expect(b.walls).not.toBe('daub');
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('builds a stone hut stronger and slower than a wooden one, and daub in between', () => {
    const wood = specOf({ kind: 'hut' }), daub = specOf({ kind: 'hut', walls: 'daub' }), stone = specOf({ kind: 'hut', walls: 'stone' });
    expect(stone.shelter).toBeGreaterThan(daub.shelter);
    expect(daub.shelter).toBeGreaterThan(wood.shelter);
    expect(stone.work).toBeGreaterThan(wood.work);
    expect(stone.stone).toBeGreaterThan(0);
    expect(wood.mud + wood.stone).toBe(0);
  });
});
