// Close-ups of the models in the real renderer, and a frame-by-frame strip of someone walking.
// Usage: node tools/closeup.mjs <outdir>   (start `npm run preview` first, or set URL=)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const out = process.argv[2] ?? 'shots';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
page.setDefaultTimeout(120000); // software rendering on a busy machine can be slow
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && /Shader Error|WebGL|THREE\./.test(m.text())) errs.push(m.text().slice(0, 300)); });
await page.goto(`${process.env.URL ?? 'http://localhost:4173/index.html'}#w4471-128`);
await page.waitForSelector('#ui > .loading.done', { timeout: 120000 });
// a year on, so there are huts, a storehouse and paths worn in
await page.evaluate(() => window.__lw.skip('season'));
await page.waitForTimeout(500);
await page.waitForFunction(() => !window.__lw.snap.skipping, null, { timeout: 300000 });
await page.evaluate(() => window.__lw.skip('season'));
await page.waitForTimeout(500);
await page.waitForFunction(() => !window.__lw.snap.skipping, null, { timeout: 300000 });
await page.evaluate(() => { const e = window.__lw; e.skip('morning'); });
await page.waitForTimeout(500);
await page.waitForFunction(() => !window.__lw.snap.skipping, null, { timeout: 300000 });
// on to mid-morning, when people are out and about
await page.evaluate(() => window.__lw.setSpeed(10));
await page.waitForFunction(() => { const t = window.__lw.snap.tick % 240; return t > 95 && t < 140; }, null, { timeout: 300000, polling: 200 });
await page.addStyleTag({ content: '#ui > *:not(.loading) { display: none !important; }' });
const shot = async (name, x, z, zoom, wait = 2500) => {
  await page.evaluate(([x, z, zoom]) => window.__lw.view.cam.frame(x, z, zoom, true), [x, z, zoom]);
  await page.waitForTimeout(wait);
  await page.screenshot({ path: `${out}/${name}.png` });
};
await page.evaluate(() => window.__lw.setSpeed(1));
const b = await page.evaluate(() => window.__lw.view.band.getBuildings().map((q) => ({ kind: q.kind, x: q.x + 0.5, z: q.z + 0.5, built: q.built })));
const seen = new Set();
for (const q of b) if (!seen.has(q.kind)) { seen.add(q.kind); await shot(`bld_${q.kind}${q.built ? '' : '_site'}`, q.x, q.z, 4.5); }
const h = b.find((q) => q.kind === 'hearth');
await shot('camp_wide', h.x, h.z, 14);
// a walker: follow someone moving, and grab frames
let id = -1;
for (let k = 0; k < 40 && id < 0; k++) {
  id = await page.evaluate(() => {
    const band = window.__lw.view.band; let best = -1;
    band.each((id, p) => { if (best < 0 && p.act === 1 && p.age > 14 && !p.indoors) best = id; });
    return best;
  });
  if (id < 0) await page.waitForTimeout(250);
}
if (id >= 0) {
  await page.evaluate((id) => { window.__lw.select(id); window.__lw.setFollow(true); window.__lw.view.cam.zoom = 4; window.__lw.view.cam.frame(0, 0, 4, false); }, id);
  await page.evaluate((id) => { const p = window.__lw.view.band.positionOf(id); window.__lw.view.cam.frame(p.x, p.z, 4, true); }, id);
  await page.waitForTimeout(1500);
  for (let k = 0; k < 10; k++) { await page.screenshot({ path: `${out}/walk_${String(k).padStart(2, '0')}.png`, clip: { x: 350, y: 180, width: 400, height: 400 } }); await page.waitForTimeout(60); }
}
// deer and a stand of trees
const d = await page.evaluate(() => { const v = window.__lw.view.band.visibleDeer[0]; return v ? { x: v.x, z: v.z } : null; });
if (d) await shot('deer', d.x, d.z, 4);
// the camp fire at night
await page.evaluate(() => window.__lw.setSpeed(30));
await page.waitForFunction(() => { const t = window.__lw.snap.tick % 240; return t > 225; }, null, { timeout: 300000, polling: 100 });
await page.evaluate(() => window.__lw.setPaused(true));
await shot('fire_night', h.x, h.z, 6, 3000);
await shot('fire_night_wide', h.x, h.z, 14, 2000);
console.log(JSON.stringify({ buildings: [...seen], walker: id, errs }));
await browser.close();
