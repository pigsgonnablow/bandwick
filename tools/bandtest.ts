// Headless band runs: N seeds x Y game-years, yearly census, survival summary.
// Usage: npx tsx tools/bandtest.ts [--seeds 1,2,3] [--years 20] [--size 128] [--verbose]
import { generateWorld } from '../src/sim/worldgen';
import { DEFAULT_PARAMS } from '../src/sim/types';
import { Sim } from '../src/sim/sim';
import { TICKS_PER_YEAR, yearOf } from '../src/sim/time';

const args = process.argv.slice(2);
const get = (k: string, d: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const seeds = get('--seeds', '1,2,3,4,5,6,7,8,9,10').split(',').map(Number);
const years = Number(get('--years', '20'));
const size = Number(get('--size', '128'));
const verbose = args.includes('--verbose');
const results: { seed: number; pop: number; survived: boolean; peak: number; births: number; deaths: number; starved: number; froze: number; ms: number; hash: string }[] = [];

for (const seed of seeds) {
  const world = generateWorld({ ...DEFAULT_PARAMS, size, seed });
  const sim = new Sim(world);
  const t0 = performance.now();
  const end = sim.tick + years * TICKS_PER_YEAR;
  let lastYear = yearOf(sim.tick);
  const census: string[] = [];
  while (sim.tick < end) {
    sim.step();
    const y = yearOf(sim.tick);
    if (y !== lastYear) {
      const s = sim.summary();
      census.push(`y${lastYear}:${s.pop}`);
      if (verbose)
        console.log(`  seed ${seed} year ${lastYear}: pop ${s.pop} (kids ${s.children}, elders ${s.elders}) food ${s.food} wood ${Math.round(s.stock.wood)} homes ${s.homes} deer ${s.deer} births ${s.stats.births} deaths ${s.stats.deaths} starved ${s.stats.starved} froze ${s.stats.froze} kills ${s.stats.kills} knows ${s.knows.join(', ') || 'nothing yet'}`);
      lastYear = y;
      if (s.pop === 0) break;
    }
  }
  const s = sim.summary();
  const ms = performance.now() - t0;
  // a fingerprint of the whole history, for determinism checks (the same one the stats overlay shows)
  const hash = sim.historyHash();
  results.push({ seed, pop: s.pop, survived: s.pop > 0, peak: s.stats.peak, births: s.stats.births, deaths: s.stats.deaths, starved: s.stats.starved, froze: s.stats.froze, ms, hash });
  console.log(`seed ${seed}: pop ${s.pop} peak ${s.stats.peak} births ${s.stats.births} deaths ${s.stats.deaths} (starved ${s.stats.starved}, froze ${s.stats.froze}) homes ${s.homes} events ${sim.events.length} ${(ms / 1000).toFixed(1)}s hash ${hash}`);
  if (verbose) console.log('  ' + census.join(' '));
  if (args.includes('--events')) for (const e of sim.events.filter((e) => e.weight >= 2)) console.log(`   y${yearOf(e.tick)} ${e.text}`);
}
const ok = results.filter((r) => r.survived).length;
console.log(`\nSURVIVED ${ok}/${results.length}  median pop ${results.map((r) => r.pop).sort((a, b) => a - b)[Math.floor(results.length / 2)]}  avg run ${(results.reduce((a, r) => a + r.ms, 0) / results.length / 1000).toFixed(1)}s`);
