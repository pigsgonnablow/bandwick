// The band's cooking, day by day: who put the stew on and when, what went in, what it filled, how much was left by
// noon, the brews, the earth oven, and who was sick from bad food. Usage: npx tsx tools/cooktrace.ts [seed] [years]
// [--knows] [--boil]  (--knows: the band knows pottery, the stew pot, broth, brews, the grilling stone and the earth
// oven from the start, with a cooking pot at the fire; --boil: it knows stone boiling instead of the pot)
import { generateWorld } from '../src/sim/worldgen';
import { DEFAULT_PARAMS } from '../src/sim/types';
import { Sim } from '../src/sim/sim';
import { SK } from '../src/sim/band';
import { TICKS_PER_YEAR, TICKS_PER_DAY, hourOf, yearOf, DAYS_PER_YEAR, START_TICK } from '../src/sim/time';

const args = process.argv.slice(2);
const seed = Number(args[0] ?? 3), years = Number(args[1] ?? 3);
const sim = new Sim(generateWorld({ ...DEFAULT_PARAMS, seed }));
if (args.includes('--knows')) {
  for (const k of ['pottery', 'cooking', 'herbs', 'stew', 'broth', 'brews', 'garden', 'grain', 'griddle', 'digstick', 'oven']) if (!sim.camp.knows.includes(k)) sim.camp.knows.push(k);
  sim.items.push({ id: sim.newId(), kind: 'cookpot', band: sim.camp.id, holder: -1, wear: 0, made: sim.tick, maker: -1 });
}
if (args.includes('--boil')) for (const k of ['cooking', 'preserving', 'boiling']) if (!sim.camp.knows.includes(k)) sim.camp.knows.push(k);
const day = (t: number) => { const d = Math.floor((t - START_TICK) / TICKS_PER_DAY); return `y${Math.floor(d / DAYS_PER_YEAR) + 1}d${d % DAYS_PER_YEAR}`; };
let seen: unknown;
let lastY = yearOf(sim.tick), stews = 0, brews = 0, left = 0, made = 0, ovens = 0, boiled = 0;
const end = sim.tick + years * TICKS_PER_YEAR;
while (sim.tick < end) {
  sim.step();
  const c = sim.camp;
  const st = c.stew;
  if (st && st !== seen && st.ready >= 0) {
    seen = st;
    stews++;
    if (st.brew) brews++;
    if (st.oven) ovens++;
    if (st.boiled) boiled++;
    made += st.fill;
    const cook = sim.byId.get(st.cook);
    const raw = Object.entries(st.raw).filter(([, v]) => v! > 0.05).map(([k, v]) => `${k} ${v!.toFixed(1)}`).join(', ');
    if (stews <= 12 || stews % 20 === 0)
      console.log(`${day(sim.tick)} ${hourOf(st.started).toFixed(1)}h-${hourOf(st.ready).toFixed(1)}h ${st.dish} by ${cook?.name} (cooking ${cook?.skills[SK.cook].toFixed(1)}): ${st.fill.toFixed(1)} meals from ${raw}${st.bones ? `, ${st.bones} bones` : ''}${st.brew ? ', and a brew' : ''}${st.oven ? ' (earth oven)' : st.boiled ? ' (stone boiled)' : ''}; ${sim.members(c).length} people`);
  }
  if (!st && seen && (seen as { fill: number }).fill > 0.02) { left += (seen as { fill: number }).fill; seen = undefined; }
  if (yearOf(sim.tick) !== lastY) {
    const dishes = sim.members(sim.camp).filter((p) => p.dish).length;
    const l = sim.camp.ledger?.last ?? {};
    console.log(`-- year ${lastY}: ${stews} stews (${brews} with a brew, ${boiled} stone boiled, ${ovens} from the oven), ${made.toFixed(0)} meals made, ${left.toFixed(0)} left to waste; ${dishes} remember a best meal; sick from raw food ${l['sick.raw'] ?? 0}, from stale ${l['sick.stale'] ?? 0}; pop ${sim.members(sim.camp).length}`);
    stews = brews = ovens = boiled = 0; made = left = 0;
    lastY = yearOf(sim.tick);
  }
}
