import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
page.setDefaultTimeout(120000); // software rendering on a busy machine can be slow
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && /Shader Error|WebGL|THREE\./.test(m.text())) errs.push(m.text().slice(0, 300)); });
await page.goto(`${process.env.URL ?? 'http://localhost:4173/index.html'}#w4471-128`);
await page.waitForSelector('#ui > .loading.done', { timeout: 120000 });
await page.evaluate(() => window.__lw.setSpeed(100));
await page.waitForTimeout(40000);
await page.evaluate(() => window.__lw.setPaused(true));
await page.waitForTimeout(1500);
const kinds = { stump: [56, 58], logs: [59, 60], grave: [61, 62], tree: [0, 35], berry: [39, 41] };
const refs = await page.evaluate((kinds) => {
  const e = window.__lw, st = e.propState, w = e.snap.world;
  const out = [];
  for (const [name, [a, b]] of Object.entries(kinds)) {
    for (let k = st.count - 1; k >= 0; k--) if (st.alive[k] && st.type[k] >= a && st.type[k] <= b) { out.push([name, { kind: 'prop', id: k }]); break; }
  }
  const lake = [...Array(w.size * w.size).keys()].find((i) => w.water[i] === 2) ?? [...Array(w.size * w.size).keys()].find((i) => w.water[i] === 3);
  out.push(['water', { kind: 'tile', id: lake }]);
  const d = e.view.band.visibleDeer[0];
  if (d) out.push(['deer', { kind: 'deer', id: d.id }]);
  return out;
}, kinds);
for (const [name, ref] of refs) {
  await page.evaluate((ref) => window.__lw.selectRef(ref), ref);
  await page.waitForTimeout(1200);
  const c = await page.evaluate(() => window.__lw.snap.card);
  console.log(`\n[${name}] ${c?.title} — ${c?.subtitle}`);
  for (const l of c?.lines ?? []) console.log(`   ${l.label}: ${l.value}${l.ref ? ' →' + l.ref.kind : ''}`);
  for (const n of c?.notes ?? []) console.log(`   “${n}”`);
}
console.log('\nyear', await page.evaluate(() => Math.floor(window.__lw.snap.tick / 11520) + 1), 'errors', errs.slice(0, 3));
await browser.close();
