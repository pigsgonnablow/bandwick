// Saves and loads in the real page: the loaded world must resume at the same tick with the same
// history; export a file, import it back, and check saves survive a page reload.
// Usage: node tools/savebrowser.mjs <outdir>   (start `npm run preview` first, or set URL=)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const out = process.argv[2] ?? 'shots';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 820 }, acceptDownloads: true });
const page = await ctx.newPage();
page.setDefaultTimeout(120000);
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && /Shader Error|WebGL|THREE\.|IndexedDB/.test(m.text())) errs.push(m.text().slice(0, 300)); });
const URL = `${process.env.URL ?? 'http://localhost:4173/index.html'}#w4471-128`;
await page.goto(URL);
await page.waitForSelector('#ui > .loading.done');
const fresh = async () => { await page.evaluate(() => window.__lw.selectRef(null)); await page.waitForTimeout(800); return page.evaluate(() => ({ tick: window.__lw.snap.summary.tick, hash: window.__lw.snap.summary.historyHash, pop: window.__lw.snap.summary.pop })); };
// play a while, then pause and save
await page.evaluate(() => window.__lw.skip('season'));
await page.waitForTimeout(400);
await page.waitForFunction(() => !window.__lw.snap.skipping);
await page.evaluate(() => window.__lw.setPaused(true));
const before = await fresh();
await page.evaluate(() => window.__lw.saveNow(false, 'Browser test'));
await page.waitForFunction(() => !window.__lw.snap.saving && window.__lw.snap.lastSave);
const meta = await page.evaluate(() => window.__lw.snap.lastSave);
// carry on, then load the save back
await page.evaluate(() => window.__lw.setSpeed(120));
await page.waitForTimeout(4000);
const moved = await fresh();
await page.evaluate(() => window.__lw.setPaused(true));
await page.evaluate((id) => window.__lw.loadSave(id), meta.id);
await page.waitForFunction(() => window.__lw.snap.loading === null && window.__lw.snap.summary);
const loaded = await fresh();
// the Saves window
await page.evaluate(() => window.__lw.setSavesOpen(true));
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/saves_dialog.png` });
// export the save as a file, then import it back
const [dl] = await Promise.all([page.waitForEvent('download'), page.evaluate((id) => window.__lw.exportSave(id), meta.id)]);
const file = `${out}/${dl.suggestedFilename()}`;
await dl.saveAs(file);
await page.setInputFiles('#save-file', file);
await page.waitForFunction(() => window.__lw.snap.loading === null && window.__lw.snap.summary && !window.__lw.snap.savesOpen);
const imported = await fresh();
// saves survive a reload, and a fresh start offers to continue
await page.goto('about:blank');
await page.goto(URL.replace('#w4471-128', '#w555-128'));
await page.waitForSelector('#ui > .loading.done');
await page.waitForTimeout(1500);
const afterReload = await page.evaluate(() => ({ saves: (window.__lw.snap.saves || []).length, offer: !!document.querySelector('.continue') }));
await page.screenshot({ path: `${out}/continue_offer.png` });
console.log(JSON.stringify({ before, savedAs: { name: meta.name, kb: Math.round(meta.bytes / 1024) }, movedOnTo: moved.tick, loaded, sameAfterLoad: loaded.tick === before.tick && loaded.hash === before.hash,
  exportFile: dl.suggestedFilename(), imported, sameAfterImport: imported.tick === before.tick && imported.hash === before.hash, afterReload, errs }, null, 1));
await browser.close();
