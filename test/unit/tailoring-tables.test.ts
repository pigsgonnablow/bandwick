// The tables behind clothes hang together: every garment has one place on the body, a recipe the band
// has to think of first, words for the Gear tab, and a model where it shows on a villager.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  GARMENTS, SLOTS, RECIPES, RECIPE_KEYS, ITEMS, ITEM_KINDS, SEWN, CARRY, isGarment, BAG_LOAD, SHOES_REST, SHOES_WEAR_EVERY,
  MEND_AT, MEND_BY, MEND_CORD, MEND_MAX, CLOAK_WARM, TASK_KINDS, TRAINING, HIDES_PER_CLOAK,
} from '../../src/sim/band';
import { DISCOVERY } from '../../src/sim/know';
import { condition } from '../../src/sim/sim';
import { dressStyle } from '../../src/render/band';
import { PHRASE, INTEREST } from '../../src/render/director';
import { CARRYING, SLOT_WORDS, gearLine, warmthWords, clothesLine, TASK_PHRASE } from '../../src/ui/words';

// (a necklace is worn but never made at the fire or handed out: it is given)
const KINDS = (Object.keys(GARMENTS) as (keyof typeof GARMENTS)[]).filter((k): k is Exclude<keyof typeof GARMENTS, 'necklace'> => k !== 'necklace');

describe('garments', () => {
  it('are each worn in one of the places on the body', () => {
    for (const k of KINDS) expect(SLOTS, k).toContain(GARMENTS[k].slot);
    expect(new Set(SLOTS).size).toBe(SLOTS.length);
    // two things only share a place when one is the poor cousin of the other (a reed cape for a hide
    // cloak, a hide cloak for a fur one)
    const body = KINDS.filter((k) => GARMENTS[k].slot === 'body').sort();
    expect(body).toEqual(['cape', 'cloak', 'furcloak']);
    for (const slot of SLOTS) if (slot !== 'body' && slot !== 'neck') expect(KINDS.filter((k) => GARMENTS[k].slot === slot).length, slot).toBe(1);
    expect(GARMENTS.necklace).toMatchObject({ slot: 'neck', warm: 0, first: 'given' });
  });

  it('are things the band can make, each from a recipe it has to think of first', () => {
    for (const k of KINDS) {
      expect(ITEM_KINDS, k).toContain(k);
      expect(RECIPE_KEYS, k).toContain(k);
      expect(RECIPES[k].makes).toBe(k);
      const knows = RECIPES[k].knows;
      expect(knows, `${k} is a discovery`).toBeTruthy();
      expect(DISCOVERY.get(knows!), `discovery ${knows}`).toBeDefined();
      expect(ITEMS[k].uses, `${k} wears out`).toBeGreaterThan(0);
      expect(isGarment(k)).toBe(true);
    }
    for (const k of ['axe', 'needle', 'pot', 'basket']) expect(isGarment(k)).toBe(false);
  });

  it('sewn from a hide are quicker with a needle; a reed cape is knotted from grass, not hide', () => {
    for (const k of ['cloak', 'hat', 'mittens', 'shoes', 'bag'] as const) {
      expect(SEWN, k).toContain(k);
      expect(RECIPES[k].uses.hides ?? 0, k).toBeGreaterThan(0);
    }
    expect(RECIPES.cape.uses.hides ?? 0).toBe(0);
    expect(RECIPES.cape.uses.fiber ?? 0).toBeGreaterThan(0);
    // the small things take less hide than a cloak
    for (const k of ['hat', 'mittens', 'shoes', 'bag'] as const) expect(RECIPES[k].uses.hides!).toBeLessThan(HIDES_PER_CLOAK);
  });

  it('keep off the cold in a sensible order, a fur cloak the most, then a hide cloak, and a bag not at all', () => {
    expect(GARMENTS.cloak.warm).toBe(CLOAK_WARM);
    expect(GARMENTS.furcloak.warm).toBeGreaterThan(GARMENTS.cloak.warm);
    for (const k of KINDS) {
      expect(GARMENTS[k].warm).toBeGreaterThanOrEqual(0);
      if (k !== 'furcloak') expect(GARMENTS[k].warm).toBeLessThanOrEqual(GARMENTS.cloak.warm);
    }
    expect(GARMENTS.bag.warm).toBe(0);
    expect(GARMENTS.hat.warm).toBeGreaterThan(GARMENTS.mittens.warm);
    // everything worn at once by day (the warmest thing for the body) still lets some cold through
    // (a blanket is only over them at night)
    const through = KINDS.filter((k) => k !== 'cape' && k !== 'cloak' && k !== 'blanket').reduce((t, k) => t * (1 - GARMENTS[k].warm), 1);
    expect(through).toBeGreaterThan(0.3);
  });

  it('have sensible numbers for shoes, bags and mending', () => {
    expect(BAG_LOAD).toBeGreaterThan(1);
    expect(BAG_LOAD).toBeLessThan(2);
    expect(SHOES_REST).toBeGreaterThan(0.5);
    expect(SHOES_REST).toBeLessThan(1);
    expect(SHOES_WEAR_EVERY).toBeGreaterThan(10);
    expect(MEND_AT).toBeGreaterThan(0.2);
    expect(MEND_AT).toBeLessThan(1);
    expect(MEND_BY).toBeGreaterThan(0);
    // a mend never makes a thing better than new from the point it is wanted
    expect(MEND_BY).toBeLessThanOrEqual(MEND_AT);
    expect(MEND_CORD).toBeGreaterThan(0);
    expect(MEND_CORD).toBeLessThanOrEqual(1);
    // a few patches, not a thing that lasts for ever
    expect(MEND_MAX).toBeGreaterThanOrEqual(2);
    expect(MEND_MAX * MEND_BY).toBeLessThan(2);
  });
});

describe('mending', () => {
  it('is a task the camera can tell of, and that trains someone', () => {
    expect(TASK_KINDS).toContain('mend');
    expect(PHRASE.mend).toBeTruthy();
    expect(INTEREST.mend).toBeGreaterThan(0);
    expect(TRAINING.mend).toBeDefined();
  });
});

describe('the clothing discoveries', () => {
  it('come after cloaks, except a reed cape, which needs only a weaver', () => {
    for (const k of ['hats', 'shoes', 'bags']) expect(DISCOVERY.get(k)!.needs, k).toContain('cloaks');
    expect(DISCOVERY.get('capes')!.needs).not.toContain('cloaks');
    for (const k of ['hats', 'shoes', 'capes', 'bags']) {
      const d = DISCOVERY.get(k)!;
      expect(d.requires.length, k).toBeGreaterThan(0);
      expect(Object.keys(d.practice ?? {}).length, `${k} comes during some work`).toBeGreaterThan(0);
    }
  });
});

describe('words for the Gear tab', () => {
  it('name every place on the body', () => {
    for (const slot of SLOTS) expect(SLOT_WORDS[slot], slot).toBeTruthy();
  });

  it('say what anyone carries, for every kind of thing carried', () => {
    for (const [k, id] of Object.entries(CARRY)) if (k !== 'None') expect(CARRYING[id], k).toBeTruthy();
  });

  it('tell how worn a thing is, from new to nearly through, in order', () => {
    const words = [0, 0.2, 0.5, 0.7, 0.95].map(condition);
    expect(words).toEqual(['new', 'good', 'worn', 'well worn', 'nearly through']);
    expect(condition(0.0999)).toBe('new');
    expect(condition(0.1)).toBe('good');
    expect(condition(1)).toBe('nearly through');
  });

  it('tell of a thing, its maker and its mending in one line', () => {
    expect(gearLine({ label: 'Fur hat', condition: 'worn', maker: { name: 'Ada' } })).toBe('Fur hat, worn. Made by Ada.');
    expect(gearLine({ label: 'Hide cloak', condition: 'good', maker: null, mended: 1, mender: { name: 'Bo' } })).toBe('Hide cloak, good. Mended once, last by Bo.');
    expect(gearLine({ label: 'Hide shoes', condition: 'new', maker: { name: 'Cy' }, mended: 2, mender: null })).toBe('Hide shoes, new. Made by Cy. Mended twice.');
    expect(gearLine({ label: 'Hide bag', condition: 'worn', maker: null, mended: 3 })).toBe('Hide bag, worn. Mended 3 times.');
    // past patching
    expect(gearLine({ label: 'Hide bag', condition: 'worn', maker: null, mended: MEND_MAX })).toBe(`Hide bag, worn. Mended ${MEND_MAX} times. Too patched to mend again.`);
  });

  it('say how much of the cold is kept off', () => {
    expect(warmthWords(0)).toMatch(/Nothing/);
    expect(warmthWords(0.3)).toBe('Keeps off about 30% of the cold');
    expect(warmthWords(0.456)).toBe('Keeps off about 46% of the cold');
  });

  it('count a band\'s clothes in one line, the warmest first, and say nothing when nobody wears anything', () => {
    expect(clothesLine({ cloak: 0, cape: 0, hat: 0, mittens: 0, shoes: 0, bag: 0 }, 10)).toBe('');
    expect(clothesLine({ cloak: 8, shoes: 3, bag: 1 }, 12)).toBe('8 of 12 have cloaks · 3 shoes · 1 bag');
    expect(clothesLine({ cape: 2, hat: 1, mittens: 1 }, 5)).toBe('2 of 5 have capes · 1 hat · 1 mittens');
  });
});

describe('what shows on a villager', () => {
  it('each worn thing that shows has its own bit of the style, apart from hair and the rest', () => {
    const bits = [1, 2, 8, 16].map(dressStyle);
    expect(new Set(bits).size).toBe(4);
    for (const b of bits) expect(b).toBeGreaterThanOrEqual(32);
    // and they add up without stepping on each other
    expect(dressStyle(1 | 2 | 8 | 16)).toBe(bits.reduce((a, b) => a + b, 0));
    expect(dressStyle(0)).toBe(0);
    // shoes and mittens are too small to show
    expect(dressStyle(4 | 32)).toBe(0);
  });

  it('has a model for the hat, the reed cape and the bag', () => {
    const buf = readFileSync('src/assets/band.glb');
    const len = buf.readUInt32LE(12);
    const json = JSON.parse(buf.subarray(20, 20 + len).toString('utf8'));
    const names = new Set<string>([...(json.nodes ?? []).map((n: { name: string }) => n.name), ...(json.meshes ?? []).map((m: { name: string }) => m.name)]);
    for (const k of ['villager__hat', 'villager__cape', 'villager__bag']) expect(names.has(k), k).toBe(true);
  });
});

describe('the words over a busy head', () => {
  it('say what each kind of work is', () => {
    for (const k of TASK_KINDS) expect(TASK_PHRASE[k], k).toMatch(/^[a-z]/);
  });
});
