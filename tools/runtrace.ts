// The autumn runs and the weirs, year by year: for each seed, the fish each year brought in (and how much of it in
// the autumn, from a weir, and dried on the rack), when the band first saw a run, and when it found out and built
// a weir. Shows whether the runs give the autumn a shape without swamping the year's food.
// Usage: npx tsx tools/runtrace.ts [--seeds 1,2,3] [--years 15]
import { generateWorld } from '../src/sim/worldgen';
import { DEFAULT_PARAMS } from '../src/sim/types';
import { Sim } from '../src/sim/sim';
import { FOODS } from '../src/sim/band';
import { TICKS_PER_YEAR, yearOf, seasonOf } from '../src/sim/time';

const args = process.argv.slice(2);
const get = (k: string, d: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const seeds = get('--seeds', '1,2,3,4,5,6').split(',').map(Number);
const years = Number(get('--years', '15'));
const tot = { fish: 0, autumn: 0, weir: 0, food: 0, dried: 0 };
for (const seed of seeds) {
  const sim = new Sim(generateWorld({ ...DEFAULT_PARAMS, seed }));
  const end = sim.tick + years * TICKS_PER_YEAR;
  const ledger = () => {
    const t: Record<string, number> = {};
    for (const c of sim.camps) for (const [k, v] of Object.entries(c.ledger?.total ?? {})) t[k] = (t[k] ?? 0) + v;
    return t;
  };
  let last = ledger(), lastSeason = seasonOf(sim.tick), year = yearOf(sim.tick);
  const rows: string[] = [];
  let y = { fish: 0, autumn: 0, weir: 0, food: 0, dried: 0 };
  const close = () => {
    const pop = sim.living().length;
    const weirs = sim.buildings.filter((b) => b.kind === 'weir' && b.built).length;
    const know = sim.liveCamps().filter((c) => c.knows.includes('weir')).length;
    rows.push(`  y${String(year).padStart(2)} pop ${String(pop).padStart(3)}  food ${String(Math.round(y.food)).padStart(5)}  fish ${String(Math.round(y.fish)).padStart(5)} (autumn ${String(Math.round(y.autumn)).padStart(4)}, weir ${String(Math.round(y.weir)).padStart(4)})  dried ${String(Math.round(y.dried)).padStart(4)}  weir known ${know}, built ${weirs}`);
    for (const k of Object.keys(tot) as (keyof typeof tot)[]) tot[k] += y[k];
    y = { fish: 0, autumn: 0, weir: 0, food: 0, dried: 0 };
  };
  while (sim.tick < end) {
    sim.step();
    const s = seasonOf(sim.tick);
    if (s === lastSeason && yearOf(sim.tick) === year) continue;
    const L = ledger();
    const d = (k: string) => (L[k] ?? 0) - (last[k] ?? 0);
    y.fish += d('gathered.fish');
    if (lastSeason === 2) y.autumn += d('gathered.fish');
    y.weir += d('weir');
    y.dried += d('dried');
    y.food += FOODS.reduce((a, k) => a + d(`gathered.${k}`), 0);
    last = L;
    lastSeason = s;
    if (yearOf(sim.tick) !== year) { close(); year = yearOf(sim.tick); }
    if (!sim.living().length) break;
  }
  console.log(`seed ${seed}`);
  for (const r of rows) console.log(r);
  for (const e of sim.events.filter((e) => e.kind === 'run' || (e.kind === 'discovery' && /weir/.test(e.text)) || (e.kind === 'build' && /weir/.test(e.text))).slice(0, 12))
    console.log(`    y${yearOf(e.tick)} ${e.text}`);
}
console.log(`\nall seeds: food ${Math.round(tot.food)}, fish ${Math.round(tot.fish)} (${Math.round((tot.fish / tot.food) * 100)}% of food), autumn ${Math.round(tot.autumn)} (${Math.round((tot.autumn / tot.fish) * 100)}% of fish), weir ${Math.round(tot.weir)}, dried ${Math.round(tot.dried)}`);
