// Long-run balance survey: runs one world for many years and writes a JSON record of how it went, year by year
// (people, food, deaths and their causes, game, wolves, dogs, what was discovered and when, how people spent
// their days). Run it over many seeds and read them together with tools/longrun-report.ts.
// Usage: npx tsx tools/longrun.ts --seed 7 [--years 20] [--size 128] [--out dir]
import { writeFileSync, mkdirSync } from 'node:fs';
import { generateWorld } from '../src/sim/worldgen';
import { DEFAULT_PARAMS } from '../src/sim/types';
import { Sim } from '../src/sim/sim';
import { foodTotal, FOODS } from '../src/sim/band';
import { TICKS_PER_YEAR, TICKS_PER_DAY, TICKS_PER_SEASON, seasonOf, yearOf, isDark } from '../src/sim/time';

const args = process.argv.slice(2);
const get = (k: string, d: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const seed = Number(get('--seed', '1'));
const years = Number(get('--years', '20'));
const size = Number(get('--size', '128'));
const out = get('--out', '');

const t0 = performance.now();
const sim = new Sim(generateWorld({ ...DEFAULT_PARAMS, seed, size }));
const end = sim.tick + years * TICKS_PER_YEAR;

type Year = Record<string, any>;
const yearsOut: Year[] = [];
const fresh = (): Year => ({
  deaths: {} as Record<string, number>, deathAges: [] as number[], births: 0,
  samples: 0, hungry: 0, peckish: 0, cold: 0, sick: 0,
  tasks: {} as Record<string, number>, winterLow: Infinity, woodIn: [] as number[], woodLow: Infinity, fireOut: 0, rationedBands: 0, bandDays: 0,
});
let cur = fresh();
const kill = sim.kill.bind(sim);
sim.kill = (p, cause, killer) => {
  if (p.alive) {
    cur.deaths[cause] = (cur.deaths[cause] ?? 0) + 1;
    cur.deathAges.push(Math.round(sim.age(p)));
  }
  return kill(p, cause, killer);
};
const sum = (a: ArrayLike<number>) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; };
const ledger = () => {
  const t: Record<string, number> = {};
  for (const c of sim.camps) for (const [k, v] of Object.entries(c.ledger?.total ?? {})) t[k] = (t[k] ?? 0) + v;
  return t;
};
let lastLedger = ledger();
let lastBirths = sim.stats.births;
let lastBoar = 0;
let lastKills = sim.stats.kills, lastWolfKills = sim.stats.wolfKills;
const rationedThisWinter = new Set<number>();
let lastYear = yearOf(sim.tick);

const closeYear = (y: number) => {
  const L = ledger();
  const flow: Record<string, number> = {};
  for (const [k, v] of Object.entries(L)) { const d = v - (lastLedger[k] ?? 0); if (d > 0.5) flow[k] = Math.round(d); }
  lastLedger = L;
  const live = sim.living();
  const camps = sim.liveCamps();
  const adults = live.filter((p) => sim.age(p) >= 14);
  yearsOut.push({
    year: y,
    pop: live.length,
    kids: live.filter((p) => sim.age(p) < 14).length,
    elders: live.filter((p) => sim.age(p) >= 55).length,
    adults: adults.length,
    bands: camps.length,
    bandSizes: camps.map((c) => sim.members(c).length),
    births: sim.stats.births - lastBirths,
    deaths: cur.deaths,
    deathAges: cur.deathAges,
    hungry: cur.samples ? cur.hungry / cur.samples : 0,
    peckish: cur.samples ? cur.peckish / cur.samples : 0,
    cold: cur.samples ? cur.cold / cur.samples : 0,
    sick: cur.samples ? cur.sick / cur.samples : 0,
    winterLow: cur.winterLow === Infinity ? null : +cur.winterLow.toFixed(1),
    // firewood each band had laid in as winter came, the least any band had through the winter, and band-nights the fire was out
    woodIn: cur.woodIn, woodLow: cur.woodLow === Infinity ? null : Math.round(cur.woodLow), fireOut: cur.fireOut,
    rationedBands: rationedThisWinter.size,
    foodDays: camps.map((c) => +(foodTotal(c.stock) / Math.max(1, sim.members(c).length * 1.8)).toFixed(1)),
    wood: camps.map((c) => Math.round(c.stock.wood)),
    flow,
    deer: sim.deer.filter((d) => d.alive).length,
    wolves: sim.wolves.filter((w) => w.alive).length,
    packs: sim.packs.length,
    game: +(sum(sim.game) / Math.max(1, sum(sim.gameCap))).toFixed(3),
    fish: +(sum(sim.fish) / Math.max(1, sum(sim.fishCap))).toFixed(3),
    // the fishing places within a walk of the camps (the whole map's water hides what the bands have fished down)
    fishNear: (() => { let f = 0, cap = 0; for (let i = 0; i < sim.fishCap.length; i++) { if (!sim.fishCap[i]) continue; const x = (i % sim.N) + 0.5, z = Math.floor(i / sim.N) + 0.5; if (camps.some((c) => Math.hypot(c.x - x, c.z - z) < 28)) { f += sim.fish[i]; cap += sim.fishCap[i]; } } return cap ? +(f / cap).toFixed(3) : null; })(),
    trees: sum(sim.treesOnTile),
    dogs: live.filter((p) => p.dog !== undefined).length,
    dogBands: camps.filter((c) => c.knows.includes('dogs')).length,
    kills: sim.stats.kills - lastKills,
    wolfKills: sim.stats.wolfKills - lastWolfKills,
    tasks: cur.tasks,
    homes: sim.buildings.filter((b) => b.built && (b.kind === 'hut' || b.kind === 'leanto')).length,
    buildings: sim.buildings.filter((b) => b.built).reduce((o: Record<string, number>, b) => ((o[b.kind] = (o[b.kind] ?? 0) + 1), o), {}),
    famine: camps.filter((c) => c.famine).length,
    lean: sim.blightYear === y, plenty: sim.plentyYear === y, bitter: sim.events.some((e) => yearOf(e.tick) === y && e.kind === 'winter' && e.text.includes('bitter')),
    // wild boar, foxes and beavers, where the world has them
    beasts: ((sim as any).beasts ?? []).filter((b: any) => b.alive).reduce((o: number[], b: any) => ((o[b.kind] = (o[b.kind] ?? 0) + 1), o), [0, 0, 0]),
    boarKills: ((sim.stats as any).boarKills ?? 0) - lastBoar,
    furs: camps.reduce((a, c) => a + ((c.stock as any).furs ?? 0), 0),
    furCloaks: sim.items.filter((i: any) => i.kind === 'furcloak').length,
  });
  lastBoar = (sim.stats as any).boarKills ?? 0;
  lastBirths = sim.stats.births; lastKills = sim.stats.kills; lastWolfKills = sim.stats.wolfKills;
  cur = fresh();
  rationedThisWinter.clear();
};

while (sim.tick < end) {
  sim.step();
  const y = yearOf(sim.tick);
  if (y !== lastYear) { closeYear(lastYear); lastYear = y; if (!sim.living().length) break; }
  if (sim.tick % 10) continue;
  const dark = isDark(sim.tick);
  for (const p of sim.people) {
    if (!p.alive) continue;
    const age = sim.age(p);
    if (age >= 2) {
      cur.samples++;
      if (p.food < 8) cur.hungry++;
      if (p.food < 35) cur.peckish++;
      if (p.warmth < 22) cur.cold++;
      if (p.sick) cur.sick++;
    }
    if (age >= 14 && !dark) { const k = p.task?.kind ?? 'none'; cur.tasks[k] = (cur.tasks[k] ?? 0) + 1; }
  }
  if (sim.tick % TICKS_PER_DAY) continue;
  for (const c of sim.liveCamps()) {
    const n = sim.members(c).length;
    if (!n || sim.tick - c.founded < 5 * TICKS_PER_DAY) continue;
    if (seasonOf(sim.tick) !== 3) continue;
    if (sim.tick % TICKS_PER_YEAR === 3 * TICKS_PER_SEASON) cur.woodIn.push(Math.round(c.stock.wood));
    cur.woodLow = Math.min(cur.woodLow, c.stock.wood);
    if (sim.hearth(c).fuel <= 0) cur.fireOut++;
    if (c.rationing) rationedThisWinter.add(c.id);
    cur.winterLow = Math.min(cur.winterLow, foodTotal(c.stock) / (n * 1.8));
  }
}
if (sim.tick >= end && yearsOut[yearsOut.length - 1]?.year !== yearOf(sim.tick)) closeYear(yearOf(sim.tick));

// when each thing was first found anywhere, and by how many bands it was known in the end
const found: Record<string, number> = {};
for (const c of sim.camps) for (const l of c.learned ?? []) if (l.how === 'found') found[l.k] = Math.min(found[l.k] ?? Infinity, +((l.tick - sim.camps[0].founded) / TICKS_PER_YEAR).toFixed(2));
const known: Record<string, number> = {};
for (const c of sim.liveCamps()) for (const k of c.knows) known[k] = (known[k] ?? 0) + 1;
const rec = {
  seed, years, ms: Math.round(performance.now() - t0), foods: FOODS,
  final: { pop: sim.living().length, peak: sim.stats.peak, bands: sim.liveCamps().length, everBands: sim.camps.length },
  found, known, yearly: yearsOut,
  events: sim.events.filter((e) => e.weight >= 2).map((e) => `y${yearOf(e.tick)} ${e.text}`),
};
if (out) { mkdirSync(out, { recursive: true }); writeFileSync(`${out}/seed-${seed}.json`, JSON.stringify(rec)); }
console.log(`seed ${seed}: pop ${rec.final.pop} peak ${rec.final.peak} bands ${rec.final.bands}/${rec.final.everBands} ${(rec.ms / 1000).toFixed(0)}s`);
