// The window about a made thing: every kind has a model for its picture, and a card that says what it is,
// where it is now and who made it.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ITEM_KINDS, ITEMS } from '../../src/sim/band';
import { sim } from '../helpers';

describe('item windows', () => {
  it('has a Blender model of every kind of item in the band models', () => {
    const glb = readFileSync(new URL('../../src/assets/band.glb', import.meta.url));
    const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString());
    const names = new Set(json.nodes.map((n: { name: string }) => n.name));
    expect(ITEM_KINDS.filter((k) => !names.has(`item__${k}`))).toEqual([]);
  });

  it('describes every kind of item, on the pile and on someone', () => {
    const s = sim(4471);
    s.giveTools(s.camp, Object.fromEntries(ITEM_KINDS.map((k) => [k, 1])));
    for (const kind of ITEM_KINDS) {
      const item = s.items.filter((i) => i.kind === kind).at(-1)!;
      const c = s.inspectThing({ kind: 'item', id: item.id })!;
      expect(c.title).toBe(ITEMS[kind].label);
      expect(c.item).toBe(kind);
      expect(c.lines.find((l) => l.label === 'Lies')?.ref?.kind).toBe('building');
      expect(c.lines.map((l) => l.label)).toEqual(expect.arrayContaining(['Condition', 'Life left', 'Made by', 'Made']));
      expect(c.notes[0].length).toBeGreaterThan(20);
    }
    const p = s.people.find((q) => q.alive)!;
    const cloak = s.items.filter((i) => i.kind === 'cloak').at(-1)!;
    s.dress(p, cloak);
    const c = s.inspectThing({ kind: 'item', id: cloak.id })!;
    expect(c.lines[0]).toMatchObject({ label: 'Worn by', value: p.name, ref: { kind: 'person', id: p.id } });
    expect(c.follow).toBe(p.id);
    expect(c.lines.find((l) => l.label === 'Warmth')?.value).toBe('Keeps off 30% of the cold');
    // the Gear tab names it by id, so its window can be opened from there
    expect(s.inspect(p.id)!.gear.find((g) => g.slot === 'body')?.item?.id).toBe(cloak.id);
  });

  it('has no window for a thing that is gone', () => {
    expect(sim(4471).inspectThing({ kind: 'item', id: 999999 })).toBeNull();
  });
});
