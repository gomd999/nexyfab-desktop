/**
 * render-preview.mjs — 헤드리스 렌더→PNG (ⓐ). 어셈블리를 순수 노드로 테셀레이션·
 * 투영·래스터라이즈해 그레이스케일 PNG(top/side/iso)를 만든다. 브라우저·GL 불필요.
 *
 * 목적: 저작 루프의 "눈". 자동화/AI 가 만든 배치를 이미지로 되받아 스스로 검증·수정.
 * mesh=verts/faces 직접, box·revolve=정확 테셀레이션, 그 외 타입=partAabb 박스 폴백
 * (배치 확인엔 충분). 뷰어(Three.js)와 픽셀 단위 일치가 목적이 아니라 배치 진단이 목적.
 *
 * API: renderPreview(assembly, {views, W, H}) → { [view]: Buffer(PNG) }
 * CLI: node render-preview.mjs asm.json outPrefix [views]
 */
import zlib from 'node:zlib';
import { partAabb } from './reconstruct.mjs';

const DEG = Math.PI / 180;
function rot(p, rx = 0, ry = 0, rz = 0) {
  let [x, y, z] = p;
  if (rx) { const c = Math.cos(rx * DEG), s = Math.sin(rx * DEG); [y, z] = [y * c - z * s, y * s + z * c]; }
  if (ry) { const c = Math.cos(ry * DEG), s = Math.sin(ry * DEG); [x, z] = [x * c + z * s, -x * s + z * c]; }
  if (rz) { const c = Math.cos(rz * DEG), s = Math.sin(rz * DEG); [x, y] = [x * c - y * s, x * s + y * c]; }
  return [x, y, z];
}
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

function boxTris(corners, out) {
  const F = [[0, 1, 2, 3], [7, 6, 5, 4], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0]];
  for (const [a, b, c, d] of F) out.push([corners[a], corners[b], corners[c]], [corners[a], corners[c], corners[d]]);
}

/** 부품 → 월드 삼각형 배열. 지원: mesh(정확)·box·revolve·그 외(partAabb 박스 폴백). */
export function partTriangles(p) {
  const { tx = 0, ty = 0, tz = 0, rx = 0, ry = 0, rz = 0 } = p.at ?? {};
  const T = (v) => add(rot(v, rx, ry, rz), [tx, ty, tz]);
  const tris = [];
  if (p.type === 'mesh' && Array.isArray(p.params?.verts)) {
    const V = p.params.verts, Fs = p.params.faces ?? [];
    for (const f of Fs) tris.push([T(V[f[0]]), T(V[f[1]]), T(V[f[2]])]);
    return tris;
  }
  if (p.type === 'box') {
    const { width: w = 0, depth: d = 0, height: h = 0 } = p.params ?? {};
    boxTris([[0, 0, 0], [w, 0, 0], [w, d, 0], [0, d, 0], [0, 0, h], [w, 0, h], [w, d, h], [0, d, h]].map(T), tris);
    return tris;
  }
  if (p.type === 'revolve' && Array.isArray(p.params?.profile)) {
    const prof = p.params.profile, N = 28;
    const q = (a, b, c, dd) => tris.push([T(a), T(b), T(c)], [T(a), T(c), T(dd)]);
    for (let a = 0; a < N; a++) {
      const t0 = 2 * Math.PI * a / N, t1 = 2 * Math.PI * (a + 1) / N;
      for (let j = 0; j < prof.length - 1; j++) {
        const [r0, z0] = prof[j], [r1, z1] = prof[j + 1];
        q([r0 * Math.cos(t0), r0 * Math.sin(t0), z0], [r0 * Math.cos(t1), r0 * Math.sin(t1), z0], [r1 * Math.cos(t1), r1 * Math.sin(t1), z1], [r1 * Math.cos(t0), r1 * Math.sin(t0), z1]);
      }
    }
    return tris;
  }
  // 폴백: 임의 타입 → 로컬 AABB 박스(배치 확인용)
  let a;
  try { a = partAabb({ type: p.type, ...(p.params ?? {}) }); } catch { a = null; }
  if (a) {
    const [x0, y0, z0] = a.min, [x1, y1, z1] = a.max;
    boxTris([[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]].map(T), tris);
  }
  return tris;
}

export function assemblyTriangles(assembly) {
  return (assembly?.parts ?? []).flatMap(partTriangles);
}

function viewBasis(name) {
  if (name === 'top') return { R: [1, 0, 0], U: [0, 1, 0], dir: [0, 0, 1] };
  if (name === 'side') return { R: [1, 0, 0], U: [0, 0, 1], dir: [0, -1, 0] };
  if (name === 'front') return { R: [0, 1, 0], U: [0, 0, 1], dir: [1, 0, 0] };
  const az = -40 * DEG, el = 26 * DEG; // iso
  const dir = norm([Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)]);
  const R = norm(cross([0, 0, 1], dir)), U = cross(dir, R);
  return { R, U, dir };
}

const LIGHT = norm([0.35, 0.5, 0.9]);
/** 삼각형 배열 → 그레이스케일 Uint8Array(W*H). z-버퍼·평면음영. */
export function rasterize(tris, name, W, H) {
  const { R, U, dir } = viewBasis(name);
  let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
  for (const t of tris) for (const v of t) { const u = dot(v, R), w = dot(v, U); if (u < uMin) uMin = u; if (u > uMax) uMax = u; if (w < vMin) vMin = w; if (w > vMax) vMax = w; }
  const m = 24, sc = Math.min((W - 2 * m) / (uMax - uMin || 1), (H - 2 * m) / (vMax - vMin || 1));
  const ox = (W - sc * (uMax - uMin)) / 2 - sc * uMin, oy = (H - sc * (vMax - vMin)) / 2 - sc * vMin;
  const img = new Uint8Array(W * H).fill(238), zb = new Float32Array(W * H).fill(-Infinity);
  for (const t of tris) {
    const n = norm(cross(sub(t[1], t[0]), sub(t[2], t[0])));
    const sh = 0.25 + 0.75 * Math.abs(dot(n, LIGHT));
    const g = Math.max(30, Math.min(225, Math.round(235 - 205 * sh)));
    const A = [ox + sc * dot(t[0], R), H - (oy + sc * dot(t[0], U)), dot(t[0], dir)];
    const B = [ox + sc * dot(t[1], R), H - (oy + sc * dot(t[1], U)), dot(t[1], dir)];
    const C = [ox + sc * dot(t[2], R), H - (oy + sc * dot(t[2], U)), dot(t[2], dir)];
    const minx = Math.max(0, Math.floor(Math.min(A[0], B[0], C[0]))), maxx = Math.min(W - 1, Math.ceil(Math.max(A[0], B[0], C[0])));
    const miny = Math.max(0, Math.floor(Math.min(A[1], B[1], C[1]))), maxy = Math.min(H - 1, Math.ceil(Math.max(A[1], B[1], C[1])));
    const den = (B[1] - C[1]) * (A[0] - C[0]) + (C[0] - B[0]) * (A[1] - C[1]);
    if (Math.abs(den) < 1e-9) continue;
    for (let y = miny; y <= maxy; y++) for (let x = minx; x <= maxx; x++) {
      const w0 = ((B[1] - C[1]) * (x - C[0]) + (C[0] - B[0]) * (y - C[1])) / den;
      const w1 = ((C[1] - A[1]) * (x - C[0]) + (A[0] - C[0]) * (y - C[1])) / den;
      const w2 = 1 - w0 - w1;
      if (w0 < -0.001 || w1 < -0.001 || w2 < -0.001) continue;
      const z = w0 * A[2] + w1 * B[2] + w2 * C[2], idx = y * W + x;
      if (z > zb[idx]) { zb[idx] = z; img[idx] = g; }
    }
  }
  return img;
}

/** 그레이스케일 Uint8Array → PNG Buffer (8bit grayscale). */
export function encodePng(img, W, H) {
  const raw = Buffer.alloc((W + 1) * H);
  for (let y = 0; y < H; y++) { raw[y * (W + 1)] = 0; raw.set(img.subarray(y * W, y * W + W), y * (W + 1) + 1); }
  const idat = zlib.deflateSync(raw, { level: 9 });
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0, 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

/** 어셈블리 → { [view]: PNG Buffer }. views 기본 iso/side/top. */
export function renderPreview(assembly, { views = ['iso', 'side', 'top'], W = 1000, H = 560 } = {}) {
  const tris = assemblyTriangles(assembly);
  if (!tris.length) throw new Error('no renderable geometry (parts[] 비었거나 지오메트리 없음)');
  const out = {};
  for (const v of views) out[v] = encodePng(rasterize(tris, v, W, H), W, H);
  return { pngs: out, triCount: tris.length };
}

// ── CLI ──
const isMain = process.argv[1] && process.argv[1].replaceAll('\\', '/').endsWith('render-preview.mjs');
if (isMain) {
  const { readFileSync, writeFileSync } = await import('node:fs');
  const asm = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  const prefix = process.argv[3] ?? 'preview';
  const views = process.argv[4] ? process.argv[4].split(',') : ['iso', 'side', 'top'];
  const { pngs, triCount } = renderPreview(asm, { views });
  for (const [v, buf] of Object.entries(pngs)) writeFileSync(`${prefix}_${v}.png`, buf);
  console.log(`OK ${asm.parts?.length ?? 0} parts · ${triCount} tris → ${prefix}_{${views.join(',')}}.png`);
}
