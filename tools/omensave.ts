// Saves for looking at the omens in the real page: a band a few years on, with a white deer grazing near camp,
// beliefs and a custom of its own, and a sight in the sky under way at the right hour for it. One save for each
// sight; load them with tools/omenshots.mjs.
// Usage: npx tsx tools/omensave.ts <outdir> [--seed 4471] [--years 4]
import { writeFileSync, mkdirSync } from 'node:fs';
import { generateWorld } from '../src/sim/worldgen';
import { DEFAULT_PARAMS, T } from '../src/sim/types';
import { Sim } from '../src/sim/sim';
import { TICKS_PER_YEAR, TICKS_PER_DAY, TICKS_PER_HOUR } from '../src/sim/time';
import type { SkyKind } from '../src/sim/omen';

const args = process.argv.slice(2);
const out = args[0] && !args[0].startsWith('--') ? args[0] : 'shots';
const get = (k: string, d: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const seed = Number(get('--seed', '4471')), years = Number(get('--years', '4'));
mkdirSync(out, { recursive: true });
const world = generateWorld({ ...DEFAULT_PARAMS, seed, size: 128 });
const s = new Sim(world);
const end = s.tick - (s.tick % TICKS_PER_YEAR) + years * TICKS_PER_YEAR;
while (s.tick < end) s.step();
const c = s.camp;
// a white doe brought to graze just outside camp
const doe = s.deer.filter((d) => d.alive && !d.fawn && world.terrain[Math.floor(d.z) * world.params.size + Math.floor(d.x)] === T.Grass).sort((a, b) => Math.hypot(a.x - c.x, a.z - c.z) - Math.hypot(b.x - c.x, b.z - c.z))[0];
if (doe) doe.white = true;
// beliefs and a custom of the band's own
const grown = s.members(c).filter((p) => s.age(p) >= 14);
c.lore = [
  { key: 'white_deer:good', sign: 'white_deer', good: true, of: 'a great hunt', since: s.tick - TICKS_PER_YEAR * 3, by: grown[0].id, origin: c.name, held: s.tick - TICKS_PER_YEAR * 2, proven: 2, lastTrue: s.tick - TICKS_PER_YEAR, day: 6, season: 0 },
  { key: 'eclipse:bad', sign: 'eclipse', good: false, of: 'a death', since: s.tick - TICKS_PER_YEAR * 2, by: grown[1].id, origin: c.name, proven: 1, lastTrue: s.tick - TICKS_PER_YEAR * 2, day: 20, season: 1 },
];
for (const p of grown) p.beliefs = ['white_deer:good'];
for (const p of grown.slice(0, 3)) p.beliefs!.push('eclipse:bad');
c.customs = [{ kind: 'spare_white', from: 'white_deer:good', since: s.tick - TICKS_PER_YEAR, text: 'No one may hunt a white deer' }];
// on to the hour each sight wants, and save it under way
const at = (hour: number) => {
  const day = Math.floor(s.tick / TICKS_PER_DAY) + 1;
  return day * TICKS_PER_DAY + hour * TICKS_PER_HOUR;
};
// a plain morning first, for the white deer and the band panel
{
  const t = at(10);
  while (s.tick < t) s.step();
  writeFileSync(`${out}/omen-day.json`, JSON.stringify(s.serialize()));
}
const sights: [SkyKind, number][] = [['eclipse', 12], ['blood_moon', 22], ['comet', 21], ['lights', 22]];
for (const [kind, hour] of sights) {
  const t = at(hour);
  while (s.tick < t) s.step();
  s.sky = { kind, from: s.tick - 2, until: s.tick + TICKS_PER_HOUR * 3, told: true };
  writeFileSync(`${out}/omen-${kind}.json`, JSON.stringify(s.serialize()));
  console.log(`${out}/omen-${kind}.json`, `year ${Math.floor(s.tick / TICKS_PER_YEAR) + 1}, ${kind}, white deer ${doe ? `at ${doe.x.toFixed(1)},${doe.z.toFixed(1)}` : 'none'}, camp ${c.x},${c.z}`);
}
