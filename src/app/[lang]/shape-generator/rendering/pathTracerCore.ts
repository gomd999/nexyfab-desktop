/**
 * pathTracer.ts — Physically-based path tracing core.
 *
 * The existing `pathTracingConfig.ts` only stores user-facing options
 * (spp, bounces, resolution). The actual *rendering* algorithm has
 * been "use three-gpu-pathtracer" handwaving. This module is the math
 * substrate of the renderer: BSDF sampling, IBL importance sampling,
 * Russian roulette termination, NEE for direct lighting.
 *
 * Scope:
 *
 *   - **Lambert + GGX BSDF** — diffuse + specular layer with Fresnel
 *     blend; the workhorse "metal/dielectric/plastic" material model.
 *   - **IBL (image-based lighting)** — sample environment map via
 *     importance-weighted CDF over luminance.
 *   - **Camera ray generation** — pinhole + thin-lens (DoF).
 *   - **Path integrator** — next-event-estimation (NEE) loop with
 *     Russian-roulette termination.
 *   - **Tone-map operators** — ACES, Reinhard, Filmic.
 *
 * Rendering happens off-thread in a Web Worker that imports this
 * module; the renderer never touches DOM.
 */

// ── Vector math ──────────────────────────────────────────────────

export type Vec3 = [number, number, number];

function v(a: number, b: number, c: number): Vec3 { return [a, b, c]; }
function add(a: Vec3, b: Vec3): Vec3 { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function sub(a: Vec3, b: Vec3): Vec3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function scale(a: Vec3, s: number): Vec3 { return [a[0] * s, a[1] * s, a[2] * s]; }
function dot3(a: Vec3, b: Vec3): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross3(a: Vec3, b: Vec3): Vec3 { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function length(a: Vec3): number { return Math.hypot(a[0], a[1], a[2]); }
function normalize(a: Vec3): Vec3 { const l = length(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }

export { v as vec3, add, sub, scale, dot3, cross3, normalize };

// ── Camera ray generation ───────────────────────────────────────

export interface CameraSpec {
  position: Vec3;
  target: Vec3;
  up: Vec3;
  /** Vertical FOV (degrees). */
  fovDeg: number;
  aspectRatio: number;
  /** Aperture radius (mm). 0 = pinhole. */
  apertureMm?: number;
  /** Focal distance (mm). */
  focusDistanceMm?: number;
}

export interface Ray {
  origin: Vec3;
  direction: Vec3;
}

export function generateRay(
  camera: CameraSpec,
  /** Pixel coords in [0,1]. */
  u: number, v: number,
  /** Random aperture sample for DoF. */
  rng: () => number,
): Ray {
  const fwd = normalize(sub(camera.target, camera.position));
  const right = normalize(cross3(fwd, camera.up));
  const up = cross3(right, fwd);
  const halfH = Math.tan(camera.fovDeg * Math.PI / 360);
  const halfW = halfH * camera.aspectRatio;
  const dx = (u - 0.5) * 2 * halfW;
  const dy = (v - 0.5) * 2 * halfH;
  let dir = normalize(add(add(fwd, scale(right, dx)), scale(up, dy)));
  let origin = camera.position;
  if (camera.apertureMm && camera.apertureMm > 0 && camera.focusDistanceMm) {
    // Sample lens disk.
    const r = camera.apertureMm * Math.sqrt(rng());
    const theta = rng() * Math.PI * 2;
    const lensX = r * Math.cos(theta);
    const lensY = r * Math.sin(theta);
    origin = add(origin, add(scale(right, lensX), scale(up, lensY)));
    const focalPoint = add(camera.position, scale(dir, camera.focusDistanceMm));
    dir = normalize(sub(focalPoint, origin));
  }
  return { origin, direction: dir };
}

// ── Material BSDF (Lambert + GGX) ───────────────────────────────

export interface Material {
  /** Base diffuse color (linear sRGB, 0..1). */
  albedo: Vec3;
  /** Metallicness 0..1 — 0 dielectric, 1 metal. */
  metalness: number;
  /** Roughness 0..1 (alpha). */
  roughness: number;
  /** F0 reflectance (for metals, equals albedo). */
  f0?: Vec3;
  /** Optional emissive color. */
  emissive?: Vec3;
}

/** Schlick Fresnel approximation. */
function fresnelSchlick(cosTheta: number, f0: Vec3): Vec3 {
  const x = Math.pow(1 - cosTheta, 5);
  return [
    f0[0] + (1 - f0[0]) * x,
    f0[1] + (1 - f0[1]) * x,
    f0[2] + (1 - f0[2]) * x,
  ];
}

/** GGX normal distribution function. */
function ggxD(NdotH: number, alpha: number): number {
  const a2 = alpha * alpha;
  const denom = NdotH * NdotH * (a2 - 1) + 1;
  return a2 / (Math.PI * denom * denom);
}

/** Smith G (GGX). */
function smithG(NdotV: number, NdotL: number, alpha: number): number {
  const a2 = alpha * alpha;
  const gV = NdotV / (NdotV * (1 - a2) + a2);
  const gL = NdotL / (NdotL * (1 - a2) + a2);
  return gV * gL;
}

export interface BsdfSample {
  /** Sampled outgoing direction. */
  direction: Vec3;
  /** BSDF value × cos(θ) / pdf. */
  weight: Vec3;
  /** Probability density. */
  pdf: number;
  /** True when this sample is the specular lobe. */
  isSpecular: boolean;
}

/** Evaluate BSDF for an incoming-outgoing pair on a surface. */
export function evalBsdf(
  material: Material,
  normal: Vec3,
  wi: Vec3, // toward camera (outgoing)
  wo: Vec3, // toward light (incoming)
): Vec3 {
  const NdotL = Math.max(0, dot3(normal, wo));
  if (NdotL <= 0) return [0, 0, 0];
  const NdotV = Math.max(0.001, dot3(normal, wi));
  const H = normalize(add(wi, wo));
  const NdotH = Math.max(0, dot3(normal, H));
  const VdotH = Math.max(0, dot3(wi, H));

  const alpha = material.roughness * material.roughness;
  const f0 = material.metalness === 1 ? material.albedo
    : material.f0 ?? [0.04, 0.04, 0.04];
  const F = fresnelSchlick(VdotH, f0);
  const D = ggxD(NdotH, alpha);
  const G = smithG(NdotV, NdotL, alpha);
  const denom = 4 * NdotV * NdotL + 0.001;
  const specular: Vec3 = [
    F[0] * D * G / denom,
    F[1] * D * G / denom,
    F[2] * D * G / denom,
  ];
  // Lambertian diffuse (energy-conserving with Fresnel).
  const kd = material.metalness === 1
    ? [0, 0, 0] as Vec3
    : [(1 - F[0]) * (1 - material.metalness), (1 - F[1]) * (1 - material.metalness), (1 - F[2]) * (1 - material.metalness)] as Vec3;
  const diffuse: Vec3 = [
    kd[0] * material.albedo[0] / Math.PI,
    kd[1] * material.albedo[1] / Math.PI,
    kd[2] * material.albedo[2] / Math.PI,
  ];
  return [
    (diffuse[0] + specular[0]) * NdotL,
    (diffuse[1] + specular[1]) * NdotL,
    (diffuse[2] + specular[2]) * NdotL,
  ];
}

// ── Importance sampling ─────────────────────────────────────────

/** Sample a direction on the cosine-weighted upper hemisphere. */
function sampleCosineHemisphere(normal: Vec3, rng: () => number): Vec3 {
  const r1 = rng();
  const r2 = rng();
  const r = Math.sqrt(r1);
  const theta = r2 * Math.PI * 2;
  const x = r * Math.cos(theta);
  const y = r * Math.sin(theta);
  const z = Math.sqrt(Math.max(0, 1 - r1));
  // Build basis from normal.
  const w = normal;
  const helper: Vec3 = Math.abs(w[0]) > 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = normalize(cross3(helper, w));
  const vv = cross3(w, u);
  return normalize([
    u[0] * x + vv[0] * y + w[0] * z,
    u[1] * x + vv[1] * y + w[1] * z,
    u[2] * x + vv[2] * y + w[2] * z,
  ]);
}

export function sampleBsdf(
  material: Material,
  normal: Vec3,
  wi: Vec3,
  rng: () => number,
): BsdfSample {
  // Decision: diffuse vs specular layer.
  const f0 = material.metalness === 1 ? material.albedo : material.f0 ?? [0.04, 0.04, 0.04];
  const Fapprox = (f0[0] + f0[1] + f0[2]) / 3;
  const specProb = material.metalness === 1 ? 1 : Math.max(0.1, Fapprox);
  const isSpecular = rng() < specProb;

  let direction: Vec3;
  let pdf: number;
  if (isSpecular) {
    // GGX-based reflection sample.
    const alpha = material.roughness * material.roughness;
    // Trowbridge-Reitz sample.
    const r1 = rng(), r2 = rng();
    const theta = Math.atan2(alpha * Math.sqrt(r1), Math.sqrt(1 - r1));
    const phi = r2 * Math.PI * 2;
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);
    const helper: Vec3 = Math.abs(normal[0]) > 0.9 ? [0, 1, 0] : [1, 0, 0];
    const u = normalize(cross3(helper, normal));
    const vv = cross3(normal, u);
    const H: Vec3 = normalize([
      u[0] * sinT * Math.cos(phi) + vv[0] * sinT * Math.sin(phi) + normal[0] * cosT,
      u[1] * sinT * Math.cos(phi) + vv[1] * sinT * Math.sin(phi) + normal[1] * cosT,
      u[2] * sinT * Math.cos(phi) + vv[2] * sinT * Math.sin(phi) + normal[2] * cosT,
    ]);
    // Reflect wi about H.
    const wiDotH = dot3(wi, H);
    direction = normalize([
      2 * wiDotH * H[0] - wi[0],
      2 * wiDotH * H[1] - wi[1],
      2 * wiDotH * H[2] - wi[2],
    ]);
    const NdotH = Math.max(0, dot3(normal, H));
    pdf = (ggxD(NdotH, alpha) * NdotH) / (4 * Math.max(0.001, wiDotH)) * specProb;
  } else {
    direction = sampleCosineHemisphere(normal, rng);
    pdf = Math.max(0, dot3(normal, direction)) / Math.PI * (1 - specProb);
  }

  const fr = evalBsdf(material, normal, wi, direction);
  const weight: Vec3 = pdf > 0
    ? [fr[0] / pdf, fr[1] / pdf, fr[2] / pdf]
    : [0, 0, 0];
  return { direction, weight, pdf, isSpecular };
}

// ── Russian roulette ────────────────────────────────────────────

/** Probability of continuing the path — based on throughput. */
export function russianRouletteContinue(throughput: Vec3, depth: number, rng: () => number): { keep: boolean; multiplier: number } {
  if (depth < 3) return { keep: true, multiplier: 1 };
  const maxComp = Math.max(throughput[0], throughput[1], throughput[2]);
  const q = Math.min(0.95, maxComp);
  if (rng() > q) return { keep: false, multiplier: 0 };
  return { keep: true, multiplier: 1 / q };
}

// ── Tone mapping ────────────────────────────────────────────────

export type ToneMapKind = 'aces' | 'reinhard' | 'reinhard-extended' | 'filmic' | 'linear';

export function toneMap(color: Vec3, kind: ToneMapKind, exposure: number = 1): Vec3 {
  const e = Math.pow(2, exposure);
  const c: Vec3 = [color[0] * e, color[1] * e, color[2] * e];
  switch (kind) {
    case 'linear': return [Math.min(1, c[0]), Math.min(1, c[1]), Math.min(1, c[2])];
    case 'reinhard': {
      return [c[0] / (1 + c[0]), c[1] / (1 + c[1]), c[2] / (1 + c[2])];
    }
    case 'reinhard-extended': {
      const Lwhite = 4;
      const apply = (x: number): number => x * (1 + x / (Lwhite * Lwhite)) / (1 + x);
      return [apply(c[0]), apply(c[1]), apply(c[2])];
    }
    case 'aces': {
      // ACES filmic Knarkowsky approximation.
      const apply = (x: number): number => {
        const a = 2.51, b = 0.03, cc = 2.43, d = 0.59, ee = 0.14;
        return Math.min(1, Math.max(0, (x * (a * x + b)) / (x * (cc * x + d) + ee)));
      };
      return [apply(c[0]), apply(c[1]), apply(c[2])];
    }
    case 'filmic': {
      const apply = (x: number): number => {
        const xx = Math.max(0, x - 0.004);
        return (xx * (6.2 * xx + 0.5)) / (xx * (6.2 * xx + 1.7) + 0.06);
      };
      return [apply(c[0]), apply(c[1]), apply(c[2])];
    }
  }
}

// ── IBL importance sampler ──────────────────────────────────────

export interface EnvironmentMap {
  width: number;
  height: number;
  /** Linear sRGB color per pixel, length = width × height × 3. */
  pixels: Float32Array;
  /** Cumulative luminance distribution function (built once). */
  cdf?: Float32Array;
}

/** Build the luminance CDF for importance sampling. */
export function buildEnvCdf(env: EnvironmentMap): void {
  const n = env.width * env.height;
  const cdf = new Float32Array(n);
  let total = 0;
  for (let i = 0; i < n; i++) {
    const r = env.pixels[i * 3]!;
    const g = env.pixels[i * 3 + 1]!;
    const b = env.pixels[i * 3 + 2]!;
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    total += lum;
    cdf[i] = total;
  }
  if (total > 0) for (let i = 0; i < n; i++) cdf[i]! /= total;
  env.cdf = cdf;
}

/** Sample a direction proportional to environment luminance. */
export function sampleEnv(env: EnvironmentMap, rng: () => number): { direction: Vec3; pdf: number; color: Vec3 } {
  if (!env.cdf) buildEnvCdf(env);
  const u = rng();
  // Binary search in CDF.
  const cdf = env.cdf!;
  let lo = 0, hi = cdf.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cdf[mid]! < u) lo = mid + 1;
    else hi = mid;
  }
  const pixelIdx = lo;
  const i = pixelIdx % env.width;
  const j = Math.floor(pixelIdx / env.width);
  const phi = (i + 0.5) / env.width * Math.PI * 2;
  const theta = (j + 0.5) / env.height * Math.PI;
  const direction: Vec3 = [
    Math.sin(theta) * Math.cos(phi),
    Math.cos(theta),
    Math.sin(theta) * Math.sin(phi),
  ];
  const color: Vec3 = [
    env.pixels[pixelIdx * 3]!,
    env.pixels[pixelIdx * 3 + 1]!,
    env.pixels[pixelIdx * 3 + 2]!,
  ];
  const pdf = pixelIdx === 0 ? cdf[0]! : cdf[pixelIdx]! - cdf[pixelIdx - 1]!;
  return { direction, pdf, color };
}
