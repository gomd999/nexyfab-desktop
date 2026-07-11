/**
 * 2D→3D 정확성 검증 — 재구성 결과를 실제로 렌더해 기하를 대조한다.
 *
 * 방법론의 검증층: intent → 결정론 재구성(OpenSCAD) → openscad-wasm으로 실렌더 →
 * STL의 bbox·manifold를 intent가 기대하는 AABB와 대조. "만들었다"가 아니라 "만든 것이
 * 치수와 맞다"를 기계적으로 확인. 치수 정확도엔 VLM보다 결정론 대조가 강하고 안정적.
 *
 * 반환: { rendered, manifold, nonManifoldEdges, bbox, expected, maxErrorMm, pass }
 *
 * usage: node verify.mjs '<intent.json>'
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toOpenScad, partAabb } from './reconstruct.mjs';

const OSDIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'openscad');

export async function renderStl(scad) {
  const mod = await import(pathToFileURL(join(OSDIR, 'openscad.js')).href);
  // Node에서는 브라우저 glue의 fetch가 실패 → wasmBinary 직접 주입.
  const inst = await mod.default({ noInitialRun: true, wasmBinary: readFileSync(join(OSDIR, 'openscad.wasm')), print: () => {}, printErr: () => {} });
  inst.FS.writeFile('/in.scad', scad.replace(/\r\n?/g, '\n'));
  const code = inst.callMain(['/in.scad', '-o', '/out.stl', '--backend=manifold', '--export-format=binstl']);
  const stl = inst.FS.readFile('/out.stl', { encoding: 'binary' });
  if (!stl || stl.length === 0) throw new Error(`render produced no STL (exit ${code})`);
  return stl;
}

function analyzeStl(stl) {
  const dv = new DataView(stl.buffer, stl.byteOffset, stl.byteLength);
  const n = dv.getUint32(80, true);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const edges = new Map();
  const key = (x, y, z) => `${Math.round(x * 1000)},${Math.round(y * 1000)},${Math.round(z * 1000)}`;
  for (let i = 0; i < n; i++) {
    const o = 84 + i * 50 + 12;
    const ks = [];
    for (let j = 0; j < 3; j++) {
      const x = dv.getFloat32(o + j * 12, true), y = dv.getFloat32(o + j * 12 + 4, true), z = dv.getFloat32(o + j * 12 + 8, true);
      for (let k = 0, v = [x, y, z]; k < 3; k++) { if (v[k] < min[k]) min[k] = v[k]; if (v[k] > max[k]) max[k] = v[k]; }
      ks.push(key(x, y, z));
    }
    for (let j = 0; j < 3; j++) { const e = [ks[j], ks[(j + 1) % 3]].sort().join('|'); edges.set(e, (edges.get(e) ?? 0) + 1); }
  }
  let bad = 0; for (const c of edges.values()) if (c !== 2) bad++;
  return { triangles: n, min, max, nonManifoldEdges: bad };
}

/** intent → 렌더 → 기하 대조. tolMm: bbox 치수 허용오차(기본 0.5mm). */
export async function verify3d(intent, { tolMm = 0.5 } = {}) {
  const scad = toOpenScad(intent); // 게이트 실패 시 여기서 throw
  const stl = await renderStl(scad);
  const g = analyzeStl(stl);
  const exp = partAabb(intent);
  const dims = ['x', 'y', 'z'];
  const items = dims.map((ax, k) => {
    const actual = g.max[k] - g.min[k];
    const expected = exp.max[k] - exp.min[k];
    return { axis: ax, expected: +expected.toFixed(3), actual: +actual.toFixed(3), errorMm: +(actual - expected).toFixed(3), pass: Math.abs(actual - expected) <= tolMm };
  });
  const maxErrorMm = Math.max(...items.map((i) => Math.abs(i.errorMm)));
  const pass = g.nonManifoldEdges === 0 && items.every((i) => i.pass);
  return {
    rendered: true, manifold: g.nonManifoldEdges === 0, nonManifoldEdges: g.nonManifoldEdges,
    triangles: g.triangles, dims: items, maxErrorMm, pass,
  };
}

const isMain = process.argv[1] && process.argv[1].replaceAll('\\', '/').endsWith('verify.mjs');
if (isMain && process.argv[2]) {
  const intent = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  console.log(JSON.stringify(await verify3d(intent), null, 1));
}
