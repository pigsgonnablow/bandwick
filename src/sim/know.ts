// What a band knows, and how it comes to know more. Bands start with only what people living like
// this had long known (fire, the chopper and spear, cordage, the lean-to, gathering, burial). Every
// other thing is found by doing the work that leads to it: each piece of that work adds to the band's
// experience toward the idea, and the person who did it may have it, the likelier the more there is.
// Adding a feature that has to be discovered means adding a row here.
import type { Sim, Camp } from './sim';
import { SK, BuildKind, Walls } from './band';
import { seasonOf } from './time';

/** The kinds of work (and of living) that lead to discoveries. */
export type Practice =
  | 'build' // a spell of work on any building site
  | 'leanto' // a spell of work on a lean-to
  | 'night_out' // a night under a lean-to or in the open (each adult)
  | 'evening_fire' // an evening by the camp fire (each adult)
  | 'damp_fire' // feeding the fire with damp wood
  | 'store_food' // food carried into the stores (per meal)
  | 'store_meat' // meat and fish carried into the stores (per meal)
  | 'thatch' // grass and reeds cut and carried in (per bundle)
  | 'fell_chopper' // a tree felled with a hand chopper
  | 'dig_hand' // a trip's digging done with bare hands
  | 'grave'; // a grave dug with bare hands

export interface Discovery {
  key: string;
  /** what the band panel lists: "Huts" */
  label: string;
  /** what has to be known first */
  needs: string[];
  /** the work that leads to it, and how much each unit of it counts */
  practice: Partial<Record<Practice, number>>;
  /** experience at which a typical band has usually had the idea (about half do by then) */
  need: number;
  /** the skill that makes someone likelier to see it */
  skill: number;
  /** only where there is mud or stone near camp */
  near?: 'mud' | 'stone';
  /** hardship tied to it makes it come faster (1 = none) */
  hurry?: (s: Sim, c: Camp) => number;
  /** "Ada worked out how to ..." */
  found: string;
  /** "Ada taught the people of Holt to ..." */
  taught: string;
  /** the discoverer's memory */
  memory: string;
}

const winter = (s: Sim) => seasonOf(s.tick) === 3;
const cold = (s: Sim) => (seasonOf(s.tick) === 3 ? 2 : seasonOf(s.tick) === 2 ? 1.4 : 1);

export const DISCOVERIES: Discovery[] = [
  {
    key: 'huts', label: 'Huts', needs: [], skill: SK.build, need: 130,
    practice: { leanto: 2, night_out: 1 },
    hurry: cold,
    found: 'worked out how to raise a proper hut, walled and roofed against the cold',
    taught: 'raise huts', memory: 'Worked out how to build a hut.',
  },
  {
    key: 'windbreak', label: 'Windbreak', needs: [], skill: SK.build, need: 330,
    practice: { evening_fire: 1 },
    hurry: cold,
    found: 'thought to build a screen of stakes behind the fire, to keep the wind off and the warmth in',
    taught: 'build a windbreak behind the fire', memory: 'Thought of a windbreak for the fire.',
  },
  {
    key: 'woodshed', label: 'Woodpile roof', needs: [], skill: SK.wood, need: 22,
    practice: { damp_fire: 1 },
    found: 'saw that a roof over the woodpile would keep the firewood dry',
    taught: 'roof the woodpile', memory: 'Thought of a roof to keep the firewood dry.',
  },
  {
    key: 'axe', label: 'Hafted axe', needs: [], skill: SK.wood, need: 40,
    practice: { fell_chopper: 1 },
    found: 'lashed a stone head to a wooden haft and made the first axe, heavy enough for the big trees',
    taught: 'make stone axes', memory: 'Made the first stone axe.',
  },
  {
    key: 'digstick', label: 'Digging stick', needs: [], skill: SK.build, need: 8,
    practice: { dig_hand: 1, grave: 3 },
    found: 'sharpened a stout stick, hardened its point in the fire, and found the ground gave way to it',
    taught: 'make digging sticks', memory: 'Made the first digging stick.',
  },
  {
    key: 'preserving', label: 'Drying and smoking', needs: [], skill: SK.hide, need: 1600,
    practice: { store_meat: 1 },
    hurry: (_s, c) => (c.hungryWinters > 0 || c.famine ? 2.5 : 1),
    found: 'discovered how to dry and smoke meat and fish',
    taught: 'dry and smoke meat and fish', memory: 'Discovered how to dry and smoke meat.',
  },
  {
    key: 'storehouse', label: 'Storehouse', needs: ['huts'], skill: SK.build, need: 1500,
    practice: { store_food: 1 },
    // food going off in the open: lots of it lying in the stores in the warm months
    hurry: (s, c) => (seasonOf(s.tick) === 1 && c.stock.berries + c.stock.fish > 30 ? 1.8 : 1),
    found: 'thought of a raised, roofed store to keep the food from going off',
    taught: 'build a storehouse', memory: 'Thought of a storehouse to keep food from spoiling.',
  },
  {
    key: 'daub', label: 'Wattle-and-daub', needs: ['huts'], skill: SK.build, need: 180, near: 'mud',
    practice: { thatch: 1, build: 1 },
    hurry: (s) => (winter(s) ? 1.6 : 1),
    found: 'worked out how to weave walls of reeds and plaster them with mud',
    taught: 'raise walls of wattle-and-daub', memory: 'Worked out wattle-and-daub walls.',
  },
  {
    key: 'stonework', label: 'Stonework', needs: ['huts'], skill: SK.build, need: 45, near: 'stone',
    practice: { build: 1 },
    found: 'worked out how to raise walls of stacked stone',
    taught: 'raise walls of stacked stone', memory: 'Worked out how to raise walls of stacked stone.',
  },
];

export const DISCOVERY = new Map(DISCOVERIES.map((d) => [d.key, d]));

/** What a band has to know to build something. */
export function knowHowFor(b: { kind: BuildKind; walls?: Walls }): string[] {
  const out: string[] = [];
  const k = ({ hut: 'huts', storehouse: 'storehouse', rack: 'preserving', windbreak: 'windbreak', woodshed: 'woodshed' } as Partial<Record<BuildKind, string>>)[b.kind];
  if (k) out.push(k);
  if (b.walls === 'daub') out.push('daub');
  if (b.walls === 'stone') out.push('stonework');
  return out;
}
