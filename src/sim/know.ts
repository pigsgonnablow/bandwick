// What a band knows, and how it comes to know more. Bands start with only what people living like
// this had long known (fire, the chopper and spear, cordage, the lean-to, gathering, burial). Every
// other thing is the idea of someone who has mastered the crafts around it: a builder who is also a
// good weaver works out how to raise a hut, a fisher who can weave thinks of a trap. The idea comes to
// them while they are at the work that leads to it, sooner the further past the mark they are.
// Adding a feature that has to be discovered means adding a row here.
import { SK, SKILLS, BuildKind, Walls, Person } from './band';

/** The kinds of work (and of living) during which an idea can come. */
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
  | 'grave' // a grave dug with bare hands
  | 'hunt' // a hunt, kill or no kill
  | 'forage' // a basket of berries picked
  | 'fish_fiber' // a fishing trip, with fiber in the stores to think of weaving with (more when the catch is thin)

/**
 * What someone has to be before they can have an idea. Only skill levels for now; a new kind of
 * condition (a material they have handled, a tool they own, a master they worked beside) is a new
 * member of this union and a new case in `meets`.
 */
export type Requirement =
  | { kind: 'skill'; skill: number; level: number }
  /** any one of these will do */
  | { kind: 'any'; of: Requirement[] };

/** The mark of a master, and of someone merely good at a craft. */
export const ELITE = 15;
export const ABLE = 10;
/** A requirement of a skill at a level: skill(SK.build, ELITE). */
export const skill = (k: number, level: number): Requirement => ({ kind: 'skill', skill: k, level });
export const any = (...of: Requirement[]): Requirement => ({ kind: 'any', of });

/**
 * How far past a requirement someone is, in skill points (0 just at it), or -1 if they fall short.
 * The idea comes likelier the further past every requirement they are.
 */
export function margin(p: Person, r: Requirement): number {
  switch (r.kind) {
    case 'skill':
      return p.skills[r.skill] >= r.level ? p.skills[r.skill] - r.level : -1;
    case 'any':
      return Math.max(-1, ...r.of.map((q) => margin(p, q)));
  }
}

/** Whether someone meets everything a discovery asks of them, and if so by how much they clear it (0 or more). */
export function meets(p: Person, d: Discovery): number {
  let least = Infinity;
  for (const r of d.requires) {
    const m = margin(p, r);
    if (m < 0) return -1;
    least = Math.min(least, m);
  }
  return least === Infinity ? 0 : least;
}

/** The skills a requirement trains toward (for the tables and the reachability test). */
export function skillsIn(r: Requirement): number[] {
  return r.kind === 'skill' ? [r.skill] : r.of.flatMap(skillsIn);
}

/** "building 15 and weaving 10" */
export function describeRequirement(r: Requirement): string {
  return r.kind === 'skill' ? `${SKILLS[r.skill]} ${r.level}` : r.of.map(describeRequirement).join(' or ');
}

export interface Discovery {
  key: string;
  /** what the band panel lists: "Huts" */
  label: string;
  /** what the band has to know first */
  needs: string[];
  /** who can have the idea */
  requires: Requirement[];
  /** the work during which it comes to them, and how much each unit of it counts */
  practice: Partial<Record<Practice, number>>;
  /** units of that work someone just at the mark does, on average, before the idea comes */
  odds: number;
  /** only where there is mud or stone near camp */
  near?: 'mud' | 'stone';
  /** "Ada worked out how to ..." */
  found: string;
  /** "Ada taught the people of Holt to ..." */
  taught: string;
  /** the discoverer's memory */
  memory: string;
}

export const DISCOVERIES: Discovery[] = [
  {
    // (before huts there is little building to learn from: a hut is the idea of someone who knows timber)
    key: 'huts', label: 'Huts', needs: [], requires: [skill(SK.wood, 12), skill(SK.weave, 8)],
    practice: { leanto: 2, night_out: 1 }, odds: 12,
    found: 'worked out how to raise a proper hut, walled and roofed against the cold',
    taught: 'raise huts', memory: 'Worked out how to build a hut.',
  },
  {
    key: 'windbreak', label: 'Windbreak', needs: [], requires: [skill(SK.wood, 12), skill(SK.build, 8)],
    practice: { evening_fire: 1 }, odds: 20,
    found: 'thought to build a screen of stakes behind the fire, to keep the wind off and the warmth in',
    taught: 'build a windbreak behind the fire', memory: 'Thought of a windbreak for the fire.',
  },
  {
    key: 'woodshed', label: 'Woodpile roof', needs: [], requires: [skill(SK.wood, 12), skill(SK.build, 8)],
    practice: { damp_fire: 1 }, odds: 6,
    found: 'saw that a roof over the woodpile would keep the firewood dry',
    taught: 'roof the woodpile', memory: 'Thought of a roof to keep the firewood dry.',
  },
  {
    key: 'axe', label: 'Hafted axe', needs: [], requires: [skill(SK.wood, ELITE), skill(SK.tool, ABLE)],
    practice: { fell_chopper: 1 }, odds: 4,
    found: 'lashed a stone head to a wooden haft and made the first axe, heavy enough for the big trees',
    taught: 'make stone axes', memory: 'Made the first stone axe.',
  },
  {
    key: 'digstick', label: 'Digging stick', needs: [], requires: [skill(SK.tool, ABLE), skill(SK.build, 8)],
    practice: { dig_hand: 1, grave: 3 }, odds: 4,
    found: 'sharpened a stout stick, hardened its point in the fire, and found the ground gave way to it',
    taught: 'make digging sticks', memory: 'Made the first digging stick.',
  },
  {
    key: 'snares', label: 'Snares', needs: [], requires: [skill(SK.hunt, ELITE), skill(SK.weave, 8)],
    practice: { hunt: 2, forage: 1 }, odds: 8,
    found: 'noticed the hares keep to their runs, and set a loop of cord across one',
    taught: 'set snares for hares', memory: 'Set the first snare.',
  },
  {
    key: 'fishtraps', label: 'Fish traps', needs: [], requires: [skill(SK.fish, ELITE), skill(SK.weave, 8)],
    practice: { fish_fiber: 1 }, odds: 10,
    found: 'wove reeds into a funnel the fish swim into and cannot find their way out of',
    taught: 'weave fish traps', memory: 'Wove the first fish trap.',
  },
  {
    // (hidework is learned at the drying rack, so it can't be what leads to it)
    key: 'preserving', label: 'Drying and smoking', needs: [], requires: [any(skill(SK.hunt, ELITE), skill(SK.fish, ELITE)), skill(SK.forage, 8)],
    practice: { store_meat: 1 }, odds: 120,
    found: 'discovered how to dry and smoke meat and fish',
    taught: 'dry and smoke meat and fish', memory: 'Discovered how to dry and smoke meat.',
  },
  {
    key: 'storehouse', label: 'Storehouse', needs: ['huts', 'preserving'], requires: [skill(SK.build, 13), skill(SK.forage, ABLE)],
    // (food carried into the stores, or a builder at work on a site)
    practice: { store_food: 1, build: 10 }, odds: 250,
    found: 'thought of a raised, roofed store to keep the food from going off',
    taught: 'build a storehouse', memory: 'Thought of a storehouse to keep food from spoiling.',
  },
  {
    key: 'daub', label: 'Wattle-and-daub', needs: ['huts'], requires: [skill(SK.build, 13), skill(SK.weave, 8)], near: 'mud',
    practice: { thatch: 1, build: 1 }, odds: 40,
    found: 'worked out how to weave walls of reeds and plaster them with mud',
    taught: 'raise walls of wattle-and-daub', memory: 'Worked out wattle-and-daub walls.',
  },
  {
    key: 'stonework', label: 'Stonework', needs: ['huts'], requires: [skill(SK.build, ELITE), skill(SK.tool, 8)], near: 'stone',
    practice: { build: 1 }, odds: 4,
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
