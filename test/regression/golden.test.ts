// Golden fingerprints: the land each seed makes, and where five years of history lead.
// Any change to world generation or the simulation's behaviour shows up here as a snapshot diff.
// If the change is intended, look the new numbers over and accept them with `npm run test:update`
// (then commit the updated __snapshots__ file with the change that caused it).
import { describe, it, expect } from 'vitest';
import { world, sim, runYears } from '../helpers';

describe('golden worlds', () => {
  for (const seed of [1, 2, 3, 4471]) {
    it(`seed ${seed}`, () => {
      const w = world(seed);
      expect({ hash: w.hash, props: w.propCount, ...w.stats }).toMatchSnapshot();
    });
  }
});

describe('golden histories', () => {
  for (const seed of [1, 2, 3]) {
    it(`seed ${seed}, five years on`, () => {
      const s = runYears(sim(seed), 5);
      const sum = s.summary();
      expect({
        tick: s.tick,
        hash: s.historyHash(),
        pop: s.living().length,
        everLived: s.people.length,
        bands: s.liveCamps().map((c) => c.name),
        homes: sum.homes,
        stats: s.stats,
        events: s.events.length,
        // the momentous things, in words, so a diff says what changed
        story: s.events.filter((e) => e.weight >= 3).map((e) => e.text),
      }).toMatchSnapshot();
    });
  }
});
