// Follows the bands' customs through a run: what each band came with, what it took up and why, what daughter bands
// left behind, and what every living band lives by at the end.
// Usage: npx tsx tools/waytrace.ts [--seed 1] [--years 20]
import { generateWorld } from '../src/sim/worldgen';
import { DEFAULT_PARAMS } from '../src/sim/types';
import { Sim } from '../src/sim/sim';
import { WAYS } from '../src/sim/ways';
import { TICKS_PER_YEAR, yearOf } from '../src/sim/time';

const args = process.argv.slice(2);
const get = (k: string, d: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const seed = Number(get('--seed', '1')), years = Number(get('--years', '20'));
const s = new Sim(generateWorld({ ...DEFAULT_PARAMS, seed, size: 128 }));
const shown = new Set<number>();
const show = () => {
  for (const c of s.camps) if (!shown.has(c.id)) {
    shown.add(c.id);
    console.log(`  y${yearOf(c.founded)} ${c.name} founded${c.parent >= 0 ? ` from ${s.campById(c.parent)?.name}` : ''}: ${(c.ways ?? []).map((w) => WAYS[w.kind].text).join('; ') || 'no customs'}`);
  }
};
let seen = 0;
const end = years * TICKS_PER_YEAR;
while (s.tick < end) {
  s.step();
  if (s.tick % 500 === 0) {
    show();
    for (; seen < s.events.length; seen++) {
      const e = s.events[seen];
      if (['way', 'way_drift', 'way_habit', 'rule', 'rule_end', 'theft', 'exile'].includes(e.kind)) console.log(`  y${yearOf(e.tick)} [${e.kind}] ${e.text}`);
    }
  }
}
show();
console.log(`seed ${seed}, ${years} years:`);
for (const c of s.liveCamps()) console.log(`  ${c.name} (${s.members(c).length}): ${(c.ways ?? []).map((w) => `${WAYS[w.kind].text} [${w.why}]`).join('; ') || 'no customs'}`);
console.log(`  stats: kills ${s.stats.kills}, deaths ${s.stats.deaths}, peak ${s.stats.peak}`);
