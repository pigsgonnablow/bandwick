# Bandwick (working title; was "Living World") — M1: the first band (now with M2's Chronicle and M3's bands)

A seeded, deterministic isometric island where a band of ten named people tries to live:
they forage, fell trees, hunt deer, fish, build huts, keep the fire going, pair up, have
children, fall ill, grieve and bury their dead. Every person has needs, traits, skills,
memories and relationships; the camp plans its work each morning. The land changes as they
use it: stumps where forest stood, saplings returning, graves at the edge of camp. Firewood comes
from felled trees and from fallen branches gathered without cutting anything down; hunters range
further as nearby herds thin out, and hunted-out ranges slowly refill.

Built on M0's world: terraces, sea, lakes, rivers, Blender-made forests, day and night,
and four seasons.

**Bands (M3).** The band is no longer alone for long. A band grown big or quarrelsome splits:
someone restless leads a few households away to found a new camp on good land. A band whose
timber is gone for miles, or that has buried too many, packs up and moves. The last few of a
dwindling band go to live with another; an empty camp is left standing, cold. Strangers come over
the hills now and then (and always, eventually, to an empty land), and young people of
neighbouring bands pair off, one going to live with the other. The panel at the left follows one
band at a time: step between them, or click anyone to follow theirs.

**Band colours.** Every band has a colour. Strangers take one as unlike every other band's as
can be; a band that parts on good terms takes a lighter shade of its parent's; one that breaks away
in anger (a feud, a hungry year, bloodshed, a cruel or grasping leader) or is driven out takes the
colour across the wheel (red against blue). A band that moves keeps its colour; people who marry or
merge into a band take on its colour. Press `B` (or Band colours) to see them: everyone glows in
their band's colour, buildings take it on, and a wash around each camp, wider the more people live
there, shows each band's range; a legend lists the bands. The band panel shows the colour, and how
the band came to be.

**Landing.** A new world opens with the first band coming in from the sea in a boat. They land
on the nearest shore, walk inland to their camp, lay the hearth and mark out the stockpile, and
then life begins. Time stands still until they are settled. Press Skip (or Esc, or pick a speed)
to start at once. The landing is only for show, so a world's history is the same either way.
Loaded saves don't replay it.

**Stores.** Every camp marks out a stockpile beside the hearth the day it is founded, and
everything gathered is carried there: wood stacked between stakes at the back, berries, meat and
fish laid on a bark mat in front, the pile growing and shrinking with the stores. Once there is a
storehouse, food goes inside it and wood stays on the stack. Each band keeps a ledger of what came
in and went out (gathered, eaten, spoiled, dried, burned, built with, carried away by those who
left): click the stockpile for this year, last year and since the founding; the band panel shows
this year at a glance, and the Chronicle's annals give each year's totals.

**Fiber and cordage.** Grass tussocks and reed beds are cut for fiber, and they grow back through
spring and summer (reeds faster, not at all in winter). Older children help cut it. Fiber is
stacked at the stockpile, and in the evenings people sit by the fire twisting it into cordage, three
bundles to a length (the weaving skill). Buildings need both: a lean-to takes 4 wood and 3 thatch,
a hut 14 wood, 6 thatch and 3 cordage, a storehouse 10 wood, 4 thatch and 2 cordage, a drying rack
5 wood and 2 cordage. Work on a site starts once everything has been carried to it.

**Mud and stone.** Huts and storehouses can also have walls of wattle-and-daub (a few poles, woven
reeds and mud dug on the banks of rivers and lakes or from riverbank clay) or drystone (quarried
from rock near camp, once someone in the band has worked out stonework). Daub and stone are warmer
and keep food better but take longer to raise. Each morning the band weighs what is near camp, how
hard its winters are, how close the cold is, how long it has stayed, what it built before and what
its leader is like, and says why in its plan ("Build a stone hut for Arn's household (the woods
are thin here)"). Mud can't be dug from frozen ground: a daub site still short of mud as winter
comes is finished in wood. Daubed walls show the colour of dried mud, stone ones go grey.

**The fire's comforts.** Firewood stacked in the open is damp through autumn and winter and burns a
fifth faster, so once the first hut stands the band puts a thatched roof over the woodpile (4 wood,
4 thatch, 2 cordage). Then, before the cold or once the band has grown, it raises a windbreak of
stakes and rails in an arc behind the fire (6 wood, 2 cordage): it throws the heat back, so people
at the fire warm faster and further out. Bark stripped from big felled trees, and pine cones picked
up with fallen branches, go on the woodpile too. The fire's card says when the wood is damp.

**Discovery.** A band starts with only the old ways: fire, the chopper and spear, cordage, the
lean-to, gathering and burial. Everything else is found by doing the work that leads to it. Nights
under a lean-to lead to huts, evenings at the fire to a windbreak, feeding the fire damp wood to a
roof over the woodpile, handling meat and fish to drying racks, storing food to a storehouse,
thatching and building near mud to wattle-and-daub, and building near stone to stonework. Each
piece of that work adds to the band's experience, and whoever did it may have the idea, more likely
the more experience there is, for the curious, the industrious and the skilled, and in hardship.
Some discoveries need others first. A daughter band or a band that moves keeps all it knew; someone
who marries in teaches their old band's ways a season later; a dwindling band that merges teaches
the band it joins; and strangers bring some of what is known in the world, more the later they come.
The band panel lists what a band knows. Every discovery is one row in `src/sim/know.ts`, and
`npx tsx tools/discoveries.ts` shows when each seed's first band found each one.

**Tools.** Felling takes a tool. A band starts with two hand choppers (a stone knapped to an edge,
held in the fist), which take only saplings and young trees, and at half the pace. Hacking at trunks
with them is what leads someone to lash a stone head to a haft: the stone axe, a discovery, which
fells any tree. Tools are made by the fire (a chopper from a lump of stone; an axe from 2 wood, 1
stone and 1 cordage), with the stone fetched from the rocks, and the band keeps a couple of choppers
and about one axe for every few people. They lie on the stockpile: a woodcutter fetches one before
setting out and lays it back when passing the pile again; the dead's tools come back with whoever
buries them. Each tree wears a tool down (a chopper lasts about 10, an axe about 25) until it
breaks. Fallen branches never need a tool, so a band that loses every tool still keeps its fire
going. The band panel and the stockpile list the tools and how worn they are, and a woodcutter
without an axe is drawn hacking with a stone.

**Digging stick.** Mud for daub and graves are dug by hand at first: two baskets a trip, and a grave
takes a while. Digging that way is what leads someone to sharpen a stout stick and harden its point
in the fire (a discovery). A digging stick is made by the fire from 1 wood. Diggers and gravediggers
fetch one from the pile when there is one. With it a trip brings back three baskets, and a grave
takes two-thirds of the time. A stick lasts about 15 trips. A band keeps one, or two once it raises
wattle-and-daub.

**Trapping.** Grass and forest hold hares, a hidden count on each tile that snares thin out and
that comes back over a few weeks. Hunting and picking berries lead a band to snares, and fishing
with reeds in the stores leads it to fish traps (both discoveries). A snare is made by the fire from
1 cordage and lasts about a season; a fish trap takes 3 fiber and 2 wood and lasts about a year. The
plan keeps a few snares out, more when food is short or winter is coming, and a couple of fish traps
where there is fishing water near camp. Once a day one person goes round them all: each snare that
caught a hare gives 2 meat, a fish trap up to 4 fish from the same stock spear-fishers use. Traps
where the hares or fish are gone are taken up, and traps from the pile are set where the hares run
thickest within about 10 tiles of camp, never two side by side. The catch comes home in one load.
Traps work through winter, when hare tracks in the snow make snaring easier. A band that moves or
joins another takes its traps up. A tile's card says what trap is set there and what it holds. A few
of the hares are drawn near the camera, more on open grass than in the woods and fewer where the
snares have thinned them out: they feed, hop about, sit up to watch anyone passing and bolt when
someone comes close (only for show: the count is what the snares catch from). The hares from the
snares come home dangling from the trapper's hand.
Fish show too: trout glimpsed under the surface near the camera, scattering from anyone swimming
or a spear going in, and rises dimpling the water with now and then a fish leaping clear, all more
often where the water is full and less where it has been fished out. Lakes and rivers go still under
the winter ice; the sea does not.
Birds too: small flocks of finches feed on open grass near the camera, go up together when anyone
comes close and come down again a few tiles off, and roost out of sight at night. Skeins of geese
pass high over, northward early in spring and southward in autumn. A pair of birds flutters round
a tree while someone robs their nest, and bees boil out of a wild hive being smoked.
The deer keep the seasons. In the autumn rut the stags stop to roar, neck out and jaw dropped, their
breath steaming, and a stag with a rival close by squares up to him: they lock antlers, shove to and
fro and crash together until one gives way. A roaring or fighting stag hardly notices people, and is
an easier kill. In winter the herds keep to the woods, and the snow slows a running deer; hunters
follow fresh tracks to herds further out (the hoofprints show in the snow, filling in over time). Hunters
leave a herd that is down to three or fewer to breed again, unless the band is going hungry.
Wolves roam the wilds in a pack or two, well away from people. A hungry pack picks out the nearest
deer and runs it down, fanning out round it (more easily in deep snow), then feeds at the kill and
needs nothing more for a couple of weeks; deer bolt from a wolf on the hunt as they do from people.
Wolves keep clear of the camp fires (further at night, and further still from a camp with dogs),
slink off from anyone who comes near, lie up in the middle of the day and howl at dusk. A camp that
hears them notes it, and they are the only wolves that can attack someone alone far from camp. Cubs
are born in spring. A good hunter who has watched them hunt, or heard them round the fire, may take in
a cub and raise the first dog (a discovery); after that a band takes in a pup now and then for its
hunters, about one dog for every four grown people. A dog goes everywhere with its keeper, out ahead on
a hunt, nosing about when they stop, lying across the doorway while they sleep. A grown dog finds deer
further off and holds them at bay (a better kill), and helps fend off an attack. Wolves and dogs leave
prints in the snow too.

Wild boar keep to the woods in sounders: a sow or two with their young, striped piglets born in early
spring. They root through the leaf litter, lie up at midday and, in autumn, go to the oaks for the
acorns, sometimes clearing a tree before the band's foragers get there. A boar runs from people, but
one cornered (or a sow with piglets) may charge, and a tusk leaves a bad gash. A good hunter who keeps
crossing them out after deer may work out how to take one on the braced spear (a discovery): a lot of
meat, and a real risk of being gored, less with a dog along. Hunters leave a sounder that is down to
three or fewer alone, a lone sow is joined by a boar in spring, and a sounder hunted out near a camp
takes up a new range deeper in the woods, so boar last through the decades.

Foxes live in pairs, each with an earth in the open country, and raise cubs in spring. By day they lie
curled up in the sun; at dusk they trot out to mouse in the long grass, listening and then pouncing.
A fox that finds a hare caught in a snare near its earth overnight takes it, and the band notices.
Foxes keep away from camps that keep dogs. Boar and foxes leave prints in the snow.

Beavers live in lodges of sticks and mud on rivers and lakes, with a dam they build up across the
river nearby. They come out at dusk and dawn to swim, slapping their tails when someone comes near,
and go ashore to gnaw through the birches along the bank. A felled birch lies where it fell, its wood
free for anyone who comes to haul it home. In winter, under the ice, they stay in the lodge.

**Crafting.** Everything made by the fire is one job with a list of recipes (`RECIPES` in
`src/sim/band.ts`): cordage, the hand chopper and the stone axe so far. Each morning the plan says
what is wanted, in a fixed order: cordage a building site is waiting on, then tools the day's work is
missing, then a few lengths of cordage put by. A crafter takes whichever wanted recipe they are best
at. Crafting is four skills: toolmaking, weaving, pottery and hidework (drying and smoking meat uses
hidework for now). Pottery and hidework show on a person's card once the band has a use for them.
Whoever is clearly a band's best at a craft is known for it ("Ada, the toolmaker") on their card
and in the Chronicle. Older saves give each person's old crafting level to toolmaking and weaving.

**Fortune.** Most years are ordinary. Some are not: a sickness that runs through a camp, a feud
that ends in a killing and an exile, wolves or a bear on someone out alone after dark, a drowning,
a lean year (a late frost takes the berry flowers, the fish run thin and the acorns, roots, mushrooms
and hares come to half), a murrain among the deer; or a year of plenty, a great hunt that brings
down half a herd, someone hardy enough to see ninety, ten years without a single death. A bitter
winter makes people hungrier as well as colder. Lean years and bitter winters are where bands go on
short rations and sometimes lose people; the first band is spared a lean year in its first two
summers. A band whose fire is dying in winter with no wood left goes to live at a neighbour's fire
rather than freeze. Fished-down water gives smaller catches, and wolves only raise cubs where there
are deer to feed them. `npx tsx tools/longrun.ts --seed N` records a world year by year, and
`npx tsx tools/longrun-report.ts dir` sums many of them up. Over sixty
years some worlds hold one small band hanging on and some hold four thriving ones; now and then the
land is left empty until strangers come.

## Open it
Run `npm run build`, then double-click `dist/index.html`. It is one self-contained file and runs offline from disk in
current Chrome, Edge, Firefox (114+) or Safari (15+) on Windows, macOS or Linux. A desktop or laptop
with any WebGL2 GPU will do; integrated graphics are fine (quality adjusts itself).
Fonts come from Google Fonts when online; offline the page falls back to system fonts.
If a browser refuses to start the simulation worker from a local file, the page notices
and runs the simulation on the main thread instead, so it still works, just with a little less headroom at 100×.

## Controls
- Drag to pan, scroll to zoom, `Q` / `E` to rotate, `W A S D` or arrows to pan
- `B` band colours, `H` chronicle
- `Space` pause, `1`–`6` speed (1× is a walking pace, a day in about a minute and a half; 4×, 12×, 40×, 120×, 400×)
- Click anything to examine it: people, deer, huts, the fire, trees, stumps, log piles, graves. Double-click the ground for the land or water itself.
  An info window opens beside it, joined to it by a line. People's windows have tabs: Now (what they're doing,
  carrying, needs, health, mood), Gear (what they wear and hold), Family, Skills, and Story (memories). On the Gear tab
  each thing worn or held is a link: it opens a window about it beside theirs, with a picture of it (its model,
  `item__<kind>` in `blender/build_band.py`), how worn it is and how much use is left in it, how warm it keeps them or
  what it is good for, what it was made from, who made and mended it, and where it is now. Drag a window by its header. Pin it to keep it open
  while you click other things, so up to four can sit side by side for comparison. `Esc` closes the unpinned
  window first, then pinned ones. `F` follows the person whose window is in front.
- `H` or the Chronicle button opens the history of the world, four ways:
  Annals (each year in a few lines, with a title it's remembered by), Timeline (people, food, mood and climate over time,
  with births, deaths, hard times and works marked in lanes; hover for any moment, click a mark to go there),
  Family (everyone who ever lived, by generation; point at someone to trace their line), and Records
  (longest life, best hunter, largest family line, deadliest and coldest years, how people died).
  Every name leads back into the world. The band's numbers are recorded every 4 days and kept in saves.
- `C` or the Director button hands the camera to the director, which finds what is worth watching; move the camera yourself to take it back
- Point at anything to see its name
- On hot summer afternoons children and young adults go down to the lake or the sea shallows to cool off. Fords, lake edges and calm sea shallows can all be crossed, slowly; deep water can't
- Skip ahead to the next morning or next season
- Save and load: `Ctrl+S` or the Save button saves; Saves lists every saved world in this browser, with Load, Export
  (a `.lwsave` file), Delete, and Open a save file. The game also autosaves each new season and when you switch away.
  A fresh page offers to continue your latest save.
- `` ` `` or `F3` toggles the stats overlay (fps, triangles, world hash)
- The same seed always produces the same world (check the world hash).

## Build from source
Requires Node 18 or newer (any OS). Commands are the same in PowerShell, cmd, bash or zsh.
```
npm install
npm run dev          # live-reloading dev server
npm run build        # -> dist/index.html (single self-contained file)
npm run preview      # serves the build at http://localhost:4173
npm run check        # type-check only
```
Tests (no browser needed; they also run on every pull request):
```
npm test                   # everything, about half a minute
npm run test:unit          # pure functions: random numbers, calendar, noise, pathfinding, names, saves
npm run test:integration   # whole worlds: generation, years of simulation under the invariants, save/load
npm run test:regression    # golden fingerprints of fixed seeds, and tests for bugs that were fixed
npm run test:watch         # re-run on every change
npm run test:update        # accept new golden fingerprints after an intended change to the sim
```
The tests live in `test/` (Vitest). When a change to world generation or the simulation is meant to
change what happens, `test/regression/golden.test.ts` fails with a diff of the hashes, numbers and
momentous events; read it over, run `npm run test:update` and commit the new snapshot with the change.
When you fix a bug, add a test for it under `test/regression/` (see `carry-home.test.ts`).
The daily invariant checks are shared with `npm run invariants` through `tools/lib/invariants.ts`.

Longer headless checks (no browser needed):
```
npm run gentest -- 4471 --size 256          # world generation: timing, hash, preview image
npm run bandtest -- --seeds 1,2,3 --years 30 # survival, births, deaths per seed
npm run invariants -- --seeds 1,2 --years 30 # checks every game day that nothing impossible happened
```
Browser checks (start `npm run preview` first; set `URL=` to point elsewhere) live in `tools/*.mjs`
and use Playwright: `npx playwright install chromium` once, then e.g. `node tools/clicktest.mjs shots`.
`tools/soaktest.mjs` runs the page at 100x for a few minutes and watches memory, frame rate and errors;
`tools/determinism.mjs` checks that the browser and Node produce the same history.
`tools/walkfilm.mjs` films someone walking frame by frame on a hand-wound clock (smooth however slowly
the machine draws) and `tools/closeup.mjs` photographs the models in the game; both need ffmpeg/Playwright.

Rebuild the 3D models (needs Blender 3.6+ on the PATH, or `pip install bpy`):
```
npm run assets:blender   # blender -b -P blender/build_assets.py, then build_band.py
npm run assets           # same through Python's bpy module
```
On Windows, if `python3` isn't found use `py blender/build_assets.py` and `py blender/build_band.py`.

`build_band.py` also writes `src/assets/gait.json`: the walk and run cycles, keyframed as Bezier
curves on Blender's timeline (contact, down, passing, up) and sampled into a table the villager
shader plays back, with the stride driven by distance walked so feet don't slide. The same file holds
every other authored clip: looping poses (children skipping in play, squatting to tend the fire,
reaching up to the drying rack, hands held out to warm) and one-off moves played over whatever the
body is doing (bending to pick something up, setting it down, the spear thrust that brings down a
deer, the stab that lands a fish). Carried things follow the hand through those moves. In water too deep
to stand in for their height, people swim (a dog paddle, flat in the water, when going somewhere) or
tread water (upright, head out, when stopped or carrying something), with ripples spreading around them.
Woodcutters swing a stone axe (modelled in `build_band.py`, drawn following the swing); each blow
makes the tree shudder and throws chips, and a felled tree topples away from its cutter, bounces,
lies a moment and goes, leaving the stump and logs. Fishers stab several times a try, each stab
splashing where the spear meets the water, and a catch comes home on the spear. Two preview
scripts render straight from the game's files:
```
python3 blender/preview_walk.py out/ walk 8          # the cycle, side-on and at the game's angle
python3 blender/model_sheet.py out.png src/assets/band.glb bld__,deer 4 iso   # any models, laid out
```
Both scripts write into `src/assets/` relative to themselves, so they can be run from any folder.

The simulation is deterministic across machines and browsers: it uses its own seeded random numbers
and only exactly-rounded arithmetic (no `Math.sin`/`exp`/`pow` in the sim), so a seed gives the same
history everywhere. The stats overlay (`` ` ``) shows two fingerprints: the *world hash* (the land)
and the *history hash* (everything that has happened, and where everyone is, at the shown tick).
To compare two machines: open the same seed, pause, press "Next season" a couple of times, and the
history hashes at the same tick must match. `node tools/determinism.mjs` does this in a browser and
`npx tsx tools/histhash.ts <seed> <tick>` gives the answer from Node.

If the simulation ever hits a bug it stops and says so, with the seed and tick, and offers to restart.

## Layout
- `src/sim/` — world generation and the band simulation (deterministic: seeded PRNG, no browser-dependent math)
  - `sim.ts` people, life and death, the camp planner, deer; `beasts.ts` wild boar, foxes and beavers; `ai.ts` decisions and tasks; `know.ts` the discoveries; `path.ts` pathfinding
- `src/render/` — three.js renderer: terrain, water shader, instanced props, lighting, seasons, camera
- `src/ui/` — Preact interface (`InfoWindows.tsx` is the floating inspector, `Chronicle.tsx` the history browser)
- `src/saves.ts` — save storage (IndexedDB, gzip, export/import)
- `blender/build_assets.py` — every tree, bush, reed, grass tuft, rock, outcrop, stump, log pile and grave
- `blender/build_band.py` — villagers (jointed: thighs/shins, upper arms/forearms), their walk and run cycles and every other animation clip, deer (stags with antlers), wolves, dogs, foxes, wild boar, beavers (and their lodge and dam), carried items, hearth, lean-to, two kinds of hut, storehouse, drying rack, the dugout the first band lands in
- `test/` — the test suite: `unit/`, `integration/`, `regression/` (Vitest)
- `tools/` — headless tests (generation, survival, invariants, traces) and Playwright browser checks
