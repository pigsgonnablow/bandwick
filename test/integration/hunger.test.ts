// Hunger with an empty store sends people out for food, the older children too.
import { describe, it, expect } from 'vitest';
import { decide } from '../../src/sim/ai';
import { seasonOf, hourOf } from '../../src/sim/time';
import { sim, runTo } from '../helpers';

describe('hunger', () => {
  it('sends a starving child out to fish rather than play when the store is empty', () => {
    const s = sim(1);
    // winter: no berries to pick or eat
    while (seasonOf(s.tick) !== 3) runTo(s, s.tick + 200);
    // and broad daylight
    while (hourOf(s.tick) < 11 || hourOf(s.tick) > 13) runTo(s, s.tick + 5);
    const c = s.camp;
    const kid = s.members().find((p) => s.age(p) >= 11 && s.age(p) < 14) ?? s.members().find((p) => s.age(p) >= 14)!;
    for (const k of ['berries', 'meat', 'fish', 'preserved'] as const) c.stock[k] = 0;
    let food = 0, play = 0;
    for (let i = 0; i < 40; i++) {
      Object.assign(kid, { food: 12, health: 60, rest: 90, warmth: 90, belonging: 90, task: null, carry: 0 });
      decide(s, kid);
      if (kid.task?.kind === 'fish' || kid.task?.kind === 'hunt' || kid.task?.kind === 'forage') food++;
      if (kid.task?.kind === 'play' || kid.task?.kind === 'idle') play++;
    }
    expect(food).toBeGreaterThan(play);
  });
});
