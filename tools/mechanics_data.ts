// Runs one band for decades and records what the "how it works" pages show.
// Usage: npx tsx tools/mechanics_data.ts <out.json> [seed=3] [years=80]
import { writeFileSync } from 'node:fs';
import { generateWorld } from '../src/sim/worldgen';
import { DEFAULT_PARAMS, WATER } from '../src/sim/types';
import { Sim, isTreeType, treeStage } from '../src/sim/sim';
import { foodTotal } from '../src/sim/band';
import { TICKS_PER_DAY, TICKS_PER_YEAR, TICKS_PER_SEASON, TICKS_PER_HOUR, yearOf, seasonOf, hourOf, dayOf, DAYS_PER_YEAR } from '../src/sim/time';

const out = process.argv[2] ?? 'mechanics.json';
const seed = Number(process.argv[3] ?? 3);
const years = Number(process.argv[4] ?? 80);
const world = generateWorld({ ...DEFAULT_PARAMS, seed });
const sim = new Sim(world);
const N = sim.N;

const yearly: Record<string, number | string>[] = [];
const seasonal: Record<string, number>[] = [];
// what adults are doing at each hour of the day: [season][hour][task] -> count
const hourly: Record<string, number>[][] = [0, 1, 2, 3].map(() => Array.from({ length: 24 }, () => ({})));
const pyramids: Record<string, { m: number[]; f: number[] }> = {};
const days: Record<string, { name: string; age: number; spans: [number, string, string][] }[]> = {};
let deathsThisYear: Record<string, number> = {};
let lastDeaths = 0, lastBirths = 0, lastKills = 0, lastFelled = 0;
let woodIn = 0, foodIn = { meat: 0, fish: 0, berries: 0 }, burned = 0;
const dayPlan = [{ key: 'summer', year: 10, day: 20 }, { key: 'winter', year: 10, day: 41 }];
let tracking: { key: string; ids: number[]; cur: Map<number, string> } | null = null;

const ring = () => {
  let near = 0, mid = 0, young = 0, all = 0;
  for (let k = 0; k < sim.propCount; k++) {
    if (!sim.propAlive[k] || !isTreeType(sim.propType[k])) continue;
    all++;
    const d = Math.hypot(sim.propX[k] - sim.camp.x, sim.propZ[k] - sim.camp.z);
    if (treeStage(sim.propType[k]) >= 2) { if (d < 26) near++; else if (d < 48) mid++; } else if (d < 26) young++;
  }
  return { near, mid, young, all };
};

while (sim.tick < years * TICKS_PER_YEAR && sim.living().length) {
  const st = sim.camp.stock;
  const before = { meat: st.meat, fish: st.fish, berries: st.berries, wood: st.wood, fuel: sim.hearth().fuel };
  sim.step();
  const t = sim.tick;
  // flows (a rough split: increases are deliveries, decreases at the hearth are burning)
  if (st.wood > before.wood) woodIn += st.wood - before.wood;
  for (const k of ['meat', 'fish', 'berries'] as const) if (st[k] > before[k]) foodIn[k] += st[k] - before[k];
  if (sim.hearth().fuel < before.fuel) burned += before.fuel - sim.hearth().fuel;
  for (const p of sim.people) if (!p.alive && p.death === t) deathsThisYear[p.cause] = (deathsThisYear[p.cause] ?? 0) + 1;
  // the hour-by-hour activity profile, years 6-15
  const y = yearOf(t);
  if (y >= 6 && y <= 15 && t % TICKS_PER_HOUR === 0) {
    const h = hourly[seasonOf(t)][Math.floor(hourOf(t))];
    for (const p of sim.living()) {
      if (sim.age(p) < 14) continue;
      const k = p.task?.kind ?? 'idle';
      h[k] = (h[k] ?? 0) + 1;
    }
  }
  // a day in the life of five adults
  for (const plan of dayPlan) {
    const startT = (plan.year - 1) * TICKS_PER_YEAR + plan.day * TICKS_PER_DAY;
    if (t === startT) {
      const adults = sim.living().filter((p) => sim.age(p) >= 15).sort((a, b) => a.id - b.id).slice(0, 5);
      tracking = { key: plan.key, ids: adults.map((p) => p.id), cur: new Map() };
      days[plan.key] = adults.map((p) => ({ name: p.name, age: Math.floor(sim.age(p)), spans: [] }));
    }
    if (tracking && tracking.key === plan.key && t >= startT && t < startT + TICKS_PER_DAY) {
      tracking.ids.forEach((id, i) => {
        const p = sim.byId.get(id)!;
        const k = p.alive ? p.task?.kind ?? 'idle' : 'dead';
        if (tracking!.cur.get(id) !== k) {
          tracking!.cur.set(id, k);
          days[plan.key][i].spans.push([t - startT, k, p.thought]);
        }
      });
    }
  }
  if (t % TICKS_PER_SEASON === 0) {
    const r = ring();
    let fishLeft = 0, fishCap = 0;
    for (let i = 0; i < sim.fish.length; i++) { fishLeft += sim.fish[i]; fishCap += sim.fishCap[i]; }
    seasonal.push({
      t: t / TICKS_PER_YEAR, pop: sim.living().length, food: Math.round(foodTotal(st)), meat: Math.round(st.meat), fish: Math.round(st.fish),
      berries: Math.round(st.berries), preserved: Math.round(st.preserved), wood: Math.round(st.wood), woodIn: Math.round(woodIn), burned: Math.round(burned),
      inMeat: Math.round(foodIn.meat), inFish: Math.round(foodIn.fish), inBerries: Math.round(foodIn.berries),
      felled: sim.stats.felled - lastFelled, kills: sim.stats.kills - lastKills, deadwood: sim.deadwoodTaken.size,
      jobFood: +(sim.camp.jobs.food ?? 0).toFixed(2), jobWood: +(sim.camp.jobs.wood ?? 0).toFixed(2),
      matureNear: r.near, matureMid: r.mid, youngNear: r.young, fishPct: Math.round((fishLeft / fishCap) * 100),
      deer: sim.deer.filter((d) => d.alive).length,
    });
    lastFelled = sim.stats.felled; lastKills = sim.stats.kills; woodIn = 0; burned = 0; foodIn = { meat: 0, fish: 0, berries: 0 };
  }
  if (t % TICKS_PER_YEAR === 0) {
    const L = sim.living();
    yearly.push({
      year: yearOf(t) - 1, pop: L.length, births: sim.stats.births - lastBirths, deaths: sim.stats.deaths - lastDeaths,
      children: L.filter((p) => sim.age(p) < 14).length, elders: L.filter((p) => sim.age(p) >= 55).length,
      couples: L.filter((p) => p.partner >= 0).length / 2, homes: sim.buildings.filter((b) => b.built && (b.kind === 'hut' || b.kind === 'leanto')).length,
      ...Object.fromEntries(Object.entries(deathsThisYear).map(([k, v]) => [`d_${k}`, v])),
      treesAll: ring().all,
    });
    lastBirths = sim.stats.births; lastDeaths = sim.stats.deaths; deathsThisYear = {};
    const yr = yearOf(t) - 1;
    if (yr === 20 || yr === 50 || yr === 80) {
      const pyr = { m: Array(18).fill(0), f: Array(18).fill(0) };
      for (const p of L) (p.sex === 1 ? pyr.m : pyr.f)[Math.min(17, Math.floor(sim.age(p) / 5))]++;
      pyramids[yr] = pyr;
    }
  }
}

// the land, as bytes for the page to paint
const b64 = (a: ArrayLike<number>) => Buffer.from(Uint8Array.from(a as number[])).toString('base64');
const land = {
  size: N, seed,
  terrain: b64(world.terrain), level: b64(world.level), water: b64(world.water),
  moisture: b64(world.moisture), fertility: b64(world.fertility),
  camp: [sim.camp.x, sim.camp.z],
};
const events = sim.events.filter((e) => e.weight >= 3).map((e) => ({ y: +(e.tick / TICKS_PER_YEAR).toFixed(2), kind: e.kind, text: e.text, w: e.weight }));
const kinds: Record<string, number> = {};
for (const e of sim.events) kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
const people = sim.people.map((p) => ({ born: +(p.birth / TICKS_PER_YEAR).toFixed(2), died: p.alive ? null : +(p.death / TICKS_PER_YEAR).toFixed(2), cause: p.cause || null, sex: p.sex }));
writeFileSync(out, JSON.stringify({ seed, years, camp: sim.camp.name, yearly, seasonal, hourly, pyramids, days, events, kinds, people, land, stats: sim.stats, dayTicks: TICKS_PER_DAY, daysPerYear: DAYS_PER_YEAR }));
console.log(`seed ${seed}: ${yearly.length} years, ${events.length} big events, ${people.length} people ever -> ${out}`);
void dayOf; void WATER;
