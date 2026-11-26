// The bands' customs in the real page: loads the save tools/waysave.ts made and photographs each living band's panel
// with its customs, its camp, and the chronicle's story of the years.
// Usage: node tools/wayshots.mjs <savedir> <outdir>   (start `npm run preview` first, or set URL=)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const dir = process.argv[2] ?? 'shots', out = process.argv[3] ?? dir;
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'], ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}) });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
page.setDefaultTimeout(180000);
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(`${process.env.URL ?? 'http://localhost:4173/index.html'}#w1-128`);
await page.waitForSelector('#ui > .loading.done', { timeout: 180000 });
await page.evaluate(() => window.__lw.setSavesOpen(true));
await page.setInputFiles('#save-file', `${dir}/ways.json`);
await page.waitForTimeout(1500);
await page.waitForFunction(() => window.__lw.snap.summary?.bands?.length, null, { timeout: 180000 });
await page.evaluate(() => window.__lw.setPaused(true));
const bands = await page.evaluate(() => window.__lw.snap.summary.bands.filter((b) => !b.gone));
for (const b of bands) {
  await page.evaluate((id) => window.__lw.setFocusBand(id), b.id);
  await page.waitForTimeout(800);
  await page.evaluate(([x, z]) => window.__lw.view.cam.frame(x, z, 22, true), [b.x, b.z]);
  await page.waitForTimeout(5000);
  const name = b.name.toLowerCase();
  await page.screenshot({ path: `${out}/customs-${name}-in-game.png` });
  // the band panel scrolled down to its customs
  const dt = page.locator('dt', { hasText: /^Customs$/ }).first();
  if (await dt.count()) {
    // (on a tall page, so the panel needn't scroll, from its beliefs down to its customs)
    await page.setViewportSize({ width: 1280, height: 2600 });
    await page.waitForTimeout(600);
    const top = await page.locator('dt', { hasText: /^(Believes|Customs)$/ }).first().boundingBox();
    const dl = await dt.locator('xpath=..').boundingBox();
    if (top && dl) await page.screenshot({ path: `${out}/customs-${name}-panel.png`, clip: { x: dl.x - 24, y: top.y - 16, width: dl.width + 48, height: dl.y + dl.height - top.y + 32 } });
    await page.setViewportSize({ width: 1280, height: 800 });
  }
}
await page.evaluate(() => window.__lw.setChronicleOpen(true, 'story'));
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/customs-chronicle.png` });
console.log(JSON.stringify({ bands: bands.map((b) => b.name), errs }, null, 1));
await browser.close();
