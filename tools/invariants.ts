// Runs bands for decades and checks, every game day, that nothing impossible has happened.
// Usage: npx tsx tools/invariants.ts [--seeds 1,2,3] [--years 30] [--size 128]
// The checks themselves live in tools/lib/invariants.ts (the test suite runs them too).
import { generateWorld } from '../src/sim/worldgen';
import { DEFAULT_PARAMS } from '../src/sim/types';
import { Sim } from '../src/sim/sim';
import { runChecked, Problem } from './lib/invariants';

const args = process.argv.slice(2);
const get = (k: string, d: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const seeds = get('--seeds', '1,2,3,4,5').split(',').map(Number);
const years = Number(get('--years', '30'));
const size = Number(get('--size', '128'));

const problems = new Map<string, Problem>();
for (const seed of seeds) {
  const sim = new Sim(generateWorld({ ...DEFAULT_PARAMS, seed, size }));
  const checker = runChecked(sim, years);
  for (const [k, v] of checker.problems) {
    const p = problems.get(k);
    if (p) p.count += v.count;
    else problems.set(k, { ...v });
  }
  console.log(`seed ${seed}: ${years} years, pop ${sim.living().length}, people ever ${sim.people.length}, events ${sim.events.length}`);
}
console.log('');
if (!problems.size) console.log('No invariant violations.');
for (const [k, v] of [...problems].sort((a, b) => b[1].count - a[1].count)) console.log(`${String(v.count).padStart(6)}  ${k}  e.g. ${v.first}`);
process.exitCode = problems.size ? 1 : 0;
