// M1 screenshots: node tools/m1shot.mjs <outDir> <seed> '<json steps>'
// steps: [{wait, speed, skip:'morning'|'season', zoom, select:true, name, hideUi, rotate}]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const [out, seed, stepsJson] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const steps = JSON.parse(stepsJson);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const logs = [];
page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
await page.goto(`${process.env.URL ?? 'http://localhost:4173/index.html'}#w${seed}-128`);
await page.waitForSelector('#ui > .loading.done', { timeout: 120000 });
for (const s of steps) {
  await page.evaluate(async (s) => {
    const e = window.__lw;
    if (s.speed) e.setSpeed(s.speed);
    if (s.pause) e.setPaused(true);
    if (s.skip) e.skip(s.skip);
    if (s.zoom) { const c = e.view.cam; c.frame(c.target.x, c.target.z, s.zoom); }
    if (s.camp) { const sum = e.snap.summary; }
    if (s.rotate) for (let k = 0; k < s.rotate; k++) e.view.cam.rotate(1);
    if (s.select) {
      const r = e.snap.summary?.roster ?? [];
      const id = r[s.select % r.length]?.id;
      if (id !== undefined) { e.select(id); e.setFollow(true); }
    }
    if (s.unselect) e.select(-1);
    document.getElementById('ui').style.display = s.hideUi ? 'none' : '';
  }, s);
  await page.waitForTimeout(s.wait ?? 2000);
  if (s.name) await page.screenshot({ path: `${out}/${s.name}.png` });
}
const info = await page.evaluate(() => ({ tick: window.__lw.snap.tick, mode: window.__lw.snap.genMode, pop: window.__lw.snap.summary?.pop, tps: window.__lw.snap.tps, fps: window.__lw.view.stats.fps }));
console.log(JSON.stringify(info));
console.log(logs.slice(0, 20).join('\n'));
await browser.close();
