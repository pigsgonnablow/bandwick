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
  | 'dry_fire' // feeding the fire with wood from under the woodpile's roof
  | 'store_food' // food carried into the stores (per meal)
  | 'store_meat' // meat and fish carried into the stores (per meal)
  | 'store_berries' // berries carried into the stores (per meal)
  | 'thatch' // grass and reeds cut and carried in (per bundle)
  | 'fell_chopper' // a tree felled with a hand chopper
  | 'dig_hand' // a trip's digging done with bare hands
  | 'grave' // a grave dug with bare hands
  | 'hunt' // a hunt, kill or no kill
  | 'forage' // a bush's berries picked
  | 'fish_fiber' // a fishing trip, with fiber in the stores to think of weaving with (more when the catch is thin)
  | 'fish_miss' // a stab at the water that missed (a quarter as much: a fish that wriggled off the point while the catch was landed)
  | 'ice' // an evening by the fire while the lakes and rivers are frozen over (each adult)
  | 'trap_fish' // a fish trap emptied on the round with fish in it (more the fuller it was)
  | 'run' // a fishing trip to a river while the salmon or the eels are running in it
  | 'carcass' // a deer or boar carried home and skinned (half again when it is butchered)
  | 'rack' // a batch of meat or fish hung on the drying rack
  | 'deadwood' // an armful of fallen branches gathered under a tree
  | 'sickbed' // a day sitting with someone sick with fever (each adult at camp)
  | 'sew' // a cloak sewn by the fire
  | 'dig_stick' // a trip's digging done with a digging stick
  | 'wolves' // a hunt with a wolf pack close by, or an evening hearing them howl round camp
  | 'boar' // a hunt with a sounder of wild boar rooting close by
  | 'fur' // a fox's raid found at a snare, a fox or beaver watched at dusk, wood a beaver felled carried home
  | 'midden' // a spring day at a camp lived in since the spring before, when things sprout from the scraps thrown out (each adult)
  | 'harvest' // a load of the garden's harvest brought in
  | 'raided' // finding a garden plot raided by deer, boar or hares (each gardener)
  | 'store_grain' // grain carried into the stores (per load)
  | 'far_tree' // a tree felled far out from camp, past the stumps of the near woods
  | 'sprout_tree' // a tree felled that grew up from the stump of one felled before
  | 'gift' // a necklace strung for someone dear
  | 'knap' // a stone knapped into a chopper or an axe head
  | 'fire_pot' // a pot or bowl fired in the embers of the hearth (twice over when it cracks)
  | 'fire_kiln' // a pot, bowl or lamp fired in the kiln
  | 'night_work' // a spell of sitting work (making something, or mending) finished by the fire after dark
  | 'twist' // a length of cordage twisted by the fire
  | 'spin' // a hank of thread spun on a spindle
  | 'weave' // a basket, a fish trap or a reed cape woven by the fire
  | 'piglet' // a boar brought down on the hunt (a striped piglet counts most), or a garden plot rooted up by the boar (each gardener)
  | 'laid' // one of the band's dead laid in the burial ground by camp (each adult there to see it)
  | 'raise' // a spell of work on a monument

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
  /** what else the band comes to know with it (the tool it is found with), if it doesn't already */
  brings?: string[];
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
    key: 'huts', label: 'Huts', needs: [], requires: [skill(SK.wood, 11), skill(SK.weave, 8)],
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
    key: 'axe', label: 'Hafted axe', needs: [], requires: [skill(SK.wood, 14), skill(SK.tool, ABLE)],
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
    // (a fisher who has watched one fish too many wriggle off the spear point, and who knows how to work bone,
    // cuts barbs into a point of antler so that what it strikes stays on it)
    key: 'harpoon', label: 'Barbed harpoons', needs: [], requires: [skill(SK.fish, ABLE), skill(SK.tool, 8)],
    practice: { fish_miss: 1 }, odds: 60,
    found: 'cut barbs into a point of antler and lashed it to a shaft, and the fish it struck stayed on it: the first harpoon',
    taught: 'fish with barbed harpoons', memory: 'Made the first barbed harpoon.',
  },
  {
    // (a fisher sitting by the fire through the weeks the lakes are frozen, thinking of the fish under the ice, or
    // waiting at the water for fish that won't come near the spear, thinks of making them come to a bait)
    key: 'hooks', label: 'Hook and line', needs: [], requires: [skill(SK.fish, ABLE), skill(SK.tool, 8)],
    practice: { ice: 1, fish_miss: 0.25 }, odds: 70,
    found: 'whittled a hook from a thorn, baited it, and pulled a fish up through a hole in the ice on a line',
    taught: 'fish with a hook and line, even through the ice', memory: 'Caught the first fish on a hook and line.',
  },
  {
    // (a fisher who weaves, emptying the traps of a morning and seeing how the fish crowd into them, thinks of a
    // trap that could be drawn through the water to them)
    key: 'nets', label: 'Fishing nets', needs: ['fishtraps'], requires: [skill(SK.fish, 12), skill(SK.weave, 12)],
    practice: { trap_fish: 1, fish_fiber: 0.1 }, odds: 14,
    found: 'knotted cord into a long net, weighted its foot with stones, and with two others hauled it through the shallows full of fish',
    taught: 'knot nets and haul them through the water together', memory: 'Hauled the first fishing net.',
  },
  {
    // (a fisher who builds and knows the woven trap, standing in a river thick with the run and watching the fish
    // nose along the bank for a way up, thinks of fencing the river so that the only way is into a trap)
    key: 'weir', label: 'Fish weirs', needs: ['fishtraps'], requires: [skill(SK.fish, 12), skill(SK.build, 10)],
    practice: { run: 1, trap_fish: 0.1 }, odds: 60,
    found: 'drove stakes across the river and wove withies between them, and the run swam into a basket at the point: the first fish weir',
    taught: 'fence a river with a weir that leads the fish into a trap', memory: 'Built the first fish weir across the river.',
  },
  {
    // (the picker who already twists cord thinks of weaving something to carry more home in)
    key: 'baskets', label: 'Baskets', needs: [], requires: [skill(SK.forage, ABLE), skill(SK.weave, 8)],
    practice: { forage: 1 }, odds: 45,
    found: 'wove grass round a ring of withies into a deep basket, and came home with the berries of a dozen bushes',
    taught: 'weave baskets for gathering', memory: 'Wove the first gathering basket.',
  },
  {
    // (a basket lined with clay to keep the juice in, left too near the fire, comes out hard)
    key: 'pottery', label: 'Pottery', needs: ['baskets'], requires: [skill(SK.weave, ABLE), skill(SK.build, 8)], near: 'mud',
    practice: { store_berries: 1 }, odds: 40,
    found: 'lined a basket with clay, left it in the embers, and found a hard pot where the basket had burned away',
    taught: 'make pots of fired clay', memory: 'Fired the first clay pot.',
  },
  {
    // (someone who cuts grass for thatch, sleeping on the hard ground, thinks to bring an armful in to lie on)
    key: 'bedding', label: 'Grass bedding', needs: [], requires: [skill(SK.forage, 8), skill(SK.weave, 8)],
    practice: { night_out: 0.15, thatch: 0.5 }, odds: 40,
    found: 'spread an armful of dry grass under the lean-to and slept soft and deep on it',
    taught: 'lay grass bedding in their shelters', memory: 'Thought to sleep on a bed of dry grass.',
  },
  {
    // (a toolmaker who sews hides, pushing a thorn through them, thinks of a sliver of bone from the kill)
    key: 'needles', label: 'Bone needles', needs: ['cloaks'], requires: [skill(SK.tool, 8), skill(SK.hide, 8)],
    practice: { sew: 1, carcass: 0.5 }, odds: 12,
    found: 'ground a sliver of deer bone to a point, burned an eye through it, and sewed a seam in half the time',
    taught: 'make needles and awls of bone', memory: 'Made the first bone needle.',
  },
  {
    // (the hideworker who skins the kills, and can sew a seam, thinks of wearing the hide against the cold)
    key: 'cloaks', label: 'Hide cloaks', needs: ['preserving'], requires: [skill(SK.hide, 8), skill(SK.weave, 8)],
    practice: { carcass: 3, rack: 1 }, odds: 30,
    found: 'scraped two deer hides soft, sewed them together, and wore the first cloak against the cold',
    taught: 'sew cloaks of deer hide', memory: 'Sewed the first hide cloak.',
  },
  {
    // (a picker who knows the plants of the meadow sees what lies under them; someone already digging with
    // a stick turns them up. Whoever finds roots without a digging stick sharpens one to get at them.)
    key: 'roots', label: 'Digging roots', needs: [], requires: [skill(SK.forage, ABLE), skill(SK.tool, 6)], brings: ['digstick'],
    practice: { forage: 1, dig_stick: 3 }, odds: 25,
    found: 'dug up the fat roots under the reeds and the meadow grass with a sharpened stick, and found they kept all winter',
    taught: 'dig roots in the autumn and keep them for winter', memory: 'Dug the first roots for the winter store.',
  },
  {
    // (someone who knows every plant of the land, sitting with the sick, remembers the bitter bark and
    // leaves that ease a fever)
    key: 'herbs', label: 'Healing herbs', needs: [], requires: [skill(SK.forage, 11)],
    practice: { sickbed: 1, forage: 0.05 }, odds: 40,
    found: 'brewed willow bark and bitter leaves for a fever, and the fever broke: the band had its first healer',
    taught: 'nurse fevers with healing herbs', memory: 'Nursed the first fever with healing herbs.',
  },
  {
    // (a hunter or fisher who knows the plants, sitting by the fire of an evening, drops a piece of meat
    // or a root in the embers and finds it tender, and that it goes further)
    key: 'cooking', label: 'Cooking', needs: [], requires: [skill(SK.forage, 8), any(skill(SK.hunt, ABLE), skill(SK.fish, ABLE))],
    practice: { evening_fire: 1 }, odds: 200,
    found: 'dropped meat in the embers by mistake, and found it tender and filling: from then on the band roasted its food',
    taught: 'roast their food in the embers', memory: 'Roasted the first meal in the embers.',
  },
  {
    // (someone gathering fallen branches under the oaks, who knows which plants are bitter and how to
    // draw the bitterness out, thinks of the acorns lying in the leaves)
    key: 'nuts', label: 'Acorns', needs: [], requires: [skill(SK.forage, ABLE), skill(SK.wood, 8)],
    practice: { deadwood: 1, forage: 0.2 }, odds: 60,
    found: 'gathered the acorns under the oaks, soaked the bitterness out of them in the stream, and found they kept the year round',
    taught: 'gather acorns and leach them for the winter', memory: 'Gathered the first acorns for the winter store.',
  },
  {
    // (someone sewing a cloak, the offcuts in their lap, thinks of the cold on their head and hands)
    key: 'hats', label: 'Fur hats and mittens', needs: ['cloaks'], requires: [skill(SK.hide, 8)],
    practice: { sew: 1, night_out: 0.05 }, odds: 10,
    found: 'sewed the offcuts of a hide into a cap and a pair of mittens, fur turned in',
    taught: 'sew fur hats and mittens', memory: 'Sewed the first fur hat and mittens.',
  },
  {
    // (someone skinning a deer, feet sore from the hunt, thinks to wrap them in the hide)
    key: 'shoes', label: 'Hide shoes', needs: ['cloaks'], requires: [skill(SK.hide, 9), skill(SK.hunt, 8)],
    practice: { sew: 1, carcass: 0.5, hunt: 0.05 }, odds: 16,
    found: 'cut soles from a hide and gathered them at the ankle with a thong: shoes, and the long walks were easier',
    taught: 'sew hide shoes', memory: 'Sewed the first pair of hide shoes.',
  },
  {
    // (someone thatching a roof sees how the reeds shed the wind, and thinks to wear them)
    key: 'capes', label: 'Reed capes', needs: [], requires: [skill(SK.weave, ABLE)],
    practice: { thatch: 0.3, night_out: 0.05 }, odds: 60,
    found: 'knotted reeds and grass into a cape that shed the wind like a thatched roof',
    taught: 'knot reed capes', memory: 'Knotted the first reed cape.',
  },
  {
    // (someone sewing, who has carried home armfuls of acorns and roots, thinks of a hide bag)
    key: 'bags', label: 'Hide bags', needs: ['cloaks'], requires: [skill(SK.hide, 8), skill(SK.forage, 9)],
    practice: { sew: 1, store_food: 0.02 }, odds: 14,
    found: 'sewed a hide into a bag with a strap for the shoulder, and brought home more from every trip',
    taught: 'sew hide bags for gathering', memory: 'Sewed the first gathering bag.',
  },
  {
    // (someone gathering fallen branches in spring hears a bird scold them from its nest overhead)
    key: 'eggs', label: 'Bird eggs', needs: [], requires: [skill(SK.forage, 8)],
    practice: { deadwood: 1, forage: 0.1 }, odds: 35,
    found: 'climbed to a nest and brought down the eggs, and the band ate well in the lean days of spring',
    taught: 'look for eggs in the nests in spring', memory: 'Found the first eggs in a nest.',
  },
  {
    // (someone who keeps the fire and knows what smoke does to a swarm, sitting by it, thinks of the bees in the old trees)
    key: 'honey', label: 'Wild honey', needs: ['cooking'], requires: [skill(SK.forage, 10)],
    practice: { evening_fire: 0.3, deadwood: 0.6 }, odds: 160,
    found: 'took an ember to a hive in a hollow tree, smoked the bees drowsy and came away with the comb',
    taught: 'smoke out wild hives for honey', memory: 'Smoked out the first wild hive and brought back honey.',
  },
  {
    // (someone gathering wood in the autumn woods, who knows the plants well, learns which mushrooms are good)
    key: 'mushrooms', label: 'Mushrooms', needs: [], requires: [skill(SK.forage, 11)],
    practice: { deadwood: 1, forage: 0.1 }, odds: 90,
    found: 'learned which of the mushrooms in the autumn woods are good to eat, and which make you sick',
    taught: 'pick the good mushrooms in autumn', memory: 'Picked the first good mushrooms.',
  },
  {
    // (a hunter who has watched the wolves run deer down, and heard them round the fire at night, takes in a
    // cub left behind by its pack and raises it on scraps; it grows up to hunt beside them and to bark at strangers)
    key: 'dogs', label: 'Dogs', needs: [], requires: [skill(SK.hunt, 12)],
    practice: { wolves: 1 }, odds: 9,
    found: 'took in a wolf cub left behind by its pack, raised it on scraps by the fire, and it grew up to hunt at their side: the first dog',
    taught: 'raise dogs to hunt with', memory: 'Raised the first dog from a wolf cub.',
  },
  {
    // (a hunter out after deer keeps crossing the sounders' rooting and their wallows, and works out how to
    // close in on a boar in the thickets with the spear braced: a dangerous quarry, but a lot of meat)
    key: 'boar', label: 'Boar hunting', needs: [], requires: [skill(SK.hunt, 10)],
    practice: { boar: 1 }, odds: 14,
    found: 'learned to follow a sounder of wild boar into the thickets and take one on the braced spear',
    taught: 'hunt the wild boar', memory: 'Brought down the first wild boar.',
  },
  {
    // (a trapper who keeps finding a fox has emptied the snares, or who has watched the beavers at work on
    // the bank, thinks of a trap heavy enough for them; a good hideworker sees what the pelts would make)
    key: 'furs', label: 'Trapping for fur', needs: ['snares'], requires: [skill(SK.hunt, 10), skill(SK.hide, 8)],
    practice: { fur: 1 }, odds: 12,
    found: 'propped a log on a notched stick trigger at a fox earth, and took the fox in it: the first pelt, soft enough to sew into a cloak',
    taught: 'trap foxes and beavers for their fur', memory: 'Took the first fox in a deadfall, for its pelt.',
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
    // (a forager who digs roots, back at a camp where the band has lived since last spring, sees roots and greens
    // sprouting on the heap where the peelings and the spoiled ones were thrown, and sets some in the ground on purpose)
    key: 'garden', label: 'Garden plots', needs: [], requires: [skill(SK.forage, ABLE), skill(SK.tool, 5)], brings: ['digstick'],
    practice: { midden: 1, dig_stick: 2, forage: 0.3 }, odds: 110,
    found: 'noticed roots sprouting where the scraps were thrown the spring before, and dug a plot by the camp to set them in on purpose: the band\'s first garden',
    taught: 'dig garden plots and grow roots and greens', memory: 'Dug the first garden plot.',
  },
  {
    // (a gardener cutting grass for thatch at the end of summer, the ripe heads shedding seed in their hands,
    // thinks of sowing it in the garden like the roots)
    key: 'grain', label: 'Sowing grain', needs: ['garden'], requires: [skill(SK.garden, 5), skill(SK.forage, ABLE)],
    practice: { thatch: 0.5, harvest: 1 }, odds: 12,
    found: 'rubbed the seed from the heads of the wild grass, sowed it in a garden plot, and reaped a harvest of grain that keeps the year round',
    taught: 'sow and reap grain', memory: 'Sowed and reaped the first grain.',
  },
  {
    // (a hunter who has carried home one piglet too many, in a band whose gardens the boar keep raiding, keeps the
    // next one alive, feeds it on the scraps and the weeds from the plots, and fences it in)
    key: 'pigs', label: 'Penned pigs', needs: ['garden', 'boar'], requires: [skill(SK.hunt, 10), skill(SK.garden, 8)],
    practice: { piglet: 1 }, odds: 6,
    found: 'brought a striped piglet home from the hunt alive, fed it on scraps and weeds from the plots, and penned it in with hurdles: the band\'s first pig',
    taught: 'keep pigs in a pen and breed them', memory: 'Penned the first pig.',
  },
  {
    // (a gardener who finds a plot trampled and eaten in the night thinks of a hurdle round it, like the windbreak)
    key: 'fences', label: 'Garden fences', needs: ['garden'], requires: [skill(SK.garden, 6), skill(SK.build, 8)],
    practice: { raided: 1 }, odds: 3,
    found: 'drove a ring of stakes round a garden plot and wove withies between them, and the deer kept out',
    taught: 'fence their gardens against the deer and the boar', memory: 'Fenced the first garden plot.',
  },
  {
    // (someone carrying the grain into the stores, who has watched it go mouldy in the damp, thinks of a dry pit)
    key: 'pits', label: 'Storage pits', needs: ['grain'], requires: [skill(SK.garden, 7), skill(SK.build, 8)], near: 'mud',
    practice: { store_grain: 1 }, odds: 6,
    found: 'dug a pit by the stores, lined it with clay and grass, filled it with grain and sealed it: it came out dry and sweet in spring',
    taught: 'keep grain in lined storage pits', memory: 'Dug the first storage pit for grain.',
  },
  {
    // (a woodcutter walking out past the stumps of the near woods to find a tree worth felling, or cutting a
    // straight young trunk that grew from an old stump, sees that a stump cut low grows back as poles)
    key: 'coppice', label: 'Coppiced woods', needs: [], requires: [skill(SK.wood, 13), skill(SK.forage, 8)],
    practice: { far_tree: 0.25, sprout_tree: 1 }, odds: 14,
    found: 'saw the straight poles growing from an old stump, and began to cut the oaks and birches near camp low, to grow back for the fire',
    taught: 'cut the woods near camp low so they grow back', memory: 'Began to coppice the woods near camp.',
  },
  {
    // (a master woodcutter feeding the fire from under the woodpile's roof notices the old wood at the bottom of
    // the stack, lain there since last year, burns hotter and longer than any new-cut log: they split the new wood
    // and stack it to dry a season ahead)
    key: 'seasoning', label: 'Seasoned firewood', needs: ['woodshed'], requires: [skill(SK.wood, 16)],
    practice: { dry_fire: 1 }, odds: 30,
    found: 'noticed the old logs from the bottom of the stack burned hotter and longer than new-cut wood, and began to split the wood and stack it a season ahead to dry',
    taught: 'split and stack their firewood to season it', memory: 'Saw that wood stacked a season burns longest.',
  },
  {
    // (someone who knows the woods, firing pots in the kiln and raking out the black, half-burned sticks that
    // burned without flame, sees how fiercely they glow, and thinks of burning a whole stack of wood that way)
    key: 'charcoal', label: 'Charcoal', needs: ['kiln'], requires: [skill(SK.wood, ELITE), skill(SK.pot, 6)],
    practice: { fire_kiln: 1 }, odds: 30,
    found: 'stacked split wood in a mound, covered it with turf and let it smoulder a day and a night: it came out black, light and ringing, and burned in the kiln hotter than any wood',
    taught: 'burn charcoal in a clamp for the kiln', memory: 'Burned the first charcoal.',
  },
  {
    // (a toolmaker stringing teeth and shells for someone dear, or knapping a stone, thinks of grinding the
    // pebbles themselves smooth and boring them through: beads of any stone, as many as there are hours for)
    key: 'beads', label: 'Beads', needs: ['huts'], requires: [skill(SK.tool, 9)],
    practice: { gift: 1, knap: 0.2 }, odds: 120,
    found: 'ground a pebble smooth on a slab, bored it through with a bow drill, and strung the first beads',
    taught: 'grind and drill beads of stone', memory: 'Ground and drilled the first beads.',
  },
  {
    // (a potter who has watched too many pots crack in the open embers thinks of walling the fire in clay,
    // so the heat comes evenly and slowly)
    key: 'kiln', label: 'Kiln', needs: ['pottery'], requires: [skill(SK.pot, 11), skill(SK.build, 6)], near: 'mud',
    practice: { fire_pot: 1 }, odds: 22,
    found: 'walled the firing in a dome of clay with a hole to stoke it, and the pots came out whole and ringing hard: the band\'s first kiln',
    taught: 'build a kiln and fire their pots in it', memory: 'Built the first kiln.',
  },
  {
    // (a potter at work by the fire after dark, squinting at it in the firelight, pinches a little dish of clay,
    // fills it with fat from the kills and lays a twist of moss in its lip for a wick: a light to work by)
    key: 'lamps', label: 'Clay lamps', needs: ['pottery'], requires: [skill(SK.pot, ABLE), skill(SK.hide, 6)],
    practice: { night_work: 1 }, odds: 14,
    found: 'pinched a little dish of clay, filled it with fat from the kills and lit a wick of moss in its lip: a light to work by after dark',
    taught: 'make clay lamps and burn fat in them', memory: 'Lit the first clay lamp.',
  },
  {
    // (a potter firing in the kiln, who has seen the grain go musty and the mice get into the stores, thinks of a
    // jar big enough to hold it, fired hard and sealed with a clay stopper)
    key: 'jars', label: 'Storage jars', needs: ['kiln'], requires: [skill(SK.pot, 12), any(skill(SK.garden, 5), skill(SK.forage, ABLE))], near: 'mud',
    practice: { fire_kiln: 1, store_grain: 1 }, odds: 30,
    found: 'coiled a tall jar, fired it hard in the kiln, filled it with grain and sealed its mouth with clay: it came out dry and sweet a year later',
    taught: 'fire tall jars in the kiln and seal the stores in them', memory: 'Sealed the first storage jar.',
  },
  {
    // (a hunter skinning a kill at the stores, beside the drying rack, sees how much goes to the crows with what
    // is thrown away: the marrow in the bones, the fat, the long cords of sinew along the back)
    key: 'butchering', label: 'Butchering', needs: ['preserving'], requires: [skill(SK.hide, 8), skill(SK.hunt, ABLE)],
    practice: { carcass: 1, rack: 0.2 }, odds: 12,
    found: 'laid a deer out on its hide at the stores and took it apart joint by joint: the marrow cracked from the bones, the fat cut away for the lamps and the rack, and the sinew drawn from its back and dried to sew with',
    taught: 'butcher a kill properly', memory: 'Butchered the first carcass properly, nothing wasted.',
  },
  {
    // (a weaver who has twisted more cord than anyone, rolling it on their thigh, hangs a stone on a stick to
    // keep the twist going, and draws out a thread fine enough to weave)
    key: 'spinning', label: 'Spinning', needs: ['huts'], requires: [skill(SK.weave, 11)],
    practice: { twist: 1 }, odds: 12,
    found: 'pushed a stick through a stone whorl, set it turning, and drew nettle fiber out into a thread finer than any cord: the first spindle',
    taught: 'spin thread on a spindle', memory: 'Spun the first thread on a spindle.',
  },
  {
    // (a skilled weaver with thread put by, weaving another basket, thinks of hanging the threads from a beam,
    // weighted with stones, and passing the weft between them)
    key: 'loom', label: 'Loom', needs: ['spinning'], requires: [skill(SK.weave, 14), skill(SK.build, 8)],
    practice: { spin: 1, weave: 1, twist: 0.3 }, odds: 7,
    found: 'hung threads from a beam, weighted each with a stone, and wove the first cloth across them: the band\'s first loom',
    taught: 'weave cloth on a loom', memory: 'Wove the first cloth on a loom.',
  },
  {
    key: 'daub', label: 'Wattle-and-daub', needs: ['huts'], requires: [skill(SK.build, 13), skill(SK.weave, 8)], near: 'mud',
    practice: { thatch: 1, build: 1 }, odds: 40,
    found: 'worked out how to weave walls of reeds and plaster them with mud',
    taught: 'raise walls of wattle-and-daub', memory: 'Worked out wattle-and-daub walls.',
  },
  {
    // (a settled band, burying its dead year after year in the same ground: someone who has raised its storehouse
    // and its huts thinks of heaping a mound over them, so that they are not forgotten)
    key: 'barrow', label: 'Burial mound', needs: ['storehouse'], requires: [skill(SK.build, 11)],
    practice: { laid: 1 }, odds: 2,
    found: 'thought of heaping a great mound of earth over the band\'s dead, walled inside with slabs of stone, so that they would never be forgotten',
    taught: 'raise a burial mound over their dead', memory: 'Thought of raising a mound over the band\'s dead.',
  },
  {
    // (and a master builder heaping the mound, levering its slabs upright, or laying one of the band's dead by it,
    // thinks of stones standing on their own)
    key: 'stones', label: 'Stone ring', needs: ['barrow'], requires: [skill(SK.build, 14)],
    practice: { raise: 1, laid: 2 }, odds: 60,
    found: 'stood a slab upright on its own, then another, and marked out a ring of standing stones for the band to gather in',
    taught: 'raise a ring of standing stones', memory: 'Marked out a ring of standing stones.',
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
  const k = ({ hut: 'huts', storehouse: 'storehouse', rack: 'preserving', windbreak: 'windbreak', woodshed: 'woodshed', plot: 'garden', fence: 'fences', pit: 'pits', kiln: 'kiln', loom: 'loom', pen: 'pigs', barrow: 'barrow', stones: 'stones', weir: 'weir', clamp: 'charcoal' } as Partial<Record<BuildKind, string>>)[b.kind];
  if (k) out.push(k);
  if (b.walls === 'daub') out.push('daub');
  if (b.walls === 'stone') out.push('stonework');
  return out;
}
