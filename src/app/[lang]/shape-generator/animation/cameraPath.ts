/**
 * cameraPath.ts — Cinematic camera path animation.
 *
 * Customer-facing CAD videos (product reveal, exploded view,
 * walkthrough) need smooth camera moves. This module builds a
 * timeline of keyframes — position, lookAt, FOV, aspect — and
 * interpolates between them using easing.
 *
 * Built-in patterns:
 *
 *   - **Orbit** — rotate around a target at a fixed radius / height.
 *   - **Flyby** — linear from A to B with optional roll.
 *   - **Push-in** — start far, end close to a feature.
 *   - **Dolly-zoom** — change FOV while moving to keep subject size
 *     constant (Hitchcock zoom).
 *   - **Rule-of-thirds** — bias the lookAt so the subject sits on a
 *     thirds line.
 *
 * Output: per-frame `CameraState` array suitable for a screen
 * recorder, video export, or interactive playback.
 */

export type Vec3 = [number, number, number];

export interface CameraState {
  positionMm: Vec3;
  lookAtMm: Vec3;
  upVector: Vec3;
  /** Vertical FOV in radians. */
  fovYRad: number;
  /** Aspect ratio. */
  aspect: number;
}

export interface Keyframe {
  /** Time in seconds. */
  timeSec: number;
  state: CameraState;
  /** Easing applied from previous keyframe to this one. */
  easing?: EasingKind;
}

export type EasingKind =
  | 'linear'
  | 'ease-in-quad'
  | 'ease-out-quad'
  | 'ease-in-out-quad'
  | 'ease-in-cubic'
  | 'ease-out-cubic'
  | 'ease-in-out-cubic'
  | 'cubic-bezier';

export interface CameraPath {
  keyframes: Keyframe[];
}

// ── Easing functions ────────────────────────────────────────────

export function applyEasing(t: number, kind: EasingKind): number {
  switch (kind) {
    case 'linear': return t;
    case 'ease-in-quad': return t * t;
    case 'ease-out-quad': return t * (2 - t);
    case 'ease-in-out-quad': return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    case 'ease-in-cubic': return t * t * t;
    case 'ease-out-cubic': return 1 - Math.pow(1 - t, 3);
    case 'ease-in-out-cubic': return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    case 'cubic-bezier': {
      // Default cubic bezier (.4, 0, .2, 1) — Material "standard" curve.
      const c1 = 0.4, c2 = 0.2;
      return 3 * Math.pow(1 - t, 2) * t * c1 + 3 * (1 - t) * t * t * c2 + t * t * t;
    }
  }
}

// ── Sampling ────────────────────────────────────────────────────

export function sampleCamera(path: CameraPath, timeSec: number): CameraState {
  if (path.keyframes.length === 0) {
    return defaultCameraState();
  }
  if (path.keyframes.length === 1) return path.keyframes[0]!.state;
  if (timeSec <= path.keyframes[0]!.timeSec) return path.keyframes[0]!.state;
  if (timeSec >= path.keyframes[path.keyframes.length - 1]!.timeSec) {
    return path.keyframes[path.keyframes.length - 1]!.state;
  }
  // Find bracketing keyframes.
  for (let i = 0; i < path.keyframes.length - 1; i++) {
    const a = path.keyframes[i]!;
    const b = path.keyframes[i + 1]!;
    if (b.timeSec >= timeSec) {
      const span = b.timeSec - a.timeSec;
      const u = span > 0 ? (timeSec - a.timeSec) / span : 0;
      const eased = applyEasing(u, b.easing ?? 'ease-in-out-quad');
      return lerpCameraState(a.state, b.state, eased);
    }
  }
  return path.keyframes[path.keyframes.length - 1]!.state;
}

function lerpCameraState(a: CameraState, b: CameraState, t: number): CameraState {
  return {
    positionMm: [
      lerp(a.positionMm[0], b.positionMm[0], t),
      lerp(a.positionMm[1], b.positionMm[1], t),
      lerp(a.positionMm[2], b.positionMm[2], t),
    ],
    lookAtMm: [
      lerp(a.lookAtMm[0], b.lookAtMm[0], t),
      lerp(a.lookAtMm[1], b.lookAtMm[1], t),
      lerp(a.lookAtMm[2], b.lookAtMm[2], t),
    ],
    upVector: [
      lerp(a.upVector[0], b.upVector[0], t),
      lerp(a.upVector[1], b.upVector[1], t),
      lerp(a.upVector[2], b.upVector[2], t),
    ],
    fovYRad: lerp(a.fovYRad, b.fovYRad, t),
    aspect: lerp(a.aspect, b.aspect, t),
  };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function defaultCameraState(): CameraState {
  return {
    positionMm: [0, 0, 100],
    lookAtMm: [0, 0, 0],
    upVector: [0, 1, 0],
    fovYRad: Math.PI / 3,
    aspect: 16 / 9,
  };
}

// ── Build per-frame array ───────────────────────────────────────

export interface PlaybackOptions {
  /** Frames per second. */
  fps: number;
  /** Start time (s). If omitted, uses first keyframe time. */
  startSec?: number;
  /** End time (s). If omitted, uses last keyframe time. */
  endSec?: number;
}

export function generateFrames(path: CameraPath, opts: PlaybackOptions): CameraState[] {
  if (path.keyframes.length === 0) return [];
  const start = opts.startSec ?? path.keyframes[0]!.timeSec;
  const end = opts.endSec ?? path.keyframes[path.keyframes.length - 1]!.timeSec;
  const frameCount = Math.max(1, Math.floor((end - start) * opts.fps));
  const frames: CameraState[] = [];
  for (let i = 0; i <= frameCount; i++) {
    const t = start + (i / frameCount) * (end - start);
    frames.push(sampleCamera(path, t));
  }
  return frames;
}

// ── Pattern builders ────────────────────────────────────────────

export function buildOrbit(
  target: Vec3,
  radius: number,
  height: number,
  durationSec: number,
  fovYRad: number = Math.PI / 3,
  aspect: number = 16 / 9,
  keyframeCount: number = 8,
): CameraPath {
  const keyframes: Keyframe[] = [];
  for (let i = 0; i < keyframeCount; i++) {
    const t = i / (keyframeCount - 1);
    const angle = t * 2 * Math.PI;
    keyframes.push({
      timeSec: t * durationSec,
      state: {
        positionMm: [
          target[0] + radius * Math.cos(angle),
          target[1] + height,
          target[2] + radius * Math.sin(angle),
        ],
        lookAtMm: target,
        upVector: [0, 1, 0],
        fovYRad,
        aspect,
      },
      easing: i > 0 ? 'linear' : undefined,
    });
  }
  return { keyframes };
}

export function buildFlyby(
  from: Vec3,
  to: Vec3,
  target: Vec3,
  durationSec: number,
  fovYRad: number = Math.PI / 3,
  aspect: number = 16 / 9,
): CameraPath {
  return {
    keyframes: [
      {
        timeSec: 0,
        state: { positionMm: from, lookAtMm: target, upVector: [0, 1, 0], fovYRad, aspect },
      },
      {
        timeSec: durationSec,
        state: { positionMm: to, lookAtMm: target, upVector: [0, 1, 0], fovYRad, aspect },
        easing: 'ease-in-out-cubic',
      },
    ],
  };
}

export function buildPushIn(
  start: Vec3,
  target: Vec3,
  endDistanceMm: number,
  durationSec: number,
  fovYRad: number = Math.PI / 3,
  aspect: number = 16 / 9,
): CameraPath {
  const dir = normalize([target[0] - start[0], target[1] - start[1], target[2] - start[2]]);
  const end: Vec3 = [
    target[0] - dir[0] * endDistanceMm,
    target[1] - dir[1] * endDistanceMm,
    target[2] - dir[2] * endDistanceMm,
  ];
  return buildFlyby(start, end, target, durationSec, fovYRad, aspect);
}

/** Dolly zoom: subject stays the same screen size while camera moves.
 *  FOV adjusts so target subject diameter remains constant. */
export function buildDollyZoom(
  start: Vec3,
  end: Vec3,
  target: Vec3,
  subjectSizeMm: number,
  durationSec: number,
  aspect: number = 16 / 9,
): CameraPath {
  const fovFromDistance = (camPos: Vec3) => {
    const d = Math.hypot(camPos[0] - target[0], camPos[1] - target[1], camPos[2] - target[2]);
    if (d <= 0) return Math.PI / 4;
    return 2 * Math.atan((subjectSizeMm / 2) / d);
  };
  return {
    keyframes: [
      {
        timeSec: 0,
        state: { positionMm: start, lookAtMm: target, upVector: [0, 1, 0], fovYRad: fovFromDistance(start), aspect },
      },
      {
        timeSec: durationSec,
        state: { positionMm: end, lookAtMm: target, upVector: [0, 1, 0], fovYRad: fovFromDistance(end), aspect },
        easing: 'ease-in-out-cubic',
      },
    ],
  };
}

// ── Rule of thirds bias ────────────────────────────────────────

/** Shift the lookAt point so the subject sits on a rule-of-thirds line.
 *  `axis` = horizontal/vertical, `position` = -1 (left/top third) or +1
 *  (right/bottom third), `magnitude` = world-space offset. */
export function biasRuleOfThirds(
  state: CameraState,
  axis: 'horizontal' | 'vertical',
  position: -1 | 1,
  magnitude: number,
): CameraState {
  const offset = axis === 'horizontal' ? [position * magnitude, 0, 0] as Vec3 : [0, position * magnitude, 0] as Vec3;
  return {
    ...state,
    lookAtMm: [
      state.lookAtMm[0] + offset[0],
      state.lookAtMm[1] + offset[1],
      state.lookAtMm[2] + offset[2],
    ],
  };
}

// ── Helpers ────────────────────────────────────────────────────

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}
