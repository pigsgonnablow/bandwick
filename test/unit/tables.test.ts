// The game's data tables hang together: every discovery, recipe, tool and building refers only to
// things that exist, nothing needs itself first, and every cost is sensible. A new row that breaks
// one of these rules fails here before it can fail somewhere stranger in a long run.
import { describe, it, expect } from 'vitest';
import { DISCOVERIES, DISCOVERY, knowHowFor, skillsIn, describeRequirement, Requirement } from '../../src/sim/know';
import { START_SKILL_MAX } from '../../src/sim/sim';
import {
  BUILD, BUILD_KINDS, ITEMS, ITEM_KINDS, MATERIALS, RECIPES, RECIPE_KEYS, SKILLS, TASK_KINDS, TRAP_KINDS,
  specOf, wallsFor, labelOf, TRAINING, SKILL_MAX,
} from '../../src/sim/band';

describe('discoveries', () => {
  it('have unique keys and say how they were found, taught and remembered', () => {
    expect(DISCOVERY.size).toBe(DISCOVERIES.length);
    for (const d of DISCOVERIES) {
      expect(d.label, d.key).toBeTruthy();
      expect(d.found, d.key).toBeTruthy();
      expect(d.taught, d.key).toBeTruthy();
      expect(d.memory, d.key).toBeTruthy();
      expect(d.odds, d.key).toBeGreaterThan(0);
      expect(d.requires.length, d.key).toBeGreaterThan(0);
    }
  });

  it('ask only for skills someone can train past the starting cap, to a level they can reach', () => {
    // every skill some work trains: the lessons, and the crafts
    const trained = new Set<number>([...Object.values(TRAINING).flatMap((l) => l.map((x) => x.skill)), ...RECIPE_KEYS.map((k) => RECIPES[k].skill)]);
    for (const d of DISCOVERIES)
      for (const r of d.requires) {
        const walk = (q: Requirement): void => {
          if (q.kind === 'any') return q.of.forEach(walk);
          expect(q.skill, d.key).toBeGreaterThanOrEqual(0);
          expect(q.skill, d.key).toBeLessThan(SKILLS.length);
          expect(q.level, `${d.key} asks ${describeRequirement(q)}`).toBeLessThanOrEqual(SKILL_MAX);
          if (q.level > START_SKILL_MAX) expect(trained.has(q.skill), `${d.key}: nothing trains ${SKILLS[q.skill]}`).toBe(true);
        };
        walk(r);
        expect(skillsIn(r).length, d.key).toBeGreaterThan(0);
      }
  });

  it('are each led to by some work, every unit of it counting for something', () => {
    for (const d of DISCOVERIES) {
      const ways = Object.entries(d.practice);
      expect(ways.length, d.key).toBeGreaterThan(0);
      for (const [, v] of ways) expect(v, d.key).toBeGreaterThan(0);
    }
  });

  it('need only other discoveries first, and never (even roundabout) themselves', () => {
    const depth = (k: string, seen: string[] = []): number => {
      expect(seen, `cycle through ${k}`).not.toContain(k);
      const d = DISCOVERY.get(k);
      expect(d, `unknown discovery ${k}`).toBeTruthy();
      return 1 + Math.max(0, ...d!.needs.map((n) => depth(n, [...seen, k])));
    };
    for (const d of DISCOVERIES) expect(depth(d.key)).toBeGreaterThan(0);
  });
});

describe('recipes and tools', () => {
  it('have a recipe for every tool, and every recipe asks only for a known discovery and real stores', () => {
    for (const k of ITEM_KINDS) expect(RECIPE_KEYS.some((r) => RECIPES[r].makes === k), k).toBe(true);
    for (const k of RECIPE_KEYS) {
      const r = RECIPES[k];
      if (r.knows) expect(DISCOVERY.has(r.knows), `${k} needs ${r.knows}`).toBe(true);
      expect(Object.keys(r.uses).length, k).toBeGreaterThan(0);
      for (const [m, n] of Object.entries(r.uses)) {
        expect(['wood', 'fiber', 'cordage', 'stone', 'mud'], k).toContain(m);
        expect(n, k).toBeGreaterThan(0);
      }
      expect(r.work, k).toBeGreaterThan(0);
      expect(r.grow, k).toBeGreaterThan(0);
      expect(r.skill, k).toBeLessThan(SKILLS.length);
    }
  });

  it('wear out after a sensible number of uses', () => {
    for (const k of ITEM_KINDS) {
      expect(ITEMS[k].uses, k).toBeGreaterThan(0);
      expect(ITEMS[k].label, k).toBeTruthy();
    }
    for (const k of TRAP_KINDS) expect(ITEM_KINDS).toContain(k);
  });
});

describe('buildings', () => {
  it('cost no negative materials, and every kind in every wall asks only for known discoveries', () => {
    for (const kind of BUILD_KINDS) {
      for (const walls of wallsFor(kind)) {
        const sp = specOf({ kind, walls });
        for (const m of MATERIALS) expect(sp[m], `${kind} ${walls} ${m}`).toBeGreaterThanOrEqual(0);
        expect(sp.shelter).toBeGreaterThanOrEqual(0);
        expect(sp.shelter).toBeLessThan(1);
        expect(sp.keep).toBeGreaterThan(0);
        expect(sp.keep).toBeLessThanOrEqual(1);
        for (const k of knowHowFor({ kind, walls })) expect(DISCOVERY.has(k), `${kind} ${walls} needs ${k}`).toBe(true);
        expect(labelOf({ kind, walls })).toBeTruthy();
      }
    }
  });

  it('give homes room and shelter, and a better wall gives more shelter for more work', () => {
    for (const kind of ['leanto', 'hut'] as const) {
      expect(BUILD[kind].cap).toBeGreaterThan(0);
      expect(BUILD[kind].shelter).toBeGreaterThan(0);
    }
    expect(BUILD.hut.shelter).toBeGreaterThan(BUILD.leanto.shelter);
    const hut = wallsFor('hut').map((walls) => specOf({ kind: 'hut', walls }));
    expect(wallsFor('hut')).toEqual(['wood', 'daub', 'stone']);
    for (let i = 1; i < hut.length; i++) {
      expect(hut[i].shelter).toBeGreaterThan(hut[i - 1].shelter);
      expect(hut[i].work).toBeGreaterThan(hut[i - 1].work);
    }
    const store = wallsFor('storehouse').map((walls) => specOf({ kind: 'storehouse', walls }));
    for (let i = 1; i < store.length; i++) expect(store[i].keep).toBeLessThan(store[i - 1].keep);
  });

  it('need nothing discovered for what a band starts with', () => {
    for (const kind of ['hearth', 'stockpile', 'leanto'] as const) expect(knowHowFor({ kind })).toEqual([]);
  });
});

describe('task kinds', () => {
  it('are listed once each, so the renderer can be told them by number', () => {
    expect(new Set(TASK_KINDS).size).toBe(TASK_KINDS.length);
  });
});
