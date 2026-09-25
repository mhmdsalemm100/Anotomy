// Reports how many structures of each body resolve to a knowledge-base entry, and fails if
// any entry is malformed. Usage: npm run kb:check [-- --missing]
import fs from 'node:fs';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  const { KNOWLEDGE } = await server.ssrLoadModule('/src/kb/index.ts');
  const { variants } = await server.ssrLoadModule('/src/kb/resolve.ts');
  const index = new Map();
  let bad = 0;
  for (const [k, e] of Object.entries(KNOWLEDGE)) {
    if (k !== k.toLowerCase()) { console.error(`key not lower-case: ${k}`); bad++; }
    if (!e.summary || e.summary.length < 20) { console.error(`missing summary: ${k}`); bad++; }
    index.set(k, k);
    for (const a of e.aka ?? []) index.set(a.toLowerCase(), k);
  }
  console.log(`knowledge base: ${Object.keys(KNOWLEDGE).length} entries`);
  for (const sex of ['male', 'female']) {
    const m = JSON.parse(fs.readFileSync(`public/models/${sex}/manifest.json`, 'utf8'));
    const keys = [...new Set(m.parts.map((p) => p.k))];
    let direct = 0, parent = 0;
    const missing = [];
    for (const k of keys) {
      const v = variants(k).find((x) => index.has(x.k));
      if (!v) missing.push(k);
      else if (v.parent) parent++;
      else direct++;
    }
    const pct = (n) => ((100 * n) / keys.length).toFixed(1);
    console.log(`${sex}: ${keys.length} distinct structures — ${pct(direct)}% own entry, ${pct(parent)}% via parent, ${pct(missing.length)}% definition/fallback only`);
    if (process.argv.includes('--missing')) console.log(missing.sort().join('\n'));
  }
  if (bad) process.exitCode = 1;
} finally {
  await server.close();
}
