// Renders the README showcase images into docs/images/ (needs `npm run dev` running).
//   node tools/showcase.mjs [sceneName …]
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = 'docs/images';
mkdirSync(OUT, { recursive: true });
const PORT = process.env.PORT ?? 5173;
const only = process.argv.slice(2);

/** Camera placement helper run in the page: azimuth° around the target, elevation, distance ×. */
const orbit = (page, az, el = 0.08, zoom = 1) => page.evaluate(([az, el, zoom]) => {
  const e = window.__explorer, c = e.rig.controls, cam = e.app.stage.camera;
  const d = cam.position.distanceTo(c.target) * zoom;
  const a = (az * Math.PI) / 180;
  const dir = { x: Math.sin(a), y: el, z: Math.cos(a) };
  const n = Math.hypot(dir.x, dir.y, dir.z);
  return e.rig.flyTo(c.target.clone().add({ x: (dir.x / n) * d, y: (dir.y / n) * d, z: (dir.z / n) * d }), c.target.clone(), 1);
}, [az, el, zoom]);

const byName = (page, re, side) => page.evaluate(([src, side]) => {
  const re = new RegExp(src, 'i');
  return [...window.__explorer.body.parts.values()].filter((p) => re.test(p.info.n) && (!side || p.info.s === side)).map((p) => p.info.id);
}, [re, side]);

const SCENES = {
  landing: { hash: '#/', wait: 3000 },
  muscular: {
    hash: '#/body/male?systems=muscular',
    setup: async (page) => { await orbit(page, 28, 0.06, 0.95); },
  },
  'neck-dissection': {
    hash: '#/body/male?systems=skeletal,muscular&region=neck',
    setup: async (page) => {
      const platysma = await byName(page, '^platysma$');
      const scm = (await byName(page, '^sternocleidomastoid', 'left'))[0];
      await page.evaluate(([hide, scm]) => {
        const e = window.__explorer;
        e.hide(hide);
        e.select(scm);
      }, [platysma, scm]);
      await orbit(page, 24, -0.04, 0.95);
      await page.evaluate(() => window.__explorer.nudge('right'));
    },
  },
  systems: {
    hash: '#/body/male?systems=skeletal,cardiovascular,nervous',
    setup: async (page) => { await orbit(page, 20, 0.05, 0.95); },
  },
  'thorax-organs': {
    hash: '#/body/male?systems=respiratory,cardiovascular&region=thorax',
    setup: async (page) => {
      const lv = (await byName(page, '^left ventricle$'))[0];
      if (lv) await page.evaluate((id) => window.__explorer.select(id), lv);
      await orbit(page, 15, 0.1, 0.9);
    },
  },
  'head-brain': {
    hash: '#/body/male?systems=nervous&region=head',
    setup: async (page) => { await orbit(page, -55, 0.25, 1.0); },
  },
  female: {
    hash: '#/body/female?systems=skeletal,digestive,respiratory,cardiovascular,urinary,reproductive',
    setup: async (page) => { await page.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove())); await orbit(page, 18, 0.05, 0.95); },
  },
  'micro-rbc': { hash: '#/micro/rbc', wait: 3500 },
  'micro-cell': { hash: '#/micro/cell', wait: 3500 },
  'micro-neuron': { hash: '#/micro/neuron', wait: 3500 },
  'micro-dna': { hash: '#/micro/dna', wait: 3500 },
  'micro-sarcomere': { hash: '#/micro/sarcomere', wait: 3500 },
  // true 3840×2160 capture through the app's own 4K export
  '4k': {
    hash: '#/body/male?systems=respiratory,cardiovascular&region=thorax', capture4k: true,
    setup: async (page) => { await orbit(page, 22, 0.12, 0.78); },
  },
};

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
for (const [name, sc] of Object.entries(SCENES)) {
  if (only.length && !only.includes(name)) continue;
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.addInitScript(() => { try { localStorage.setItem('anotomy.quality', 'high'); } catch { /* */ } });
  page.on('pageerror', (e) => console.log(`[${name}] pageerror`, e.message));
  await page.goto(`http://localhost:${PORT}/${sc.hash}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ready, null, { timeout: 240000 });
  await page.waitForTimeout(1200);
  if (sc.setup) await sc.setup(page);
  await page.mouse.move(1919, 1079);
  await page.waitForTimeout(sc.wait ?? 2500);
  if (sc.capture4k) {
    const b64 = await page.evaluate(async () => {
      const png = await window.__explorer.app.stage.screenshot(3840, 2160);
      const bmp = await createImageBitmap(png);
      const cv = new OffscreenCanvas(bmp.width, bmp.height);
      const g = cv.getContext('2d');
      g.fillStyle = '#000';
      g.fillRect(0, 0, cv.width, cv.height);
      g.drawImage(bmp, 0, 0);
      const blob = await cv.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
      const buf = new Uint8Array(await blob.arrayBuffer());
      let s = '';
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return btoa(s);
    });
    writeFileSync(`${OUT}/4k-thorax.jpg`, Buffer.from(b64, 'base64'));
    console.log('saved', `${OUT}/4k-thorax.jpg (3840×2160)`);
  } else {
    await page.screenshot({ path: `${OUT}/${name}.jpg`, type: 'jpeg', quality: 86, timeout: 180000 });
    console.log('saved', `${OUT}/${name}.jpg`);
  }
  await page.close();
}
await browser.close();
