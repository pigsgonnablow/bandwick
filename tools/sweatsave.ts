// Saves for looking at the sweat lodge in the real page: a band a few years on with a lodge standing by camp, one
// save on a winter's day with the lodge cold, and one on a winter evening with the stones hot and people inside it.
// Load them with tools/sweatshots.mjs.
// Usage: npx tsx tools/sweatsave.ts <outdir> [--seed 4471] [--years 3]
import { writeFileSync, mkdirSync } from 'node:fs';
import { generateWorld } from '../src/sim/worldgen';
import { DEFAULT_PARAMS } from '../src/sim/types';
import { Sim } from '../src/sim/sim';
import { completeBuilding, setup, abandon } from '../src/sim/ai';
import { TICKS_PER_YEAR, TICKS_PER_DAY, seasonOf, hourOf } from '../src/sim/time';

const args = process.argv.slice(2);
const out = args[0] && !args[0].startsWith('--') ? args[0] : 'shots';
const get = (k: string, d: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const seed = Number(get('--seed', '4471')), years = Number(get('--years', '3'));
mkdirSync(out, { recursive: true });
const s = new Sim(generateWorld({ ...DEFAULT_PARAMS, seed, size: 128 }));
const end = s.tick - (s.tick % TICKS_PER_YEAR) + years * TICKS_PER_YEAR;
while (s.tick < end) s.step();
const c = s.camp;
for (const k of ['huts', 'herbs', 'sweat']) if (!c.knows.includes(k)) c.knows.push(k);
c.stock.wood += 60;
c.stock.hides += 4;
// the lodge planned in the morning, and raised at once
while (!s.buildings.some((b) => b.band === c.id && b.kind === 'sweat')) s.step();
const lodge = s.buildings.find((b) => b.band === c.id && b.kind === 'sweat')!;
completeBuilding(s, lodge, s.members(c)[0]);
// on to the winter: a cold lodge by day, then the first evening it is hot with people in it
while (seasonOf(s.tick) !== 3) s.step();
while (hourOf(s.tick) < 11 || hourOf(s.tick) > 12) s.step();
writeFileSync(`${out}/sweat-day.json`, JSON.stringify(s.serialize()));
const limit = s.tick + 40 * TICKS_PER_DAY;
while (s.tick < limit) {
  s.step();
  const inside = s.members(c).filter((p) => p.task?.kind === 'sweat' && p.indoors).length;
  if (s.lodgeHot(lodge) && inside >= 2 && hourOf(s.tick) < 20.5) break;
}
console.log('lodge at', lodge.x, lodge.z, 'hot', s.lodgeHot(lodge), 'hour', hourOf(s.tick).toFixed(1), 'inside', s.members(c).filter((p) => p.task?.kind === 'sweat' && p.indoors).map((p) => p.name));
writeFileSync(`${out}/sweat-evening.json`, JSON.stringify(s.serialize()));
// and by day, the stones hot and a few of the band sent in (as a sign they hold would send them), to see it steam
while (hourOf(s.tick) < 12 || hourOf(s.tick) > 13) s.step();
lodge.hot = s.tick + 60;
for (const p of s.members(c).filter((q) => s.age(q) >= 16 && q.sick === 0).slice(0, 4)) { abandon(s, p); p.task = setup(s, p, 'sweat'); }
for (let k = 0; k < 120 && s.members(c).filter((p) => p.task?.kind === 'sweat' && p.indoors).length < 2; k++) s.step();
console.log('by day: inside', s.members(c).filter((p) => p.task?.kind === 'sweat' && p.indoors).map((p) => p.name));
writeFileSync(`${out}/sweat-noon.json`, JSON.stringify(s.serialize()));
