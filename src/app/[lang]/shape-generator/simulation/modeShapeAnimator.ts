/**
 * modeShapeAnimator.ts — Time-domain animation of FEA modal mode
 * shapes.
 *
 * Modal analysis (`fea/modalAnalysis`) emits eigenvectors + natural
 * frequencies. Engineers want to *see* the mode shape, not just
 * stare at numbers. This module:
 *
 *   1. Takes the static reference mesh + a normalized eigenvector
 *      (one displacement per vertex).
 *   2. At time t, the displaced position is:
 *        x(t) = x0 + scale · φ · sin(2π · f · t)
 *   3. Sampled at a frame rate produces a sequence of meshes the
 *      renderer plays back as an animation.
 *
 * Helpers also:
 *
 *   - Auto-pick scale so the largest displacement is ~5% of bbox
 *     diagonal (typical visualization preset).
 *   - Compute strain proxy (eigenvector magnitude per vertex) so
 *     hot spots can be colored.
 *   - Report per-frame max displacement so the UI can render a
 *     timeline scrubber.
 */

export interface MeshArrays {
  positions: number[];
  indices: number[];
}

export interface ModeShape {
  /** Per-vertex displacement (3 numbers per vertex). */
  displacements: number[];
  /** Natural frequency (Hz). */
  frequencyHz: number;
  /** Mode index. */
  modeIndex: number;
}

export interface AnimationFrame {
  /** Frame index. */
  frame: number;
  /** Time in seconds. */
  timeSec: number;
  /** Displaced positions (3 per vertex). */
  positions: number[];
  /** Max displacement magnitude in this frame. */
  maxDisplacementMm: number;
}

export interface AnimationResult {
  frames: AnimationFrame[];
  /** Auto-picked or user-specified scale. */
  appliedScale: number;
  /** Strain proxy: |displacement| per vertex. */
  perVertexStrainProxy: number[];
}

export interface AnimationOptions {
  /** Frames per second. */
  fps: number;
  /** Animation duration, sec. */
  durationSec: number;
  /** Override scale; if omitted auto-computed. */
  scaleOverride?: number;
  /** Auto-scale fraction of bbox diagonal (default 0.05 = 5%). */
  autoScaleFraction: number;
}

export const DEFAULT_OPTIONS: AnimationOptions = {
  fps: 24,
  durationSec: 2,
  autoScaleFraction: 0.05,
};

// ── Top-level entry ────────────────────────────────────────────

export function buildModeAnimation(
  mesh: MeshArrays,
  mode: ModeShape,
  options: Partial<AnimationOptions> = {},
): AnimationResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const vertexCount = mesh.positions.length / 3;
  if (vertexCount === 0) {
    return { frames: [], appliedScale: 1, perVertexStrainProxy: [] };
  }

  // Per-vertex strain proxy.
  const strain: number[] = [];
  let maxStrain = 0;
  for (let i = 0; i < vertexCount; i++) {
    const dx = mode.displacements[i * 3] ?? 0;
    const dy = mode.displacements[i * 3 + 1] ?? 0;
    const dz = mode.displacements[i * 3 + 2] ?? 0;
    const mag = Math.hypot(dx, dy, dz);
    strain.push(mag);
    if (mag > maxStrain) maxStrain = mag;
  }

  // Auto scale.
  let scale = opts.scaleOverride;
  if (scale === undefined) {
    const bboxDiag = bboxDiagonal(mesh.positions);
    scale = maxStrain > 0 ? (bboxDiag * opts.autoScaleFraction) / maxStrain : 1;
  }

  // Generate frames.
  const frames: AnimationFrame[] = [];
  const frameCount = Math.max(1, Math.round(opts.fps * opts.durationSec));
  const omega = 2 * Math.PI * mode.frequencyHz;
  for (let f = 0; f < frameCount; f++) {
    const t = f / opts.fps;
    const phase = Math.sin(omega * t);
    const positions: number[] = new Array(mesh.positions.length);
    let maxDisp = 0;
    for (let i = 0; i < vertexCount; i++) {
      const dx = (mode.displacements[i * 3] ?? 0) * scale * phase;
      const dy = (mode.displacements[i * 3 + 1] ?? 0) * scale * phase;
      const dz = (mode.displacements[i * 3 + 2] ?? 0) * scale * phase;
      positions[i * 3] = mesh.positions[i * 3]! + dx;
      positions[i * 3 + 1] = mesh.positions[i * 3 + 1]! + dy;
      positions[i * 3 + 2] = mesh.positions[i * 3 + 2]! + dz;
      const mag = Math.hypot(dx, dy, dz);
      if (mag > maxDisp) maxDisp = mag;
    }
    frames.push({ frame: f, timeSec: t, positions, maxDisplacementMm: maxDisp });
  }

  return { frames, appliedScale: scale, perVertexStrainProxy: strain };
}

// ── Helpers ────────────────────────────────────────────────────

function bboxDiagonal(positions: number[]): number {
  let xMin = Infinity, yMin = Infinity, zMin = Infinity;
  let xMax = -Infinity, yMax = -Infinity, zMax = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i]!, y = positions[i + 1]!, z = positions[i + 2]!;
    if (x < xMin) xMin = x; if (x > xMax) xMax = x;
    if (y < yMin) yMin = y; if (y > yMax) yMax = y;
    if (z < zMin) zMin = z; if (z > zMax) zMax = z;
  }
  return Math.hypot(xMax - xMin, yMax - yMin, zMax - zMin);
}

// ── Frame interpolation ────────────────────────────────────────

/** Interpolate between two frames at parameter t ∈ [0,1]. */
export function interpolateFrames(a: AnimationFrame, b: AnimationFrame, t: number): AnimationFrame {
  const positions: number[] = new Array(a.positions.length);
  for (let i = 0; i < a.positions.length; i++) {
    positions[i] = a.positions[i]! * (1 - t) + b.positions[i]! * t;
  }
  let maxDisp = 0;
  for (let i = 0; i < positions.length; i += 3) {
    const dx = positions[i]!;
    const dy = positions[i + 1]!;
    const dz = positions[i + 2]!;
    const m = Math.hypot(dx, dy, dz);
    if (m > maxDisp) maxDisp = m;
  }
  return {
    frame: -1,
    timeSec: a.timeSec * (1 - t) + b.timeSec * t,
    positions,
    maxDisplacementMm: maxDisp,
  };
}

// ── Summary ────────────────────────────────────────────────────

export interface AnimationSummary {
  frameCount: number;
  durationSec: number;
  fps: number;
  peakDisplacementMm: number;
  appliedScale: number;
}

export function summarize(result: AnimationResult, fps: number): AnimationSummary {
  const peak = result.frames.reduce((m, f) => Math.max(m, f.maxDisplacementMm), 0);
  return {
    frameCount: result.frames.length,
    durationSec: result.frames.length > 0 ? result.frames[result.frames.length - 1]!.timeSec : 0,
    fps,
    peakDisplacementMm: peak,
    appliedScale: result.appliedScale,
  };
}
