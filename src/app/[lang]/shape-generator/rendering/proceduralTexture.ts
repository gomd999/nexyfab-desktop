/**
 * proceduralTexture.ts — Procedural texture generators.
 *
 * Hand-painted textures are expensive; procedural textures cost
 * 0 disk space and tile seamlessly. Used for:
 *
 *   - Material previews (brushed-metal, wood-grain, marble, leather)
 *     where the customer doesn't yet have an actual scan.
 *   - Multi-color 3D prints: procedural gradient pattern bakes into
 *     vertex colors via UV.
 *   - Render variation: each render gets a slightly different texture
 *     so a 100-piece order doesn't look identical.
 *
 * Generators:
 *
 *   - **Perlin noise** — classic gradient noise.
 *   - **Worley (Voronoi)** — cellular / leather / stone patterns.
 *   - **Checker** — alignment / debug texture.
 *   - **Stripes** — wood-grain or fabric weave.
 *   - **Brick** — masonry / tile.
 *
 * Output: a `TextureGen` function `(u, v) → RGB` evaluable per pixel.
 * Renderer samples it at the desired resolution.
 */

export type RGB = [number, number, number];
export type TextureGen = (u: number, v: number) => RGB;

// ── Perlin noise (2D) ──────────────────────────────────────────

const PERLIN_PERMUTATION: number[] = (() => {
  const p: number[] = [];
  for (let i = 0; i < 256; i++) p.push(i);
  // Seeded Fisher-Yates shuffle (deterministic permutation).
  let seed = 42;
  for (let i = p.length - 1; i > 0; i--) {
    // Math.imul keeps the multiply exact in 32-bit space. The float form
    // (seed * 1103515245) overflows 2^53, zeroing ~8 low bits per state
    // and biasing the shuffle (see meshCompare.ts sampleIndices).
    seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
    const j = seed % (i + 1);
    [p[i], p[j]] = [p[j]!, p[i]!];
  }
  return [...p, ...p];
})();

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function gradient(hash: number, x: number, y: number): number {
  const h = hash & 7;
  const u = h < 4 ? x : y;
  const v = h < 4 ? y : x;
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}

export function perlin2D(x: number, y: number): number {
  const X = Math.floor(x) & 255;
  const Y = Math.floor(y) & 255;
  const xf = x - Math.floor(x);
  const yf = y - Math.floor(y);
  const u = fade(xf);
  const v = fade(yf);
  const A = PERLIN_PERMUTATION[X]! + Y;
  const B = PERLIN_PERMUTATION[X + 1]! + Y;
  const aa = PERLIN_PERMUTATION[A]!;
  const ab = PERLIN_PERMUTATION[A + 1]!;
  const ba = PERLIN_PERMUTATION[B]!;
  const bb = PERLIN_PERMUTATION[B + 1]!;
  const x1 = lerp(gradient(aa, xf, yf), gradient(ba, xf - 1, yf), u);
  const x2 = lerp(gradient(ab, xf, yf - 1), gradient(bb, xf - 1, yf - 1), u);
  return lerp(x1, x2, v);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Multi-octave fractal noise (fBM). */
export function fractalNoise(x: number, y: number, octaves: number = 4, persistence: number = 0.5): number {
  let total = 0;
  let amplitude = 1;
  let frequency = 1;
  let maxValue = 0;
  for (let i = 0; i < octaves; i++) {
    total += perlin2D(x * frequency, y * frequency) * amplitude;
    maxValue += amplitude;
    amplitude *= persistence;
    frequency *= 2;
  }
  return total / maxValue;
}

// ── Worley / Voronoi ──────────────────────────────────────────

export function worley2D(x: number, y: number, cellSize: number = 1): number {
  const cx = Math.floor(x / cellSize);
  const cy = Math.floor(y / cellSize);
  let bestDist = Infinity;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const ncx = cx + dx;
      const ncy = cy + dy;
      // Deterministic feature point per cell.
      const hash = (ncx * 73856093) ^ (ncy * 19349663);
      const featureX = (ncx + ((hash & 0xfff) / 0xfff)) * cellSize;
      const featureY = (ncy + (((hash >>> 12) & 0xfff) / 0xfff)) * cellSize;
      const d = Math.hypot(featureX - x, featureY - y);
      if (d < bestDist) bestDist = d;
    }
  }
  return bestDist / cellSize;
}

// ── Built-in texture generators ────────────────────────────────

export function makePerlinTexture(scale: number = 4, colorA: RGB = [0, 0, 0], colorB: RGB = [1, 1, 1]): TextureGen {
  return (u, v) => {
    const n = perlin2D(u * scale, v * scale) * 0.5 + 0.5;
    return [
      lerp(colorA[0], colorB[0], n),
      lerp(colorA[1], colorB[1], n),
      lerp(colorA[2], colorB[2], n),
    ];
  };
}

export function makeCheckerTexture(divisions: number = 8, colorA: RGB = [1, 1, 1], colorB: RGB = [0, 0, 0]): TextureGen {
  return (u, v) => {
    const x = Math.floor(u * divisions);
    const y = Math.floor(v * divisions);
    return (x + y) % 2 === 0 ? colorA : colorB;
  };
}

export function makeStripeTexture(
  frequency: number = 10,
  axis: 'horizontal' | 'vertical' | 'diagonal' = 'horizontal',
  colorA: RGB = [1, 1, 1],
  colorB: RGB = [0, 0, 0],
): TextureGen {
  return (u, v) => {
    let t: number;
    if (axis === 'horizontal') t = v * frequency;
    else if (axis === 'vertical') t = u * frequency;
    else t = (u + v) * frequency;
    return Math.floor(t) % 2 === 0 ? colorA : colorB;
  };
}

export function makeBrickTexture(
  rows: number = 6,
  cols: number = 4,
  mortar: number = 0.05,
  brickColor: RGB = [0.6, 0.2, 0.15],
  mortarColor: RGB = [0.7, 0.7, 0.7],
): TextureGen {
  return (u, v) => {
    const rowF = v * rows;
    const row = Math.floor(rowF);
    const offset = (row % 2) * 0.5;
    const colF = (u + offset) * cols;
    const inRowGap = (rowF - row) < mortar || (rowF - row) > 1 - mortar;
    const inColGap = (colF - Math.floor(colF)) < mortar || (colF - Math.floor(colF)) > 1 - mortar;
    return inRowGap || inColGap ? mortarColor : brickColor;
  };
}

export function makeWorleyTexture(cellSize: number = 0.1, colorA: RGB = [0, 0, 0], colorB: RGB = [1, 1, 1]): TextureGen {
  return (u, v) => {
    const w = Math.min(1, worley2D(u, v, cellSize));
    return [lerp(colorA[0], colorB[0], w), lerp(colorA[1], colorB[1], w), lerp(colorA[2], colorB[2], w)];
  };
}

export function makeWoodGrainTexture(
  rings: number = 12,
  baseColor: RGB = [0.4, 0.25, 0.15],
  grainColor: RGB = [0.25, 0.12, 0.05],
): TextureGen {
  return (u, v) => {
    const r = Math.hypot(u - 0.5, v - 0.5) * rings + perlin2D(u * 6, v * 6) * 0.4;
    const t = 0.5 + 0.5 * Math.sin(r * Math.PI * 2);
    return [
      lerp(baseColor[0], grainColor[0], t),
      lerp(baseColor[1], grainColor[1], t),
      lerp(baseColor[2], grainColor[2], t),
    ];
  };
}

export function makeMarbleTexture(
  baseColor: RGB = [0.9, 0.9, 0.9],
  veinColor: RGB = [0.4, 0.4, 0.4],
): TextureGen {
  return (u, v) => {
    const noise = fractalNoise(u * 4, v * 4, 5, 0.6);
    const t = Math.abs(Math.sin((u + noise) * Math.PI * 8));
    return [
      lerp(baseColor[0], veinColor[0], t),
      lerp(baseColor[1], veinColor[1], t),
      lerp(baseColor[2], veinColor[2], t),
    ];
  };
}

// ── Texture compositing ────────────────────────────────────────

export function multiplyTextures(a: TextureGen, b: TextureGen): TextureGen {
  return (u, v) => {
    const ra = a(u, v), rb = b(u, v);
    return [ra[0] * rb[0], ra[1] * rb[1], ra[2] * rb[2]];
  };
}

export function mixTextures(a: TextureGen, b: TextureGen, mix: number): TextureGen {
  return (u, v) => {
    const ra = a(u, v), rb = b(u, v);
    return [
      lerp(ra[0], rb[0], mix),
      lerp(ra[1], rb[1], mix),
      lerp(ra[2], rb[2], mix),
    ];
  };
}

// ── Bake to ImageData ──────────────────────────────────────────

export interface BakedTexture {
  width: number;
  height: number;
  /** RGBA bytes, [0, 255]. */
  data: Uint8ClampedArray;
}

export function bakeTexture(gen: TextureGen, width: number, height: number): BakedTexture {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const u = x / width;
      const v = y / height;
      const [r, g, b] = gen(u, v);
      const idx = (y * width + x) * 4;
      data[idx] = Math.max(0, Math.min(255, Math.round(r * 255)));
      data[idx + 1] = Math.max(0, Math.min(255, Math.round(g * 255)));
      data[idx + 2] = Math.max(0, Math.min(255, Math.round(b * 255)));
      data[idx + 3] = 255;
    }
  }
  return { width, height, data };
}
