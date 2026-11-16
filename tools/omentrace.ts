// Omens over a run: every sign seen, every belief that took hold, came true again, spread to the band, faded or
// hardened into a custom, and at the end what each band believes and keeps.
// Usage: npx tsx tools/omentrace.ts --seed 1 [--years 40] [--quiet]
import { generateWorld } from '../src/sim/worldgen';
import { DEFAULT_PARAMS } from '../src/sim/types';
import { Sim } from '../src/sim/sim';
import { TICKS_PER_YEAR } from '../src/sim/time';
import { OMEN_KINDS, loreSummary } from '../src/sim/omen';

const args = process.argv.slice(2);
const get = (k: string, d: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const seed = Number(get('--seed', '1')), years = Number(get('--years', '40'));
const quiet = args.includes('--quiet');
const sim = new Sim(generateWorld({ ...DEFAULT_PARAMS, seed, size: 128 }));
const kinds: Record<string, number> = {};
const ev = sim.event.bind(sim);
sim.event = (kind, text, people, x, z, w) => {
  if (OMEN_KINDS.has(kind)) {
    kinds[kind] = (kinds[kind] ?? 0) + 1;
    if (!quiet && !(kind === 'omen_habit' && w < 2)) console.log(`  y${Math.floor(sim.tick / TICKS_PER_YEAR) + 1} [${kind}] ${text}`);
  }
  return ev(kind, text, people, x, z, w);
};
const end = sim.tick + years * TICKS_PER_YEAR;
while (sim.tick < end) sim.step();
console.log(`\nseed ${seed}, ${years} years:`, kinds);
for (const c of sim.liveCamps()) {
  const l = loreSummary(sim, c);
  console.log(`\n${c.name} (${sim.members(c).length} people)`);
  for (const b of l.beliefs) console.log(`  ${b.held ? 'held ' : 'some '} ${b.text} (${b.hold}/${b.of}, since y${b.since}, from ${b.origin}, proven ${b.proven}x)`);
  for (const k of l.customs) console.log(`  CUSTOM ${k.text} (since y${k.since})`);
}
