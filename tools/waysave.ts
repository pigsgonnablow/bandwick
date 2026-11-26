// Saves for looking at the bands' customs in the real page: a world some years on, with a first band and a daughter
// band that has kept some of its customs and dropped others, on a summer's day. Load it with tools/wayshots.mjs.
// Usage: npx tsx tools/waysave.ts <outdir> [--seed 1] [--years 24]
import { writeFileSync, mkdirSync } from 'node:fs';
import { generateWorld } from '../src/sim/worldgen';
import { DEFAULT_PARAMS } from '../src/sim/types';
import { Sim } from '../src/sim/sim';
import { WAYS } from '../src/sim/ways';
import { TICKS_PER_YEAR, seasonOf, hourOf } from '../src/sim/time';

const args = process.argv.slice(2);
const out = args[0] && !args[0].startsWith('--') ? args[0] : 'shots';
const get = (k: string, d: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const seed = Number(get('--seed', '1')), years = Number(get('--years', '24'));
mkdirSync(out, { recursive: true });
const s = new Sim(generateWorld({ ...DEFAULT_PARAMS, seed, size: 128 }));
const end = years * TICKS_PER_YEAR;
while (s.tick < end) s.step();
while (seasonOf(s.tick) !== 1 || hourOf(s.tick) < 11 || hourOf(s.tick) > 12) s.step();
for (const c of s.liveCamps()) console.log(c.id, c.name, s.members(c).length, (c.ways ?? []).map((w) => WAYS[w.kind].text).join('; '));
writeFileSync(`${out}/ways.json`, JSON.stringify(s.serialize()));
