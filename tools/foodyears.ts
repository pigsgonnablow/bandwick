// Food across the years: for each span of years, how often people are short of food, what share of the
// day goes to getting food (and to the gardens), and how many people there are. Shows whether food stays
// the struggle once a band gardens.
// Usage: npx tsx tools/foodyears.ts [--seeds 1,2,3] [--years 15]
import { generateWorld } from '../src/sim/worldgen';
import { DEFAULT_PARAMS } from '../src/sim/types';
import { Sim } from '../src/sim/sim';
import { TICKS_PER_YEAR, yearOf, isDark } from '../src/sim/time';

const args = process.argv.slice(2);
const get = (k: string, d: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const seeds = get('--seeds', '1,2,3,4,5,6').split(',').map(Number);
const years = Number(get('--years', '15'));
const SPANS = [[1, 3], [4, 6], [7, 9], [10, 12], [13, 15], [16, 20]].filter(([a]) => a <= years);
const FOOD = new Set(['forage', 'hunt', 'fish', 'trap', 'preserve', 'roots', 'nuts', 'eggs', 'honey', 'mushrooms', 'eatwild']);
const GARDEN = new Set(['sow', 'tend', 'harvest']);
type Acc = { n: number; short: number; work: number; food: number; garden: number; pop: number; popN: number; starved: number };
const acc: Acc[] = SPANS.map(() => ({ n: 0, short: 0, work: 0, food: 0, garden: 0, pop: 0, popN: 0, starved: 0 }));
const spanOf = (y: number) => SPANS.findIndex(([a, b]) => y >= a && y <= b);
for (const seed of seeds) {
  const sim = new Sim(generateWorld({ ...DEFAULT_PARAMS, seed }));
  const end = sim.tick + years * TICKS_PER_YEAR;
  let starved = sim.stats.starved;
  while (sim.tick < end) {
    sim.step();
    if (sim.tick % 20) continue;
    const a = acc[spanOf(yearOf(sim.tick))];
    if (!a) continue;
    if (sim.stats.starved > starved) { a.starved += sim.stats.starved - starved; starved = sim.stats.starved; }
    const living = sim.living();
    if (sim.tick % 240 === 0) { a.pop += living.length; a.popN++; }
    for (const p of living) {
      if (sim.age(p) < 14) continue;
      a.n++;
      if (p.food < 35) a.short++;
      if (isDark(sim.tick)) continue;
      a.work++;
      const k = p.task?.kind ?? '';
      if (FOOD.has(k)) a.food++;
      if (GARDEN.has(k)) a.garden++;
    }
  }
}
console.log('years   short of food   day on wild food   day in gardens   people   starved');
SPANS.forEach(([x, y], i) => {
  const a = acc[i];
  if (!a.n) return;
  console.log(`${String(x).padStart(2)}-${String(y).padEnd(4)} ${(a.short / a.n * 100).toFixed(1).padStart(10)}% ${(a.food / a.work * 100).toFixed(1).padStart(15)}% ${(a.garden / a.work * 100).toFixed(1).padStart(15)}% ${(a.pop / Math.max(1, a.popN)).toFixed(1).padStart(8)} ${String(a.starved).padStart(9)}`);
});
