'use client';

/**
 * Photo → tonal layered relief (레이어드 포토 아트). No AI model needed: decode
 * the image, take luminance as a pseudo-height, quantize into N tonal bands, and
 * trace each band's contour (marching squares). Stacking the cut bands rebuilds
 * the photo as a layered relief. Also builds a height-displaced mesh for the 3D
 * preview. Brighter = higher (consistent between the 2D layers and 3D preview).
 */
import type { Seg } from '@/lib/papercraft/netDxf';

export interface ReliefField { w: number; h: number; vals: Float32Array }

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; });
}

/** Decode a data-URL image to a luminance field, downscaled to maxDim. */
export async function imageToField(dataUrl: string, maxDim = 140): Promise<ReliefField> {
  const img = await loadImage(dataUrl);
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const w = Math.max(2, Math.round(img.width * scale));
  const h = Math.max(2, Math.round(img.height * scale));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  ctx.drawImage(img, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  const vals = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const a = d[i * 4 + 3];
    vals[i] = a < 16 ? 0 : (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) / 255;
  }
  return { w, h, vals: boxBlur(vals, w, h, 1) };
}

/** Small separable box blur — smooths the luminance so tonal-band contours come
 *  out cleaner (less jagged "투박" stair-stepping). */
function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  if (r < 1) return src;
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let k = -r; k <= r; k++) { const xx = x + k; if (xx >= 0 && xx < w) { s += src[y * w + xx]; n++; } }
    tmp[y * w + x] = s / n;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let k = -r; k <= r; k++) { const yy = y + k; if (yy >= 0 && yy < h) { s += tmp[yy * w + x]; n++; } }
    out[y * w + x] = s / n;
  }
  return out;
}

/** Marching-squares contour segments for threshold t (image-pixel coords). */
function contourSegs(f: ReliefField, t: number): Array<[number, number, number, number]> {
  const { w, h, vals } = f;
  const at = (x: number, y: number) => vals[y * w + x];
  const segs: Array<[number, number, number, number]> = [];
  const ix = (a: number, b: number) => (t - a) / ((b - a) || 1e-6);
  for (let y = 0; y < h - 1; y++) for (let x = 0; x < w - 1; x++) {
    const tl = at(x, y), tr = at(x + 1, y), br = at(x + 1, y + 1), bl = at(x, y + 1);
    let cs = 0; if (tl >= t) cs |= 8; if (tr >= t) cs |= 4; if (br >= t) cs |= 2; if (bl >= t) cs |= 1;
    if (cs === 0 || cs === 15) continue;
    const top: [number, number] = [x + ix(tl, tr), y];
    const right: [number, number] = [x + 1, y + ix(tr, br)];
    const bot: [number, number] = [x + ix(bl, br), y + 1];
    const left: [number, number] = [x, y + ix(tl, bl)];
    const push = (a: [number, number], b: [number, number]) => segs.push([a[0], a[1], b[0], b[1]]);
    switch (cs) {
      case 1: case 14: push(left, bot); break;
      case 2: case 13: push(bot, right); break;
      case 3: case 12: push(left, right); break;
      case 4: case 11: push(top, right); break;
      case 5: push(left, top); push(bot, right); break;
      case 6: case 9: push(top, bot); break;
      case 7: case 8: push(left, top); break;
      case 10: push(top, right); push(left, bot); break;
    }
  }
  return segs;
}

/** N tonal bands → CUT contours, laid out in a grid (one cut shape per layer). */
export function reliefToSegs(f: ReliefField, levels: number, cell = 2): { segs: Seg[]; layerCount: number } {
  const cols = Math.ceil(Math.sqrt(levels));
  const cw = f.w * cell, ch = f.h * cell;
  const gap = Math.max(8, Math.min(cw, ch) * 0.18);
  const out: Seg[] = [];
  let count = 0;
  for (let k = 1; k <= levels; k++) {
    const t = k / (levels + 1);
    const raw = contourSegs(f, t);
    if (raw.length === 0) continue;
    const col = count % cols, row = Math.floor(count / cols);
    const ox = col * (cw + gap), oy = row * (ch + gap);
    for (const [x1, y1, x2, y2] of raw) {
      out.push({ a: [x1 * cell + ox, (f.h - y1) * cell + oy], b: [x2 * cell + ox, (f.h - y2) * cell + oy], layer: 'CUT' });
    }
    count++;
  }
  return { segs: out, layerCount: count };
}

/** Height-displaced grid mesh (positions) for the 3D relief preview. */
export function reliefHeightmap(f: ReliefField, sizeMm = 120, depthMm = 18): number[] {
  const { w, h, vals } = f;
  const big = Math.max(w, h);
  const sx = sizeMm / (big - 1), sy = sizeMm / (big - 1);
  const z = (x: number, y: number) => vals[y * w + x] * depthMm;
  const pos: number[] = [];
  const P = (x: number, y: number) => { pos.push(x * sx - (w * sx) / 2, (h - 1 - y) * sy - (h * sy) / 2, z(x, y)); };
  for (let y = 0; y < h - 1; y++) for (let x = 0; x < w - 1; x++) {
    P(x, y); P(x + 1, y); P(x + 1, y + 1);
    P(x, y); P(x + 1, y + 1); P(x, y + 1);
  }
  return pos;
}
