// End-to-end smoke test of the explorer in headless Chromium (needs `npm run dev` running).
//   node tools/e2e.mjs [outDir]
// Walks the main user journey — landing → male body → muscular system → neck region →
// select a muscle → move it left/right, drag it, hide / undo, explode → search → female
// body — asserting state at each step and saving a screenshot per step.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const outDir = process.argv[2] ?? '.cache/e2e';
mkdirSync(outDir, { recursive: true });
const PORT = process.env.PORT ?? 5173;
const W = 1600, H = 1000;
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|ERR_CERT/.test(m.text())) errors.push(m.text()); });

let step = 0, failed = 0;
const shot = async (name) => page.screenshot({ path: `${outDir}/${String(++step).padStart(2, '0')}-${name}.png` });
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failed++; };
const idle = (ms = 600) => page.waitForTimeout(ms);
const loaderGone = () => page.waitForFunction(() => document.querySelector('.loader')?.classList.contains('hidden'), null, { timeout: 180000 });
const ex = (fn, arg) => page.evaluate(fn, arg);

/** Screen position of a part's surface: projects its centre and nudges until picking hits it. */
const partScreen = (id) => ex((id) => {
  const e = window.__explorer, p = e.body.parts.get(id), cam = e.app.stage.camera;
  const rect = e.app.stage.renderer.domElement.getBoundingClientRect();
  const b = p.info.b, c = p.center.clone().add(p.offset).add(p.explode);
  const tries = [[0, 0, 0], [0, 0.25, 0], [0, -0.25, 0], [0.25, 0, 0], [-0.25, 0, 0], [0, 0, 0.25], [0, 0.4, 0.2], [0, -0.4, 0.2]];
  for (const [fx, fy, fz] of tries) {
    const q = c.clone().add({ x: (b[1][0] - b[0][0]) * fx, y: (b[1][1] - b[0][1]) * fy, z: (b[1][2] - b[0][2]) * fz }).project(cam);
    const x = rect.left + ((q.x + 1) / 2) * rect.width, y = rect.top + ((1 - q.y) / 2) * rect.height;
    const hit = e.pick(x, y);
    if (hit?.part.info.id === id) return { x, y };
  }
  return null;
}, id);

try {
  // 1. landing ---------------------------------------------------------------------------
  await page.goto(`http://localhost:${PORT}/#/`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ready, null, { timeout: 180000 });
  await idle(1500);
  check(await page.locator('.sex-card.male').isVisible() && await page.locator('.sex-card.female').isVisible(), 'landing shows male and female cards');
  await shot('landing');

  // 2. choose male -----------------------------------------------------------------------
  await ex(() => { window.__ready = false; });
  await page.locator('.sex-card.male').click();
  await page.waitForFunction(() => window.__ready && window.__explorer, null, { timeout: 180000 });
  await idle(1500);
  check(/#\/body\/male/.test(page.url()), `route is the male body (${page.url().split('#')[1]})`);
  check(await ex(() => window.__explorer.body.visibleParts().length) > 0, 'skin is visible');
  const cursor = await ex(() => getComputedStyle(document.querySelector('canvas')).cursor);
  check(/url\(/.test(cursor), 'canvas uses the grab-hand cursor');
  await shot('male-skin');

  // 3. muscular system -------------------------------------------------------------------
  await page.locator('.chip', { hasText: 'Muscular' }).click();
  await idle(300);
  await loaderGone();
  await idle(1200);
  const sys = await ex(() => window.__explorer.systems);
  check(sys.length === 1 && sys[0] === 'muscular', `only the muscular system is on (${sys})`);
  const nMus = await ex(() => window.__explorer.body.visibleParts().filter((p) => p.info.sys === 'muscular').length);
  check(nMus > 300, `${nMus} muscular structures visible`);
  await shot('muscular');

  // 4. hover + click the neck -----------------------------------------------------------
  const neck = await ex(() => {
    const e = window.__explorer, box = e.body.regionBox('neck'), cam = e.app.stage.camera;
    const c = box.getCenter(box.min.clone()); c.z = box.max.z; // front of the neck
    for (let dz = 0; dz < 0.2; dz += 0.01) {
      const q = c.clone().setZ(c.z - dz).project(cam);
      const rect = e.app.stage.renderer.domElement.getBoundingClientRect();
      const x = rect.left + ((q.x + 1) / 2) * rect.width, y = rect.top + ((1 - q.y) / 2) * rect.height;
      const hit = e.pick(x, y);
      if (hit && e.body.regionAt(hit.point)?.id === 'neck') return { x, y };
    }
    return null;
  });
  check(!!neck, 'found the neck on screen');
  if (neck) {
    await page.mouse.move(neck.x, neck.y, { steps: 4 });
    await idle(500);
    const tip = await page.locator('.tooltip .tooltip-title').textContent().catch(() => '');
    check(tip === 'Neck', `hover tooltip names the region (${tip})`);
    await shot('neck-hover');
    await page.mouse.click(neck.x, neck.y);
    await idle(1800);
    check(await ex(() => window.__explorer.body.region?.id) === 'neck', 'clicking the neck isolates the neck region');
    const hiddenOutside = await ex(() => {
      const e = window.__explorer;
      return [...e.body.parts.values()].filter((p) => p.mesh?.visible && p.info.sys === 'muscular').every((p) => e.body.inRegion(p));
    });
    check(hiddenOutside, 'structures outside the neck are hidden');
    check((await page.locator('.left-panel h2').first().textContent()) === 'Neck', 'left panel lists the neck structures');
    await shot('neck-region');
  }

  // 5. select the muscle under the cursor (the most superficial layer) ------------------
  const pickAtCentre = () => ex(() => {
    const e = window.__explorer, rect = e.app.stage.renderer.domElement.getBoundingClientRect();
    const box = e.body.boundsOfVisible(), c = box.getCenter(box.min.clone()).project(e.app.stage.camera);
    const x0 = rect.left + ((c.x + 1) / 2) * rect.width, y0 = rect.top + ((1 - c.y) / 2) * rect.height;
    for (let r = 0; r < 200; r += 12) for (let a = 0; a < 6.28; a += 0.8) {
      const x = x0 + Math.cos(a) * r, y = y0 + Math.sin(a) * r, hit = e.pick(x, y);
      if (hit && hit.part.info.sys === 'muscular') return hit.part.info.id;
    }
    return null;
  });
  const target = await pickAtCentre();
  let at = target ? await partScreen(target) : null;
  check(!!at, `found ${target} on screen`);
  if (at) {
    await page.mouse.move(at.x, at.y, { steps: 3 });
    await idle(300);
    await page.mouse.click(at.x, at.y);
    await idle(800);
    check(await ex(() => window.__explorer.selected) === target, 'clicking selects the structure');
    const name = await page.locator('.left-panel .struct-name').textContent().catch(() => '');
    check(!!name, `info panel shows the name (${name})`);
    check(await page.locator('.left-panel .speak').count() >= 1, 'info panel has a pronounce button');
    check(await page.locator('.left-panel .summary').count() >= 1, 'info panel has a description');
    const sel0 = await ex((id) => window.__explorer.body.parts.get(id).mesh.material.__an?.uSel.value, target);
    check(sel0 > 0, `selected structure is recoloured (uSel ${sel0})`);
    await shot('selected');

    // 6. move right / left ---------------------------------------------------------------
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await idle(300);
    const off1 = await ex((id) => window.__explorer.body.parts.get(id).offset.length(), target);
    check(off1 > 0.01, `→ moves the structure (${(off1 * 100).toFixed(1)} cm)`);
    await shot('moved-right');
    await page.locator('.left-panel button', { hasText: 'Left' }).click();
    await idle(300);
    const off2 = await ex((id) => window.__explorer.body.parts.get(id).offset.length(), target);
    check(off2 < off1, 'the Left button moves it back');

    // 7. drag it out ---------------------------------------------------------------------
    at = await partScreen(target);
    if (at) {
      const before = await ex((id) => window.__explorer.body.parts.get(id).offset.toArray(), target);
      await page.mouse.move(at.x, at.y);
      await page.mouse.down();
      await page.mouse.move(at.x + 80, at.y, { steps: 5 });
      await page.mouse.move(at.x + 160, at.y + 20, { steps: 5 });
      await page.mouse.up();
      await idle(400);
      const after = await ex((id) => window.__explorer.body.parts.get(id).offset.toArray(), target);
      check(Math.hypot(after[0] - before[0], after[1] - before[1], after[2] - before[2]) > 0.01, 'dragging the selected structure pulls it out');
      check(await ex(() => window.__explorer.selected) === target, 'still selected after the drag');
      await shot('dragged');
    } else check(false, 'could not find the structure again for dragging');

    // 8. hide + undo ---------------------------------------------------------------------
    await page.keyboard.press('Delete');
    await idle(300);
    check(await ex((id) => window.__explorer.body.parts.get(id).hidden, target), 'Delete hides the structure');
    await page.keyboard.press('Control+z');
    await idle(300);
    check(!(await ex((id) => window.__explorer.body.parts.get(id).hidden, target)), 'Ctrl+Z brings it back');
    // peel this layer away: the next structure beneath becomes clickable
    await page.keyboard.press('Delete');
    await idle(300);
    const next = await pickAtCentre();
    check(next && next !== target, `hiding a layer exposes the next structure (${await ex((id) => id && window.__explorer.body.parts.get(id).info.n, next)})`);
    await shot('layer-peeled');
    await page.keyboard.press('Control+z');
    await ex((id) => window.__explorer.select(id), target);
    await idle(300);
    // undo the drag and the nudges too
    for (let i = 0; i < 4; i++) await page.keyboard.press('Control+z');
    await idle(300);
    const off3 = await ex((id) => window.__explorer.body.parts.get(id).offset.length(), target);
    check(off3 < 1e-6, 'undo restores the original position');

    // 9. isolate -------------------------------------------------------------------------
    await ex((id) => window.__explorer.select(id), target);
    await page.keyboard.press('i');
    await idle(500);
    const nVis = await ex(() => window.__explorer.body.visibleParts().length);
    check(nVis === 1, `I isolates the structure (${nVis} visible)`);
    await shot('isolated');
    await page.locator('.toolbar .icon-btn[title="Show hidden structures"]').click();
    await idle(300);
    check(await ex(() => window.__explorer.body.visibleParts().length) > 1, 'show-hidden restores the region');
    check(await ex(() => window.__explorer.body.visibleParts().every((p) => !p.info.h)), 'default-hidden layers (fascia) stay hidden');
  }

  // 10. explode -------------------------------------------------------------------------
  await page.keyboard.press('Escape');
  await page.locator('.toolbar input[type=range]').evaluate((el) => { el.value = '0.7'; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change')); });
  await idle(800);
  check(await ex(() => window.__explorer.body.explodeAmount) > 0.6, 'explode slider spreads the structures');
  await shot('exploded');
  await page.keyboard.press('Control+z');
  await idle(300);
  check(await ex(() => window.__explorer.body.explodeAmount) === 0, 'undo collapses the explosion');

  // 11. back to the full body --------------------------------------------------------------
  await page.keyboard.press('Escape');
  await idle(1500);
  check(await ex(() => window.__explorer.body.region) === null, 'Esc returns to the full body');

  // 12. search ----------------------------------------------------------------------------
  await page.keyboard.press('/');
  await page.keyboard.type('biceps brachii');
  await idle(300);
  const nRes = await page.locator('.search-results .search-item').count();
  check(nRes > 0, `search finds results (${nRes})`);
  await page.keyboard.press('Enter');
  await idle(1500);
  const sel = await ex(() => { const e = window.__explorer; return e.selected && e.body.parts.get(e.selected).info.n; });
  check(/biceps brachii/i.test(sel ?? ''), `Enter selects the first result (${sel})`);
  await shot('search-biceps');

  // 13. layers panel + skeletal layer ----------------------------------------------------
  await page.keyboard.press('Escape');
  await page.locator('.chip', { hasText: 'Skeletal' }).locator('.chip-add').click();
  await idle(300);
  await loaderGone();
  await idle(1000);
  check((await ex(() => window.__explorer.systems)).join() === 'skeletal,muscular', 'the + button adds the skeleton as a layer');
  await page.locator('.icon-btn[title=Layers]').click();
  check(await page.locator('.layers-panel').isVisible(), 'layers panel opens');
  await shot('layers');
  await page.locator('.layers-panel .icon-btn').click();

  // 14. region via the region list -----------------------------------------------------------
  await page.locator('.region-btn', { hasText: 'Thorax' }).click();
  await idle(1800);
  check(await ex(() => window.__explorer.body.region?.id) === 'thorax', 'region buttons open a region');
  await shot('thorax');
  await page.keyboard.press('Escape');
  await idle(1200);

  // 15. settings + help ------------------------------------------------------------------
  await page.locator('.icon-btn[title=Settings]').click();
  check(await page.locator('.modal').isVisible(), 'settings open');
  await page.keyboard.press('Escape');
  await idle(300);
  check(!(await page.locator('.modal').count()), 'Esc closes the modal');
  await page.locator('.icon-btn[title="Help & sources"]').click();
  const refs = await page.locator('.modal .refs li').count();
  check(refs >= 6, `help lists the references (${refs})`);
  await page.locator('.modal .icon-btn').first().click().catch(() => {});

  // 16. female body -----------------------------------------------------------------------
  await ex(() => { window.__ready = false; window.__explorer = null; });
  await page.locator('.segmented button', { hasText: 'Female' }).click();
  await page.waitForFunction(() => window.__ready && window.__explorer, null, { timeout: 180000 });
  await loaderGone();
  await idle(1500);
  check(/#\/body\/female/.test(page.url()), 'switches to the female body');
  const nF = await ex(() => window.__explorer.body.visibleParts().length);
  check(nF > 0, `female structures visible (${nF})`);
  await shot('female');
} catch (e) {
  check(false, `exception: ${e.message}`);
  await shot('exception').catch(() => {});
}

for (const e of errors) console.log('[page error]', e.slice(0, 300));
check(errors.length === 0, 'no page errors');
await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
