/**
 * motionStudy.ts — Timeline-based animation of assembly state.
 *
 * SolidWorks Motion Study lets users scrub a timeline, define
 * keyframes on mate values, and play back the resulting motion.
 * NexyFab equivalent stores keyframes per *driver* (mate or flex
 * param) and interpolates between them.
 *
 * The animation loop is decoupled from this module — UI controls
 * call `valueAtTime(driver, t)` once per render frame to get the
 * current interpolated value, then dispatch the mate update.
 *
 * Interpolation modes:
 *   - linear (default) — straight lerp
 *   - ease — cubic Hermite tangents
 *   - step — value held until next keyframe (mechanical clicks)
 */

export type InterpolationMode = 'linear' | 'ease' | 'step';

export interface Keyframe {
  /** Time stamp in seconds along the study timeline. */
  t: number;
  value: number;
  /** Optional cubic-Hermite tangents (slopes) for 'ease' mode. */
  tangentIn?: number;
  tangentOut?: number;
}

export interface MotionDriver {
  id: string;
  /** Driver target — mate id, flex param key, etc. Caller-defined. */
  targetId: string;
  paramKey: string;
  interpolation: InterpolationMode;
  keyframes: Keyframe[];
}

export interface MotionStudy {
  id: string;
  name: string;
  /** Total duration in seconds. */
  durationSec: number;
  /** Frames per second for playback default. */
  fps: number;
  drivers: MotionDriver[];
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/** Cubic Hermite spline:  h(s) = (2s³-3s²+1)p0 + (s³-2s²+s)m0 + (-2s³+3s²)p1 + (s³-s²)m1 */
function hermite(p0: number, p1: number, m0: number, m1: number, s: number): number {
  const s2 = s * s;
  const s3 = s2 * s;
  return (2 * s3 - 3 * s2 + 1) * p0
       + (s3 - 2 * s2 + s) * m0
       + (-2 * s3 + 3 * s2) * p1
       + (s3 - s2) * m1;
}

/** Lookup the driver's value at time t. */
export function valueAtTime(driver: MotionDriver, t: number): number | null {
  const k = driver.keyframes;
  if (k.length === 0) return null;
  if (t <= k[0]!.t) return k[0]!.value;
  if (t >= k[k.length - 1]!.t) return k[k.length - 1]!.value;

  // Find the bracketing keyframes.
  let i = 0;
  while (i < k.length - 1 && k[i + 1]!.t <= t) i++;
  const a = k[i]!;
  const b = k[i + 1]!;
  if (a.t === b.t) return a.value;

  switch (driver.interpolation) {
    case 'step':
      return a.value;
    case 'linear': {
      const u = clamp01((t - a.t) / (b.t - a.t));
      return a.value + (b.value - a.value) * u;
    }
    case 'ease': {
      const u = clamp01((t - a.t) / (b.t - a.t));
      const dt = b.t - a.t;
      const m0 = (a.tangentOut ?? 0) * dt;
      const m1 = (b.tangentIn  ?? 0) * dt;
      return hermite(a.value, b.value, m0, m1, u);
    }
  }
}

/** Sample every driver at a given time. */
export function sampleStudy(study: MotionStudy, t: number): Array<{
  driverId: string;
  targetId: string;
  paramKey: string;
  value: number;
}> {
  const out: Array<{ driverId: string; targetId: string; paramKey: string; value: number }> = [];
  for (const d of study.drivers) {
    const v = valueAtTime(d, t);
    if (v === null) continue;
    out.push({ driverId: d.id, targetId: d.targetId, paramKey: d.paramKey, value: v });
  }
  return out;
}

/** Insert / replace a keyframe on a driver, keeping the array
 *  sorted by time. */
export function setKeyframe(driver: MotionDriver, kf: Keyframe): void {
  const i = driver.keyframes.findIndex(k => k.t === kf.t);
  if (i >= 0) driver.keyframes[i] = kf;
  else driver.keyframes.push(kf);
  driver.keyframes.sort((a, b) => a.t - b.t);
}

/** Remove a keyframe by time. */
export function removeKeyframe(driver: MotionDriver, t: number): boolean {
  const i = driver.keyframes.findIndex(k => k.t === t);
  if (i < 0) return false;
  driver.keyframes.splice(i, 1);
  return true;
}
