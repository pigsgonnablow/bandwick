// The tables behind village life hang together: what is cooked is food, what is sewn has a recipe,
// what a discovery brings is itself a discovery, every task can be told of by the camera, and every
// thing carried has a model to show it.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { DISCOVERIES, DISCOVERY } from '../../src/sim/know';
import {
  CARRY, COOKED, COOK_GAIN, COOK_TICKS, SEWN, NEEDLE_SPEED, RECIPES, RECIPE_KEYS, ITEMS, TASK_KINDS, foodTotal,
  BONES_PER_DEER, BONES_KEPT, TEETH_PER_DEER, TRINKETS_KEPT, HERBS_WANT, NURSE_DAYS, GIFT_DAYS, MIDWINTER, FEAST_MEAL,
  NUTS_LOAD, ROOTS_LOAD, Stock,
} from '../../src/sim/band';
import { DAYS_PER_YEAR, DAYS_PER_SEASON } from '../../src/sim/time';
import { PHRASE, INTEREST } from '../../src/render/director';

const empty = (): Stock => ({ berries: 0, meat: 0, fish: 0, preserved: 0, wood: 0, fiber: 0, cordage: 0, mud: 0, stone: 0, hides: 0, roots: 0, nuts: 0, herbs: 0, bones: 0, trinkets: 0 });

describe('food', () => {
  it('counts acorns and roots in the stores, but not herbs, bones, teeth or hides', () => {
    for (const k of ['nuts', 'roots'] as const) expect(foodTotal({ ...empty(), [k]: 5 })).toBe(5);
    for (const k of ['herbs', 'bones', 'trinkets', 'hides'] as const) expect(foodTotal({ ...empty(), [k]: 5 })).toBe(0);
  });

  it('is only cooked if it is food, and cooking is worth a little more of it, for a little time', () => {
    for (const k of COOKED) expect(foodTotal({ ...empty(), [k]: 1 }), k).toBe(1);
    // berries are eaten as they come
    expect(COOKED).not.toContain('berries');
    expect(COOK_GAIN).toBeGreaterThan(1);
    expect(COOK_GAIN).toBeLessThan(1.6);
    expect(COOK_TICKS).toBeGreaterThan(0);
  });

  it('comes home in sensible loads', () => {
    expect(NUTS_LOAD).toBeGreaterThan(2);
    expect(ROOTS_LOAD).toBeGreaterThan(2);
  });
});

describe('sewing', () => {
  it('speeds only real recipes that the band could sew, and a needle is made of bone and wears out', () => {
    for (const k of SEWN) expect(RECIPE_KEYS).toContain(k);
    expect(NEEDLE_SPEED).toBeGreaterThan(0);
    expect(NEEDLE_SPEED).toBeLessThan(1);
    expect(RECIPES.needle.uses).toEqual({ bones: 1 });
    expect(RECIPES.needle.knows).toBe('needles');
    expect(ITEMS.needle.uses).toBeGreaterThan(5);
    expect(BONES_PER_DEER).toBeGreaterThan(0);
    expect(BONES_KEPT).toBeGreaterThanOrEqual(BONES_PER_DEER);
    // a cloak is sewn from hides and cord
    expect(SEWN).toContain('cloak');
    expect(RECIPES.cloak.uses.hides).toBeGreaterThan(0);
  });
});

describe('customs', () => {
  it('have sensible numbers: a gift now and then, the feast on a day of the year in winter', () => {
    expect(TEETH_PER_DEER).toBeGreaterThan(0);
    expect(TRINKETS_KEPT).toBeGreaterThanOrEqual(TEETH_PER_DEER);
    expect(GIFT_DAYS).toBeGreaterThan(4);
    expect(MIDWINTER).toBeGreaterThanOrEqual(3 * DAYS_PER_SEASON);
    expect(MIDWINTER).toBeLessThan(DAYS_PER_YEAR);
    expect(FEAST_MEAL).toBeGreaterThan(1);
    expect(HERBS_WANT).toBeGreaterThan(0);
    expect(NURSE_DAYS).toBeGreaterThan(0);
  });

  it('are not discoveries: nobody has to think of giving a gift or holding a feast', () => {
    for (const k of ['gift', 'feast', 'midwinter', 'necklace', 'ornaments']) expect(DISCOVERY.get(k)).toBeUndefined();
  });
});

describe('the new discoveries', () => {
  it('are each in the table, in the order they can be found', () => {
    for (const k of ['nuts', 'cooking', 'herbs', 'needles', 'bedding', 'cloaks', 'roots', 'digstick']) expect(DISCOVERY.get(k), k).toBeDefined();
    expect(DISCOVERY.get('needles')!.needs).toContain('cloaks');
  });

  it('only bring along other discoveries, never themselves', () => {
    for (const d of DISCOVERIES)
      for (const b of d.brings ?? []) {
        expect(DISCOVERY.get(b), `${d.key} brings ${b}`).toBeDefined();
        expect(b).not.toBe(d.key);
        // what it brings must not need the thing that brings it
        expect(DISCOVERY.get(b)!.needs).not.toContain(d.key);
      }
  });
});

describe('the camera director', () => {
  it('has words and an interest for every kind of task', () => {
    for (const k of TASK_KINDS) {
      expect(PHRASE[k], `phrase for ${k}`).toBeTruthy();
      expect(INTEREST[k], `interest in ${k}`).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('carried things', () => {
  /** The names of the meshes in a .glb file (its JSON chunk). */
  function glbNames(path: string) {
    const buf = readFileSync(path);
    expect(buf.readUInt32LE(0)).toBe(0x46546c67); // 'glTF'
    const len = buf.readUInt32LE(12);
    const json = JSON.parse(buf.subarray(20, 20 + len).toString('utf8'));
    return new Set<string>([...(json.nodes ?? []).map((n: { name: string }) => n.name), ...(json.meshes ?? []).map((m: { name: string }) => m.name)]);
  }

  it('each have a model in the band\'s models, and the renderer shows every one', () => {
    const names = glbNames('src/assets/band.glb');
    const src = readFileSync('src/render/band.ts', 'utf8');
    const shown = new Map([...src.matchAll(/\[CARRY\.(\w+), '(\w+)'\]/g)].map((m) => [m[1], m[2]]));
    for (const k of Object.keys(CARRY)) {
      if (k === 'None') continue;
      expect(shown.get(k), `renderer shows CARRY.${k}`).toBeTruthy();
      expect(names.has(`carry__${shown.get(k)}`), `model carry__${shown.get(k)}`).toBe(true);
    }
  });

  it('are numbered once each', () => {
    const ids = Object.values(CARRY);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
