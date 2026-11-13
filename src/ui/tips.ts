// What the numbers and words on the cards mean, for the tooltips that appear when you hover over them.
// Each tip says what the thing is, what fills or drains it, and what it does to people, in the sim's terms.
import { GARMENTS, HEALTH, SHOES_REST, BAG_LOAD } from '../sim/band';

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** The five needs on a person's Now tab. */
export const NEED_TIPS: Record<string, string> = {
  food: `Food: how well fed they are. It drains all day, faster while working, and fills when they eat from the stores or off a bush. Below ${HEALTH.starving} they are starving and their health falls.`,
  rest: 'Rest: how fresh they are. It drains while awake, faster during hard work, and fills when they sleep. Tired people put work aside to sleep.',
  warmth: `Warmth: how warm they are. It drains whenever the air is below 15°C, slower under a roof or in warm clothes, and fills by the fire. Below ${HEALTH.cold} the cold hurts their health, and below ${HEALTH.freezing} it hurts much more.`,
  belonging: 'Company: how close they feel to the others. It drains slowly by itself and fills when they visit, talk, play or share a meal.',
  safety: 'Safety: how settled they feel. Being out in the dark away from the fire or a roof makes them uneasy; daylight, the fire and home put them at ease.',
};

/** Skills on the Skills tab: what each one makes better. */
export const SKILL_TIPS: Record<string, string> = {
  foraging: 'Foraging: picking berries, digging roots, gathering acorns, eggs, honey, mushrooms, herbs and grass. More skill picks faster and carries more home.',
  woodcutting: 'Woodcutting: felling trees. More skill brings a tree down in fewer strokes.',
  building: 'Building: raising shelters, racks and stores, and digging mud. More skill gets the work done faster.',
  hunting: 'Hunting: bringing down deer. More skill means more spears that find their mark.',
  fishing: 'Fishing: more skill catches fish more often, and more of them at a time.',
  toolmaking: 'Toolmaking: knapping stone and shaping wood into axes, spears and other tools by the fire.',
  weaving: 'Weaving: twisting grass into cordage and weaving baskets and mats.',
  pottery: 'Pottery: shaping and firing clay into pots, bowls, lamps and storage jars. More skill works faster, cracks fewer in the firing and makes finer things.',
  hidework: 'Hidework: scraping hides and sewing cloaks, hats, shoes and bags, and mending them when they wear.',
  gardening: 'Gardening: sowing, weeding and harvesting the garden plots. A skilled gardener works faster and brings in a bigger harvest: about 60% from a beginner, 140% from a master.',
};
export const SKILLS_NOTE = 'Skills grow with practice, slowest near the top. The band sends its most skilled to each job, and new ideas come only to those who have mastered the crafts around them.';

/** Traits, the chips under a person's needs. */
export const TRAIT_TIPS: Record<string, string> = {
  industrious: 'Industrious: works harder and more readily than most, and is a little quicker to hit on new ideas.',
  lazy: 'Lazy: less keen to work and more often found resting.',
  curious: 'Curious: twice as likely as others to come up with a new idea while working.',
  brave: 'Brave: hunts more readily and a little better, goes after wild honey, and is likelier to lead a band of their own.',
  cautious: 'Cautious: shies away from hunting and wild bees.',
  kind: 'Kind: gives gifts more often, makes friends faster and is slow to start a fight.',
  cruel: 'Cruel: now and then wounds others with a hard word, and is quick to come to blows with those they hate.',
  ambitious: 'Ambitious: likelier to lead others away to found a camp of their own.',
  pious: 'Pious: keeps to the old ways. (It changes nothing they do yet.)',
  wanderlust: 'Wanderlust: likes to swim and roam, and is the likeliest to leave and found a new camp.',
  charismatic: 'Charismatic: good company, so those they visit feel closer to the band; likelier to lead a band of their own.',
  greedy: 'Greedy: eats more than their share, gets hungry faster, and gives few gifts.',
};

/** Places on the body, on the Gear tab. */
export const SLOT_TIPS: Record<string, string> = {
  head: `Head: a fur hat keeps off about ${pct(GARMENTS.hat.warm)} of the cold.`,
  body: `Body: a hide cloak keeps off the most cold, about ${pct(GARMENTS.cloak.warm)}; a grass cape about ${pct(GARMENTS.cape.warm)}.`,
  hands: `Hands: mittens keep off about ${pct(GARMENTS.mittens.warm)} of the cold.`,
  feet: `Feet: hide shoes make a long walk ${pct(1 - SHOES_REST)} less tiring, and wear out with walking.`,
  shoulder: `Shoulder: a hide bag lets a gatherer bring home ${pct(BAG_LOAD - 1)} more in a trip.`,
  neck: 'Neck: a necklace is worn for pride and remembrance; it keeps off no cold.',
  torso: `Torso: a woven tunic, worn next to the skin under a cloak or cape, keeps off about ${pct(GARMENTS.tunic.warm)} more of the cold.`,
  bed: `Bed: a woven blanket keeps off about ${pct(GARMENTS.blanket.warm)} of the cold while they sleep, and they sleep deeper under it.`,
};
export const GEAR_ROW_TIPS: Record<string, string> = {
  'In hand': 'In hand: the tool they are using. Tools belong to the band and go back to the stockpile when the work is done.',
  Carrying: 'Carrying: what they are bringing home or to a building site.',
};
export const WARMTH_TIP = 'All they wear together. It cuts how fast the cold drains their warmth, indoors or out, but cannot warm them up: only the fire and the summer do that.';

/** Rows on a person's Now and Family tabs. */
export const PERSON_ROW_TIPS: Record<string, string> = {
  Doing: 'Doing: what they are busy with right now. The band decides each day what needs doing, and each person picks work that suits their skills and needs.',
  Where: 'Where: how far they are from their camp\'s fire.',
  Wearing: 'Wearing: their clothes and ornaments. See the Gear tab for how much cold they keep off.',
  Partner: 'Partner: who they share a home and children with.',
  'Raised by': 'Raised by: who took them in after their parents died.',
  Fostering: 'Fostering: orphans they have taken in to raise.',
  Line: 'Line: their children, grandchildren and onward, living and dead.',
  'Close to': 'Close to: those they like best. Friends visit, share and stand by each other.',
  Dislikes: 'Dislikes: those they cannot stand. Bad blood can end in a fight, or in the band splitting apart.',
  Knows: 'Knows: how many of the living they have met and have some feeling about.',
};

/** Rows on the band panel on the left. */
export const BAND_TIPS: Record<string, string> = {
  Pigs: 'Pigs: the herd kept in the pen. They eat scraps and greens from the stores, their muck keeps the garden plots rich, and they give meat when the hunt fails.',
  Food: 'Food: how long the stores would feed everyone, with nothing more brought in. Food spoils, fastest in the warm months and out in the open; a storehouse and dried meat keep it longer.',
  Wood: 'Wood: firewood and timber at the stockpile, in loads one person can carry. The fire burns it day and night, more in winter; building uses it too.',
  Fiber: 'Fiber: grass and reeds cut for thatch and bedding, and cordage twisted from them for lashing and tools.',
  'Mud, stone': 'Mud and stone: dug and quarried for daubed and stone walls.',
  'This year': 'This year: what came in to the stores since the start of the year, and where it went.',
  Fire: 'Fire: the camp fire. People eat, warm up and, until they have a roof, sleep beside it. If it goes out nobody can get warm.',
  Homes: 'Homes: shelters built for families. A roof keeps off a share of the cold at night.',
  Tools: 'Tools: what the band owns. Anyone can take a tool from the stockpile for the work it suits; tools wear out with use.',
  Goods: 'Goods: the bowls, beads and sashes the band has made in its spare hours, lying at the stockpile. They are given as gifts, set out at the midwinter feast and buried with the dead; fine ones count for more.',
  Clothes: 'Clothes: what people are wearing. Warm clothes slow how fast the cold drains them.',
  Knows: 'Knows: what this band has found out for itself or learned from others, beyond the old ways. The planner only uses what the band knows.',
};

/** Rows on a building, animal, plant or land card, by their label. */
export const CARD_TIPS: Record<string, string> = {
  Herd: 'Herd: the deer that graze and move together. Herds breed each spring and drift away from hunters.',
  Meat: 'Meat: meals of meat. One meal feeds one person for about a day; meat spoils unless dried.',
  Wood: 'Wood: in loads one person can carry.',
  Thatch: 'Thatch: bundles of cut grass and reeds for the roof.',
  Cordage: 'Cordage: lengths of twisted grass for lashing the frame.',
  Mud: 'Mud: loads of mud for daubing walls.',
  Stone: 'Stone: loads of stone for walls and tools.',
  Work: 'Work: how far the builders have got. Building needs every material delivered first; skilled builders work faster.',
  Fire: 'Fire: how long the wood on the fire will last before someone needs to feed it.',
  'Wood in store': 'Wood in store: what is left at the stockpile to feed the fire.',
  'By the fire': 'By the fire: those near enough to warm themselves.',
  Firewood: 'Firewood: wood stacked in the open is damp in autumn and winter. A woodshed keeps it dry.',
  Windbreak: 'Windbreak: a screen behind the fire that widens and warms the circle of heat.',
  Shelter: 'Shelter: how much of the night\'s cold the roof and walls keep off those sleeping inside.',
  Bedding: 'Bedding: fresh grass to sleep on. It goes stale and wants changing every so often.',
  Holding: 'Holding: the food in the storehouse, in meals. One meal feeds one person for about a day.',
  Tools: 'Tools: tools lying at the stockpile, ready for anyone to take.',
  Goods: 'Goods: bowls, beads and sashes made in the band\'s spare hours, kept for gifts, the midwinter feast and the graves of the dead.',
  'Out in use': 'Out in use: tools in someone\'s hands right now.',
  'Traps set': 'Traps set: snares and fish traps out on the land, waiting to be checked.',
  Food: 'Food: meals in store. One meal feeds one person for about a day.',
  Berries: 'Berries: handfuls in store. They spoil fast, slower in a lidded pot and in the cold months.',
  Fish: 'Fish: meals in store, or how many fish this water still holds. Fished-out water fills back up in time.',
  Roots: 'Roots: dug roots, in meals. They keep most of a winter.',
  Acorns: 'Acorns: gathered in autumn, in meals. Dried, they keep the year round, and longer still sealed in a storage jar.',
  Eggs: 'Eggs: taken from nests, in meals. They go off quickly, slower in a lidded pot.',
  Mushrooms: 'Mushrooms: gathered in the damp months, in meals. They keep longer in a lidded pot.',
  Honey: 'Honey: wild honeycomb, in meals. It keeps almost forever.',
  Dried: 'Dried: meat and fish dried on the rack, in meals. Keeps for most of a year.',
  'Dried food': 'Dried food: meat and fish dried on the rack, in meals. Keeps for most of a year.',
  Hides: 'Hides: deer hides, kept for cloaks and other clothes.',
  Pelts: 'Pelts: fox and beaver furs from the deadfalls, kept to sew into fur cloaks.',
  Thread: 'Thread: hanks of nettle and grass fiber spun on a spindle by the fire, for weaving cloth at the loom.',
  Weaving: 'Weaving: who is at the loom now, and what they are weaving.',
  Cloth: 'Cloth: how many of the band have a woven tunic to wear and a blanket to sleep under.',
  Pigs: 'Pigs: the herd in the pen. Sows farrow in spring, and in autumn the spare pigs are killed for the stores.',
  Tending: 'Tending: who is working here today.',
  Fed: 'Fed: when the pigs last had a full trough. Pigs left unfed for days grow thin and break out.',
  Feed: 'Feed: greens, nuts, roots and grain the pigs eat from the stores each day. Grown pigs eat twice what piglets do.',
  'Raised by': 'Raised by: how many of the band put in a day\'s work on it, over the years it took.',
  'Worked on by': 'Worked on by: how many of the band have put in a day\'s work on it so far. A monument is raised only in the hours the band can spare.',
  'Laid by it': 'Laid by it: the band\'s dead buried beside the mound since it was finished.',
  'Kept by': 'Kept by: the band whose pen this pig lives in.',
  Pen: 'Pen: how many pigs share the pen, and how many are still young.',
  'Worn by': 'Worn by: who has it on. Clothes go to whoever needs them most when they are made.',
  'In the hands of': 'In the hands of: who is using it. It goes back on the pile when they are done.',
  Lies: 'Lies: on the stockpile, for anyone in the band to take.',
  Set: 'Set: a trap out on the land. Someone checks it on the daily round.',
  Condition: 'Condition: how worn it is. Every use wears it a little; worn right through, it is gone.',
  'Life left': 'Life left: about how much more use it has in it before it wears through. Mending buys more.',
  'Worn on': 'Worn on: where on the body it goes. One thing to each place.',
  Warmth: 'Warmth: how much of the cold it keeps off. Several things worn together keep off more.',
  'Good for': 'Good for: what having it does for whoever uses it.',
  'Made from': 'Made from: what it took from the stores to make.',
  'Made by': 'Made by: who made it by the fire. Better skill makes things faster.',
  Made: 'Made: when it was finished.',
  Mended: 'Mended: worn things are patched by the fire with a little cord. After a few patches it cannot be mended again.',
  Herbs: 'Herbs: dried for fevers. A fever nursed with herbs does far less harm. They keep their strength longer sealed in a storage jar.',
  Used: 'Used: where this year\'s stores went.',
  'Last year': 'Last year: what came in and went out the year before.',
  'Since founding': 'Since founding: everything this camp has gathered and used.',
  Age: 'Age: trees grow from sapling to old tree over decades.',
  'Wood if felled': 'Wood if felled: loads of wood the tree gives when cut down. Bigger trees give more.',
  Seeds: 'Seeds: grown trees spread saplings, so the forest regrows where it is cut.',
  Growing: 'Growing: when it will reach its next size.',
  Deadwood: 'Deadwood: fallen branches anyone can pick up without an axe. It comes back each year.',
  'Marked for felling by': 'Marked for felling: someone has chosen this tree and is on their way.',
  'Being picked by': 'Being picked: someone is on their way to gather from it.',
  'Being cut by': 'Being cut: someone is on their way to cut it.',
  'Being hauled by': 'Being hauled: someone is carrying these logs back to camp.',
  Depth: 'Depth: how deep the water is. Rivers are shallow enough to wade.',
  Elevation: 'Elevation: height above the sea. It is colder the higher you go.',
  Air: 'Air: the temperature here right now. Below 15°C people start to feel the cold.',
  Ice: 'Ice: lakes and rivers freeze in winter; the sea does not.',
  Moisture: 'Moisture: how wet the ground is. Trees, grass and berries grow better on moist ground.',
  Fertility: 'Fertility: how rich the soil is.',
  Clay: 'Clay: good for pots, once people learn to fire it.',
  Ore: 'Ore: metal in the rock that no one here knows how to use yet.',
  Trees: 'Trees: how many trees stand on this patch of ground.',
  Hares: 'Hares: how many hare runs are left for snares. Trapped-out ground fills back up in time.',
  'Here now': 'Here now: who is standing on this spot.',
};
