// Saves for looking at the longhouse in the real page: a band a few years on with a longhouse standing by camp, one
// save on a winter's day with the hall cold, and one on the evening of the midwinter feast with its fire lit and the
// band inside. Load them with tools/longhouseshots.mjs.
// Usage: npx tsx tools/longhousesave.ts <outdir> [--seed 4471] [--years 3]
import { writeFileSync, mkdirSync } from 'node:fs';
import { generateWorld } from '../src/sim/worldgen';
import { DEFAULT_PARAMS } from '../src/sim/types';
import { Sim } from '../src/sim/sim';
import { completeBuilding } from '../src/sim/ai';
import { TICKS_PER_YEAR, TICKS_PER_DAY, seasonOf, hourOf, dayOf } from '../src/sim/time';

const args = process.argv.slice(2);
const out = args[0] && !args[0].startsWith('--') ? args[0] : 'shots';
const get = (k: string, d: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const seed = Number(get('--seed', '4471')), years = Number(get('--years', '3'));
mkdirSync(out, { recursive: true });
const s = new Sim(generateWorld({ ...DEFAULT_PARAMS, seed, size: 128 }));
const end = s.tick - (s.tick % TICKS_PER_YEAR) + years * TICKS_PER_YEAR;
while (s.tick < end) s.step();
const c = s.camp;
for (const k of ['huts', 'storehouse', 'longhouse']) if (!c.knows.includes(k)) c.knows.push(k);
c.stock.wood += 80;
c.stock.preserved += 300;
// the longhouse planned, and raised at once
while (!s.buildings.some((b) => b.band === c.id && b.kind === 'longhouse')) s.step();
const hall = s.buildings.find((b) => b.band === c.id && b.kind === 'longhouse')!;
completeBuilding(s, hall, s.members(c)[0]);
// on to the winter: the hall cold by day
while (seasonOf(s.tick) !== 3) s.step();
while (hourOf(s.tick) < 11 || hourOf(s.tick) > 12) s.step();
writeFileSync(`${out}/longhouse-day.json`, JSON.stringify(s.serialize()));
// then a feast that evening (as on the longest night), the fire lit and the band inside
while (hourOf(s.tick) < 16.5 || hourOf(s.tick) > 17) s.step();
c.feastDay = dayOf(s.tick);
const limit = s.tick + 2 * TICKS_PER_DAY;
const inside = () => s.members(c).filter((p) => s.inHall(p)).length;
while (s.tick < limit && !(s.hallLit(hall) && inside() >= Math.min(6, s.members(c).length - 2) && hourOf(s.tick) >= 18.5)) s.step();
console.log('hall at', hall.x, hall.z, 'rot', hall.rot, 'lit', s.hallLit(hall), 'hour', hourOf(s.tick).toFixed(1), 'inside', inside(), 'of', s.members(c).length);
writeFileSync(`${out}/longhouse-feast.json`, JSON.stringify(s.serialize()));
