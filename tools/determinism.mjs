// Checks that the browser and Node agree on a history: skips a world ahead in the page, reads the
// history hash, and prints it with the tick so it can be compared with tools/histhash.ts.
// Usage: node tools/determinism.mjs [seasons]   (start `npm run preview` first, or set URL=)
import { chromium } from 'playwright';
const seasons = Number(process.argv[2] ?? 2);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.setDefaultTimeout(120000); // software rendering on a busy machine can be slow
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && /Shader Error|WebGL|THREE\./.test(m.text())) errs.push(m.text().slice(0, 300)); });
await page.goto(`${process.env.URL ?? 'http://localhost:4173/index.html'}#w4471-128`);
await page.waitForSelector('#ui > .loading.done', { timeout: 120000 });
await page.evaluate(() => window.__lw.setPaused(true));
for (let k = 0; k < seasons; k++) {
  await page.evaluate(() => window.__lw.skip('season'));
  await page.waitForTimeout(500);
  await page.waitForFunction(() => !window.__lw.snap.skipping, null, { timeout: 300000 });
  await page.waitForTimeout(300);
}
await page.evaluate(() => window.__lw.selectRef(null)); // asks the simulation for a fresh summary
await page.waitForTimeout(800);
const r = await page.evaluate(() => ({ tick: window.__lw.snap.summary.tick, hash: window.__lw.snap.summary.historyHash, mode: window.__lw.snap.genMode }));
console.log(JSON.stringify({ ...r, errs }));
await browser.close();
