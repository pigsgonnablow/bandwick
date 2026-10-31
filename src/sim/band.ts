// Data definitions for people, buildings, animals and the camp.

export const TRAITS = [
  'industrious', 'lazy', 'curious', 'brave', 'cautious', 'kind', 'cruel',
  'ambitious', 'pious', 'wanderlust', 'charismatic', 'greedy',
] as const;
export type Trait = (typeof TRAITS)[number];
export const OPPOSED: [Trait, Trait][] = [['industrious', 'lazy'], ['brave', 'cautious'], ['kind', 'cruel']];

// Crafting is four skills, so people grow into the band's toolmaker, weaver, potter or hideworker.
export const SKILLS = ['foraging', 'woodcutting', 'building', 'hunting', 'fishing', 'toolmaking', 'weaving', 'pottery', 'hidework'] as const;
export type Skill = (typeof SKILLS)[number];
export const SK = { forage: 0, wood: 1, build: 2, hunt: 3, fish: 4, tool: 5, weave: 6, pot: 7, hide: 8 } as const;
/** The top of every skill. */
export const SKILL_MAX = 20;
/**
 * What each piece of work teaches: the skills it trains, and how much a beginner gains in each. Every gain
 * goes through `trainSkill`, which makes the last steps toward mastery the slowest.
 */
type Lesson = readonly { skill: number; gain: number }[];
export const TRAINING = {
  'forage.pick': [{ skill: SK.forage, gain: 0.06 }], // a bush's berries picked
  // an armful of grass or reeds cut: handling them is how a weaver gets to know them
  reap: [{ skill: SK.forage, gain: 0.03 }, { skill: SK.weave, gain: 0.03 }],
  dig: [{ skill: SK.build, gain: 0.05 }], // a load of mud or stone dug
  // (building is the rarest work, a few roofs a year: each spell of it teaches the most)
  build: [{ skill: SK.build, gain: 0.3 }], // a spell of work on a building site
  fell: [{ skill: SK.wood, gain: 0.08 }], // a tree brought down
  deadwood: [{ skill: SK.wood, gain: 0.02 }], // an armful of fallen branches
  'hunt.kill': [{ skill: SK.hunt, gain: 0.35 }],
  'hunt.miss': [{ skill: SK.hunt, gain: 0.05 }],
  'trap.catch': [{ skill: SK.hunt, gain: 0.03 }], // a catch taken from a snare or fish trap
  'fish.catch': [{ skill: SK.fish, gain: 0.12 }],
  'fish.miss': [{ skill: SK.fish, gain: 0.03 }],
  preserve: [{ skill: SK.hide, gain: 0.1 }], // a batch hung on the drying rack
} as const satisfies Record<string, Lesson>;
export type Training = keyof typeof TRAINING;

/** How much of a gain someone at this level still takes in: all of it at first, little near the top. */
export const learnRate = (level: number) => Math.max(0.05, 1 - level / (SKILL_MAX + 2));

/** How fast everyone learns, against the gains in the tables: the one knob for how long mastery takes. */
export const SKILL_PACE = 3;

/** A skill grows by `gain` as a beginner would take it in. */
export function trainSkill(p: Person, k: number, gain: number) {
  p.skills[k] = Math.min(SKILL_MAX, p.skills[k] + gain * SKILL_PACE * learnRate(p.skills[k]));
}
/** A piece of work done: the skills it trains grow. */
export function train(p: Person, what: Training) {
  for (const l of TRAINING[what] as Lesson) trainSkill(p, l.skill, l.gain);
}

/** What a person is known as when they are clearly the band's best at a craft. */
export const CRAFT_TITLES: Partial<Record<number, string>> = { [SK.tool]: 'toolmaker', [SK.weave]: 'weaver', [SK.pot]: 'potter', [SK.hide]: 'hideworker' };

/** What a person's body is doing (drives animation). */
export const ACT = {
  Idle: 0, Walk: 1, Chop: 2, Gather: 3, Sit: 4, Sleep: 5, Chat: 6, Build: 7, Fish: 8, Eat: 9,
  Mourn: 10, Dead: 11, Run: 12, Hunt: 13, Dig: 14,
  /** children's games; squatting to tend the fire; hanging food on the rack; hands out to the fire */
  Play: 15, Tend: 16, Rack: 17, Warm: 18,
} as const;
/** One-off moves the renderer plays when a person's `flash` changes (low two bits). */
export const FLASH = { Thrust: 1, Stab: 2 } as const;
export const ACT_NAMES = Object.keys(ACT);

/** What a person is carrying. */
export const CARRY = { None: 0, Log: 1, Berries: 2, Meat: 3, Fish: 4, Body: 5, Spear: 6, Baby: 7, Fiber: 8, Mud: 9, Stone: 10 } as const;

export type TaskKind =
  | 'eat' | 'eatwild' | 'sleep' | 'warm' | 'socialize' | 'play' | 'idle' | 'mourn'
  | 'forage' | 'fell' | 'haul' | 'hunt' | 'fish' | 'build' | 'supply' | 'fuel' | 'preserve' | 'bury' | 'explore'
  | 'deadwood' | 'swim' | 'migrate' | 'reap' | 'craft' | 'dig' | 'quarry' | 'trap';

/** Task kinds in a fixed order, so the renderer can be told what each person is doing. */
export const TASK_KINDS: TaskKind[] = [
  'eat', 'eatwild', 'sleep', 'warm', 'socialize', 'play', 'idle', 'mourn',
  'forage', 'fell', 'haul', 'hunt', 'fish', 'build', 'supply', 'fuel', 'preserve', 'bury', 'explore',
  'deadwood', 'swim', 'migrate', 'reap', 'craft', 'dig', 'quarry', 'trap',
];

/** Things a band makes and keeps: tools, traps, baskets and pots. */
export const ITEM_KINDS = ['chopper', 'axe', 'stick', 'snare', 'fishtrap', 'basket', 'pot'] as const;
/** Things set out in the land and left to work: checked on the band's daily round. */
export const TRAP_KINDS: ItemKind[] = ['snare', 'fishtrap'];
export type ItemKind = (typeof ITEM_KINDS)[number];
export interface ItemSpec {
  label: string;
  /** how many trees it fells (or trips it digs) before it is worn out */
  uses: number;
}
export const ITEMS: Record<ItemKind, ItemSpec> = {
  // a stone knapped to an edge, held in the fist: saplings and young trees only, and slowly
  chopper: { label: 'Hand chopper', uses: 10 },
  // the same head lashed to a wooden haft: any tree
  axe: { label: 'Stone axe', uses: 25 },
  // a stout stick sharpened to a point and hardened in the fire: mud, clay and graves
  stick: { label: 'Digging stick', uses: 15 },
  // a loop of cord at the foot of a bush, for hares: the cord rots or is chewed through in about a season
  snare: { label: 'Snare', uses: 12 },
  // a woven basket funnel in the shallows: about a year
  fishtrap: { label: 'Fish trap', uses: 48 },
  // a deep basket of willow withies and grass, carried out empty and brought home full: a season or two of picking
  basket: { label: 'Basket', uses: 40 },
  // a coiled clay pot fired in the embers, kept in the stores with berries in it under a lid: it lasts
  // a few years of daily use before it cracks (each day it holds food counts as a use)
  pot: { label: 'Clay pot', uses: 150 },
};
/** Berries kept in one pot, and how much of the usual going-off still happens to them there. */
export const POT_HOLDS = 6;
export const POT_KEEP = 0.4;
/** Berries brought home in one trip with a basket: several bushes' worth, where bare hands manage one. */
export const BASKET_HOLDS = 8;

/**
 * Everything made sitting by the fire is one job, crafting, with a recipe for each thing. The morning
 * plan says what the band is short of; each crafter takes the recipe they are best at among those.
 */
/** Fiber twisted into one length of cordage. */
export const FIBER_PER_CORD = 3;
export const RECIPE_KEYS = ['cordage', 'chopper', 'axe', 'stick', 'snare', 'fishtrap', 'basket', 'pot'] as const;
export type RecipeKey = (typeof RECIPE_KEYS)[number];
export interface Recipe {
  /** what it makes: a length of cordage into the stores, or an item onto the pile */
  makes: 'cordage' | ItemKind;
  /** what it uses from the stores */
  uses: Partial<Record<'wood' | 'fiber' | 'cordage' | 'stone' | 'mud', number>>;
  /** ticks of work at the fire, before skill */
  work: number;
  skill: number;
  /** how much the skill grows each time */
  grow: number;
  /** what the band has to know first */
  knows?: string;
  /** the person card: "Twisting cordage" */
  doing: string;
  /** the person's thought while at it, and when done */
  thought: string;
  done: string;
}
export const RECIPES: Record<RecipeKey, Recipe> = {
  cordage: {
    makes: 'cordage', uses: { fiber: FIBER_PER_CORD }, work: 36, skill: SK.weave, grow: 0.06, doing: 'Twisting cordage',
    thought: 'Twisting grass into cordage.', done: 'Twisted a length of cordage.',
  },
  chopper: {
    makes: 'chopper', uses: { stone: 1 }, work: 24, skill: SK.tool, grow: 0.08, doing: 'Knapping a hand chopper',
    thought: 'Knapping a stone to an edge for a chopper.', done: 'Knapped a chopper and laid it on the pile.',
  },
  axe: {
    makes: 'axe', uses: { wood: 2, stone: 1, cordage: 1 }, work: 60, skill: SK.tool, grow: 0.08, knows: 'axe', doing: 'Making a stone axe',
    thought: 'Lashing a stone head to a haft for an axe.', done: 'Made a stone axe and laid it on the pile.',
  },
  stick: {
    makes: 'stick', uses: { wood: 1 }, work: 16, skill: SK.tool, grow: 0.05, knows: 'digstick', doing: 'Making a digging stick',
    thought: 'Sharpening a digging stick and hardening its point in the fire.', done: 'Made a digging stick and laid it on the pile.',
  },
  snare: {
    makes: 'snare', uses: { cordage: 1 }, work: 12, skill: SK.weave, grow: 0.04, knows: 'snares', doing: 'Making a snare',
    thought: 'Knotting a running loop of cord for a snare.', done: 'Made a snare and laid it on the pile.',
  },
  fishtrap: {
    makes: 'fishtrap', uses: { fiber: 3, wood: 2 }, work: 40, skill: SK.weave, grow: 0.06, knows: 'fishtraps', doing: 'Weaving a fish trap',
    thought: 'Weaving reeds into a funnel basket for the shallows.', done: 'Wove a fish trap and laid it on the pile.',
  },
  basket: {
    makes: 'basket', uses: { fiber: 3, wood: 1 }, work: 30, skill: SK.weave, grow: 0.05, knows: 'baskets', doing: 'Weaving a basket',
    thought: 'Weaving grass round a ring of withies for a gathering basket.', done: 'Wove a basket and laid it on the pile.',
  },
  pot: {
    // clay coiled up into a pot, then fired in the embers of the hearth
    makes: 'pot', uses: { mud: 2, wood: 1 }, work: 44, skill: SK.pot, grow: 0.08, knows: 'pottery', doing: 'Making a clay pot',
    thought: 'Coiling clay into a pot to fire in the embers.', done: 'Fired a clay pot and set it in the stores.',
  },
};
/** One made thing. It lies on its band's stockpile unless someone holds it, or it is set out in the land. */
export interface Item {
  id: number;
  kind: ItemKind;
  /** the band whose pile it goes back to */
  band: number;
  /** who has it in hand (a person id), or -1 on the stockpile */
  holder: number;
  /** how worn it is, 0 new .. 1 broken */
  wear: number;
  made: number;
  /** who made it (-1: brought from beyond the map) */
  maker: number;
  /** a trap: the tile it is set on (absent or -1: on the pile; -2: in the basket of whoever is setting it) */
  tile?: number;
  /** a trap: what it has caught and is holding, waiting for the round (meat for a snare, fish for a fish trap) */
  catch?: number;
}

/** Anything in the world that can be clicked. */
export interface Ref {
  kind: 'person' | 'deer' | 'building' | 'prop' | 'tile';
  id: number;
}
export interface CardLine {
  label: string;
  value: string;
  ref?: Ref;
}
/** A description of a thing for the inspector card. */
export interface Card {
  ref: Ref;
  title: string;
  subtitle: string;
  lines: CardLine[];
  notes: string[];
  x: number;
  z: number;
  gone?: boolean;
}

export interface Task {
  kind: TaskKind;
  stage: number;
  /** destination tile */
  goal: number;
  /** exact spot inside the goal tile (tile units) */
  gx: number;
  gz: number;
  /** id of the thing worked on (prop, building, deer, person) */
  ref: number;
  timer: number;
  started: number;
  amount: number;
  near: boolean;
  /** tick by which a chase gives up (hunting: longer for herds further out) */
  deadline?: number;
  /** tick the walk back to the stores began, while carrying goods home */
  homeAt?: number;
  /** preserving: how much of `amount` was taken from the fish (the rest is meat) */
  fish?: number;
  /** the trap round: the stops, three numbers each (trap id, the tile to stand on, the tile to set it on) */
  route?: number[];
  /** the trap round: which stop is next */
  step?: number;
  /** supplying a building site: what is carried there (absent: wood) */
  res?: Material;
}

export interface Memory {
  kind: string;
  tick: number;
  /** -100..100 effect on mood when fresh */
  weight: number;
  /** how many years it takes to fade */
  years: number;
  subject: number;
  text: string;
}

export interface Person {
  id: number;
  /** the band (camp id) they belong to */
  band: number;
  name: string;
  sex: 0 | 1; // 0 female, 1 male
  birth: number;
  mother: number;
  father: number;
  partner: number;
  /** attraction: 0 = the other sex, 1 = the same sex */
  samesex: boolean;
  alive: boolean;
  death: number;
  cause: string;
  buried: boolean;
  x: number;
  z: number;
  fx: number; // facing target
  fz: number;
  path: Int32Array | null;
  pathIdx: number;
  task: Task | null;
  nextThink: number;
  food: number;
  rest: number;
  warmth: number;
  safety: number;
  belonging: number;
  health: number;
  mood: number;
  sick: number; // days of fever left
  traits: Trait[];
  skills: Float32Array;
  /** the craft they are known for in their band (a skill index), when clearly its best at it */
  known?: number;
  /** every craft they have ever been named for (absent until they are) */
  titles?: number[];
  carry: number;
  carryAmt: number;
  home: number;
  indoors: boolean;
  act: number;
  thought: string;
  memories: Memory[];
  rel: Map<number, number>;
  pregnantUntil: number;
  babyFather: number;
  look: number; // seed for clothes, skin, hair
  kills: number;
  /** a rare constitution: ages far more slowly once old (absent = no) */
  hardy?: boolean;
  /** who killed them, if someone did */
  killer?: number;
  /** a one-off move to show: count * 4 + FLASH code (looks only; changes nothing) */
  flash?: number;
  children: number[];
  /** tick of the last time they went to mourn */
  mourned: number;
  /** who raises them when both parents are dead (-1: their parents); kinship stays with the birth parents */
  carer: number;
}

export const BUILD_KINDS = ['hearth', 'leanto', 'hut', 'storehouse', 'rack', 'stockpile', 'windbreak', 'woodshed'] as const;
export type BuildKind = (typeof BUILD_KINDS)[number];
/**
 * What goes into a building: wood for the frame, grass and reed fiber for thatch, cordage to lash it
 * together, and for walls that are not wood, mud for daub or stone.
 */
export const MATERIALS = ['wood', 'fiber', 'cordage', 'mud', 'stone'] as const;
export type Material = (typeof MATERIALS)[number];
export interface BuildSpec {
  wood: number;
  fiber: number;
  cordage: number;
  mud: number;
  stone: number;
  work: number;
  cap: number;
  shelter: number;
  /** storehouses: how much of the usual spoilage still happens to food kept inside */
  keep: number;
  label: string;
}
const spec = (s: Partial<BuildSpec> & { label: string }): BuildSpec => ({ wood: 0, fiber: 0, cordage: 0, mud: 0, stone: 0, work: 0, cap: 0, shelter: 0, keep: 1, ...s });
export const BUILD: Record<BuildKind, BuildSpec> = {
  hearth: spec({ label: 'Hearth' }),
  leanto: spec({ wood: 4, fiber: 3, work: 40, cap: 2, shelter: 0.5, label: 'Lean-to' }),
  hut: spec({ wood: 14, fiber: 6, cordage: 3, work: 150, cap: 6, shelter: 0.78, label: 'Hut' }),
  storehouse: spec({ wood: 10, fiber: 4, cordage: 2, work: 110, keep: 0.6, label: 'Storehouse' }),
  rack: spec({ wood: 5, cordage: 2, work: 45, label: 'Drying rack' }),
  stockpile: spec({ label: 'Stockpile' }),
  // built onto the camp fire and the stockpile, on their tiles
  windbreak: spec({ wood: 6, cordage: 2, work: 30, label: 'Windbreak' }),
  woodshed: spec({ wood: 4, fiber: 4, cordage: 2, work: 40, label: 'Woodpile roof' }),
};

/** What a building's walls are made of. Huts and storehouses can be raised in any of these. */
export const WALLS = ['wood', 'daub', 'stone'] as const;
export type Walls = (typeof WALLS)[number];
export const WALL_NAMES: Record<Walls, string> = { wood: 'wood', daub: 'wattle-and-daub', stone: 'stone' };
/**
 * The same buildings in other walls: wattle-and-daub (a few poles, woven reeds, mud) and drystone
 * (stone, with wood only for the roof). Warmer and slower to raise; stone needs the knowledge of stonework.
 */
const WALL_SPECS: Partial<Record<BuildKind, Partial<Record<Walls, BuildSpec>>>> = {
  hut: {
    daub: spec({ wood: 5, fiber: 10, cordage: 3, mud: 10, work: 200, cap: 6, shelter: 0.85, label: 'Hut' }),
    stone: spec({ wood: 5, fiber: 6, cordage: 3, stone: 18, work: 330, cap: 6, shelter: 0.92, label: 'Hut' }),
  },
  storehouse: {
    daub: spec({ wood: 4, fiber: 7, cordage: 2, mud: 8, work: 145, keep: 0.5, label: 'Storehouse' }),
    stone: spec({ wood: 4, fiber: 4, cordage: 2, stone: 14, work: 250, keep: 0.4, label: 'Storehouse' }),
  },
};
/** Which walls a kind of building can have. */
export const wallsFor = (kind: BuildKind): Walls[] => ['wood', ...(Object.keys(WALL_SPECS[kind] ?? {}) as Walls[])];
/** What a building (or a kind, in given walls) takes, and what it gives. */
export function specOf(b: { kind: BuildKind; walls?: Walls }): BuildSpec {
  return (b.walls && b.walls !== 'wood' && WALL_SPECS[b.kind]?.[b.walls]) || BUILD[b.kind];
}
/** "Hut", "Stone hut", "Wattle-and-daub storehouse". */
export function labelOf(b: { kind: BuildKind; walls?: Walls }) {
  const l = BUILD[b.kind].label;
  if (!b.walls || b.walls === 'wood') return l;
  const w = WALL_NAMES[b.walls];
  return `${w[0].toUpperCase()}${w.slice(1)} ${l.toLowerCase()}`;
}

export interface Building {
  id: number;
  /** the band (camp id) that built it */
  band: number;
  kind: BuildKind;
  tile: number;
  x: number;
  z: number;
  rot: number; // quarter turns
  wood: number; // delivered
  /** thatch and cordage delivered (absent in older saves until restored) */
  fiber: number;
  cordage: number;
  /** mud and stone delivered for walls that are not wood (absent in older saves until restored) */
  mud: number;
  stone: number;
  /** what the walls are made of (absent in older saves: wood) */
  walls?: Walls;
  work: number; // done
  built: boolean;
  owner: number; // person id of the household head
  fuel: number;
  started: number;
  finished: number;
  builders: number[];
}

export interface Deer {
  id: number;
  herd: number;
  x: number;
  z: number;
  tx: number;
  tz: number;
  fx: number;
  fz: number;
  state: number; // 0 graze, 1 walk, 2 flee
  timer: number;
  alive: boolean;
  fawn: boolean;
}

export interface Herd {
  id: number;
  hx: number;
  hz: number;
  /** wander target shared by the herd */
  tx: number;
  tz: number;
  next: number;
}

export interface Stock {
  berries: number;
  meat: number;
  fish: number;
  preserved: number;
  wood: number;
  /** cut grass and reeds, and the cordage twisted from them (absent in older saves until restored) */
  fiber: number;
  cordage: number;
  /** dug mud and quarried stone, for walls (absent in older saves until restored) */
  mud: number;
  stone: number;
}

export interface SimEvent {
  id: number;
  tick: number;
  kind: string;
  text: string;
  people: number[];
  x: number;
  z: number;
  /** 1 routine .. 5 momentous; the history engine (M2) builds on this */
  weight: number;
}

export const foodTotal = (s: Stock) => s.berries + s.meat + s.fish + s.preserved;

/** The health levels the sim acts on (the info window's health tooltip reads them too). */
export const HEALTH = {
  /** must be above this to go swimming */
  swim: 50,
  /** below this, can't lead a band that splits off */
  lead: 50,
  /** below this, isn't sent hunting */
  hunt: 45,
  /** below this: half the work, a slower walk and twice the daily chance of dying */
  weak: 40,
  /** health mends only while food and warmth are both above this */
  mend: 30,
  /** food below this hurts */
  starving: 8,
  /** warmth below this hurts, and below `freezing` much more */
  cold: 22,
  freezing: 8,
} as const;
