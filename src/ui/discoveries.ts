// What each band has come to know, and how: the Chronicle's Discoveries page, worked out from the chronicle
// alone so it can be tested without a page to draw it on.
import type { Chronicle, Learned } from '../sim/sim';
import { DISCOVERIES, DISCOVERY } from '../sim/know';
import { TICKS_PER_YEAR } from '../sim/time';

type Camp = Chronicle['camps'][number];
/** Words, and the people named in them (ids, so the page can link them). */
export type Part = string | { id: number };

export interface KnownRow {
  key: string;
  label: string;
  /** the year it came to them (0: before the chronicle kept count) */
  year: number;
  /** how: "worked out by ", {Ada} */
  how: Part[];
}

export interface BandDiscoveries {
  camp: Camp;
  known: KnownRow[];
  /** what it doesn't know yet, and what it has to know first */
  unknown: { key: string; label: string; needs: string[] }[];
}

const yearOf = (t: number) => Math.floor(t / TICKS_PER_YEAR) + 1;

function howLearned(l: Learned, camp: Camp, camps: Camp[]): Part[] {
  const who: Part[] = l.by >= 0 ? [{ id: l.by }] : ['someone'];
  const how: Part[] =
    l.how === 'found' ? ['worked out by ', ...who]
    : l.how === 'taught' ? ['taught by ', ...who, ', who married in']
    : l.how === 'newcomers' ? [`shown by the last of the people of ${l.from ?? 'another band'}`]
    : ['brought with them when they came as strangers'];
  // found or taught before this camp was made: it came down from the band it split from or moved from
  const parent = camps.find((c) => c.id === camp.parent);
  if (l.tick < camp.founded && parent) how.push(` at ${parent.name}`);
  return how;
}

/** Each band's discoveries, in the order it made them, living bands first. */
export function bandDiscoveries(c: Chronicle): BandDiscoveries[] {
  const order = [...c.camps].sort((a, b) => (a.gone ? 1 : 0) - (b.gone ? 1 : 0) || a.founded - b.founded);
  return order.map((camp) => {
    const rec = new Map(camp.learned.map((l) => [l.k, l]));
    const known = camp.knows.filter((k) => DISCOVERY.has(k)).map((k): KnownRow => {
      const l = rec.get(k);
      return {
        key: k, label: DISCOVERY.get(k)!.label,
        year: l ? yearOf(l.tick) : 0,
        how: l ? howLearned(l, camp, c.camps) : ['known before the chronicle kept count'],
      };
    });
    const unknown = DISCOVERIES.filter((d) => !camp.knows.includes(d.key)).map((d) => ({
      key: d.key, label: d.label,
      needs: d.needs.filter((k) => !camp.knows.includes(k)).map((k) => DISCOVERY.get(k)!.label),
    }));
    return { camp, known, unknown };
  });
}

/** Who first worked each thing out anywhere, and how many of the living bands know it now. */
export function firstFound(c: Chronicle) {
  const live = c.camps.filter((b) => !b.gone);
  return DISCOVERIES.map((d) => {
    let first: { by: number; tick: number; band: string } | null = null;
    for (const b of c.camps)
      for (const l of b.learned)
        if (l.k === d.key && l.how === 'found' && (!first || l.tick < first.tick)) first = { by: l.by, tick: l.tick, band: b.name };
    return { key: d.key, label: d.label, first: first && { ...first, year: yearOf(first.tick) }, knownBy: live.filter((b) => b.knows.includes(d.key)).length, of: live.length };
  });
}
