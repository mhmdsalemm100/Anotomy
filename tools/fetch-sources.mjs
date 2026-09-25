// Downloads the upstream anatomy geometry this project is built from into .cache/sources.
//
// Both sources are pinned to exact commits of github.com/ashemag/human-atlas, which
// repackaged the official datasets as raw binary chunks (positions float32,
// normals int16, indices uint32) plus a JSON manifest:
//
//   male   – BodyParts3D 4.0 (DBCLS), CC BY 4.0, 2,234 meshes, commit 1c38bf35
//   female – HuBMAP Human Reference Atlas, 3D Reference Organ Set for Female v1.5,
//            CC BY 4.0, 888 meshes, commit e6743fa1 (removed from later revisions)
//
//   za     – Z-Anatomy (Lluís Vinent), CC BY-SA 4.0, exported to Draco GLB by
//            github.com/nqwrc/3d-anatomy, commit 8ca3b742. Non-commercial
//            (inner ear, kidney) and unlicensed (Brainder cortex) components are
//            excluded later by the build step, never shipped.
//
// See ATTRIBUTION.md for the full provenance and license notes.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = path.join(root, '.cache/sources');

export const SOURCES = {
  male: {
    repo: 'ashemag/human-atlas',
    commit: '1c38bf35c254a891200d3cedecfd57abebe83d8d',
    manifest: 'public/models/atlas.json',
    chunkPrefix: 'public/models/body-',
  },
  female: {
    repo: 'ashemag/human-atlas',
    commit: 'e6743fa18065e2469dfea58f478d7857464d2545',
    manifest: 'public/models/atlas-female.json',
    chunkPrefix: 'public/models/female-',
  },
};

export const ZA = {
  repo: 'nqwrc/3d-anatomy',
  commit: '8ca3b7421bcfbe88b85859eb1983d5cf79f21749',
  files: [
    'public/models/skeletal.glb',
    'public/models/muscular.glb',
    'public/models/joints.glb',
    'public/models/cardiovascular.glb',
    'public/models/nervous.glb',
    'public/models/lymphatic.glb',
    'public/models/visceral.glb',
    'public/models/License.txt',
    'public/data/lexicon.json',
    'public/data/definitions.json',
  ],
};

async function download(url, file) {
  if (fs.existsSync(file) && fs.statSync(file).size > 0) return fs.readFileSync(file);
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const buf = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(file, buf);
      return buf;
    } catch (err) {
      if (attempt === 4) throw new Error(`Failed to download ${url}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
}

{
  const dir = path.join(out, 'za');
  fs.mkdirSync(dir, { recursive: true });
  const base = `https://raw.githubusercontent.com/${ZA.repo}/${ZA.commit}/`;
  let bytes = 0;
  for (const f of ZA.files) bytes += (await download(base + f, path.join(dir, path.basename(f)))).length;
  console.log(`za: ${ZA.files.length} files, ${(bytes / 1e6).toFixed(1)} MB`);
}

for (const [sex, src] of Object.entries(SOURCES)) {
  const dir = path.join(out, sex);
  fs.mkdirSync(dir, { recursive: true });
  const base = `https://raw.githubusercontent.com/${src.repo}/${src.commit}/`;
  const manifestBuf = await download(base + src.manifest, path.join(dir, 'atlas.json'));
  const manifest = JSON.parse(manifestBuf.toString('utf8'));
  let bytes = 0;
  await Promise.all(
    manifest.chunks.map(async (chunk, i) => {
      const name = chunk.url.split('/').pop();
      const buf = await download(base + src.chunkPrefix + name.split('-').pop(), path.join(dir, `chunk-${i}.bin`));
      if (buf.length !== chunk.bytes) throw new Error(`${sex} chunk ${i}: expected ${chunk.bytes} bytes, got ${buf.length}`);
      bytes += buf.length;
    }),
  );
  const sha = crypto.createHash('sha256').update(manifestBuf).digest('hex').slice(0, 16);
  console.log(`${sex}: ${manifest.parts.length} meshes, ${manifest.chunks.length} chunks, ${(bytes / 1e6).toFixed(1)} MB (manifest sha256 ${sha})`);
}
