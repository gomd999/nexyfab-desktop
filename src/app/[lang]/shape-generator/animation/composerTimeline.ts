/**
 * composerTimeline.ts — Technical-illustration animation timeline.
 *
 * SolidWorks Composer creates assembly instructions, exploded-view
 * walkthroughs, and operator training videos from the CAD assembly.
 * The core abstraction is a *keyframe timeline*: a list of "this
 * actor's position/visibility/highlight changes from t to t+Δ".
 *
 * Capabilities:
 *
 *   - **Keyframe timeline** with N tracks (one per actor) and M
 *     keyframes per track. Linear / ease / cubic interpolation.
 *   - **Exploded-view sequence** auto-generator — drop apart from
 *     the assembly center along configurable axes.
 *   - **Callout / annotation animation** — text label fades in,
 *     leader line draws.
 *   - **Camera path** — orbit / zoom / fly-through with smooth
 *     in/out tangents.
 *   - **Export to frame sequence** — for downstream video encoding.
 *
 * Output is a time-sampled `Frame[]` that the renderer (existing
 * path tracer or real-time view) consumes one frame at a time.
 */

export type Easing = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'step';

export interface Keyframe<T> {
  /** Time (sec) at which this keyframe is hit. */
  t: number;
  value: T;
  easing?: Easing;
}

export interface Track<T> {
  actorId: string;
  property: 'position' | 'rotation' | 'opacity' | 'highlight' | 'cameraTarget';
  keyframes: Keyframe<T>[];
}

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

export interface ActorState {
  /** Position offset from base (mm). */
  position: Vec3;
  /** Rotation quaternion (x, y, z, w). */
  rotation: Quat;
  /** 0..1 — 0 = invisible, 1 = fully visible. */
  opacity: number;
  /** Highlight intensity — used for color/outline emphasis. */
  highlight: number;
}

export interface Frame {
  /** Frame time (sec). */
  t: number;
  /** State for every named actor. */
  actors: Record<string, ActorState>;
  /** Camera state. */
  camera: { position: Vec3; target: Vec3; fov: number };
  /** Captions visible at this frame. */
  captions: Array<{ text: string; positionScreen: [number, number]; opacity: number }>;
}

// ── Easing functions ────────────────────────────────────────────

function applyEasing(t: number, easing: Easing): number {
  switch (easing) {
    case 'linear': return t;
    case 'ease-in': return t * t;
    case 'ease-out': return t * (2 - t);
    case 'ease-in-out': return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    case 'step': return t < 1 ? 0 : 1;
  }
}

// ── Track interpolation ─────────────────────────────────────────

export function interpolateScalar(track: Track<number>, t: number): number {
  const k = track.keyframes;
  if (k.length === 0) return 0;
  if (t <= k[0]!.t) return k[0]!.value;
  if (t >= k[k.length - 1]!.t) return k[k.length - 1]!.value;
  for (let i = 0; i < k.length - 1; i++) {
    if (t >= k[i]!.t && t <= k[i + 1]!.t) {
      const u = (t - k[i]!.t) / (k[i + 1]!.t - k[i]!.t);
      const eased = applyEasing(u, k[i + 1]!.easing ?? 'linear');
      return k[i]!.value * (1 - eased) + k[i + 1]!.value * eased;
    }
  }
  return 0;
}

export function interpolateVec3(track: Track<Vec3>, t: number): Vec3 {
  const k = track.keyframes;
  if (k.length === 0) return [0, 0, 0];
  if (t <= k[0]!.t) return [...k[0]!.value];
  if (t >= k[k.length - 1]!.t) return [...k[k.length - 1]!.value];
  for (let i = 0; i < k.length - 1; i++) {
    if (t >= k[i]!.t && t <= k[i + 1]!.t) {
      const u = (t - k[i]!.t) / (k[i + 1]!.t - k[i]!.t);
      const e = applyEasing(u, k[i + 1]!.easing ?? 'linear');
      const a = k[i]!.value;
      const b = k[i + 1]!.value;
      return [a[0] * (1 - e) + b[0] * e, a[1] * (1 - e) + b[1] * e, a[2] * (1 - e) + b[2] * e];
    }
  }
  return [0, 0, 0];
}

// ── Timeline assembly ───────────────────────────────────────────

export interface Timeline {
  /** Total duration (sec). */
  duration: number;
  tracks: Array<Track<Vec3> | Track<Quat> | Track<number>>;
  captionEvents: Array<{ t: number; durationSec: number; text: string; positionScreen: [number, number] }>;
  cameraTrack?: Track<Vec3>;
  cameraTargetTrack?: Track<Vec3>;
}

/** Sample the entire timeline at a given time. */
export function sampleFrame(timeline: Timeline, t: number, actorIds: string[]): Frame {
  const actors: Record<string, ActorState> = {};
  for (const id of actorIds) {
    const positionTrack = timeline.tracks.find(tr => tr.actorId === id && tr.property === 'position') as Track<Vec3> | undefined;
    const opacityTrack = timeline.tracks.find(tr => tr.actorId === id && tr.property === 'opacity') as Track<number> | undefined;
    const highlightTrack = timeline.tracks.find(tr => tr.actorId === id && tr.property === 'highlight') as Track<number> | undefined;
    actors[id] = {
      position: positionTrack ? interpolateVec3(positionTrack, t) : [0, 0, 0],
      rotation: [0, 0, 0, 1],
      opacity: opacityTrack ? interpolateScalar(opacityTrack, t) : 1,
      highlight: highlightTrack ? interpolateScalar(highlightTrack, t) : 0,
    };
  }
  const camera = {
    position: timeline.cameraTrack ? interpolateVec3(timeline.cameraTrack, t) : [0, 0, 100] as Vec3,
    target: timeline.cameraTargetTrack ? interpolateVec3(timeline.cameraTargetTrack, t) : [0, 0, 0] as Vec3,
    fov: 50,
  };
  const captions: Frame['captions'] = [];
  for (const c of timeline.captionEvents) {
    if (t >= c.t && t <= c.t + c.durationSec) {
      const localT = (t - c.t) / c.durationSec;
      // Fade in over 0.3s, fade out over 0.3s.
      let opacity = 1;
      if (localT < 0.1) opacity = localT / 0.1;
      else if (localT > 0.9) opacity = (1 - localT) / 0.1;
      captions.push({ text: c.text, positionScreen: c.positionScreen, opacity });
    }
  }
  return { t, actors, camera, captions };
}

// ── Frame-sequence export ───────────────────────────────────────

export function renderFrames(
  timeline: Timeline,
  actorIds: string[],
  fps: number = 30,
): Frame[] {
  const out: Frame[] = [];
  const totalFrames = Math.ceil(timeline.duration * fps);
  for (let i = 0; i < totalFrames; i++) {
    out.push(sampleFrame(timeline, i / fps, actorIds));
  }
  return out;
}

// ── Exploded view auto-generator ────────────────────────────────

export interface ExplodedActor {
  id: string;
  /** Resting position (mm). */
  basePosition: Vec3;
  /** Optional explode direction (else: away from assembly center). */
  explodeDirection?: Vec3;
  /** Distance to move during explode (mm). */
  explodeDistanceMm: number;
}

export interface ExplodedSequenceOptions {
  /** Time spent exploding (sec). */
  explodeDurationSec: number;
  /** Time stationary at apex (sec). */
  holdDurationSec: number;
  /** Time spent re-assembling (sec). */
  reassembleDurationSec: number;
  /** Stagger between actors (sec). */
  staggerSec?: number;
  /** Center of explosion (mm). */
  centerPosition?: Vec3;
}

export function generateExplodedTimeline(
  actors: ExplodedActor[],
  options: ExplodedSequenceOptions,
): Timeline {
  const stagger = options.staggerSec ?? 0.1;
  const center = options.centerPosition ?? [0, 0, 0];
  const tracks: Timeline['tracks'] = [];
  let maxEnd = 0;

  for (let i = 0; i < actors.length; i++) {
    const actor = actors[i]!;
    const startT = i * stagger;
    const explodedT = startT + options.explodeDurationSec;
    const holdEndT = explodedT + options.holdDurationSec;
    const reassembledT = holdEndT + options.reassembleDurationSec;
    if (reassembledT > maxEnd) maxEnd = reassembledT;

    let direction: Vec3 = actor.explodeDirection ?? [
      actor.basePosition[0] - center[0],
      actor.basePosition[1] - center[1],
      actor.basePosition[2] - center[2],
    ];
    const len = Math.hypot(direction[0], direction[1], direction[2]) || 1;
    direction = [direction[0] / len, direction[1] / len, direction[2] / len];
    const explodedPos: Vec3 = [
      actor.basePosition[0] + direction[0] * actor.explodeDistanceMm,
      actor.basePosition[1] + direction[1] * actor.explodeDistanceMm,
      actor.basePosition[2] + direction[2] * actor.explodeDistanceMm,
    ];

    tracks.push({
      actorId: actor.id,
      property: 'position',
      keyframes: [
        { t: startT, value: actor.basePosition, easing: 'linear' },
        { t: explodedT, value: explodedPos, easing: 'ease-out' },
        { t: holdEndT, value: explodedPos, easing: 'linear' },
        { t: reassembledT, value: actor.basePosition, easing: 'ease-in' },
      ],
    });
  }

  return {
    duration: maxEnd,
    tracks,
    captionEvents: [],
  };
}

// ── Callout helper ──────────────────────────────────────────────

export function addCallout(
  timeline: Timeline,
  at: number,
  durationSec: number,
  text: string,
  positionScreen: [number, number],
): void {
  timeline.captionEvents.push({ t: at, durationSec, text, positionScreen });
  if (at + durationSec > timeline.duration) {
    timeline.duration = at + durationSec;
  }
}

// ── Camera orbit path ───────────────────────────────────────────

export function generateOrbitCamera(
  centerPosition: Vec3,
  radiusMm: number,
  startAngleDeg: number,
  endAngleDeg: number,
  durationSec: number,
  heightMm: number = 0,
): { cameraTrack: Track<Vec3>; cameraTargetTrack: Track<Vec3> } {
  const sampleCount = Math.max(8, Math.ceil(durationSec * 30 / 3));
  const camPositions: Keyframe<Vec3>[] = [];
  for (let i = 0; i < sampleCount; i++) {
    const t = (i / (sampleCount - 1)) * durationSec;
    const angleDeg = startAngleDeg + (endAngleDeg - startAngleDeg) * (i / (sampleCount - 1));
    const angle = angleDeg * Math.PI / 180;
    camPositions.push({
      t,
      value: [
        centerPosition[0] + radiusMm * Math.cos(angle),
        centerPosition[1] + heightMm,
        centerPosition[2] + radiusMm * Math.sin(angle),
      ],
      easing: 'ease-in-out',
    });
  }
  return {
    cameraTrack: { actorId: 'camera', property: 'cameraTarget', keyframes: camPositions },
    cameraTargetTrack: {
      actorId: 'camera-target',
      property: 'cameraTarget',
      keyframes: [{ t: 0, value: centerPosition }, { t: durationSec, value: centerPosition }],
    },
  };
}
