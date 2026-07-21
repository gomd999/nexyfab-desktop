import * as THREE from 'three';
import type { FeatureDefinition } from './types';
import { occtSweepProfile, occtSweepHelix } from './occtEngine';
import { shouldUseOcctEngine } from './engineSelection';
import { noteMeshFallback } from './downgradeNotice';
import { sweepVariableSection, sampleSpine, type SpinePathSample, type Point3D } from './variableSectionSweep';

/** Rectangular cross-section half-extents from the input geometry bbox. */
function crossSection(geometry: THREE.BufferGeometry): { hw: number; hh: number } | null {
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  if (!bb) return null;
  return { hw: (bb.max.x - bb.min.x) / 2, hh: (bb.max.y - bb.min.y) / 2 };
}

interface SweepParams {
  pathType: number;
  length: number;
  arcAngleDeg: number;
  arcRadius: number;
  turns: number;
  pitch: number;
  helixSteps: number;
  twistDeg: number;
  /** 0 = no guide rail, 1 = linear guide rail (see guide-rail block below). */
  guideMode: number;
  /** In-plane spine→rail distance at the start / end of the path (mm). */
  guideStart: number;
  guideEnd: number;
}

function sanitizeParams(params: Record<string, number>): SweepParams {
  // Sanitize non-finite params so a NaN never reaches the curve/extrude maths
  // (a single NaN propagates to every vertex → invalid solid). Cap helix steps
  // so a huge turns count can't lock the tab up.
  const turns = Math.max(1, Math.min(100, Number.isFinite(params.helixTurns) ? params.helixTurns : 3));
  return {
    pathType: Math.round(Number.isFinite(params.pathType) ? params.pathType : 0),
    length: Number.isFinite(params.length) ? params.length : 100,
    arcAngleDeg: Number.isFinite(params.arcAngle) ? params.arcAngle : 90,
    arcRadius: Number.isFinite(params.arcRadius) ? params.arcRadius : 60,
    turns,
    pitch: Number.isFinite(params.helixPitch) ? params.helixPitch : 20,
    helixSteps: Math.max(2, Math.min(2000, Math.round(turns * 36))),
    twistDeg: Number.isFinite(params.twist) ? params.twist : 0,
    guideMode: Math.round(Number.isFinite(params.guideMode) ? params.guideMode : 0),
    // Deliberately NOT clamped to > 0: a non-positive distance is an
    // explicit rejection (thrown with a reason), never a silent fix-up.
    guideStart: Number.isFinite(params.guideStart) ? params.guideStart : 20,
    guideEnd: Number.isFinite(params.guideEnd) ? params.guideEnd : 20,
  };
}

/** Analytic spine samples (position + unit tangent) for the three path types. */
function spineSamples(p: SweepParams, hw: number, hh: number): SpinePathSample[] {
  const out: SpinePathSample[] = [];
  if (p.pathType === 0) {
    // Straight along +Z.
    out.push({ t: 0, position: { x: 0, y: 0, z: 0 }, tangent: { x: 0, y: 0, z: 1 } });
    out.push({ t: 1, position: { x: 0, y: 0, z: p.length }, tangent: { x: 0, y: 0, z: 1 } });
    return out;
  }
  if (p.pathType === 1) {
    // Circular arc in the XZ plane (same geometry as the extrude path).
    const arcAngle = (p.arcAngleDeg / 180) * Math.PI;
    const steps = 128;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const a = t * arcAngle;
      out.push({
        t,
        position: { x: p.arcRadius * Math.sin(a), y: 0, z: p.arcRadius * (1 - Math.cos(a)) },
        tangent: { x: Math.cos(a), y: 0, z: Math.sin(a) },
      });
    }
    return out;
  }
  // Helix (same radius/pitch/turns as the extrude path).
  const helixR = Math.max(hw, hh) * 1.5 + 20;
  const steps = p.helixSteps;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = t * p.turns * Math.PI * 2;
    const w = p.turns * Math.PI * 2; // d(angle)/dt
    const dx = -helixR * Math.sin(a) * w;
    const dy = p.turns * p.pitch;
    const dz = helixR * Math.cos(a) * w;
    const len = Math.hypot(dx, dy, dz) || 1;
    out.push({
      t,
      position: { x: helixR * Math.cos(a), y: t * p.turns * p.pitch, z: helixR * Math.sin(a) },
      tangent: { x: dx / len, y: dy / len, z: dz / len },
    });
  }
  return out;
}

// ── W5-A guide-rail sweep ───────────────────────────────────────────────────
//
// Adopted semantics (minimal 1-guide form of a SolidWorks guide-curve sweep):
//   spine path + ONE guide curve. At each RMF station the guide point
//   associated by *parameter synchronization* (same normalized t as the
//   station — not closest-plane intersection) is projected into the station's
//   section plane; the section is scaled UNIFORMLY by
//       k(t) = d_inplane(t) / d_inplane(0)
//   so the section point that starts on the rail keeps tracking the rail.
// Explicit limits (this is NOT the fully general guide-curve sweep):
//   - uniform scale only — no single-axis stretch, no shear, no extra section
//     rotation driven by the guide (twist stays an independent parameter),
//   - parameter sync, so a guide with very different arc-length pacing than
//     the spine will pair points differently than SolidWorks' plane-
//     intersection pairing (approximation, documented),
//   - the out-of-plane component of the spine→guide offset is dropped by the
//     projection; if it dominates (offset nearly parallel to the tangent) the
//     station's section plane cannot reach the guide point → explicit reject.

/** One guide-rail sample: normalized parameter t ∈ [0,1] + world position. */
export interface GuideRailSample {
  t: number;
  position: Point3D;
}

export type GuideRailScaleResult =
  | { ok: true; scales: number[] }
  | { ok: false; reason: string };

const GUIDE_EPS = 1e-6; // mm — below this the spine→rail distance is "zero"

/** Piecewise-linear interpolation of the guide polyline at parameter t. */
function interpGuide(guide: GuideRailSample[], t: number): Point3D {
  if (t <= guide[0]!.t) return guide[0]!.position;
  const last = guide[guide.length - 1]!;
  if (t >= last.t) return last.position;
  for (let i = 0; i < guide.length - 1; i++) {
    const a = guide[i]!, b = guide[i + 1]!;
    if (b.t >= t) {
      const u = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0;
      return {
        x: a.position.x + (b.position.x - a.position.x) * u,
        y: a.position.y + (b.position.y - a.position.y) * u,
        z: a.position.z + (b.position.z - a.position.z) * u,
      };
    }
  }
  return last.position;
}

/**
 * Per-station uniform section scales from a guide rail polyline.
 *
 * Stations are sampled with the SAME `sampleSpine` the mesh builder uses, so
 * scale i belongs to exactly the i-th emitted station. Returns `{ok:false}`
 * with a reason instead of guessing when the guide is incompatible with the
 * spine:
 *   - fewer than 2 guide samples (no curve to follow),
 *   - guide touches the spine (in-plane distance < 1e-6 mm → scale collapses),
 *   - guide crosses the spine between stations (in-plane direction flips —
 *     would need a negative/mirrored section scale, not representable),
 *   - spine→guide offset out of the section plane by more than 50% of its
 *     in-plane component (offset nearly parallel to the tangent — the
 *     station's section plane cannot reach the guide point).
 */
export function computeGuideRailScales(
  spine: SpinePathSample[],
  guide: GuideRailSample[],
  stationCount: number,
): GuideRailScaleResult {
  if (guide.length < 2) {
    return { ok: false, reason: `guide rail needs at least 2 samples (got ${guide.length})` };
  }
  const stations = sampleSpine(spine, stationCount);
  if (stations.length < 2) {
    return { ok: false, reason: `spine yields fewer than 2 stations (got ${stations.length})` };
  }
  const dIn: number[] = [];
  let prevInPlane: Point3D | null = null;
  for (let i = 0; i < stations.length; i++) {
    const st = stations[i]!;
    const g = interpGuide(guide, st.t);
    const off: Point3D = {
      x: g.x - st.position.x,
      y: g.y - st.position.y,
      z: g.z - st.position.z,
    };
    const along = off.x * st.tangent.x + off.y * st.tangent.y + off.z * st.tangent.z;
    const inPlane: Point3D = {
      x: off.x - along * st.tangent.x,
      y: off.y - along * st.tangent.y,
      z: off.z - along * st.tangent.z,
    };
    const d = Math.hypot(inPlane.x, inPlane.y, inPlane.z);
    const tLabel = st.t.toFixed(3);
    if (d < GUIDE_EPS) {
      return { ok: false, reason: `guide touches the spine at t=${tLabel} (in-plane distance ${d.toExponential(2)} mm < ${GUIDE_EPS} — section scale collapses to 0)` };
    }
    if (Math.abs(along) > 0.5 * d) {
      return { ok: false, reason: `guide point at t=${tLabel} is unreachable from the section plane (out-of-plane offset ${Math.abs(along).toFixed(3)} mm > 50% of in-plane ${d.toFixed(3)} mm — offset nearly parallel to the spine tangent)` };
    }
    if (prevInPlane && (prevInPlane.x * inPlane.x + prevInPlane.y * inPlane.y + prevInPlane.z * inPlane.z) < 0) {
      return { ok: false, reason: `guide crosses the spine between t=${stations[i - 1]!.t.toFixed(3)} and t=${tLabel} (in-plane direction flips — a negative/mirrored section scale is not representable)` };
    }
    prevInPlane = inPlane;
    dIn.push(d);
  }
  const d0 = dIn[0]!;
  return { ok: true, scales: dIn.map(d => d / d0) };
}

/**
 * Linear guide rail from the feature's scalar params: at parameter t the rail
 * sits lerp(guideStart, guideEnd, t) mm from the spine along world +Y — which
 * is perpendicular to the tangent for the straight (+Z) and arc (XZ-plane)
 * paths, and within ~9% tangential skew for the default helix (projected;
 * see out-of-plane note above). Non-positive distances are rejected before a
 * polyline is even built: they would demand a zero/negative section scale.
 */
function guideFromParams(p: SweepParams, spine: SpinePathSample[]): GuideRailSample[] {
  if (!(p.guideStart > GUIDE_EPS) || !(p.guideEnd > GUIDE_EPS)) {
    throw new Error(
      `Sweep guide rail rejected: guide distances must be positive (start=${p.guideStart} mm, end=${p.guideEnd} mm) — a zero or negative spine→rail distance implies a non-positive section scale`,
    );
  }
  return spine.map(s => ({
    t: s.t,
    position: {
      x: s.position.x,
      y: s.position.y + p.guideStart + (p.guideEnd - p.guideStart) * s.t,
      z: s.position.z,
    },
  }));
}

/**
 * W5-A station-based sweep: twist (section rotates linearly about the path
 * tangent, RMF-carried) and/or guide rail (section scales uniformly to track
 * the rail, see guide-rail block above). Exact rectangle corners are kept.
 * Volume note: stations discretize the path and the twist, so curved/twisted
 * volumes are approximations that converge with station count; the pure
 * guide-rail taper on a straight spine is exact (linear-in-t vertices →
 * planar lateral faces). Measured bounds live in sweep.test.ts.
 */
function applySweepStationMesh(hw: number, hh: number, p: SweepParams): THREE.BufferGeometry {
  const twistRad = (p.twistDeg / 180) * Math.PI;
  const spine = spineSamples(p, hw, hh);
  const stationCount = p.pathType === 0 ? 65 : p.pathType === 1 ? 129 : p.helixSteps + 1;

  // Guide-rail scales, aligned 1:1 with the stations the builder will emit.
  let scales: number[] | null = null;
  if (p.guideMode === 1) {
    const guide = guideFromParams(p, spine);
    const res = computeGuideRailScales(spine, guide, stationCount);
    if (!res.ok) throw new Error(`Sweep guide rail rejected: ${res.reason}`);
    scales = res.scales;
  }
  const scaleAt = (s: number): number => {
    if (!scales) return 1;
    const f = s * (scales.length - 1);
    const i0 = Math.min(scales.length - 2, Math.max(0, Math.floor(f)));
    const u = f - i0;
    return scales[i0]! * (1 - u) + scales[i0 + 1]! * u;
  };
  // Rectangle densified with SUB points per edge (corners preserved exactly) —
  // a corner-only profile makes the twisted saddle quads lose ~1% volume to
  // their same-diagonal triangulation; subdividing shrinks that bias.
  const SUB = 16;
  const baseProfile: { x: number; y: number }[] = [];
  const corners = [
    { x: -hw, y: -hh }, { x: hw, y: -hh }, { x: hw, y: hh }, { x: -hw, y: hh },
  ];
  for (let e = 0; e < 4; e++) {
    const a = corners[e]!, b = corners[(e + 1) % 4]!;
    for (let k = 0; k < SUB; k++) {
      const f = k / SUB;
      baseProfile.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
    }
  }
  const profileFn = (s: number) => {
    const rot = twistRad * s;
    const c = Math.cos(rot), sn = Math.sin(rot);
    const k = scaleAt(s);
    return baseProfile.map(pt => ({
      x: (pt.x * c - pt.y * sn) * k,
      y: (pt.x * sn + pt.y * c) * k,
    }));
  };
  const mesh = sweepVariableSection(spine, profileFn, {
    stationCount,
    profileResolution: baseProfile.length,
    capEnds: true,
    frame: 'rmf',
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
  geo.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  geo.computeVertexNormals();
  return geo;
}

function applySweepMesh(geometry: THREE.BufferGeometry, params: Record<string, number>): THREE.BufferGeometry {
  const cs = crossSection(geometry);
  if (!cs) return geometry;
  // A zero-area section (flat input) makes a degenerate ExtrudeGeometry — floor it.
  const hw = cs.hw > 0 ? cs.hw : 1;
  const hh = cs.hh > 0 ? cs.hh : 1;
  const p = sanitizeParams(params);

  // Twisted and/or guide-rail sweeps go through the station-based builder
  // (ExtrudeGeometry can neither rotate nor scale its shape along the path).
  // twist=0 AND no guide keeps the original ExtrudeGeometry path untouched
  // (bit-identical regression guarantee).
  if (p.twistDeg !== 0 || p.guideMode === 1) return applySweepStationMesh(hw, hh, p);

  const shape = new THREE.Shape();
  shape.moveTo(-hw, -hh);
  shape.lineTo(hw, -hh);
  shape.lineTo(hw, hh);
  shape.lineTo(-hw, hh);
  shape.closePath();

  let extrudePath: THREE.Curve<THREE.Vector3>;

  if (p.pathType === 0) {
    extrudePath = new THREE.LineCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, p.length));
  } else if (p.pathType === 1) {
    const arcAngle = (p.arcAngleDeg / 180) * Math.PI;
    const pts: THREE.Vector3[] = [];
    const steps = 32;
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * arcAngle;
      pts.push(new THREE.Vector3(p.arcRadius * Math.sin(a), 0, p.arcRadius * (1 - Math.cos(a))));
    }
    extrudePath = new THREE.CatmullRomCurve3(pts);
  } else {
    const helixR = Math.max(hw, hh) * 1.5 + 20;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= p.helixSteps; i++) {
      const t = i / p.helixSteps;
      const a = t * p.turns * Math.PI * 2;
      pts.push(new THREE.Vector3(helixR * Math.cos(a), t * p.turns * p.pitch, helixR * Math.sin(a)));
    }
    extrudePath = new THREE.CatmullRomCurve3(pts);
  }

  const swept = new THREE.ExtrudeGeometry(shape, {
    steps: p.pathType === 2 ? p.helixSteps : 48,
    bevelEnabled: false,
    extrudePath,
  });
  swept.computeVertexNormals();
  return swept;
}

/** Planar path points (in the XZ plane: [x, z]) for a straight or arc sweep.
 *  Returns null for the helix (a true 3D path occtSweepProfile can't represent
 *  with its 2D polyline). */
function planarPath(params: Record<string, number>): { x: number; y: number }[] | null {
  const pathType = Math.round(Number.isFinite(params.pathType) ? params.pathType : 0);
  if (pathType === 0) {
    return [{ x: 0, y: 0 }, { x: 0, y: Number.isFinite(params.length) ? params.length : 100 }];
  }
  if (pathType === 1) {
    const arcAngle = ((Number.isFinite(params.arcAngle) ? params.arcAngle : 90) / 180) * Math.PI;
    const R = Number.isFinite(params.arcRadius) ? params.arcRadius : 60;
    const pts: { x: number; y: number }[] = [];
    const steps = 32;
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * arcAngle;
      pts.push({ x: R * Math.sin(a), y: R * (1 - Math.cos(a)) });
    }
    return pts;
  }
  return null;
}

/** OCCT B-rep sweep: planar paths (straight/arc) go through occtSweepProfile;
 *  the helix goes through occtSweepHelix (true 3D spine). The rectangular
 *  section + helix radius mirror the mesh path so the bbox matches; the result
 *  carries an occtHandle for downstream fillet/chamfer. Any failure → null
 *  (mesh fallback). A twisted or guide-rail sweep is NOT representable by
 *  these B-rep pipe builders — return null so the mesh path handles it (with
 *  a downgrade note). */
function applySweepOcct(geometry: THREE.BufferGeometry, params: Record<string, number>): THREE.BufferGeometry | null {
  try {
    const twistDeg = Number.isFinite(params.twist) ? params.twist : 0;
    if (twistDeg !== 0) return null;
    const guideMode = Math.round(Number.isFinite(params.guideMode) ? params.guideMode : 0);
    if (guideMode !== 0) return null;
    const cs = crossSection(geometry);
    if (!cs || !(cs.hw > 0) || !(cs.hh > 0)) return null;
    const { hw, hh } = cs;
    const profile = [
      { x: -hw, y: -hh }, { x: hw, y: -hh }, { x: hw, y: hh }, { x: -hw, y: hh },
    ];
    const pathType = Math.round(params.pathType);
    let result;
    if (pathType === 2) {
      // Helix: same radius/pitch/height as the mesh path (height = turns×pitch).
      const turns = Math.max(1, Math.min(100, Number.isFinite(params.helixTurns) ? params.helixTurns : 3));
      const pitch = Number.isFinite(params.helixPitch) ? params.helixPitch : 20;
      const helixR = Math.max(hw, hh) * 1.5 + 20;
      result = occtSweepHelix(profile, pitch, turns * pitch, helixR);
    } else {
      const path = planarPath(params);
      if (!path) return null;
      result = occtSweepProfile(profile, path, 'XZ');
    }
    if (!result.handle) return null;
    result.geometry.userData.occtHandle = result.handle;
    return result.geometry;
  } catch (err) {
    console.warn('[sweep] OCCT path failed, falling back to mesh:', err);
    return null;
  }
}

export const sweepFeature: FeatureDefinition = {
  type: 'sweep',
  icon: '〰️',
  params: [
    {
      key: 'pathType', labelKey: 'paramSweepPath', default: 0, min: 0, max: 2, step: 1, unit: '',
      options: [
        { value: 0, labelKey: 'sweepPathStraight' },
        { value: 1, labelKey: 'sweepPathArc' },
        { value: 2, labelKey: 'sweepPathHelix' },
      ],
    },
    { key: 'length', labelKey: 'paramSweepLength', default: 100, min: 10, max: 500, step: 5, unit: 'mm' },
    { key: 'arcAngle', labelKey: 'paramSweepArcAngle', default: 90, min: 10, max: 360, step: 5, unit: '°' },
    { key: 'arcRadius', labelKey: 'paramSweepArcRadius', default: 60, min: 10, max: 300, step: 5, unit: 'mm' },
    { key: 'helixPitch', labelKey: 'paramSweepHelixPitch', default: 20, min: 1, max: 100, step: 1, unit: 'mm' },
    { key: 'helixTurns', labelKey: 'paramSweepHelixTurns', default: 3, min: 1, max: 20, step: 1, unit: '' },
    { key: 'twist', labelKey: 'paramLoftTwist', default: 0, min: 0, max: 360, step: 5, unit: '°' },
    // Guide-rail params (W5-A remainder). The labelKeys below are not yet in
    // shapeDict — FeatureParams falls back to the raw key (t[labelKey] ?? key);
    // dict registration is an orchestrator follow-up.
    {
      key: 'guideMode', labelKey: 'paramSweepGuideMode', default: 0, min: 0, max: 1, step: 1, unit: '',
      options: [
        { value: 0, labelKey: 'sweepGuideOff' },
        { value: 1, labelKey: 'sweepGuideLinearRail' },
      ],
    },
    { key: 'guideStart', labelKey: 'paramSweepGuideStart', default: 20, min: 1, max: 200, step: 1, unit: 'mm' },
    { key: 'guideEnd', labelKey: 'paramSweepGuideEnd', default: 20, min: 1, max: 200, step: 1, unit: 'mm' },
  ],
  apply(geometry, params) {
    return applySweepMesh(geometry, params);
  },
  async applyAsync(geometry, params) {
    if (shouldUseOcctEngine()) {
      const brep = applySweepOcct(geometry, params);
      if (brep) return brep;
    }
    return noteMeshFallback(applySweepMesh(geometry, params), { op: 'Sweep' });
  },
};
