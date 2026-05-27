/**
 * arSessionRecorder.ts — Record + replay AR / WebXR session metadata.
 *
 * For customer support, demo recording, and tracking-quality analysis
 * we want to capture what an AR session "saw": camera poses, plane
 * detections, anchor placements, interaction events. NOT the camera
 * video itself (too heavy) — just the metadata that drives the
 * application.
 *
 * Use cases:
 *   - **Customer support**: when a user reports "the placement is
 *     wobbly", they upload the recorded session and we replay to see
 *     tracking quality + reproject 3D content with their actual poses.
 *   - **Demo capture**: record a polished session for marketing video
 *     synthesis (replay frames + render against synthetic backgrounds).
 *   - **Tracking metrics**: compute drift + jitter + plane stability.
 */

export interface CameraPose {
  /** Time since session start (ms). */
  timeMs: number;
  /** Position in world (mm). */
  position: [number, number, number];
  /** Rotation quaternion. */
  rotation: [number, number, number, number];
  /** Tracking confidence 0..1. */
  trackingConfidence: number;
}

export interface DetectedPlane {
  id: string;
  /** First detected (ms). */
  firstSeenMs: number;
  /** Last update (ms). */
  lastSeenMs: number;
  /** Plane center (mm). */
  center: [number, number, number];
  /** Normal (unit). */
  normal: [number, number, number];
  /** Extents along plane axes (mm × mm). */
  extents: [number, number];
}

export interface Anchor {
  id: string;
  /** Time placed (ms). */
  placedAtMs: number;
  position: [number, number, number];
  /** Linked content key (e.g. "bracket-v3"). */
  contentKey?: string;
}

export interface InteractionEvent {
  timeMs: number;
  kind: 'tap' | 'drag' | 'rotate' | 'scale' | 'remove';
  /** Screen coordinates if applicable. */
  screen?: [number, number];
  /** Anchor id if applicable. */
  anchorId?: string;
  /** Extra payload. */
  payload?: Record<string, number | string>;
}

export interface ArSession {
  /** Session id. */
  id: string;
  /** Wall-clock start (ms epoch). */
  startedAtMs: number;
  /** Device label. */
  deviceLabel?: string;
  /** Camera poses sampled at frame rate. */
  cameraPoses: CameraPose[];
  /** Detected planes (deduped by id). */
  planes: Map<string, DetectedPlane>;
  /** Anchors placed by user. */
  anchors: Anchor[];
  /** User interactions. */
  interactions: InteractionEvent[];
}

// ── Recorder ───────────────────────────────────────────────────

export class ArSessionRecorder {
  session: ArSession;

  constructor(id: string, deviceLabel?: string) {
    this.session = {
      id,
      startedAtMs: Date.now(),
      ...(deviceLabel ? { deviceLabel } : {}),
      cameraPoses: [],
      planes: new Map(),
      anchors: [],
      interactions: [],
    };
  }

  recordPose(pose: CameraPose): void {
    this.session.cameraPoses.push(pose);
  }

  recordPlane(plane: DetectedPlane): void {
    this.session.planes.set(plane.id, plane);
  }

  placeAnchor(anchor: Anchor): void {
    this.session.anchors.push(anchor);
  }

  recordInteraction(event: InteractionEvent): void {
    this.session.interactions.push(event);
  }

  // ── Querying ────────────────────────────────────────────────

  poseAt(timeMs: number): CameraPose | null {
    if (this.session.cameraPoses.length === 0) return null;
    // Binary search for closest.
    let lo = 0, hi = this.session.cameraPoses.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.session.cameraPoses[mid]!.timeMs < timeMs) lo = mid + 1;
      else hi = mid;
    }
    return this.session.cameraPoses[lo]!;
  }

  durationMs(): number {
    if (this.session.cameraPoses.length === 0) return 0;
    return this.session.cameraPoses[this.session.cameraPoses.length - 1]!.timeMs;
  }

  // ── Serialization ───────────────────────────────────────────

  serialize(): SerializedSession {
    return {
      version: 1,
      id: this.session.id,
      startedAtMs: this.session.startedAtMs,
      ...(this.session.deviceLabel ? { deviceLabel: this.session.deviceLabel } : {}),
      cameraPoses: this.session.cameraPoses,
      planes: [...this.session.planes.values()],
      anchors: this.session.anchors,
      interactions: this.session.interactions,
    };
  }

  static load(data: SerializedSession): ArSessionRecorder {
    if (data.version !== 1) throw new Error(`Unsupported session version ${data.version}`);
    const r = new ArSessionRecorder(data.id, data.deviceLabel);
    r.session.startedAtMs = data.startedAtMs;
    r.session.cameraPoses = data.cameraPoses;
    for (const p of data.planes) r.session.planes.set(p.id, p);
    r.session.anchors = data.anchors;
    r.session.interactions = data.interactions;
    return r;
  }
}

export interface SerializedSession {
  version: number;
  id: string;
  startedAtMs: number;
  deviceLabel?: string;
  cameraPoses: CameraPose[];
  planes: DetectedPlane[];
  anchors: Anchor[];
  interactions: InteractionEvent[];
}

// ── Tracking quality metrics ──────────────────────────────────

export interface TrackingQuality {
  /** Mean tracking confidence. */
  meanConfidence: number;
  /** Frame count below 0.5 confidence. */
  lowConfidenceFrames: number;
  /** Position jitter (mean Euclidean distance between consecutive frames, mm). */
  jitterMm: number;
  /** Total drift estimate: distance between mean of first 10% and last 10% poses, mm. */
  driftMm: number;
}

export function computeTrackingQuality(session: ArSession): TrackingQuality {
  const poses = session.cameraPoses;
  if (poses.length === 0) return { meanConfidence: 0, lowConfidenceFrames: 0, jitterMm: 0, driftMm: 0 };

  // Mean confidence + low-conf count.
  let confSum = 0;
  let lowConfCount = 0;
  for (const p of poses) {
    confSum += p.trackingConfidence;
    if (p.trackingConfidence < 0.5) lowConfCount++;
  }
  const meanConf = confSum / poses.length;

  // Jitter: mean consecutive distance, but ignore long gaps.
  let jitterSum = 0;
  let jitterCount = 0;
  for (let i = 1; i < poses.length; i++) {
    const a = poses[i - 1]!.position;
    const b = poses[i]!.position;
    const d = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    if (d < 100) {
      jitterSum += d;
      jitterCount++;
    }
  }
  const jitter = jitterCount > 0 ? jitterSum / jitterCount : 0;

  // Drift: compare first / last 10% pose centroids.
  const span = Math.max(1, Math.floor(poses.length * 0.1));
  const head = poses.slice(0, span);
  const tail = poses.slice(-span);
  const headMean = centroid(head.map(p => p.position));
  const tailMean = centroid(tail.map(p => p.position));
  const drift = Math.hypot(
    tailMean[0] - headMean[0],
    tailMean[1] - headMean[1],
    tailMean[2] - headMean[2],
  );

  return {
    meanConfidence: meanConf,
    lowConfidenceFrames: lowConfCount,
    jitterMm: jitter,
    driftMm: drift,
  };
}

function centroid(positions: Array<[number, number, number]>): [number, number, number] {
  if (positions.length === 0) return [0, 0, 0];
  let sx = 0, sy = 0, sz = 0;
  for (const p of positions) { sx += p[0]; sy += p[1]; sz += p[2]; }
  return [sx / positions.length, sy / positions.length, sz / positions.length];
}

// ── Replay ────────────────────────────────────────────────────

export interface ReplayHandler {
  onPose?: (pose: CameraPose) => void;
  onPlaneUpdate?: (plane: DetectedPlane) => void;
  onInteraction?: (event: InteractionEvent) => void;
}

/** Replay events in chronological order. */
export function replaySession(session: ArSession, handler: ReplayHandler): void {
  const events: Array<{ time: number; fn: () => void }> = [];
  for (const pose of session.cameraPoses) {
    events.push({ time: pose.timeMs, fn: () => handler.onPose?.(pose) });
  }
  for (const plane of session.planes.values()) {
    events.push({ time: plane.firstSeenMs, fn: () => handler.onPlaneUpdate?.(plane) });
  }
  for (const event of session.interactions) {
    events.push({ time: event.timeMs, fn: () => handler.onInteraction?.(event) });
  }
  events.sort((a, b) => a.time - b.time);
  for (const e of events) e.fn();
}

// ── Stats ─────────────────────────────────────────────────────

export interface SessionStats {
  durationMs: number;
  poseCount: number;
  planeCount: number;
  anchorCount: number;
  interactionCount: number;
  averageFrameRate: number;
}

export function sessionStats(session: ArSession): SessionStats {
  const duration = session.cameraPoses.length === 0 ? 0 : session.cameraPoses[session.cameraPoses.length - 1]!.timeMs;
  return {
    durationMs: duration,
    poseCount: session.cameraPoses.length,
    planeCount: session.planes.size,
    anchorCount: session.anchors.length,
    interactionCount: session.interactions.length,
    averageFrameRate: duration > 0 ? (session.cameraPoses.length / (duration / 1000)) : 0,
  };
}
