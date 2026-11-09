// Plain words for what the sim keeps as numbers, shared by the windows (and checked by the tests).
import { CARRY, MEND_MAX } from '../sim/band';

/** What someone has in their arms, by CARRY id. */
export const CARRYING: Record<number, string> = {
  [CARRY.Log]: 'a log', [CARRY.Berries]: 'berries', [CARRY.Meat]: 'meat', [CARRY.Fish]: 'fish',
  [CARRY.Body]: 'the body of the dead', [CARRY.Spear]: 'a spear', [CARRY.Baby]: 'a baby', [CARRY.Fiber]: 'grass and cordage', [CARRY.Mud]: 'a basket of mud', [CARRY.Stone]: 'stone',
  [CARRY.Roots]: 'roots', [CARRY.Nuts]: 'a bag of acorns', [CARRY.Herbs]: 'healing herbs', [CARRY.Eggs]: 'eggs from a nest', [CARRY.Honey]: 'honeycomb',
  [CARRY.Mushrooms]: 'a basket of mushrooms', [CARRY.Grain]: 'a sheaf of grain', [CARRY.Greens]: 'greens from the garden',
};

/** Where on the body something is worn, as the Gear tab says it. */
export const SLOT_WORDS: Record<string, string> = { head: 'Head', body: 'Body', hands: 'Hands', feet: 'Feet', shoulder: 'Shoulder', neck: 'Neck' };

/** One worn or held thing, in a line: "Fur hat, worn. Made by Ada; mended twice, last by Bo." */
export function gearLine(it: { label: string; condition: string; maker: { name: string } | null; mended?: number; mender?: { name: string } | null; given?: boolean }) {
  // a necklace does not wear out: say who gave it
  if (it.given) return `${it.label}${it.maker ? ` from ${it.maker.name}` : ''}.`;
  const made = it.maker ? ` Made by ${it.maker.name}.` : '';
  const n = it.mended ?? 0;
  const mended = n > 0 ? ` Mended ${n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`}${it.mender ? `, last by ${it.mender.name}` : ''}.` : '';
  const patches = n >= MEND_MAX ? ' Too patched to mend again.' : '';
  return `${it.label}, ${it.condition}.${made}${mended}${patches}`;
}

/** How much of the cold someone's clothes keep off, in words. */
export function warmthWords(kept: number) {
  const pct = Math.round(kept * 100);
  return pct <= 0 ? 'Nothing to keep off the cold but what they stand in' : `Keeps off about ${pct}% of the cold`;
}

const PLURAL: Record<string, string> = { cloak: 'cloaks', cape: 'capes', hat: 'hats', mittens: 'mittens', shoes: 'shoes', bag: 'bags' };
/** What a band wears, in one line: "8 of 12 have cloaks · 3 shoes · 1 bag". Empty when nobody wears anything. */
export function clothesLine(clothes: Record<string, number>, pop: number) {
  const order = ['cloak', 'cape', 'hat', 'mittens', 'shoes', 'bag'];
  const have = order.filter((k) => (clothes[k] ?? 0) > 0);
  if (!have.length) return '';
  const [first, ...rest] = have;
  return [`${clothes[first]} of ${pop} have ${PLURAL[first]}`, ...rest.map((k) => `${clothes[k]} ${clothes[k] === 1 && k !== 'mittens' && k !== 'shoes' ? k : PLURAL[k]}`)].join(' · ');
}
