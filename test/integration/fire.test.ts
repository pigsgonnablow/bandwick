// The camp fire's comforts: a roof over the woodpile keeps firewood dry, a windbreak keeps the warmth in.
import { describe, it, expect } from 'vitest';
import { DAMP_BURN } from '../../src/sim/sim';
import { seasonOf, TICKS_PER_YEAR } from '../../src/sim/time';
import { sim, runTo, runYears } from '../helpers';

describe('fire', () => {
  it('burns damp wood faster in autumn and winter, unless the woodpile has a roof', () => {
    const s = sim(1);
    // into the first autumn
    while (seasonOf(s.tick) !== 2) runTo(s, s.tick + 200);
    for (const b of s.buildings.filter((b) => b.kind === 'woodshed')) b.built = false;
    const h = s.hearth();
    const damp = s.burnRate(h);
    expect(s.dampWood()).toBe(true);
    const roof = s.buildings.find((b) => b.kind === 'woodshed' && b.band === s.camp.id) ?? s.newBuilding('woodshed', s.hearth().tile, -1);
    roof.built = true;
    expect(s.dampWood()).toBe(false);
    expect(damp / s.burnRate(h)).toBeCloseTo(DAMP_BURN, 5);
  });

  it('roofs the woodpile and raises a windbreak once it knows how, on the stockpile and the fire, with all their materials', () => {
    let checked = 0;
    for (const seed of [1, 4]) {
      const s = runYears(sim(seed), 3);
      for (const c of s.liveCamps()) {
        const mine = s.buildings.filter((b) => b.band === c.id);
        const roof = mine.find((b) => b.kind === 'woodshed' && b.built);
        const screen = mine.find((b) => b.kind === 'windbreak' && b.built);
        // a band only just founded may not have got to them yet, and one that hasn't thought of them won't
        if (s.tick - c.founded < 2 * TICKS_PER_YEAR || !s.knows('woodshed', c) || !s.knows('windbreak', c)) continue;
        checked++;
        expect(roof, `seed ${seed} band ${c.name}: woodpile roof`).toBeTruthy();
        expect(screen, `seed ${seed} band ${c.name}: windbreak`).toBeTruthy();
        expect(mine.some((b) => b.kind === 'stockpile' && b.tile === roof!.tile)).toBe(true);
        expect(screen!.tile).toBe(s.hearth(c).tile);
        for (const b of [roof!, screen!]) {
          expect(b.wood).toBeGreaterThanOrEqual(4 - 0.5);
          expect(b.cordage).toBeGreaterThanOrEqual(2 - 0.5);
        }
        // never more than one of each
        expect(mine.filter((b) => b.kind === 'woodshed').length).toBe(1);
        expect(mine.filter((b) => b.kind === 'windbreak').length).toBe(1);
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});
