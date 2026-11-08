// Reads the records tools/longrun.ts wrote and sums them up across seeds, in five-year spans.
// Usage: npx tsx tools/longrun-report.ts dir [--span 5]
import { readdirSync, readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const dir = args[0];
const span = Number(args.includes('--span') ? args[args.indexOf('--span') + 1] : 5);
const recs = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')));
recs.sort((a, b) => a.seed - b.seed);
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const f1 = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : '-');

console.log(`${recs.length} worlds`);
console.log('\nper seed: final pop / peak / bands now (ever) / deaths by cause / dogs at end / extinct year');
for (const r of recs) {
  const d: Record<string, number> = {};
  for (const y of r.yearly) for (const [k, v] of Object.entries(y.deaths as Record<string, number>)) d[k] = (d[k] ?? 0) + v;
  const last = r.yearly[r.yearly.length - 1];
  const extinct = r.yearly.find((y: any) => y.pop === 0)?.year;
  console.log(`  seed ${String(r.seed).padStart(2)}: pop ${String(r.final.pop).padStart(3)} peak ${String(r.final.peak).padStart(3)} bands ${r.final.bands} (${r.final.everBands})  dogs ${last?.dogs ?? 0}  ${Object.entries(d).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}${extinct !== undefined ? `  EXTINCT y${extinct}` : ''}`);
}

const maxY = Math.max(...recs.map((r) => r.yearly.length));
console.log(`\nby span of ${span} years (averaged over worlds still living)`);
for (let s = 0; s < maxY; s += span) {
  const ys = recs.flatMap((r) => r.yearly.slice(s, s + span)).filter((y: any) => y.pop > 0);
  if (!ys.length) continue;
  const deaths: Record<string, number> = {};
  for (const y of ys) for (const [k, v] of Object.entries(y.deaths as Record<string, number>)) deaths[k] = (deaths[k] ?? 0) + v;
  const pop = avg(ys.map((y: any) => y.pop));
  const births = avg(ys.map((y: any) => y.births));
  const nd = Object.values(deaths).reduce((a, b) => a + b, 0) / ys.length;
  const lows = ys.map((y: any) => y.winterLow).filter((x: any) => x !== null);
  console.log(`  years ${s}-${s + span - 1}: pop ${f1(pop)} (kids ${f1(avg(ys.map((y: any) => y.kids)))}, elders ${f1(avg(ys.map((y: any) => y.elders)))}) bands ${f1(avg(ys.map((y: any) => y.bands)))}  births/yr ${f1(births)} deaths/yr ${f1(nd)}  per 100 people: births ${f1(births / pop * 100)} deaths ${f1(nd / pop * 100)}`);
  console.log(`      hungry ${pct(avg(ys.map((y: any) => y.hungry)))} peckish ${pct(avg(ys.map((y: any) => y.peckish)))} cold ${pct(avg(ys.map((y: any) => y.cold)))} sick ${pct(avg(ys.map((y: any) => y.sick)))}  winter low stores median ${f1(med(lows))} days (worst ${f1(Math.min(...lows))}); rationing ${f1(avg(ys.map((y: any) => y.rationedBands / Math.max(1, y.bands))) * 100)}% of band-winters; famine ${f1(avg(ys.map((y: any) => y.famine)))}`);
  console.log(`      deer ${f1(avg(ys.map((y: any) => y.deer)))} wolves ${f1(avg(ys.map((y: any) => y.wolves)))} hares ${pct(avg(ys.map((y: any) => y.game)))} fish ${pct(avg(ys.map((y: any) => y.fish)))} (near camps ${pct(avg(ys.map((y: any) => y.fishNear ?? NaN).filter((x: number) => !Number.isNaN(x))))}) trees ${f1(avg(ys.map((y: any) => y.trees)))}  kills/yr ${f1(avg(ys.map((y: any) => y.kills)))} wolf kills/yr ${f1(avg(ys.map((y: any) => y.wolfKills)))}  dogs ${f1(avg(ys.map((y: any) => y.dogs)))} (worlds with dogs ${pct(ys.filter((y: any) => y.dogs > 0).length / ys.length)})`);
  if (ys[0].woodIn) {
    const wi = ys.flatMap((y: any) => y.woodIn);
    console.log(`      firewood laid in as winter came: median ${f1(med(wi))}, under 40 in ${pct(wi.filter((w: number) => w < 40).length / Math.max(1, wi.length))} of band-winters; fire out ${f1(avg(ys.map((y: any) => y.fireOut)))} band-days a winter`);
  }
  if (ys[0].beasts) console.log(`      boar ${f1(avg(ys.map((y: any) => y.beasts[0])))} foxes ${f1(avg(ys.map((y: any) => y.beasts[1])))} beavers ${f1(avg(ys.map((y: any) => y.beasts[2])))}  boar kills/yr ${f1(avg(ys.map((y: any) => y.boarKills)))}  pelts in store ${f1(avg(ys.map((y: any) => y.furs)))} fur cloaks ${f1(avg(ys.map((y: any) => y.furCloaks)))}`);
  console.log(`      deaths: ${Object.entries(deaths).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${f1(v / ys.length)}`).join(', ')}`);
  // where the food came from, per person per year
  const fl: Record<string, number> = {};
  for (const y of ys) for (const [k, v] of Object.entries(y.flow as Record<string, number>)) fl[k] = (fl[k] ?? 0) + v / Math.max(1, y.pop);
  const g = Object.entries(fl).filter(([k]) => k.startsWith('gathered.')).sort((a, b) => b[1] - a[1]);
  console.log(`      gathered per head/yr: ${g.map(([k, v]) => `${k.slice(9)} ${f1(v / ys.length)}`).join(', ')}`);
  const o = Object.entries(fl).filter(([k]) => !k.startsWith('gathered.')).sort((a, b) => b[1] - a[1]);
  console.log(`      other flows per head/yr: ${o.map(([k, v]) => `${k} ${f1(v / ys.length)}`).join(', ')}`);
  const tasks: Record<string, number> = {};
  for (const y of ys) { const t = Object.values(y.tasks as Record<string, number>).reduce((a, b) => a + b, 0); for (const [k, v] of Object.entries(y.tasks as Record<string, number>)) tasks[k] = (tasks[k] ?? 0) + v / Math.max(1, t) / ys.length; }
  console.log(`      adults' daytime: ${Object.entries(tasks).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${pct(v)}`).join(', ')}`);
}

// how the hard years went, against the rest (after the first three years)
{
  const all = recs.flatMap((r) => r.yearly.slice(3)).filter((y: any) => y.pop > 0 && y.lean !== undefined);
  const row = (name: string, ys: any[]) => {
    const d = ys.map((y) => Object.entries(y.deaths as Record<string, number>).filter(([k]) => k === 'starvation' || k === 'cold').reduce((a, [, v]) => a + v, 0));
    console.log(`  ${name.padEnd(14)} ${String(ys.length).padStart(3)} world-years: rationing ${pct(avg(ys.map((y) => y.rationedBands / Math.max(1, y.bands))))} of bands, hungry ${pct(avg(ys.map((y) => y.hungry)))}, peckish ${pct(avg(ys.map((y) => y.peckish)))}, winter low ${f1(med(ys.map((y) => y.winterLow).filter((x) => x !== null)))} days, hunger+cold deaths ${f1(avg(d) * 100)} per 100 world-years`);
  };
  if (all.length) {
    console.log('\nhard years and the rest (from year 3)');
    row('lean year', all.filter((y: any) => y.lean));
    row('bitter winter', all.filter((y: any) => y.bitter && !y.lean));
    row('plenty', all.filter((y: any) => y.plenty));
    row('ordinary', all.filter((y: any) => !y.lean && !y.bitter && !y.plenty));
  }
}
console.log('\ndiscoveries: worlds that found it (any band), median and range of the year it was first found');
const keys = new Set<string>(recs.flatMap((r) => Object.keys(r.found)));
for (const k of [...keys].sort((a, b) => med(recs.map((r) => r.found[a] ?? 99)) - med(recs.map((r) => r.found[b] ?? 99)))) {
  const ts = recs.map((r) => r.found[k]).filter((x) => x !== undefined) as number[];
  console.log(`  ${k.padEnd(14)} ${String(ts.length).padStart(2)}/${recs.length}  median y${f1(med(ts))}  (${f1(Math.min(...ts))}-${f1(Math.max(...ts))})`);
}
const never = recs.length ? Object.keys(recs[0].known ?? {}).filter((k) => !keys.has(k)) : [];
if (never.length) console.log(`  known from the start: ${never.join(', ')}`);
