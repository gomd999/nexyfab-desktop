/**
 * 2D→3D — 합성 도면 생성기 v2 (어휘 5종 + 스캔열화 증강).
 * 어휘: plate_with_holes · stepped_plate · l_bracket · flange · bent_sheet(U채널)
 * usage: node gen-drawing.mjs [count=50] [seed=42] [--scanify-half]
 *   --scanify-half: 짝수 인덱스에 스캔열화(회전·블러·JPEG·감마) 적용
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

function rng(seed) { let s = seed >>> 0; return () => ((s = (1664525 * s + 1013904223) >>> 0), s / 2 ** 32); }
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];

/* ── 파트 생성 ── */
const GEN = {
  plate_with_holes(r) {
    const width = 60 + Math.round(r() * 14) * 10, depth = 40 + Math.round(r() * 10) * 10;
    const thickness = 6 + Math.round(r() * 7) * 2, n = 2 + Math.floor(r() * 3), d = pick(r, [6, 8, 10, 12]);
    const m = Math.max(12, d), g = [[m, m], [width - m, m], [width - m, depth - m], [m, depth - m]];
    return { type: 'plate_with_holes', unit: 'mm', width, depth, thickness, holes: g.slice(0, n).map(([x, y]) => ({ x, y, d })) };
  },
  stepped_plate(r) {
    const width = 80 + Math.round(r() * 12) * 10, depth = 40 + Math.round(r() * 8) * 10;
    const thickness = 12 + Math.round(r() * 5) * 2;
    const stepWidth = 20 + Math.round(r() * Math.max(1, (width - 40) / 10)) * 10;
    const stepThickness = Math.max(4, thickness - (4 + Math.round(r() * 2) * 2));
    return { type: 'stepped_plate', unit: 'mm', width, depth, thickness, stepWidth: Math.min(stepWidth, width - 20), stepThickness };
  },
  l_bracket(r) {
    const legA = 50 + Math.round(r() * 10) * 10, legB = 40 + Math.round(r() * 8) * 10;
    const width = 30 + Math.round(r() * 7) * 10, thickness = pick(r, [4, 5, 6, 8, 10]);
    return { type: 'l_bracket', unit: 'mm', legA, legB, width, thickness };
  },
  flange(r) {
    const outerDia = 100 + Math.round(r() * 10) * 10, boreDia = 30 + Math.round(r() * 4) * 10;
    const thickness = 10 + Math.round(r() * 5) * 2;
    const bcd = Math.round((boreDia + outerDia) / 2 / 10) * 10;
    const boltHoleD = pick(r, [8, 10, 12]), boltCount = pick(r, [4, 6, 8]);
    return { type: 'flange', unit: 'mm', outerDia, boreDia, thickness, bcd, boltHoleD, boltCount };
  },
  bent_sheet(r) {
    const webWidth = 40 + Math.round(r() * 8) * 10, flangeHeight = 20 + Math.round(r() * 6) * 5;
    const length = 60 + Math.round(r() * 10) * 10, thickness = pick(r, [1.5, 2, 3, 4]);
    return { type: 'bent_sheet', unit: 'mm', webWidth, flangeHeight, length, thickness };
  },
};

/* ── SVG 공통 ── */
function dim(x1, y1, x2, y2, label, off = 0) {
  const horiz = y1 === y2, tx = (x1 + x2) / 2, ty = (y1 + y2) / 2, a = 5;
  const arr = (x, y, s) => horiz ? `M${x},${y} l${s * a},${-a / 2} M${x},${y} l${s * a},${a / 2}` : `M${x},${y} l${-a / 2},${s * a} M${x},${y} l${a / 2},${s * a}`;
  return `<path d="M${x1},${y1} L${x2},${y2} ${arr(x1, y1, 1)} ${arr(x2, y2, -1)}" stroke="#000" stroke-width="1" fill="none"/>
  <text x="${horiz ? tx : tx - 8 + off}" y="${horiz ? ty - 5 + off : ty}" font-size="14" font-family="monospace" text-anchor="middle" ${horiz ? '' : `transform="rotate(-90 ${tx - 8 + off} ${ty})"`}>${label}</text>`;
}
const view = (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" stroke="#000" stroke-width="2" fill="none"/>`;
const label = (x, y, t) => `<text x="${x}" y="${y}" font-size="13" font-family="monospace">${t}</text>`;
const wrap = (title, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900"><rect width="1200" height="900" fill="#fff"/>
<text x="30" y="40" font-size="18" font-family="monospace">${title} — THIRD ANGLE PROJECTION, UNIT: mm</text>${body}</svg>`;

/* ── 타입별 3면도 ── */
const RENDER = {
  plate_with_holes(p) {
    const S = 2.2, px = 120, py = 90, w = p.width * S, dp = p.depth * S, t = p.thickness * S, fy = py + dp + 90, sx = px + w + 110;
    let hs = '';
    for (const h of p.holes) {
      const cx = px + h.x * S, cy = py + (p.depth - h.y) * S, rr = (h.d / 2) * S;
      hs += `<circle cx="${cx}" cy="${cy}" r="${rr}" stroke="#000" stroke-width="1.6" fill="none"/><path d="M${cx - rr - 6},${cy} H${cx + rr + 6} M${cx},${cy - rr - 6} V${cy + rr + 6}" stroke="#000" stroke-width="0.7" stroke-dasharray="8 3 2 3"/>`;
    }
    const h0 = p.holes[0], hx = px + h0.x * S, hy = py + (p.depth - h0.y) * S;
    return wrap('PART: RECTANGULAR PLATE', `${view(px, py, w, dp)}${hs}
      <text x="${hx + (h0.d / 2) * S + 8}" y="${hy - 8}" font-size="14" font-family="monospace">⌀${h0.d} (${p.holes.length}EA)</text>
      ${dim(px, py + dp + 28, hx, py + dp + 28, String(h0.x))}${dim(px - 28, py + dp, px - 28, hy, String(h0.y))}
      ${label(px, py - 12, 'TOP VIEW')}${dim(px, py - 34, px + w, py - 34, String(p.width))}${dim(px - 52, py, px - 52, py + dp, String(p.depth))}
      ${view(px, fy, w, t)}${label(px, fy - 12, 'FRONT VIEW')}${dim(px + w + 30, fy, px + w + 30, fy + t, String(p.thickness))}
      ${view(sx, fy, dp, t)}${label(sx, fy - 12, 'SIDE VIEW')}${dim(sx, fy + t + 30, sx + dp, fy + t + 30, String(p.depth))}`);
  },
  stepped_plate(p) {
    const S = 2.2, px = 120, py = 90, w = p.width * S, dp = p.depth * S, t = p.thickness * S, st = p.stepThickness * S, sw = p.stepWidth * S;
    const fy = py + dp + 90, sx = px + w + 110;
    const prof = `<path d="M${px},${fy + t} L${px},${fy + t - st} L${px + sw},${fy + t - st} L${px + sw},${fy} L${px + w},${fy} L${px + w},${fy + t} Z" stroke="#000" stroke-width="2" fill="none"/>`;
    return wrap('PART: STEPPED PLATE', `${view(px, py, w, dp)}
      <line x1="${px + sw}" y1="${py}" x2="${px + sw}" y2="${py + dp}" stroke="#000" stroke-width="1.4"/>
      ${label(px, py - 12, 'TOP VIEW')}${dim(px, py - 34, px + w, py - 34, String(p.width))}${dim(px - 52, py, px - 52, py + dp, String(p.depth))}
      ${dim(px, py + dp + 28, px + sw, py + dp + 28, String(p.stepWidth))}
      ${prof}${label(px, fy - 12, 'FRONT VIEW (step on left)')}
      ${dim(px + w + 30, fy, px + w + 30, fy + t, String(p.thickness))}${dim(px - 30, fy + t - st, px - 30, fy + t, String(p.stepThickness))}
      ${view(sx, fy, dp, t)}${label(sx, fy - 12, 'SIDE VIEW')}${dim(sx, fy + t + 30, sx + dp, fy + t + 30, String(p.depth))}`);
  },
  l_bracket(p) {
    const S = 2.4, px = 140, py = 90, la = p.legA * S, lb = p.legB * S, wd = p.width * S, t = p.thickness * S;
    const fy = py + wd + 90, sx = px + la + 110;
    const prof = `<path d="M${sx},${fy} L${sx + t},${fy} L${sx + t},${fy + lb - t} L${sx + la},${fy + lb - t} L${sx + la},${fy + lb} L${sx},${fy + lb} Z" stroke="#000" stroke-width="2" fill="none"/>`;
    return wrap('PART: L-BRACKET (ANGLE)', `${view(px, py, la, wd)}${label(px, py - 12, 'TOP VIEW')}
      ${dim(px, py - 34, px + la, py - 34, String(p.legA))}${dim(px - 52, py, px - 52, py + wd, String(p.width))}
      ${view(px, fy, la, lb)}<line x1="${px}" y1="${fy + lb - t}" x2="${px + la}" y2="${fy + lb - t}" stroke="#000" stroke-width="1" stroke-dasharray="6 4"/>
      ${label(px, fy - 12, 'FRONT VIEW')}${dim(px - 30, fy, px - 30, fy + lb, String(p.legB))}
      ${prof}${label(sx, fy - 12, 'SIDE VIEW (L profile)')}${dim(sx, fy + lb + 30, sx + la, fy + lb + 30, String(p.legA))}
      ${dim(sx + la + 26, fy + lb - t, sx + la + 26, fy + lb, String(p.thickness))}`);
  },
  flange(p) {
    const S = 2.0, cx = 120 + (p.outerDia / 2) * S, cy = 110 + (p.outerDia / 2) * S;
    const R = (p.outerDia / 2) * S, rb = (p.boreDia / 2) * S, rc = (p.bcd / 2) * S, rh = (p.boltHoleD / 2) * S;
    let bolts = '';
    for (let i = 0; i < p.boltCount; i++) {
      const a = (2 * Math.PI * i) / p.boltCount, bx = cx + rc * Math.cos(a), by = cy + rc * Math.sin(a);
      bolts += `<circle cx="${bx}" cy="${by}" r="${rh}" stroke="#000" stroke-width="1.4" fill="none"/>`;
    }
    const fx = cx - R, fy2 = cy + R + 80, t = p.thickness * S;
    return wrap('PART: CIRCULAR FLANGE', `
      <circle cx="${cx}" cy="${cy}" r="${R}" stroke="#000" stroke-width="2" fill="none"/>
      <circle cx="${cx}" cy="${cy}" r="${rb}" stroke="#000" stroke-width="1.8" fill="none"/>
      <circle cx="${cx}" cy="${cy}" r="${rc}" stroke="#000" stroke-width="0.8" stroke-dasharray="10 4 2 4" fill="none"/>${bolts}
      ${label(fx, cy - R - 16, 'TOP VIEW')}
      <text x="${cx + R + 14}" y="${cy - 10}" font-size="14" font-family="monospace">⌀${p.outerDia} O.D.</text>
      <text x="${cx + rb + 10}" y="${cy + 22}" font-size="14" font-family="monospace">⌀${p.boreDia} BORE</text>
      <text x="${cx - rc}" y="${cy - rc - 12}" font-size="14" font-family="monospace">⌀${p.boltHoleD}×${p.boltCount} ON ⌀${p.bcd} B.C.D.</text>
      ${view(fx, fy2, 2 * R, t)}${label(fx, fy2 - 12, 'FRONT VIEW')}${dim(fx + 2 * R + 30, fy2, fx + 2 * R + 30, fy2 + t, String(p.thickness))}
      ${dim(fx, fy2 + t + 30, fx + 2 * R, fy2 + t + 30, String(p.outerDia))}`);
  },
  bent_sheet(p) {
    const S = 2.4, px = 140, py = 90, L = p.length * S, wb = p.webWidth * S, fh = p.flangeHeight * S, t = Math.max(2.5, p.thickness * S);
    const fy = py + wb + 90, sx = px + L + 110;
    const prof = `<path d="M${sx},${fy} L${sx + t},${fy} L${sx + t},${fy + fh - t} L${sx + wb - t},${fy + fh - t} L${sx + wb - t},${fy} L${sx + wb},${fy} L${sx + wb},${fy + fh} L${sx},${fy + fh} Z" stroke="#000" stroke-width="2" fill="none"/>`;
    return wrap('PART: U-CHANNEL (BENT SHEET)', `${view(px, py, L, wb)}
      <line x1="${px}" y1="${py + t}" x2="${px + L}" y2="${py + t}" stroke="#000" stroke-width="1" stroke-dasharray="6 4"/>
      <line x1="${px}" y1="${py + wb - t}" x2="${px + L}" y2="${py + wb - t}" stroke="#000" stroke-width="1" stroke-dasharray="6 4"/>
      ${label(px, py - 12, 'TOP VIEW')}${dim(px, py - 34, px + L, py - 34, String(p.length))}${dim(px - 52, py, px - 52, py + wb, String(p.webWidth))}
      ${view(px, fy, L, fh)}${label(px, fy - 12, 'FRONT VIEW')}${dim(px - 30, fy, px - 30, fy + fh, String(p.flangeHeight))}
      ${prof}${label(sx, fy - 12, 'SIDE VIEW (U profile, flanges up)')}${dim(sx, fy + fh + 30, sx + wb, fy + fh + 30, String(p.webWidth))}
      <text x="${sx + wb + 12}" y="${fy + 16}" font-size="14" font-family="monospace">t=${p.thickness}</text>`);
  },
};

/* ── 스캔열화 (증강) ── */
async function scanify(pngBuf, r) {
  const angle = (r() - 0.5) * 3; // ±1.5°
  const q = 55 + Math.floor(r() * 15);
  const rotated = await sharp(pngBuf).rotate(angle, { background: '#f2f0ec' }).blur(0.6).jpeg({ quality: q }).toBuffer();
  return sharp(rotated).gamma(1.1).modulate({ brightness: 0.97 }).png().toBuffer();
}

export { GEN, RENDER };
const TYPES = Object.keys(GEN);
const isMain = process.argv[1] && process.argv[1].replaceAll('\\', '/').endsWith('gen-drawing.mjs');
if (isMain) {
const count = +(process.argv[2] ?? 50);
const seed = +(process.argv[3] ?? 42);
const scanHalf = process.argv.includes('--scanify-half');
const r = rng(seed);
for (let i = 1; i <= count; i++) {
  const type = TYPES[(i - 1) % TYPES.length];
  const part = GEN[type](r);
  const svg = RENDER[type](part);
  const degraded = scanHalf && i % 2 === 0;
  const name = `${type.replace(/_/g, '-')}-${String(i).padStart(2, '0')}${degraded ? '-scan' : ''}`;
  let png = await sharp(Buffer.from(svg)).png().toBuffer();
  if (degraded) png = await scanify(png, r);
  writeFileSync(join(OUT, `${name}.gt.json`), JSON.stringify(part, null, 1));
  writeFileSync(join(OUT, `${name}.png`), png);
}
console.log(`done: ${count} drawings (${scanHalf ? "half scanified" : "clean"}) in ${OUT}`);
}
