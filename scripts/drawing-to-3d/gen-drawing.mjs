/**
 * 2D→3D v1 — 합성 도면 생성기 (GT 보유 평가셋).
 * drawing-annotation-schema.md 방법론: 자체 3D 파라미터 → 정투상 3면도 렌더 → GT 자동 라벨.
 * v1 어휘: plate_with_holes {width, depth, thickness, holes[{x,y,d}]} — 3각법 3면도+치수.
 * usage: node gen-drawing.mjs [count=5] [seed=42]
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire('C:/Users/gomd9/Downloads/nexysys_1/nexyfab.com/new/package.json');
const sharp = require('sharp');

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'testdata');
mkdirSync(OUT, { recursive: true });

// 결정론 PRNG (재현 가능한 평가셋)
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (1664525 * s + 1013904223) >>> 0), s / 2 ** 32);
}

function genPart(r) {
  const width = 60 + Math.round(r() * 14) * 10;   // 60~200
  const depth = 40 + Math.round(r() * 10) * 10;   // 40~140
  const thickness = 6 + Math.round(r() * 7) * 2;  // 6~20
  const nHoles = 2 + Math.floor(r() * 3);          // 2~4
  const d = [6, 8, 10, 12][Math.floor(r() * 4)];
  const mx = Math.max(12, d), holes = [];
  const grid = [[mx, mx], [width - mx, mx], [width - mx, depth - mx], [mx, depth - mx]];
  for (let i = 0; i < nHoles; i++) holes.push({ x: grid[i][0], y: grid[i][1], d });
  return { type: 'plate_with_holes', unit: 'mm', width, depth, thickness, holes };
}

/** 치수선(양끝 화살표+수치) — 수평/수직 */
function dim(x1, y1, x2, y2, label, off = 0) {
  const horiz = y1 === y2;
  const tx = (x1 + x2) / 2, ty = (y1 + y2) / 2;
  const a = 5;
  const arrow = (x, y, dir) => horiz
    ? `M${x},${y} l${dir * a},${-a / 2} M${x},${y} l${dir * a},${a / 2}`
    : `M${x},${y} l${-a / 2},${dir * a} M${x},${y} l${a / 2},${dir * a}`;
  return `
  <path d="M${x1},${y1} L${x2},${y2} ${arrow(x1, y1, 1)} ${arrow(x2, y2, -1)}" stroke="#000" stroke-width="1" fill="none"/>
  <text x="${horiz ? tx : tx - 8 + off}" y="${horiz ? ty - 5 + off : ty}" font-size="14" font-family="monospace" text-anchor="middle" ${horiz ? '' : `transform="rotate(-90 ${tx - 8 + off} ${ty})"`}>${label}</text>`;
}

function renderSVG(p) {
  const S = 2.2; // scale
  const W = 1200, H = 900;
  const px = 120, py = 90; // 평면도 원점
  const w = p.width * S, dp = p.depth * S, t = p.thickness * S;
  const fy = py + dp + 90;              // 정면도 y
  const sx = px + w + 110;              // 측면도 x
  let holesSvg = '', holeDims = '';
  for (const h of p.holes) {
    const cx = px + h.x * S, cy = py + (p.depth - h.y) * S, rr = (h.d / 2) * S;
    holesSvg += `<circle cx="${cx}" cy="${cy}" r="${rr}" stroke="#000" stroke-width="1.6" fill="none"/>
      <path d="M${cx - rr - 6},${cy} H${cx + rr + 6} M${cx},${cy - rr - 6} V${cy + rr + 6}" stroke="#000" stroke-width="0.7" stroke-dasharray="8 3 2 3"/>`;
  }
  // 대표 구멍 1개에 지름·위치 치수
  const h0 = p.holes[0];
  const hx = px + h0.x * S, hy = py + (p.depth - h0.y) * S;
  holeDims = `
  <text x="${hx + (h0.d / 2) * S + 8}" y="${hy - 8}" font-size="14" font-family="monospace">⌀${h0.d} (${p.holes.length}EA)</text>
  ${dim(px, py + dp + 28, hx, py + dp + 28, String(h0.x))}
  ${dim(px - 28, py + dp, px - 28, hy, String(h0.y))}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" style="background:#fff">
  <rect width="${W}" height="${H}" fill="#fff"/>
  <text x="30" y="40" font-size="18" font-family="monospace">PART: RECTANGULAR PLATE — THIRD ANGLE PROJECTION, UNIT: mm</text>
  <!-- 평면도 (TOP VIEW) -->
  <rect x="${px}" y="${py}" width="${w}" height="${dp}" stroke="#000" stroke-width="2" fill="none"/>
  ${holesSvg}${holeDims}
  <text x="${px}" y="${py - 12}" font-size="13" font-family="monospace">TOP VIEW</text>
  ${dim(px, py - 34, px + w, py - 34, String(p.width))}
  ${dim(px - 52, py, px - 52, py + dp, String(p.depth))}
  <!-- 정면도 (FRONT VIEW) -->
  <rect x="${px}" y="${fy}" width="${w}" height="${t}" stroke="#000" stroke-width="2" fill="none"/>
  <text x="${px}" y="${fy - 12}" font-size="13" font-family="monospace">FRONT VIEW</text>
  ${dim(px + w + 30, fy, px + w + 30, fy + t, String(p.thickness))}
  <!-- 측면도 (SIDE VIEW) -->
  <rect x="${sx}" y="${fy}" width="${dp}" height="${t}" stroke="#000" stroke-width="2" fill="none"/>
  <text x="${sx}" y="${fy - 12}" font-size="13" font-family="monospace">SIDE VIEW</text>
  ${dim(sx, fy + t + 30, sx + dp, fy + t + 30, String(p.depth))}
</svg>`;
}

const count = +(process.argv[2] ?? 5);
const seed = +(process.argv[3] ?? 42);
const r = rng(seed);
for (let i = 1; i <= count; i++) {
  const part = genPart(r);
  const svg = renderSVG(part);
  const name = `plate-${String(i).padStart(2, '0')}`;
  writeFileSync(join(OUT, `${name}.gt.json`), JSON.stringify(part, null, 1));
  await sharp(Buffer.from(svg)).png().toFile(join(OUT, `${name}.png`));
  console.log(name, JSON.stringify({ w: part.width, d: part.depth, t: part.thickness, holes: part.holes.length }));
}
console.log(`done: ${count} drawings + GT in ${OUT}`);
