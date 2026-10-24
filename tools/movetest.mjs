// Samples drawn positions of everyone for a few seconds: how far each travels, and how often
// the drawn position jumps backwards (a glitch) instead of moving on.
import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
await page.goto(`${process.env.URL ?? 'http://localhost:4173/index.html'}#w4471-128`);
await page.waitForSelector('#ui > .loading.done', { timeout: 120000 });
await page.waitForTimeout(3000);
const res = await page.evaluate(async () => {
  const e = window.__lw;
  const ids = e.snap.summary.roster.map((r) => r.id);
  const track = new Map(ids.map((id) => [id, []]));
  const t0 = performance.now();
  await new Promise((done) => {
    const step = () => {
      for (const id of ids) {
        const p = e.view.band.positionOf(id);
        if (p && !p.indoors) track.get(id).push([p.x, p.z]);
      }
      if (performance.now() - t0 < 6000) requestAnimationFrame(step); else done();
    };
    requestAnimationFrame(step);
  });
  const out = [];
  for (const [id, pts] of track) {
    let path = 0, back = 0, maxJump = 0;
    for (let i = 2; i < pts.length; i++) {
      const dx1 = pts[i - 1][0] - pts[i - 2][0], dz1 = pts[i - 1][1] - pts[i - 2][1];
      const dx2 = pts[i][0] - pts[i - 1][0], dz2 = pts[i][1] - pts[i - 1][1];
      const d = Math.hypot(dx2, dz2);
      path += d;
      maxJump = Math.max(maxJump, d);
      if (dx1 * dx2 + dz1 * dz2 < -1e-4 && d > 0.05) back++;
    }
    const first = pts[0], last = pts[pts.length - 1];
    out.push({ id, samples: pts.length, path: +path.toFixed(2), net: first ? +Math.hypot(last[0] - first[0], last[1] - first[1]).toFixed(2) : 0, reversals: back, maxJump: +maxJump.toFixed(2) });
  }
  return { gameTicks: e.snap.tick, out };
});
console.log(JSON.stringify(res, null, 0));
await browser.close();
