// The thorn hedge in the real page: loads the saves tools/hedgesave.ts made and photographs the hedge half laid and
// finished round the camp, close up from all four sides, and its card.
// Usage: node tools/hedgeshots.mjs <savedir> <outdir>   (start `npm run preview` first, or set URL=)
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
for (const name of ['half', 'done']) {
  await page.evaluate(() => window.__lw.setSavesOpen(true));
  await page.setInputFiles('#save-file', `${dir}/hedge-${name}.json`);
  await page.waitForTimeout(1500);
  await page.waitForFunction(() => window.__lw.view.band.getBuildings().some((b) => b.kind === 'hedge'), null, { timeout: 180000 });
  await page.evaluate(() => { window.__lw.setSavesOpen(false); window.__lw.setPaused(true); });
  const b = await page.evaluate(() => { const q = window.__lw.view.band.getBuildings().find((b) => b.kind === 'hedge'); return { x: q.x + 0.5, z: q.z + 0.5, cx: q.cx, cz: q.cz, id: q.id }; });
  await page.addStyleTag({ content: '#ui > *:not(.loading) { visibility: hidden !important; }' });
  await page.waitForTimeout(3000);
  await page.evaluate(([x, z]) => window.__lw.view.cam.frame(x, z, 12, true), [b.cx, b.cz]);
  await page.waitForTimeout(8000);
  await page.screenshot({ path: `${out}/hedge-${name}-camp.png` });
  if (name === 'done') {
    for (let yaw = 0; yaw < 2; yaw++) {
      await page.evaluate(([x, z]) => { const c = window.__lw.view.cam; c.minZoom = 1; c.frame(x, z, 3, true); }, [b.x, b.z]);
      await page.waitForTimeout(6000);
      await page.screenshot({ path: `${out}/hedge-close${yaw}.png` });
      await page.evaluate(() => window.__lw.view.cam.rotate(1));
    }
  }
  await page.addStyleTag({ content: '#ui > *:not(.loading) { visibility: visible !important; }' });
  if (name === 'done') {
    await page.evaluate((id) => window.__lw.selectRef({ kind: 'building', id }), b.id);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${out}/hedge-card.png` });
  }
}
console.log(JSON.stringify({ errs }, null, 1));
await browser.close();
