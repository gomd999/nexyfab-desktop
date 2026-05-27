/**
 * motionTimelineEditor.ts — Keyframe timeline editor for animation tracks.
 *
 * Beyond a single camera path (`animation/cameraPath`), production
 * animations need *multiple parallel tracks* — camera + lights +
 * parts + materials, each with its own keyframes. This module is the
 * data model for the After-Effects-style timeline editor:
 *
 *   - Multiple **tracks**, each typed (number / vec3 / color / quaternion).
 *   - Per-keyframe **easing** and optional bezier handles.
 *   - **Scrubbing**: evaluate every track at a given time.
 *   - **Edit operations**: insert / remove / move keyframes, retime
 *     entire tracks, snap to time markers.
 */

export type TrackValue = number | [number, number, number] | [number, number, number, number] | [number, number, number, number];

export type EasingKind = 'linear' | 'step' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'bezier';

export interface Keyframe<T extends TrackValue = TrackValue> {
  /** Time in seconds. */
  timeSec: number;
  /** Value at this keyframe. */
  value: T;
  /** Easing from this keyframe to the next. */
  easing: EasingKind;
  /** Bezier handles when `easing === 'bezier'`. */
  bezierHandles?: { outX: number; outY: number; inX: number; inY: number };
}

export type TrackKind = 'number' | 'vec3' | 'color' | 'quaternion';

export interface Track<T extends TrackValue = TrackValue> {
  id: string;
  kind: TrackKind;
  /** Keyframes sorted by timeSec ascending. */
  keyframes: Keyframe<T>[];
}

export interface Timeline {
  /** Total duration (sec). */
  durationSec: number;
  /** Time markers (chapter labels). */
  markers: Array<{ timeSec: number; label: string }>;
  /** Tracks keyed by id. */
  tracks: Map<string, Track>;
}

// ── Construction ───────────────────────────────────────────────

export function createTimeline(durationSec: number = 10): Timeline {
  return { durationSec, markers: [], tracks: new Map() };
}

export function addTrack<T extends TrackValue>(timeline: Timeline, id: string, kind: TrackKind, keyframes: Keyframe<T>[] = []): Track<T> {
  const track: Track<T> = { id, kind, keyframes: [...keyframes].sort((a, b) => a.timeSec - b.timeSec) };
  timeline.tracks.set(id, track as Track);
  return track;
}

export function insertKeyframe<T extends TrackValue>(track: Track<T>, kf: Keyframe<T>): void {
  // Insert in sorted order; replace existing keyframe at same time.
  const existingIdx = track.keyframes.findIndex(k => k.timeSec === kf.timeSec);
  if (existingIdx >= 0) {
    track.keyframes[existingIdx] = kf;
    return;
  }
  let pos = track.keyframes.findIndex(k => k.timeSec > kf.timeSec);
  if (pos < 0) pos = track.keyframes.length;
  track.keyframes.splice(pos, 0, kf);
}

export function removeKeyframe<T extends TrackValue>(track: Track<T>, timeSec: number): boolean {
  const idx = track.keyframes.findIndex(k => k.timeSec === timeSec);
  if (idx < 0) return false;
  track.keyframes.splice(idx, 1);
  return true;
}

export function moveKeyframe<T extends TrackValue>(track: Track<T>, fromTimeSec: number, toTimeSec: number): boolean {
  const idx = track.keyframes.findIndex(k => k.timeSec === fromTimeSec);
  if (idx < 0) return false;
  const kf = track.keyframes[idx]!;
  track.keyframes.splice(idx, 1);
  insertKeyframe(track, { ...kf, timeSec: toTimeSec });
  return true;
}

// ── Scrubbing / evaluation ────────────────────────────────────

export function sampleTrack<T extends TrackValue>(track: Track<T>, timeSec: number): T | null {
  if (track.keyframes.length === 0) return null;
  if (track.keyframes.length === 1) return track.keyframes[0]!.value;
  if (timeSec <= track.keyframes[0]!.timeSec) return track.keyframes[0]!.value;
  if (timeSec >= track.keyframes[track.keyframes.length - 1]!.timeSec) {
    return track.keyframes[track.keyframes.length - 1]!.value;
  }
  for (let i = 0; i < track.keyframes.length - 1; i++) {
    const a = track.keyframes[i]!;
    const b = track.keyframes[i + 1]!;
    if (b.timeSec >= timeSec) {
      const span = b.timeSec - a.timeSec;
      const u = span > 1e-9 ? (timeSec - a.timeSec) / span : 0;
      const t = applyEasing(u, a.easing, a.bezierHandles);
      return interpolateValue(track.kind, a.value, b.value, t) as T;
    }
  }
  return track.keyframes[track.keyframes.length - 1]!.value;
}

export interface TimelineFrame {
  timeSec: number;
  trackValues: Map<string, TrackValue>;
}

export function sampleTimeline(timeline: Timeline, timeSec: number): TimelineFrame {
  const trackValues = new Map<string, TrackValue>();
  for (const [id, track] of timeline.tracks) {
    const v = sampleTrack(track, timeSec);
    if (v !== null) trackValues.set(id, v);
  }
  return { timeSec, trackValues };
}

export function generateFrames(timeline: Timeline, fps: number): TimelineFrame[] {
  const total = Math.max(1, Math.floor(timeline.durationSec * fps));
  const frames: TimelineFrame[] = [];
  for (let i = 0; i <= total; i++) {
    frames.push(sampleTimeline(timeline, (i / fps)));
  }
  return frames;
}

// ── Easing ────────────────────────────────────────────────────

export function applyEasing(t: number, kind: EasingKind, bezier?: Keyframe['bezierHandles']): number {
  const c = Math.max(0, Math.min(1, t));
  switch (kind) {
    case 'linear': return c;
    case 'step': return 0;
    case 'ease-in': return c * c;
    case 'ease-out': return 1 - (1 - c) * (1 - c);
    case 'ease-in-out': return c < 0.5 ? 2 * c * c : 1 - Math.pow(-2 * c + 2, 2) / 2;
    case 'bezier': {
      if (!bezier) return c;
      // Approximate cubic bezier with parameters.
      const c1 = bezier.outX, c2 = bezier.inX;
      return 3 * Math.pow(1 - c, 2) * c * c1 + 3 * (1 - c) * c * c * c2 + c * c * c;
    }
  }
}

// ── Value interpolation per track kind ────────────────────────

function interpolateValue(kind: TrackKind, a: TrackValue, b: TrackValue, t: number): TrackValue {
  switch (kind) {
    case 'number':
      return (a as number) + ((b as number) - (a as number)) * t;
    case 'vec3':
    case 'color': {
      const av = a as [number, number, number];
      const bv = b as [number, number, number];
      return [
        av[0] + (bv[0] - av[0]) * t,
        av[1] + (bv[1] - av[1]) * t,
        av[2] + (bv[2] - av[2]) * t,
      ];
    }
    case 'quaternion': {
      const av = a as [number, number, number, number];
      const bv = b as [number, number, number, number];
      // Slerp.
      let dot = av[0] * bv[0] + av[1] * bv[1] + av[2] * bv[2] + av[3] * bv[3];
      const sign = dot < 0 ? -1 : 1;
      dot = Math.abs(dot);
      if (dot > 0.9995) {
        return [
          av[0] + (sign * bv[0] - av[0]) * t,
          av[1] + (sign * bv[1] - av[1]) * t,
          av[2] + (sign * bv[2] - av[2]) * t,
          av[3] + (sign * bv[3] - av[3]) * t,
        ];
      }
      const theta = Math.acos(dot);
      const sinTheta = Math.sin(theta);
      const wa = Math.sin((1 - t) * theta) / sinTheta;
      const wb = Math.sin(t * theta) / sinTheta * sign;
      return [
        av[0] * wa + bv[0] * wb,
        av[1] * wa + bv[1] * wb,
        av[2] * wa + bv[2] * wb,
        av[3] * wa + bv[3] * wb,
      ];
    }
  }
}

// ── Retime + snap ─────────────────────────────────────────────

/** Scale all keyframe times in a track by `factor` and clamp to [0, max]. */
export function retimeTrack<T extends TrackValue>(track: Track<T>, factor: number, maxSec: number = Infinity): void {
  for (const kf of track.keyframes) {
    kf.timeSec = Math.max(0, Math.min(maxSec, kf.timeSec * factor));
  }
  track.keyframes.sort((a, b) => a.timeSec - b.timeSec);
}

/** Snap a time value to the nearest marker / keyframe within `snapWindowSec`. */
export function snapTime(timeline: Timeline, timeSec: number, snapWindowSec: number = 0.05): number {
  const candidates: number[] = timeline.markers.map(m => m.timeSec);
  for (const track of timeline.tracks.values()) {
    for (const kf of track.keyframes) candidates.push(kf.timeSec);
  }
  let best = timeSec;
  let bestDist = snapWindowSec;
  for (const c of candidates) {
    const d = Math.abs(c - timeSec);
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best;
}

// ── Stats ─────────────────────────────────────────────────────

export interface TimelineStats {
  trackCount: number;
  totalKeyframes: number;
  durationSec: number;
  /** Track ids with no keyframes. */
  emptyTrackIds: string[];
}

export function summarize(timeline: Timeline): TimelineStats {
  let total = 0;
  const empty: string[] = [];
  for (const track of timeline.tracks.values()) {
    total += track.keyframes.length;
    if (track.keyframes.length === 0) empty.push(track.id);
  }
  return {
    trackCount: timeline.tracks.size,
    totalKeyframes: total,
    durationSec: timeline.durationSec,
    emptyTrackIds: empty,
  };
}
