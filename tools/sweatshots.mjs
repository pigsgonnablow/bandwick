// The sweat lodge in the real page: loads the saves tools/sweatsave.ts made and photographs the lodge cold by day,
// steaming on a winter evening with people inside, and its card.
// Usage: node tools/sweatshots.mjs <savedir> <outdir>   (start `npm run preview` first, or set URL=)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const dir = process.argv[2] ?? 'shots', out = process.argv[3] ?? dir;
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'], ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}) });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: Number(process.env.DPR ?? 1) });
page.setDefaultTimeout(180000);
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && /Shader Error|WebGL|THREE\./.test(m.text())) errs.push(m.text().slice(0, 300)); });
await page.goto(`${process.env.URL ?? 'http://localhost:4173/index.html'}#w4471-128`);
await page.waitForSelector('#ui > .loading.done', { timeout: 180000 });
for (const name of ['day', 'evening', 'noon']) {
  await page.evaluate(() => window.__lw.setSavesOpen(true));
  await page.setInputFiles('#save-file', `${dir}/sweat-${name}.json`);
  await page.waitForTimeout(1500);
  await page.waitForFunction(() => window.__lw.view.band.getBuildings().some((b) => b.kind === 'sweat'), null, { timeout: 180000 });
  await page.evaluate(() => { window.__lw.setSavesOpen(false); window.__lw.setPaused(true); });
  const b = await page.evaluate(() => { const q = window.__lw.view.band.getBuildings().find((b) => b.kind === 'sweat'); return { x: q.x + 0.5, z: q.z + 0.5, id: q.id }; });
  await page.addStyleTag({ content: '#ui > *:not(.loading) { visibility: hidden !important; }' });
  await page.waitForTimeout(3000);
  // (close in past the usual limit, and round all four sides, so the door shows in one of them)
  for (let yaw = 0; yaw < 4; yaw++) {
    await page.evaluate(([x, z]) => { const c = window.__lw.view.cam; c.minZoom = 1; c.frame(x, z, 2, true); }, [b.x, b.z]);
    await page.waitForTimeout(6000);
    await page.screenshot({ path: `${out}/lodge-${name}-close${yaw}.png` });
    await page.evaluate(() => window.__lw.view.cam.rotate(1));
  }
  await page.evaluate(([x, z]) => window.__lw.view.cam.frame(x, z, 6, true), [b.x, b.z]);
  await page.waitForTimeout(8000);
  await page.screenshot({ path: `${out}/lodge-${name}-camp.png` });
  await page.addStyleTag({ content: '#ui > *:not(.loading) { visibility: visible !important; }' });
  if (name === 'evening') {
    await page.evaluate((id) => window.__lw.selectRef({ kind: 'building', id }), b.id);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${out}/lodge-card.png` });
  }
}
console.log(JSON.stringify({ errs }, null, 1));
await browser.close();
