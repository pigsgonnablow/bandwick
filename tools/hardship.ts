// How hard life is: runs bands for decades and reports how often they go hungry or cold, and what kills them.
// Usage: npx tsx tools/hardship.ts [--seeds 1,2,3] [--years 20] [--size 128]
// Aims: most bands know a hungry late winter, a few worlds lose someone to hunger or cold, no first band
// dies out in its first years, and the population still grows.
import { generateWorld } from '../src/sim/worldgen';
import { DEFAULT_PARAMS } from '../src/sim/types';
import { Sim } from '../src/sim/sim';
import { foodTotal } from '../src/sim/band';
import { TICKS_PER_YEAR, TICKS_PER_DAY, seasonOf, yearOf } from '../src/sim/time';

const args = process.argv.slice(2);
const get = (k: string, d: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const seeds = get('--seeds', '1,2,3,4,5,6,7,8,9,10').split(',').map(Number);
const years = Number(get('--years', '20'));
const size = Number(get('--size', '128'));

const causes: Record<string, number> = {};
let wornDown = 0, illness = 0, hungryWinters = 0, rationedWinters = 0, bandsRationed = 0, bands = 0, bandWinters = 0, worldsLost = 0, earlyEnd = 0, grew = 0;
for (const seed of seeds) {
  const sim = new Sim(generateWorld({ ...DEFAULT_PARAMS, seed, size }));
  const end = sim.tick + years * TICKS_PER_YEAR;
  // illness deaths, and how many of them came to people already hungry, cold or weak
  const kill = sim.kill.bind(sim);
  sim.kill = (p, cause, killer) => {
    if (p.alive && (cause === 'fever' || cause === 'sickness') && sim.age(p) >= 3) {
      illness++;
      if (p.health < 70 || p.food < 30 || p.warmth < 35) wornDown++;
    }
    return kill(p, cause, killer);
  };
  const first = sim.camps[0];
  let samples = 0, hungry = 0, peckish = 0, cold = 0, lowest = Infinity;
  const rationed = new Set<string>();
  // the leanest the stores got each winter, per band (in days of food for everyone)
  const winterLow = new Map<string, number>();
  while (sim.tick < end) {
    sim.step();
    if (sim.tick % 10) continue;
    for (const p of sim.people) {
      if (!p.alive || sim.age(p) < 2) continue;
      samples++;
      if (p.food < 8) hungry++;
      if (p.food < 35) peckish++;
      if (p.warmth < 22) cold++;
    }
    if (sim.tick % TICKS_PER_DAY) continue;
    for (const c of sim.liveCamps()) {
      const n = sim.members(c).length;
      if (!n || sim.tick - c.founded < 5 * TICKS_PER_DAY) continue;
      const days = foodTotal(c.stock) / (n * 1.8);
      lowest = Math.min(lowest, days);
      if (seasonOf(sim.tick) !== 3) continue;
      const k = `${c.id}:${yearOf(sim.tick)}`;
      if (c.rationing) rationed.add(k);
      winterLow.set(k, Math.min(winterLow.get(k) ?? Infinity, days));
    }
  }
  const dead = sim.people.filter((p) => !p.alive);
  const mine: Record<string, number> = {};
  for (const p of dead) {
    const c = p.cause ?? '?';
    causes[c] = (causes[c] ?? 0) + 1;
    mine[c] = (mine[c] ?? 0) + 1;
  }
  const lean = [...winterLow.values()].filter((d) => d < 1).length;
  hungryWinters += lean;
  rationedWinters += rationed.size;
  const ids = new Set([...winterLow.keys()].map((k) => k.split(':')[0]));
  bands += ids.size;
  bandsRationed += new Set([...rationed].map((k) => k.split(':')[0])).size;
  bandWinters += winterLow.size;
  const lost = (mine.starvation ?? 0) + (mine.cold ?? 0);
  if (lost) worldsLost++;
  const firstGone = first.gone && first.gone - first.founded < 3 * TICKS_PER_YEAR && !sim.members(first).length;
  if (firstGone) earlyEnd++;
  const pop = sim.living().length;
  if (pop > 10) grew++;
  console.log(
    `seed ${seed}: pop ${pop}, short of food ${(peckish / samples * 100).toFixed(1)}% starving ${(hungry / samples * 100).toFixed(2)}% cold ${(cold / samples * 100).toFixed(2)}% of the time, ` +
    `rationed ${rationed.size}/${winterLow.size} winters, ran out ${lean}, leanest stores ${lowest.toFixed(1)} days, ` +
    `deaths ${Object.entries(mine).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}${firstGone ? ', FIRST BAND DIED OUT EARLY' : ''}`,
  );
}
console.log(`\nwinters rationed ${rationedWinters} of ${bandWinters} band-winters; bands that ever rationed ${bandsRationed} of ${bands}; stores ran out (under a day) ${hungryWinters}`);
console.log(`worlds that lost someone to hunger or cold ${worldsLost}/${seeds.length}, first band gone early ${earlyEnd}/${seeds.length}, grew ${grew}/${seeds.length}`);
console.log(`illness deaths that came to the hungry, cold or weak ${wornDown} of ${illness}`);
console.log(`deaths: ${Object.entries(causes).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`);
