/**
 * imageBasedLighting.ts — Image-based lighting (IBL) for PBR renders.
 *
 * Realistic product renders use an HDR environment map (light probe)
 * as the only light source — the scene is lit by the captured photo
 * of a real room / studio / sky. Critical for jewellery, glassware,
 * chrome parts, and other reflective items.
 *
 * The math splits IBL into two pre-computed tables:
 *
 *   1. **Diffuse irradiance** — for each surface normal, integrate
 *      the environment cos-weighted. Stored as a low-res cubemap or
 *      spherical-harmonic (SH) coefficients (9 RGB values).
 *   2. **Specular pre-filtered radiance** — for each surface normal,
 *      pre-blur the environment at multiple roughness levels. Stored
 *      as a mipmapped cubemap.
 *
 * Plus a **BRDF integration LUT** depending only on (NdotV, roughness).
 *
 * Run-time shader: sample the diffuse SH + specular cubemap + BRDF
 * LUT and combine per the split-sum approximation (Karis 2013).
 *
 * This module ships the *CPU-side* computation; the GPU sampler is
 * up to the renderer.
 */

export type Vec3 = [number, number, number];
export type RGB = [number, number, number];

export interface EnvironmentMap {
  /** Width (each cubemap face is square). */
  faceWidth: number;
  /** 6 faces in +X, -X, +Y, -Y, +Z, -Z order, each as RGB float array. */
  faces: Float32Array[];
}

// ── Spherical-harmonic diffuse coefficients ────────────────────

export interface SphericalHarmonics9 {
  /** 9 RGB coefficients flattened: [r0, g0, b0, r1, g1, b1, ..., r8, g8, b8]. */
  coefficients: number[];
}

/** Project the environment map onto 9 spherical-harmonic basis
 *  functions (order 2). Produces a compact diffuse representation. */
export function computeShDiffuse(env: EnvironmentMap): SphericalHarmonics9 {
  const coeffs = new Array(27).fill(0);
  let totalWeight = 0;
  for (let face = 0; face < 6; face++) {
    const data = env.faces[face];
    if (!data) continue;
    for (let y = 0; y < env.faceWidth; y++) {
      for (let x = 0; x < env.faceWidth; x++) {
        const u = (x + 0.5) / env.faceWidth * 2 - 1;
        const v = (y + 0.5) / env.faceWidth * 2 - 1;
        const dir = cubemapDirection(face, u, v);
        // Solid-angle weight (texel area on the unit sphere).
        const len2 = 1 + u * u + v * v;
        const weight = 4 / (len2 * Math.sqrt(len2));
        totalWeight += weight;
        const idx = (y * env.faceWidth + x) * 3;
        const r = data[idx]!;
        const g = data[idx + 1]!;
        const b = data[idx + 2]!;
        const basis = shBasis9(dir);
        for (let k = 0; k < 9; k++) {
          coeffs[k * 3] += r * basis[k]! * weight;
          coeffs[k * 3 + 1] += g * basis[k]! * weight;
          coeffs[k * 3 + 2] += b * basis[k]! * weight;
        }
      }
    }
  }
  // Normalize.
  if (totalWeight > 0) {
    for (let k = 0; k < 27; k++) coeffs[k] *= (4 * Math.PI / totalWeight);
  }
  return { coefficients: coeffs };
}

function shBasis9(d: Vec3): number[] {
  const [x, y, z] = d;
  // L=0 (m=0), L=1 (m=-1,0,1), L=2 (m=-2,-1,0,1,2). Real spherical harmonics.
  return [
    0.282095,                             // Y_00
    0.488603 * y,                         // Y_1-1
    0.488603 * z,                         // Y_10
    0.488603 * x,                         // Y_11
    1.092548 * x * y,                     // Y_2-2
    1.092548 * y * z,                     // Y_2-1
    0.315392 * (3 * z * z - 1),           // Y_20
    1.092548 * x * z,                     // Y_21
    0.546274 * (x * x - y * y),           // Y_22
  ];
}

/** Evaluate diffuse irradiance from SH at a surface normal. */
export function evaluateShIrradiance(sh: SphericalHarmonics9, normal: Vec3): RGB {
  const basis = shBasis9(normal);
  // Cosine-weighted convolution coefficients (Ramamoorthi & Hanrahan 2001).
  const A = [Math.PI, 2.094395, 2.094395, 2.094395, 0.785398, 0.785398, 0.785398, 0.785398, 0.785398];
  let r = 0, g = 0, b = 0;
  for (let k = 0; k < 9; k++) {
    r += sh.coefficients[k * 3]! * basis[k]! * A[k]!;
    g += sh.coefficients[k * 3 + 1]! * basis[k]! * A[k]!;
    b += sh.coefficients[k * 3 + 2]! * basis[k]! * A[k]!;
  }
  return [Math.max(0, r), Math.max(0, g), Math.max(0, b)];
}

// ── Cubemap direction ──────────────────────────────────────────

function cubemapDirection(face: number, u: number, v: number): Vec3 {
  let dir: Vec3;
  switch (face) {
    case 0: dir = [1, -v, -u]; break;   // +X
    case 1: dir = [-1, -v, u]; break;   // -X
    case 2: dir = [u, 1, v]; break;     // +Y
    case 3: dir = [u, -1, -v]; break;   // -Y
    case 4: dir = [u, -v, 1]; break;    // +Z
    case 5: dir = [-u, -v, -1]; break;  // -Z
    default: dir = [0, 0, 1];
  }
  const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  return [dir[0] / len, dir[1] / len, dir[2] / len];
}

// ── Pre-filtered specular cubemap (coarse, single-sample per texel) ─

export interface PrefilteredMipLevel {
  /** Roughness this mip was pre-blurred for. */
  roughness: number;
  /** Each face. */
  faces: Float32Array[];
  /** Face resolution at this mip. */
  faceWidth: number;
}

/** Generate a stack of pre-filtered cubemaps at decreasing resolution
 *  and increasing roughness. Production runs hundreds of importance
 *  samples per pixel; this CPU version uses a simple Gaussian blur
 *  proxy keyed by roughness. */
export function prefilterEnvironmentMap(env: EnvironmentMap, mipCount: number = 5): PrefilteredMipLevel[] {
  const levels: PrefilteredMipLevel[] = [];
  let currentFaces = env.faces;
  let currentWidth = env.faceWidth;
  for (let m = 0; m < mipCount; m++) {
    const roughness = m / Math.max(1, mipCount - 1);
    // Downsample for higher mip levels.
    const targetWidth = Math.max(1, currentWidth >> 1);
    const blurred = blurFaces(currentFaces, currentWidth, roughness);
    if (m === 0) {
      levels.push({ roughness, faces: blurred, faceWidth: currentWidth });
    } else {
      const down = downsampleFaces(blurred, currentWidth, targetWidth);
      levels.push({ roughness, faces: down, faceWidth: targetWidth });
      currentFaces = down;
      currentWidth = targetWidth;
    }
  }
  return levels;
}

function blurFaces(faces: Float32Array[], width: number, roughness: number): Float32Array[] {
  if (roughness <= 0) return faces.map(f => new Float32Array(f));
  const out: Float32Array[] = [];
  const radius = Math.max(1, Math.floor(roughness * 6));
  for (const face of faces) {
    const dst = new Float32Array(face.length);
    for (let y = 0; y < width; y++) {
      for (let x = 0; x < width; x++) {
        let r = 0, g = 0, b = 0, count = 0;
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            const sx = Math.max(0, Math.min(width - 1, x + dx));
            const sy = Math.max(0, Math.min(width - 1, y + dy));
            const idx = (sy * width + sx) * 3;
            r += face[idx]!;
            g += face[idx + 1]!;
            b += face[idx + 2]!;
            count++;
          }
        }
        const dIdx = (y * width + x) * 3;
        dst[dIdx] = r / count;
        dst[dIdx + 1] = g / count;
        dst[dIdx + 2] = b / count;
      }
    }
    out.push(dst);
  }
  return out;
}

function downsampleFaces(faces: Float32Array[], srcWidth: number, dstWidth: number): Float32Array[] {
  return faces.map(face => {
    const dst = new Float32Array(dstWidth * dstWidth * 3);
    const scale = srcWidth / dstWidth;
    for (let y = 0; y < dstWidth; y++) {
      for (let x = 0; x < dstWidth; x++) {
        // Average 2x2 block.
        const sx = Math.floor(x * scale);
        const sy = Math.floor(y * scale);
        let r = 0, g = 0, b = 0, count = 0;
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            const px = Math.min(srcWidth - 1, sx + dx);
            const py = Math.min(srcWidth - 1, sy + dy);
            const idx = (py * srcWidth + px) * 3;
            r += face[idx]!;
            g += face[idx + 1]!;
            b += face[idx + 2]!;
            count++;
          }
        }
        const dIdx = (y * dstWidth + x) * 3;
        dst[dIdx] = r / Math.max(1, count);
        dst[dIdx + 1] = g / Math.max(1, count);
        dst[dIdx + 2] = b / Math.max(1, count);
      }
    }
    return dst;
  });
}

// ── BRDF integration LUT ───────────────────────────────────────

export interface BrdfLut {
  /** Texture width / height. */
  resolution: number;
  /** RG channel data: R = scale, G = bias. */
  data: Float32Array;
}

/** Generate the Smith-GGX BRDF integration LUT keyed by (NdotV, roughness).
 *  CPU pre-bake; final shader does a 2D texture sample. */
export function generateBrdfLut(resolution: number = 64, sampleCount: number = 16): BrdfLut {
  const data = new Float32Array(resolution * resolution * 2);
  for (let y = 0; y < resolution; y++) {
    const roughness = Math.max(0.001, y / (resolution - 1));
    for (let x = 0; x < resolution; x++) {
      const ndotv = Math.max(0.001, x / (resolution - 1));
      let scale = 0, bias = 0;
      for (let s = 0; s < sampleCount; s++) {
        // Hammersley low-discrepancy sequence.
        const xi = s / sampleCount;
        const xi2 = bitReverse(s) / 0xffffffff;
        const phi = 2 * Math.PI * xi;
        const cosTheta = Math.sqrt((1 - xi2) / (1 + (roughness * roughness - 1) * xi2));
        const sinTheta = Math.sqrt(1 - cosTheta * cosTheta);
        const h: Vec3 = [Math.cos(phi) * sinTheta, Math.sin(phi) * sinTheta, cosTheta];
        const v: Vec3 = [Math.sqrt(1 - ndotv * ndotv), 0, ndotv];
        const vdoth = Math.max(0, v[0] * h[0] + v[2] * h[2]);
        const ldotn = 2 * vdoth * h[2] - v[2];
        if (ldotn > 0) {
          const g = smithG(ndotv, ldotn, roughness);
          const fc = Math.pow(1 - vdoth, 5);
          scale += (1 - fc) * g * vdoth / Math.max(0.001, h[2] * ndotv);
          bias += fc * g * vdoth / Math.max(0.001, h[2] * ndotv);
        }
      }
      const idx = (y * resolution + x) * 2;
      data[idx] = scale / sampleCount;
      data[idx + 1] = bias / sampleCount;
    }
  }
  return { resolution, data };
}

function smithG(ndotv: number, ndotl: number, roughness: number): number {
  const k = (roughness * roughness) / 2;
  const ggxV = ndotv / (ndotv * (1 - k) + k);
  const ggxL = ndotl / (ndotl * (1 - k) + k);
  return ggxV * ggxL;
}

function bitReverse(x: number): number {
  let n = x >>> 0;
  n = ((n & 0xaaaaaaaa) >>> 1) | ((n & 0x55555555) << 1);
  n = ((n & 0xcccccccc) >>> 2) | ((n & 0x33333333) << 2);
  n = ((n & 0xf0f0f0f0) >>> 4) | ((n & 0x0f0f0f0f) << 4);
  n = ((n & 0xff00ff00) >>> 8) | ((n & 0x00ff00ff) << 8);
  n = ((n >>> 16) | (n << 16)) >>> 0;
  return n;
}

// ── Studio presets ──────────────────────────────────────────────

export const STUDIO_PRESETS: Record<string, { sky: RGB; ground: RGB; sun: RGB }> = {
  daylight_softbox: { sky: [1.2, 1.4, 1.6], ground: [0.4, 0.4, 0.4], sun: [3, 3, 3] },
  sunset: { sky: [0.6, 0.4, 0.5], ground: [0.2, 0.15, 0.1], sun: [3, 1.5, 0.8] },
  overcast: { sky: [0.8, 0.85, 0.9], ground: [0.3, 0.3, 0.3], sun: [0.5, 0.5, 0.5] },
  night_neon: { sky: [0.05, 0.05, 0.15], ground: [0.02, 0.02, 0.05], sun: [0.1, 0.1, 0.2] },
};

/** Generate a synthetic cubemap from a preset. */
export function buildPresetCubemap(presetName: string, faceWidth: number = 32): EnvironmentMap {
  const preset = STUDIO_PRESETS[presetName] ?? STUDIO_PRESETS.daylight_softbox;
  if (!preset) throw new Error('Preset missing');
  const faces: Float32Array[] = [];
  for (let f = 0; f < 6; f++) {
    const arr = new Float32Array(faceWidth * faceWidth * 3);
    let r: number, g: number, b: number;
    if (f === 2) { // +Y = sky
      [r, g, b] = preset.sky;
    } else if (f === 3) { // -Y = ground
      [r, g, b] = preset.ground;
    } else {
      // Horizon = sky / ground blend.
      r = (preset.sky[0] + preset.ground[0]) / 2;
      g = (preset.sky[1] + preset.ground[1]) / 2;
      b = (preset.sky[2] + preset.ground[2]) / 2;
    }
    for (let i = 0; i < faceWidth * faceWidth; i++) {
      arr[i * 3] = r;
      arr[i * 3 + 1] = g;
      arr[i * 3 + 2] = b;
    }
    faces.push(arr);
  }
  return { faceWidth, faces };
}
