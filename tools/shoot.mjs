// Headless screenshot helper: node tools/shoot.mjs "<query>" out.png [width height]
import { chromium } from 'playwright-core';
const [query = '', out = 'shot.png', w = '1600', h = '1000'] = process.argv.slice(2);
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
page.on('console', (m) => { if (m.type() === 'error' || /error|warn/i.test(m.text())) console.log('[console]', m.type(), m.text().slice(0, 300)); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
const url = `http://localhost:${process.env.PORT ?? 5173}/${query}`;
console.log("url", url);
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready || window.__error, null, { timeout: 240000 });
const err = await page.evaluate(() => window.__error);
if (err) console.log('ERROR', err);
await page.waitForTimeout(Number(process.env.WAIT ?? 2500));
await page.screenshot({ path: out });
await browser.close();
console.log('saved', out);
