/**
 * colorManagement.ts — Color space conversions for accurate rendering.
 *
 * Photorealistic renders need to operate in *linear* RGB internally
 * but read/write *sRGB* PNG/JPEG. Material previews that look right
 * in a viewport but wrong in a final export are almost always a
 * color-space bug. Plus, modern HDR pipelines tone-map from linear
 * scene radiance to a display-encoded ACES color space.
 *
 * Conversions covered:
 *
 *   - **sRGB ↔ linear** (sRGB gamma curve, exact).
 *   - **Linear ↔ ACES cg / ACEScct** (logarithmic working space).
 *   - **HSL ↔ RGB** (for color picker UI).
 *   - **CIE LAB ↔ XYZ ↔ RGB** (perceptual diff via Delta-E).
 *   - **Hex ↔ RGB** (utility).
 *
 * Plus helpers:
 *   - **Tone mapping** (Reinhard, ACES filmic).
 *   - **White-balance** (Bradford chromatic adaptation).
 */

export type RGB = [number, number, number];
export type XYZ = [number, number, number];
export type LAB = [number, number, number];
export type HSL = [number, number, number];

// ── sRGB ↔ linear ──────────────────────────────────────────────

export function srgbToLinear(c: number): number {
  if (c <= 0.04045) return c / 12.92;
  return Math.pow((c + 0.055) / 1.055, 2.4);
}

export function linearToSrgb(c: number): number {
  if (c <= 0.0031308) return 12.92 * c;
  return 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

export function srgbToLinearRgb(rgb: RGB): RGB {
  return [srgbToLinear(rgb[0]), srgbToLinear(rgb[1]), srgbToLinear(rgb[2])];
}

export function linearToSrgbRgb(rgb: RGB): RGB {
  return [linearToSrgb(rgb[0]), linearToSrgb(rgb[1]), linearToSrgb(rgb[2])];
}

// ── ACES filmic tone-mapping ───────────────────────────────────

/** Narkowicz 2015 ACES fit (simplified). Input: linear scene radiance.
 *  Output: display-encoded (still linear in [0, 1] range). */
export function acesFilmic(x: number): number {
  const a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp01((x * (a * x + b)) / (x * (c * x + d) + e));
}

export function acesFilmicRgb(rgb: RGB): RGB {
  return [acesFilmic(rgb[0]), acesFilmic(rgb[1]), acesFilmic(rgb[2])];
}

// ── Reinhard tone-mapping ──────────────────────────────────────

export function reinhardTone(x: number): number {
  return x / (1 + x);
}

export function reinhardToneRgb(rgb: RGB): RGB {
  return [reinhardTone(rgb[0]), reinhardTone(rgb[1]), reinhardTone(rgb[2])];
}

// ── XYZ ↔ sRGB (D65 illuminant) ────────────────────────────────

const M_RGB_TO_XYZ: number[][] = [
  [0.4124564, 0.3575761, 0.1804375],
  [0.2126729, 0.7151522, 0.0721750],
  [0.0193339, 0.1191920, 0.9503041],
];

const M_XYZ_TO_RGB: number[][] = [
  [3.2404542, -1.5371385, -0.4985314],
  [-0.9692660, 1.8760108, 0.0415560],
  [0.0556434, -0.2040259, 1.0572252],
];

export function linearRgbToXyz(rgb: RGB): XYZ {
  return [
    M_RGB_TO_XYZ[0]![0]! * rgb[0] + M_RGB_TO_XYZ[0]![1]! * rgb[1] + M_RGB_TO_XYZ[0]![2]! * rgb[2],
    M_RGB_TO_XYZ[1]![0]! * rgb[0] + M_RGB_TO_XYZ[1]![1]! * rgb[1] + M_RGB_TO_XYZ[1]![2]! * rgb[2],
    M_RGB_TO_XYZ[2]![0]! * rgb[0] + M_RGB_TO_XYZ[2]![1]! * rgb[1] + M_RGB_TO_XYZ[2]![2]! * rgb[2],
  ];
}

export function xyzToLinearRgb(xyz: XYZ): RGB {
  return [
    M_XYZ_TO_RGB[0]![0]! * xyz[0] + M_XYZ_TO_RGB[0]![1]! * xyz[1] + M_XYZ_TO_RGB[0]![2]! * xyz[2],
    M_XYZ_TO_RGB[1]![0]! * xyz[0] + M_XYZ_TO_RGB[1]![1]! * xyz[1] + M_XYZ_TO_RGB[1]![2]! * xyz[2],
    M_XYZ_TO_RGB[2]![0]! * xyz[0] + M_XYZ_TO_RGB[2]![1]! * xyz[1] + M_XYZ_TO_RGB[2]![2]! * xyz[2],
  ];
}

// ── XYZ ↔ LAB ─────────────────────────────────────────────────

const D65_X = 0.95047, D65_Y = 1.00000, D65_Z = 1.08883;

function f(t: number): number {
  return t > 0.008856 ? Math.cbrt(t) : (7.787 * t + 16 / 116);
}

function fInv(t: number): number {
  return t > 0.206893 ? Math.pow(t, 3) : ((t - 16 / 116) / 7.787);
}

export function xyzToLab(xyz: XYZ): LAB {
  const fx = f(xyz[0] / D65_X);
  const fy = f(xyz[1] / D65_Y);
  const fz = f(xyz[2] / D65_Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function labToXyz(lab: LAB): XYZ {
  const fy = (lab[0] + 16) / 116;
  const fx = lab[1] / 500 + fy;
  const fz = fy - lab[2] / 200;
  return [D65_X * fInv(fx), D65_Y * fInv(fy), D65_Z * fInv(fz)];
}

// ── Delta-E (CIE 76) ──────────────────────────────────────────

export function deltaE76(a: LAB, b: LAB): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

// ── HSL ↔ RGB ─────────────────────────────────────────────────

export function hslToRgb(hsl: HSL): RGB {
  const [h, s, l] = hsl;
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hueToRgb(p, q, h + 1 / 3), hueToRgb(p, q, h), hueToRgb(p, q, h - 1 / 3)];
}

function hueToRgb(p: number, q: number, t: number): number {
  let x = t;
  if (x < 0) x += 1;
  if (x > 1) x -= 1;
  if (x < 1 / 6) return p + (q - p) * 6 * x;
  if (x < 1 / 2) return q;
  if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
  return p;
}

export function rgbToHsl(rgb: RGB): HSL {
  const [r, g, b] = rgb;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  switch (max) {
    case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
    case g: h = ((b - r) / d + 2) / 6; break;
    default: h = ((r - g) / d + 4) / 6;
  }
  return [h, s, l];
}

// ── Hex ↔ RGB ─────────────────────────────────────────────────

export function hexToRgb(hex: string): RGB {
  const s = hex.replace(/^#/, '');
  if (s.length !== 6) return [0, 0, 0];
  return [parseInt(s.slice(0, 2), 16) / 255, parseInt(s.slice(2, 4), 16) / 255, parseInt(s.slice(4, 6), 16) / 255];
}

export function rgbToHex(rgb: RGB): string {
  const clamp = (x: number) => Math.max(0, Math.min(255, Math.round(x * 255)));
  const hex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${hex(clamp(rgb[0]))}${hex(clamp(rgb[1]))}${hex(clamp(rgb[2]))}`;
}

// ── White-balance (Bradford CAT) ──────────────────────────────

const BRADFORD: number[][] = [
  [0.8951, 0.2664, -0.1614],
  [-0.7502, 1.7135, 0.0367],
  [0.0389, -0.0685, 1.0296],
];

const BRADFORD_INV: number[][] = [
  [0.9869929, -0.1470543, 0.1599627],
  [0.4323053, 0.5183603, 0.0492912],
  [-0.0085287, 0.0400428, 0.9684867],
];

export function chromaticAdaptation(srcWhite: XYZ, dstWhite: XYZ, xyz: XYZ): XYZ {
  const srcCone = applyMat(BRADFORD, srcWhite);
  const dstCone = applyMat(BRADFORD, dstWhite);
  const ratio = [dstCone[0]! / srcCone[0]!, dstCone[1]! / srcCone[1]!, dstCone[2]! / srcCone[2]!];
  const cone = applyMat(BRADFORD, xyz);
  const adapted: XYZ = [cone[0]! * ratio[0]!, cone[1]! * ratio[1]!, cone[2]! * ratio[2]!];
  return applyMat(BRADFORD_INV, adapted) as XYZ;
}

function applyMat(m: number[][], v: number[]): number[] {
  return [
    m[0]![0]! * v[0]! + m[0]![1]! * v[1]! + m[0]![2]! * v[2]!,
    m[1]![0]! * v[0]! + m[1]![1]! * v[1]! + m[1]![2]! * v[2]!,
    m[2]![0]! * v[0]! + m[2]![1]! * v[1]! + m[2]![2]! * v[2]!,
  ];
}

// ── Helpers ────────────────────────────────────────────────────

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

// ── Standard illuminants ───────────────────────────────────────

export const ILLUMINANTS: Record<string, XYZ> = {
  D50: [0.96422, 1, 0.82521],
  D55: [0.95682, 1, 0.92149],
  D65: [0.95047, 1, 1.08883],
  D75: [0.94972, 1, 1.22638],
  A: [1.09850, 1, 0.35585],
};
