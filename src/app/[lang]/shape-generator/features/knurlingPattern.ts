/**
 * knurlingPattern.ts — Generate knurling and dimple patterns on a
 * cylindrical or planar surface for grip / aesthetics.
 *
 * Knurling adds a textured grip to handles, knobs, dials. Common
 * patterns:
 *
 *   - **Straight** — vertical grooves only.
 *   - **Diagonal** — single set of 30° helical grooves.
 *   - **Diamond** — diagonal + reverse-diagonal forming pyramid bumps.
 *   - **Dimple** — circular indentations (no grooves).
 *
 * For a cylinder, output is in (u, v) parametric coordinates that
 * the caller maps to 3D via R·cos(u), R·sin(u), v. For a plane,
 * output is in (x, y).
 *
 * Each bump/groove is described by its center + size, suitable for
 * a CSG subtract or a normal-map bake.
 */

export type KnurlingStyle = 'straight' | 'diagonal' | 'diamond' | 'dimple';

export interface Vec2 { u: number; v: number }

export interface KnurlElement {
  /** Center in (u, v) parametric space (or (x, y) for plane). */
  center: Vec2;
  /** Optional groove direction angle (radians from +u). */
  angleRad?: number;
  /** Groove length (only for groove elements). */
  lengthUv?: number;
  /** Element width / dimple radius (uv units). */
  size: number;
}

export interface KnurlPattern {
  style: KnurlingStyle;
  elements: KnurlElement[];
  /** Total surface coverage fraction (0..1). */
  coverageFraction: number;
  /** Bump density per uv² unit. */
  densityPerUv2: number;
}

export interface KnurlingInput {
  style: KnurlingStyle;
  /** Region width in u (e.g., 2π·R for cylinder circumference). */
  uExtent: number;
  /** Region height in v (e.g., the cylinder height or plane length). */
  vExtent: number;
  /** Pitch between elements along u. */
  uPitch: number;
  /** Pitch between elements along v. */
  vPitch: number;
  /** Element size (groove width or dimple radius). */
  elementSize: number;
  /** Optional angle override (default per style). */
  angleDeg?: number;
}

// ── Top-level entry ────────────────────────────────────────────

export function generateKnurlPattern(input: KnurlingInput): KnurlPattern {
  const elements: KnurlElement[] = [];
  const defaultAngle = defaultAngleFor(input.style);
  const angle = input.angleDeg !== undefined ? (input.angleDeg * Math.PI) / 180 : defaultAngle;

  switch (input.style) {
    case 'straight':
      for (let u = 0; u < input.uExtent; u += input.uPitch) {
        elements.push({
          center: { u, v: input.vExtent / 2 },
          angleRad: Math.PI / 2,
          lengthUv: input.vExtent,
          size: input.elementSize,
        });
      }
      break;
    case 'diagonal':
      for (let v = 0; v < input.vExtent; v += input.vPitch) {
        for (let u = 0; u < input.uExtent; u += input.uPitch) {
          elements.push({
            center: { u, v },
            angleRad: angle,
            lengthUv: input.uPitch * 0.9,
            size: input.elementSize,
          });
        }
      }
      break;
    case 'diamond':
      // Two crossed sets.
      for (let v = 0; v < input.vExtent; v += input.vPitch) {
        for (let u = 0; u < input.uExtent; u += input.uPitch) {
          elements.push({ center: { u, v }, angleRad: angle, lengthUv: input.uPitch * 0.9, size: input.elementSize });
          elements.push({ center: { u, v }, angleRad: -angle, lengthUv: input.uPitch * 0.9, size: input.elementSize });
        }
      }
      break;
    case 'dimple':
      for (let v = input.vPitch / 2; v < input.vExtent; v += input.vPitch) {
        const rowOffset = ((Math.floor(v / input.vPitch)) % 2) * (input.uPitch / 2);
        for (let u = rowOffset; u < input.uExtent; u += input.uPitch) {
          elements.push({ center: { u, v }, size: input.elementSize });
        }
      }
      break;
  }

  const totalArea = input.uExtent * input.vExtent;
  let elementArea = 0;
  if (input.style === 'dimple') {
    elementArea = elements.length * Math.PI * input.elementSize * input.elementSize;
  } else {
    elementArea = elements.length * input.elementSize * (input.elementSize * 2);
  }
  const coverage = totalArea > 0 ? Math.min(1, elementArea / totalArea) : 0;

  return {
    style: input.style,
    elements,
    coverageFraction: coverage,
    densityPerUv2: totalArea > 0 ? elements.length / totalArea : 0,
  };
}

function defaultAngleFor(style: KnurlingStyle): number {
  // 30° classic knurl angle.
  switch (style) {
    case 'straight': return Math.PI / 2;
    case 'diagonal': return (30 * Math.PI) / 180;
    case 'diamond': return (30 * Math.PI) / 180;
    case 'dimple': return 0;
  }
}

// ── Cylinder mapping helper ───────────────────────────────────

export interface Vec3 { x: number; y: number; z: number }

export function mapToCylinder(uv: Vec2, radiusMm: number): Vec3 {
  const theta = uv.u / radiusMm;
  return {
    x: radiusMm * Math.cos(theta),
    y: radiusMm * Math.sin(theta),
    z: uv.v,
  };
}

export function mapPatternToCylinder(pattern: KnurlPattern, radiusMm: number): Vec3[] {
  return pattern.elements.map(e => mapToCylinder(e.center, radiusMm));
}

// ── Grip force estimate ──────────────────────────────────────

/** Rough grip-force gain (relative to smooth surface) from knurling depth + coverage. */
export function estimateGripGain(pattern: KnurlPattern, depthMm: number): number {
  const depthScore = Math.min(1, depthMm / 1.0);
  // Diamond > Diagonal > Straight > Dimple
  const styleBoost: Record<KnurlingStyle, number> = {
    diamond: 1.6,
    diagonal: 1.3,
    straight: 1.15,
    dimple: 1.1,
  };
  return styleBoost[pattern.style] * (1 + pattern.coverageFraction * depthScore);
}

// ── Summary ────────────────────────────────────────────────────

export interface PatternSummary {
  style: KnurlingStyle;
  elementCount: number;
  coverageFraction: number;
  estGripGain: number;
}

export function summarize(pattern: KnurlPattern, depthMm: number): PatternSummary {
  return {
    style: pattern.style,
    elementCount: pattern.elements.length,
    coverageFraction: pattern.coverageFraction,
    estGripGain: estimateGripGain(pattern, depthMm),
  };
}
