// Clicks one of each kind of thing through the real picker and screenshots the cards.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const out = process.argv[2] ?? 'shots';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(120000); // software rendering on a busy machine can be slow
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && /Shader Error|WebGL|THREE\./.test(m.text())) errs.push(m.text().slice(0, 300)); });
await page.goto(`${process.env.URL ?? 'http://localhost:4173/index.html'}#w4471-128`);
await page.waitForSelector('#ui > .loading.done', { timeout: 120000 });
// run a season fast so there are huts, stumps and logs
await page.evaluate(() => window.__lw.skip('season'));
await page.waitForTimeout(30000);
await page.evaluate(() => { const e = window.__lw; e.setSpeed(1); e.skip('morning'); });
await page.waitForTimeout(8000);
await page.evaluate(() => { const e = window.__lw; e.setPaused(true); const h = e.view.band.getBuildings().find((b) => b.kind === 'hearth'); e.view.cam.frame(h.x + 0.5, h.z + 0.5, 11); });
await page.waitForTimeout(3000);
// find screen points for one of each kind, using the same projection the picker uses
const targets = await page.evaluate(() => {
  const e = window.__lw, w = e.snap.world, st = e.propState, band = e.view.band;
  const proj = (x, y, z) => e.view.project(x, y, z);
  const out = {};
  const r = document.querySelector('canvas').getBoundingClientRect();
  const onScreen = (p) => p.x > 360 && p.x < r.width - 340 && p.y > 140 && p.y < r.height - 120;
  const hut = band.getBuildings().find((b) => b.kind === 'hut' && b.built);
  if (hut) { const p = proj(hut.x + 0.5, w.groundY[hut.z * w.size + hut.x] + 0.22, hut.z + 0.5); if (onScreen(p)) out.hut = p; }
  const hearth = band.getBuildings().find((b) => b.kind === 'hearth');
  out.hearth = proj(hearth.x + 0.5, w.groundY[hearth.z * w.size + hearth.x] + 0.22, hearth.z + 0.5);
  const v = band.visible.find((q) => { const p = proj(q.x, q.y - 0.2, q.z); return onScreen(p); });
  if (v) out.person = proj(v.x, v.y - 0.2, v.z);
  for (let k = 0; k < st.count; k++) {
    if (!st.alive[k]) continue;
    const t = st.type[k];
    const kind = t < 36 ? 'tree' : ['stump_v0', 'stump_v1', 'stump_v2'].map((n) => window.__lw && n).length && t >= 56 && t < 59 ? 'stump' : t >= 59 && t < 61 ? 'logs' : null;
    if (!kind || out[kind]) continue;
    const p = proj(st.x[k], st.y[k] + (t < 36 ? 0.5 : 0.05), st.z[k]);
    if (onScreen(p)) out[kind] = p;
  }
  // a water tile
  for (let i = 0; i < w.size * w.size && !out.water; i++) {
    if (!w.water[i]) continue;
    const p = proj((i % w.size) + 0.5, w.waterY[i], Math.floor(i / w.size) + 0.5);
    if (onScreen(p)) out.water = p;
  }
  return out;
});
console.log('targets', Object.keys(targets).join(', '));
for (const [kind, p] of Object.entries(targets)) {
  await page.mouse.move(p.x, p.y);
  await page.waitForTimeout(700);
  const tip = await page.evaluate(() => window.__lw.snap.tip?.text);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(2500);
  const info = await page.evaluate(() => ({ sel: window.__lw.snap.sel, title: window.__lw.snap.card?.title ?? window.__lw.snap.person?.name, lines: (window.__lw.snap.card?.lines ?? []).map((l) => `${l.label}: ${l.value}`).slice(0, 4), notes: window.__lw.snap.card?.notes }));
  console.log(kind.padEnd(7), '| hover:', tip, '| card:', JSON.stringify(info));
  await page.screenshot({ path: `${out}/click_${kind}.png` });
  await page.keyboard.press('Escape');
}
// director
await page.evaluate(() => { const e = window.__lw; e.setSpeed(3); e.setDirector(true); });
await page.waitForTimeout(12000);
console.log('director caption:', await page.evaluate(() => window.__lw.snap.caption));
await page.screenshot({ path: `${out}/director.png` });
await page.mouse.move(700, 450); await page.mouse.down(); await page.mouse.move(760, 480, { steps: 6 }); await page.mouse.up();
await page.waitForTimeout(500);
console.log('after drag director =', await page.evaluate(() => window.__lw.snap.director), '| toast:', await page.evaluate(() => window.__lw.snap.toast));
console.log('errors:', errs.slice(0, 5));
await browser.close();
