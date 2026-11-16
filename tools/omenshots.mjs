// The omens in the real page: loads each save tools/omensave.ts made (a sight in the sky under way, a white deer
// grazing by camp), and photographs the camp, the white deer close up, and the band panel with its beliefs.
// Usage: node tools/omenshots.mjs <savedir> <outdir>   (start `npm run preview` first, or set URL=)
import { chromium } from 'playwright';
import { mkdirSync, existsSync } from 'node:fs';
const dir = process.argv[2] ?? 'shots', out = process.argv[3] ?? dir;
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'], ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}) });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(180000);
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && /Shader Error|WebGL|THREE\./.test(m.text())) errs.push(m.text().slice(0, 300)); });
await page.goto(`${process.env.URL ?? 'http://localhost:4173/index.html'}#w4471-128`);
await page.waitForSelector('#ui > .loading.done', { timeout: 180000 });
for (const kind of ['day', 'eclipse', 'blood_moon', 'comet', 'lights']) {
  const file = `${dir}/omen-${kind}.json`;
  if (!existsSync(file)) continue;
  await page.evaluate(() => window.__lw.setSavesOpen(true));
  await page.setInputFiles('#save-file', file);
  await page.waitForTimeout(1500);
  await page.waitForFunction((k) => k === 'day' ? window.__lw.snap.summary?.lore?.customs?.length : window.__lw.snap.summary?.sky === k, kind, { timeout: 180000 });
  await page.evaluate(() => window.__lw.setPaused(true));
  // the camp from a low angle, so the sky shows behind it
  const sum = await page.evaluate(() => window.__lw.snap.summary);
  await page.evaluate(([x, z]) => { const c = window.__lw.view.cam; c.frame(x, z, 26, true); if ('pitch' in c) c.pitch = 0.32; }, [sum.x, sum.z]);
  await page.waitForTimeout(6000);
  await page.screenshot({ path: `${out}/sky-${kind}.png` });
  if (kind === 'day') {
    // the white deer close up, by daylight
    const deer = await page.evaluate(() => window.__lw.view.band.visibleDeer.slice());
    const w = deer.filter((d) => d.white).sort((a, b) => Math.hypot(a.x - sum.x, a.z - sum.z) - Math.hypot(b.x - sum.x, b.z - sum.z))[0];
    if (w) {
      await page.addStyleTag({ content: '#ui > *:not(.loading) { visibility: hidden !important; }' });
      await page.evaluate(([x, z]) => window.__lw.view.cam.frame(x, z, 2.6, true), [w.x, w.z]);
      await page.waitForTimeout(3000);
      await page.screenshot({ path: `${out}/white-deer.png` });
      await page.addStyleTag({ content: '#ui > *:not(.loading) { visibility: visible !important; }' });
    }
    // the band panel, with its beliefs and customs
    const panel = await page.$('.panel.band, section.panel');
    if (panel) await panel.screenshot({ path: `${out}/band-panel.png` });
  }
}
console.log(JSON.stringify({ errs }, null, 1));
await browser.close();
