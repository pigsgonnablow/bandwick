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
  // a carcass brought home and skinned, the hide scraped and pegged out
  skin: [{ skill: SK.hide, gain: 0.08 }],
  // a load of roots dug with a digging stick
  roots: [{ skill: SK.forage, gain: 0.04 }],
  // a load of acorns gathered under the oaks
  nuts: [{ skill: SK.forage, gain: 0.04 }],
  // a bundle of healing plants found and cut, or a fever nursed with them
  herbs: [{ skill: SK.forage, gain: 0.05 }],
  // something worn mended by the fire
  mend: [{ skill: SK.hide, gain: 0.04 }],
  // a clutch of eggs found in the spring, a wild hive smoked out, a basket of mushrooms picked
  eggs: [{ skill: SK.forage, gain: 0.03 }],
  honey: [{ skill: SK.forage, gain: 0.06 }],
  mushrooms: [{ skill: SK.forage, gain: 0.05 }],
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
export const CARRY = { None: 0, Log: 1, Berries: 2, Meat: 3, Fish: 4, Body: 5, Spear: 6, Baby: 7, Fiber: 8, Mud: 9, Stone: 10, Roots: 11, Nuts: 12, Herbs: 13, Eggs: 14, Honey: 15, Mushrooms: 16 } as const;

export type TaskKind =
  | 'eat' | 'eatwild' | 'sleep' | 'warm' | 'socialize' | 'play' | 'idle' | 'mourn'
  | 'forage' | 'fell' | 'haul' | 'hunt' | 'fish' | 'build' | 'supply' | 'fuel' | 'preserve' | 'bury' | 'explore'
  | 'deadwood' | 'swim' | 'migrate' | 'reap' | 'craft' | 'dig' | 'quarry' | 'trap' | 'watch' | 'tell' | 'listen' | 'bed' | 'roots' | 'nuts' | 'herbs' | 'nurse' | 'gift' | 'feast' | 'eggs' | 'honey' | 'mushrooms' | 'mend';

/** Task kinds in a fixed order, so the renderer can be told what each person is doing. */
export const TASK_KINDS: TaskKind[] = [
  'eat', 'eatwild', 'sleep', 'warm', 'socialize', 'play', 'idle', 'mourn',
  'forage', 'fell', 'haul', 'hunt', 'fish', 'build', 'supply', 'fuel', 'preserve', 'bury', 'explore',
  'deadwood', 'swim', 'migrate', 'reap', 'craft', 'dig', 'quarry', 'trap', 'watch', 'tell', 'listen', 'bed', 'roots', 'nuts', 'herbs', 'nurse', 'gift', 'feast', 'eggs', 'honey', 'mushrooms', 'mend',
];

/** Things a band makes and keeps: tools, traps, baskets, pots and cloaks. */
export const ITEM_KINDS = ['chopper', 'axe', 'stick', 'snare', 'fishtrap', 'basket', 'pot', 'cloak', 'needle', 'hat', 'mittens', 'shoes', 'cape', 'bag', 'necklace', 'deadfall', 'furcloak'] as const;
/** Things set out in the land and left to work: checked on the band's daily round. */
export const TRAP_KINDS: ItemKind[] = ['snare', 'fishtrap', 'deadfall'];
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
  // a deer hide scraped, softened and sewn into a cloak with a cord at the throat: worn every cold day, it
  // lasts two or three winters before it is worn through
  cloak: { label: 'Hide cloak', uses: 150 },
  // a sliver of deer bone ground to a point, with an eye, and an awl to punch the holes: they speed the
  // sewing and weaving at the fire (each thing sewn with them is a use)
  needle: { label: 'Bone needle', uses: 30 },
  // a cap of hide with the fur turned in, and a pair of hide mittens: a few winters each
  hat: { label: 'Fur hat', uses: 200 },
  mittens: { label: 'Hide mittens', uses: 140 },
  // soft hide shoes, gathered at the ankle with a thong: they wear through with walking, a season or so
  shoes: { label: 'Hide shoes', uses: 100 },
  // reeds and grass knotted into a cape, shed the wind like thatch: a poor cousin of a cloak, a winter or two
  cape: { label: 'Reed cape', uses: 110 },
  // a hide bag on a strap over the shoulder, for whatever is gathered: a year or two of loads
  bag: { label: 'Hide bag', uses: 80 },
  // teeth and shells strung on a cord and given to someone dear: it does not wear out, and goes into the grave with them
  necklace: { label: 'Necklace', uses: 1000 },
  // a heavy log propped on a figure-four of sticks, at a fox's earth or on a beaver's path up the bank: the
  // beast takes the bait, the trigger slips and the log comes down (it lasts a season or two of rain)
  deadfall: { label: 'Deadfall', uses: 30 },
  // fox and beaver pelts sewn fur-out into a mantle: much warmer than a hide cloak, and it lasts longer
  furcloak: { label: 'Fur cloak', uses: 220 },
};
/** How much of the usual time sewing and weaving take with a bone needle and awl in the band. */
export const NEEDLE_SPEED = 0.65;
/** Bones kept from each deer, and at most. */
export const BONES_PER_DEER = 2;
export const BONES_KEPT = 10;
/** Teeth kept from each deer for ornaments, and teeth and shells kept at most. */
export const TEETH_PER_DEER = 2;
export const TRINKETS_KEPT = 12;
/** Days between one gift and the next from the same person. */
export const GIFT_DAYS = 24;
/** The day of the year of the midwinter feast (the middle of winter), and what each person eats at it. */
export const MIDWINTER = 42;
export const FEAST_MEAL = 1.5;
/** How much of the cold a cloak keeps off, and the deer hides that go into one. */
export const CLOAK_WARM = 0.3;
/** A fur cloak keeps off more of the cold, and the pelts that go into one. */
export const FURCLOAK_WARM = 0.42;
export const FURS_PER_CLOAK = 2;
/** Pelts kept in the stores at most. */
export const FURS_KEPT = 9;
/** Meat on a beaver taken in a deadfall (a fox is skinned and left: nobody eats fox). */
export const BEAVER_MEAT = 4;
/** A boar's tusks, kept for ornaments along with the teeth. */
export const TUSKS_PER_BOAR = 2;
/** Where on the body a thing is worn: one thing to each place. */
export const SLOTS = ['body', 'head', 'hands', 'feet', 'shoulder', 'neck'] as const;
export type Slot = (typeof SLOTS)[number];
export type GarmentKind = 'cloak' | 'furcloak' | 'hat' | 'mittens' | 'shoes' | 'cape' | 'bag' | 'necklace';
/**
 * What can be worn: where, how much of the cold it keeps off, and who gets one first from the pile
 * (those who feel the cold most, the ones who walk furthest, or the band's best gatherers). A necklace is
 * never handed out from the pile: it is given by one person to another.
 */
export const GARMENTS: Record<GarmentKind, { slot: Slot; warm: number; first: 'cold' | 'walkers' | 'gatherers' | 'given' }> = {
  cloak: { slot: 'body', warm: CLOAK_WARM, first: 'cold' },
  furcloak: { slot: 'body', warm: FURCLOAK_WARM, first: 'cold' },
  cape: { slot: 'body', warm: 0.12, first: 'cold' },
  hat: { slot: 'head', warm: 0.1, first: 'cold' },
  mittens: { slot: 'hands', warm: 0.06, first: 'cold' },
  shoes: { slot: 'feet', warm: 0.04, first: 'walkers' },
  bag: { slot: 'shoulder', warm: 0, first: 'gatherers' },
  necklace: { slot: 'neck', warm: 0, first: 'given' },
};
export const isGarment = (k: string): k is GarmentKind => k in GARMENTS;
/** With a hide bag over the shoulder, a gatherer brings home this much more in a trip. */
export const BAG_LOAD = 1.3;
/** In hide shoes, a long walk tires someone this much less. */
export const SHOES_REST = 0.8;
/** Shoes take one use of wear for every so many ticks walked in them (about two years of walking). */
export const SHOES_WEAR_EVERY = 80;
/** A worn thing is mended by the fire once it is this worn; mending takes back this much of the wear, and a little cord. */
export const MEND_AT = 0.45;
export const MEND_BY = 0.35;
export const MEND_CORD = 0.5;
/** A thing patched this many times is all patches: it is worn until it wears through, and then a new one is made. */
export const MEND_MAX = 4;
export const HIDES_PER_CLOAK = 2;
/** Hides kept in the stores at most (the rest are left: there is only so much a band can scrape and carry). */
export const HIDES_KEPT = 12;
/** Grass laid in a shelter for bedding: how much it takes, and how many days it stays fresh. */
export const BED_FIBER = 3;
export const BED_DAYS = 40;
/** How much faster someone sleeps off their tiredness on fresh grass, against the bare ground. */
export const BED_REST = 1.3;
/** Roots dug in one trip with a digging stick, and how much of the usual going-off still happens to them. */
export const ROOTS_LOAD = 10;
/** Acorns brought home in one trip (from an oak or two), leached in the stream and dried: they keep for a year. */
export const NUTS_LOAD = 8;
/** Roasted in the embers, a meal of meat, fish, roots or acorns fills this much more; it takes a little longer. */
export const COOK_GAIN = 1.25;
export const COOK_TICKS = 6;
export const COOKED = ['meat', 'fish', 'roots', 'nuts', 'eggs', 'mushrooms'];
/** Eggs brought home from the nests of a spring morning (they go off almost as fast as berries). */
export const EGGS_LOAD = 3;
/** Honey from one wild hive smoked out in summer; the harm a bad stinging does. */
export const HONEY_STING = 6;
/** A spoonful of honey with a meal, while there is some: a treat more than a meal. */
export const HONEY_TREAT = 0.2;
/** Mushrooms picked in one autumn trip; the chance a beginner tastes a bad one (less with skill) and the fever it brings. */
export const MUSHROOMS_LOAD = 6;
export const BAD_MUSHROOM = 0.22;
export const BAD_MUSHROOM_DAYS = 3;
/** Bundles of dried healing herbs a band likes to keep by, and how long one nursing keeps a fever in check. */
export const HERBS_WANT = 6;
export const NURSE_DAYS = 2;
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
export const RECIPE_KEYS = ['cordage', 'chopper', 'axe', 'stick', 'snare', 'fishtrap', 'basket', 'pot', 'cloak', 'needle', 'hat', 'mittens', 'shoes', 'cape', 'bag', 'deadfall', 'furcloak'] as const;
export type RecipeKey = (typeof RECIPE_KEYS)[number];
export interface Recipe {
  /** what it makes: a length of cordage into the stores, or an item onto the pile */
  makes: 'cordage' | ItemKind;
  /** what it uses from the stores */
  uses: Partial<Record<'wood' | 'fiber' | 'cordage' | 'stone' | 'mud' | 'hides' | 'bones' | 'furs', number>>;
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
  cloak: {
    // two hides scraped soft, cut and sewn with cord
    makes: 'cloak', uses: { hides: HIDES_PER_CLOAK, cordage: 1 }, work: 50, skill: SK.hide, grow: 0.1, knows: 'cloaks', doing: 'Sewing a hide cloak',
    thought: 'Scraping deer hides soft and sewing them into a cloak.', done: 'Sewed a hide cloak for someone to wear through the winter.',
  },
  needle: {
    makes: 'needle', uses: { bones: 1 }, work: 26, skill: SK.tool, grow: 0.06, knows: 'needles', doing: 'Grinding a bone needle',
    thought: 'Grinding a sliver of bone to a needle on a stone.', done: 'Ground a bone needle and an awl and laid them on the pile.',
  },
  hat: {
    makes: 'hat', uses: { hides: 1 }, work: 30, skill: SK.hide, grow: 0.07, knows: 'hats', doing: 'Sewing a fur hat',
    thought: 'Cutting a hide with the fur on and sewing it into a cap.', done: 'Sewed a fur hat for someone who feels the cold.',
  },
  mittens: {
    makes: 'mittens', uses: { hides: 1 }, work: 26, skill: SK.hide, grow: 0.06, knows: 'hats', doing: 'Sewing hide mittens',
    thought: 'Sewing a pair of hide mittens, fur turned in.', done: 'Sewed a pair of mittens.',
  },
  shoes: {
    makes: 'shoes', uses: { hides: 1, cordage: 1 }, work: 34, skill: SK.hide, grow: 0.07, knows: 'shoes', doing: 'Sewing hide shoes',
    thought: 'Cutting soles from a hide and gathering them into shoes.', done: 'Sewed a pair of hide shoes for someone who walks far.',
  },
  cape: {
    makes: 'cape', uses: { fiber: 5, cordage: 1 }, work: 36, skill: SK.weave, grow: 0.06, knows: 'capes', doing: 'Knotting a reed cape',
    thought: 'Knotting reeds and grass into a cape to keep off the wind.', done: 'Knotted a reed cape for someone without a cloak.',
  },
  bag: {
    makes: 'bag', uses: { hides: 1, cordage: 1 }, work: 32, skill: SK.hide, grow: 0.06, knows: 'bags', doing: 'Sewing a hide bag',
    thought: 'Sewing a hide bag with a strap for the shoulder.', done: 'Sewed a gathering bag and laid it on the pile.',
  },
  deadfall: {
    // a stout log for the weight and sticks cut and notched into a figure-four: no cord to it at all
    makes: 'deadfall', uses: { wood: 3 }, work: 28, skill: SK.tool, grow: 0.06, knows: 'furs', doing: 'Notching a deadfall trigger',
    thought: 'Notching sticks into a figure-four trigger for a deadfall.', done: 'Made a deadfall and laid it on the pile.',
  },
  furcloak: {
    makes: 'furcloak', uses: { furs: FURS_PER_CLOAK, cordage: 1 }, work: 60, skill: SK.hide, grow: 0.12, knows: 'furs', doing: 'Sewing a fur cloak',
    thought: 'Matching fox and beaver pelts and sewing them fur-out into a cloak.', done: 'Sewed a fur cloak, the warmest thing the band has.',
  },
};
/** The recipes that go faster with a bone needle and awl: sewing hides, weaving baskets and traps. */
export const SEWN: RecipeKey[] = ['cloak', 'basket', 'fishtrap', 'snare', 'hat', 'mittens', 'shoes', 'cape', 'bag', 'furcloak'];
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
  /** who made it (-1: brought from beyond the map); for a necklace, who strung it and gave it */
  maker: number;
  /** a trap: the tile it is set on (absent or -1: on the pile; -2: in the basket of whoever is setting it) */
  tile?: number;
  /** a trap: what it has caught and is holding, waiting for the round (meat for a snare, fish for a fish trap) */
  catch?: number;
  /** a deadfall: the beast it holds (a BEAST kind); a snare: a fox took the hare from it (the trapper sees the prints) */
  pelt?: number;
  robbed?: boolean;
  /** a thing worn: who wears it (absent: it lies on the pile) */
  wearer?: number;
  /** a thing worn: how many times it has been mended by the fire, and by whom last */
  mended?: number;
  mender?: number;
}

/** Anything in the world that can be clicked. */
export interface Ref {
  kind: 'person' | 'deer' | 'wolf' | 'beast' | 'building' | 'prop' | 'tile' | 'item';
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
  /** a thing someone wears or holds: who, so its window's line can follow them about */
  follow?: number;
  /** a made thing: its kind, for the picture of it in its window */
  item?: ItemKind;
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
  /** the trap round: pelts taken from the deadfalls */
  furs?: number;
  /** supplying a building site: what is carried there (absent: wood) */
  res?: Material;
  /** hunting: the quarry is a wild boar (`ref` is a beast's id) rather than a deer */
  boar?: boolean;
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
  /** the tick a dog came to them as a pup, once the band keeps dogs (a dog goes everywhere with them) */
  dog?: number;
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
  /** what they wear, by where on the body (item ids; absent: nothing there) */
  worn?: Partial<Record<Slot, number>>;
  /** nursed with herbs through a fever: until when it helps (absent: never) */
  tended?: number;
  /** when they last gave someone an ornament (absent: never); the one they wear is an item worn at the neck */
  gave?: number;
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
  /** a home: days the grass bedding laid in it stays fresh (absent or 0: the bare ground) */
  bedding?: number;
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
  state: number; // 0 graze, 1 walk, 2 flee, 3 roar (the rut), 4 spar with another stag
  timer: number;
  /** the stag it has locked antlers with, while sparring */
  foe?: number;
  alive: boolean;
  /** brought down by wolves rather than by hunters */
  byWolves?: boolean;
  fawn: boolean;
}

/** A wolf. Packs roam well away from people, run deer down (more easily in deep snow), feed at the kill,
 *  howl at dusk and keep clear of camp fires and of anyone who comes near. */
export interface Wolf {
  id: number;
  pack: number;
  x: number;
  z: number;
  tx: number;
  tz: number;
  /** a point it faces */
  fx: number;
  fz: number;
  state: number; // WOLF.*
  timer: number;
  alive: boolean;
  /** a cub of this spring (drawn smaller, kept back from the chase) */
  pup: boolean;
}
export const WOLF = { Rest: 0, Trot: 1, Chase: 2, Feed: 3, Slink: 4, Howl: 5, Lie: 6 } as const;

export interface Pack {
  id: number;
  /** the middle of the pack's range, and where it is heading */
  hx: number;
  hz: number;
  tx: number;
  tz: number;
  next: number;
  /** the deer being run down (-1 none), when the chase began, and the tick the pack goes hungry again */
  prey: number;
  chaseFrom: number;
  fed: number;
}

/**
 * The smaller wild things that share the land with the band, all kept the same way: wild boar rooting in
 * the woods in sounders, foxes about their dens, beavers at their lodges on the rivers and lakes.
 */
export interface Beast {
  id: number;
  kind: number; // BEAST.*
  /** the den, lodge or sounder's range it belongs to (index in Sim.dens) */
  den: number;
  x: number;
  z: number;
  tx: number;
  tz: number;
  /** a point it faces */
  fx: number;
  fz: number;
  state: number; // BOAR.*, FOX.* or BEAVER.*
  timer: number;
  alive: boolean;
  /** born this spring: a striped piglet, a cub, a kit */
  young: boolean;
  /** brought down by hunters (a boar) */
  killed?: boolean;
}
export const BEAST = { Boar: 0, Fox: 1, Beaver: 2 } as const;
export const BEAST_NAMES = ['boar', 'fox', 'beaver'] as const;
export const BOAR = { Stand: 0, Walk: 1, Run: 2, Root: 3, Lie: 4, Charge: 5 } as const;
export const FOX = { Sit: 0, Trot: 1, Run: 2, Mouse: 3, Curl: 4, Raid: 5 } as const;
export const BEAVER = { Sit: 0, Walk: 1, Swim: 2, Gnaw: 3, Home: 4, Dive: 5 } as const;

/** Where a group of beasts lives: a sounder's range, a fox's earth, a beaver lodge (and its dam). */
export interface Den {
  id: number;
  kind: number; // BEAST.*
  x: number;
  z: number;
  /** where the group is heading next, and when it moves on again */
  tx: number;
  tz: number;
  next: number;
  /** a beaver lodge's dam: the river tile it is built across (-1 none yet) and how far along it is (0..1) */
  dam?: number;
  built?: number;
  /** the snare a fox has gone to rob (item id), if any */
  raid?: number;
}

/** Grown deer with odd ids are stags (they wear antlers; the renderer uses the same rule), the rest are does. */
export const isStag = (d: Deer) => !d.fawn && d.id % 2 === 1;

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
  /** deer hides kept from kills, for cloaks, and roots dug in autumn (absent in older saves until restored) */
  hides: number;
  roots: number;
  /** acorns gathered in autumn, leached and dried; herbs gathered for the sick; bones from kills, for
   * needles and awls; teeth and shells, for ornaments (absent in older saves until restored) */
  nuts: number;
  herbs: number;
  bones: number;
  trinkets: number;
  /** eggs from spring nests, honey from wild hives, mushrooms from the autumn woods (absent in older saves until restored) */
  eggs: number;
  honey: number;
  mushrooms: number;
  /** fox and beaver pelts from the deadfalls (absent in older saves until restored) */
  furs: number;
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

/** Everything in the stores that can be eaten. */
export const FOODS = ['berries', 'meat', 'fish', 'preserved', 'roots', 'nuts', 'eggs', 'honey', 'mushrooms'] as const;
export type Food = (typeof FOODS)[number];
export const foodTotal = (s: Stock) => s.berries + s.meat + s.fish + s.preserved + s.roots + s.nuts + s.eggs + s.honey + s.mushrooms;

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
