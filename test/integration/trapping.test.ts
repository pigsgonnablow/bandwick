// Snares and fish traps are made by the fire, set out in the land, and emptied on a daily round.
import { describe, it, expect } from 'vitest';
import { WATER } from '../../src/sim/types';
import { TICKS_PER_DAY } from '../../src/sim/time';
import { sim, runTo } from '../helpers';

describe('trapping', () => {
  it('makes snares, sets them out near camp and brings hares home', () => {
    const s = sim(1);
    s.camp.knows.push('snares');
    let set: typeof s.items = [];
    for (let d = 0; d < 48 && !(set.length && s.camp.ledger?.total?.['trapped']); d++) {
      runTo(s, s.tick + TICKS_PER_DAY);
      set = s.toolsOf().filter((i) => i.kind === 'snare' && (i.tile ?? -1) >= 0);
    }
    expect(set.length).toBeGreaterThan(0);
    for (const it of set) {
      const t = it.tile!;
      expect(s.world.water[t]).toBe(WATER.None);
      expect(s.gameCap[t]).toBeGreaterThan(0);
      expect(Math.hypot((t % s.N) + 0.5 - s.camp.x, Math.floor(t / s.N) + 0.5 - s.camp.z)).toBeLessThan(11);
    }
    // no two snares on one tile
    expect(new Set(set.map((i) => i.tile)).size).toBe(set.length);
    expect(s.camp.ledger?.total?.['trapped'] ?? 0).toBeGreaterThan(0);
  });

  it('thins the hares where snares catch them, and the land fills again', () => {
    const s = sim(2);
    const i = s.gameCap.findIndex((c) => c > 0);
    s.items.push({ id: s.newId(), kind: 'snare', band: s.camp.id, holder: -1, wear: 0, made: s.tick, maker: -1, tile: i, catch: 0 });
    const trap = s.items[s.items.length - 1];
    let caught = 0;
    for (let d = 0; d < 10; d++) {
      runTo(s, s.tick + TICKS_PER_DAY);
      if (trap.tile === i && trap.catch) { caught++; trap.catch = 0; }
    }
    expect(caught).toBeGreaterThan(0);
    expect(s.game[i]).toBeLessThan(s.gameCap[i]);
    s.items.splice(s.items.indexOf(trap), 1);
    runTo(s, s.tick + 30 * TICKS_PER_DAY);
    expect(s.game[i]).toBe(s.gameCap[i]);
  });

  it('sets fish traps in the water by the bank', () => {
    const s = sim(1);
    s.camp.knows.push('fishtraps');
    let set: typeof s.items = [];
    for (let d = 0; d < 48 && !set.length; d++) {
      runTo(s, s.tick + TICKS_PER_DAY);
      set = s.toolsOf().filter((i) => i.kind === 'fishtrap' && (i.tile ?? -1) >= 0);
    }
    expect(set.length).toBeGreaterThan(0);
    for (const it of set) expect(s.fishCap[it.tile!]).toBeGreaterThan(0);
  });

  it('catches whole fish, even from a stock that has been fished down to a fraction', () => {
    const s = sim(1);
    // sea water, which never freezes; and nobody's trap, so no round empties it before we look
    const w = s.fishCap.findIndex((c, i) => c > 0 && s.world.water[i] === WATER.Sea);
    expect(w).toBeGreaterThanOrEqual(0);
    s.items.push({ id: s.newId(), kind: 'fishtrap', band: -1, holder: -1, wear: 0, made: s.tick, maker: -1, tile: w, catch: 0 });
    const trap = s.items[s.items.length - 1];
    const catches: number[] = [];
    for (let d = 0; d < 12; d++) {
      s.fish[w] = 2.37 + d * 0.11;
      runTo(s, s.tick + TICKS_PER_DAY);
      if (trap.catch) catches.push(trap.catch);
      trap.catch = 0;
    }
    expect(catches.length).toBeGreaterThan(0);
    for (const n of catches) expect(Number.isInteger(n)).toBe(true);
  });

  it('takes the traps up when the band leaves, and loads saves from before trapping', () => {
    const s = sim(1);
    s.camp.knows.push('snares');
    for (let d = 0; d < 48 && !s.toolsOf().some((i) => (i.tile ?? -1) >= 0); d++) runTo(s, s.tick + TICKS_PER_DAY);
    expect(s.toolsOf().some((i) => (i.tile ?? -1) >= 0)).toBe(true);
    s.takeUpTraps(s.camp);
    expect(s.toolsOf().every((i) => i.tile === undefined && !i.catch)).toBe(true);

    const save = s.serialize();
    delete save.game;
    const t = new (s.constructor as any)(s.world, save);
    expect(Array.from(t.game)).toEqual(Array.from(t.gameCap));
    runTo(t, t.tick + 3 * TICKS_PER_DAY);
  });
});
