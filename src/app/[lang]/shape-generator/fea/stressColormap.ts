/**
 * stressColormap.ts — Stress scalar → RGB mapping for FEA viz.
 *
 * The picker offers three industry-standard colormaps:
 *   - **rainbow**: blue (low) → cyan → green → yellow → red (high).
 *     Familiar but criticised for misleading perception (luminance
 *     reverses). We ship it because every FEA package has it and
 *     users expect to see it as an option.
 *   - **heatmap**: black → red → yellow → white. Perceptually
 *     monotonic — better for printed reports.
 *   - **banded**: discrete colour bands (4 / 8 / 16 stops). Used when
 *     the report needs to show "stress class" rather than continuous
 *     gradients. Banded mode also makes safety-factor cliffs visible.
 *
 * Range mapping:
 *   - Caller supplies a `domain` [min, max].
 *   - Values outside the domain clamp to the end colour.
 *   - Optional `log = true` applies log10 mapping for highly skewed
 *     stress distributions (typical near singularities).
 */

export type ColormapName = 'rainbow' | 'heatmap' | 'banded';

export interface ColormapSettings {
  name: ColormapName;
  /** [min, max] stress range mapped to the colour stops. */
  domain: [number, number];
  /** Log10-scale the input before mapping (better for stress hotspots). */
  log?: boolean;
  /** Band count when `name='banded'`. Default 8. */
  bands?: number;
}

export type Rgb = [number, number, number];

/** Clamp + remap a value from [a, b] into [0, 1]. */
function normalise(v: number, a: number, b: number): number {
  if (b <= a) return 0;
  return Math.max(0, Math.min(1, (v - a) / (b - a)));
}

/** Rainbow colormap: HSV with hue swept from 240° (blue) → 0° (red),
 *  full saturation, full value. */
export function rainbowColour(t: number): Rgb {
  // Hue 240° (blue) at t=0 → 0° (red) at t=1. Then HSV→RGB.
  const hue = (1 - t) * 240; // 240 → 0
  const h = hue / 60;
  const c = 1; // sat * value
  const x = c * (1 - Math.abs((h % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (h < 1) { r = c; g = x; }
  else if (h < 2) { r = x; g = c; }
  else if (h < 3) { g = c; b = x; }
  else if (h < 4) { g = x; b = c; }
  else if (h < 5) { r = x; b = c; }
  else { r = c; b = x; }
  return [r, g, b];
}

/** Heat colormap: black → red → orange → yellow → white. Monotonic
 *  luminance — preferred for grayscale-friendly reports. */
export function heatmapColour(t: number): Rgb {
  const r = Math.min(1, t * 3);
  const g = Math.max(0, Math.min(1, t * 3 - 1));
  const b = Math.max(0, Math.min(1, t * 3 - 2));
  return [r, g, b];
}

/** Quantise t to `bands` discrete steps before lookup. */
function quantise(t: number, bands: number): number {
  const b = Math.max(2, Math.floor(bands));
  return Math.floor(t * b) / b;
}

/** Map a stress value to an RGB triple per the colormap settings. */
export function stressToColour(value: number, settings: ColormapSettings): Rgb {
  if (!Number.isFinite(value)) return [0.5, 0.5, 0.5]; // grey for invalid
  const [a, b] = settings.domain;
  const xRaw = settings.log
    ? Math.log10(Math.max(value, 1e-9))
    : value;
  const xa = settings.log ? Math.log10(Math.max(a, 1e-9)) : a;
  const xb = settings.log ? Math.log10(Math.max(b, 1e-9)) : b;
  let t = normalise(xRaw, xa, xb);

  if (settings.name === 'banded') {
    t = quantise(t, settings.bands ?? 8);
  }

  switch (settings.name) {
    case 'rainbow':
    case 'banded':
      return rainbowColour(t);
    case 'heatmap':
      return heatmapColour(t);
  }
}

/** Bulk version — colour an entire vertex array. Returns a flat
 *  Float32Array of `[r, g, b, r, g, b, …]`. */
export function colourField(values: ArrayLike<number>, settings: ColormapSettings): Float32Array {
  const out = new Float32Array(values.length * 3);
  for (let i = 0; i < values.length; i++) {
    const [r, g, b] = stressToColour(values[i], settings);
    out[i * 3] = r;
    out[i * 3 + 1] = g;
    out[i * 3 + 2] = b;
  }
  return out;
}
