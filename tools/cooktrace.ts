// The band's cooking, day by day: who put the stew on and when, what went in, what it filled, how much was left by
// noon, and the brews. Usage: npx tsx tools/cooktrace.ts [seed] [years] [--knows]  (--knows: the band knows pottery,
// the stew pot, broth and brews from the start, with a cooking pot at the fire)
import { generateWorld } from '../src/sim/worldgen';
import { DEFAULT_PARAMS } from '../src/sim/types';
import { Sim } from '../src/sim/sim';
import { SK } from '../src/sim/band';
import { TICKS_PER_YEAR, TICKS_PER_DAY, hourOf, yearOf, DAYS_PER_YEAR, START_TICK } from '../src/sim/time';

const args = process.argv.slice(2);
const seed = Number(args[0] ?? 3), years = Number(args[1] ?? 3);
const sim = new Sim(generateWorld({ ...DEFAULT_PARAMS, seed }));
if (args.includes('--knows')) {
  for (const k of ['pottery', 'cooking', 'herbs', 'stew', 'broth', 'brews']) if (!sim.camp.knows.includes(k)) sim.camp.knows.push(k);
  sim.items.push({ id: sim.newId(), kind: 'cookpot', band: sim.camp.id, holder: -1, wear: 0, made: sim.tick, maker: -1 });
}
const day = (t: number) => { const d = Math.floor((t - START_TICK) / TICKS_PER_DAY); return `y${Math.floor(d / DAYS_PER_YEAR) + 1}d${d % DAYS_PER_YEAR}`; };
let seen: unknown;
let lastY = yearOf(sim.tick), stews = 0, brews = 0, left = 0, made = 0;
const end = sim.tick + years * TICKS_PER_YEAR;
while (sim.tick < end) {
  sim.step();
  const c = sim.camp;
  const st = c.stew;
  if (st && st !== seen && st.ready >= 0) {
    seen = st;
    stews++;
    if (st.brew) brews++;
    made += st.fill;
    const cook = sim.byId.get(st.cook);
    const raw = Object.entries(st.raw).filter(([, v]) => v! > 0.05).map(([k, v]) => `${k} ${v!.toFixed(1)}`).join(', ');
    if (stews <= 12 || stews % 20 === 0)
      console.log(`${day(sim.tick)} ${hourOf(st.started).toFixed(1)}h-${hourOf(st.ready).toFixed(1)}h ${st.dish} by ${cook?.name} (cooking ${cook?.skills[SK.cook].toFixed(1)}): ${st.fill.toFixed(1)} meals from ${raw}${st.bones ? `, ${st.bones} bones` : ''}${st.brew ? ', and a brew' : ''}; ${sim.members(c).length} people`);
  }
  if (!st && seen && (seen as { fill: number }).fill > 0.02) { left += (seen as { fill: number }).fill; seen = undefined; }
  if (yearOf(sim.tick) !== lastY) {
    const dishes = sim.members(sim.camp).filter((p) => p.dish).length;
    console.log(`-- year ${lastY}: ${stews} stews (${brews} with a brew), ${made.toFixed(0)} meals made, ${left.toFixed(0)} left to waste; ${dishes} remember a best meal; pop ${sim.members(sim.camp).length}`);
    stews = brews = 0; made = left = 0;
    lastY = yearOf(sim.tick);
  }
}
