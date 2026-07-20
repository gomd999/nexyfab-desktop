import * as THREE from 'three';
import type { FeatureDefinition } from './types';
import { occtSweepProfile, occtSweepHelix } from './occtEngine';
import { shouldUseOcctEngine } from './engineSelection';
import { noteMeshFallback } from './downgradeNotice';
import { sweepVariableSection, type SpinePathSample } from './variableSectionSweep';

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

/**
 * W5-A twist sweep: the rectangular section rotates linearly about the path
 * tangent from 0 to `twist`° over the sweep, carried by rotation-minimizing
 * frames (sweepVariableSection). Exact rectangle corners are kept
 * (profileResolution = 4). Volume note: stations discretize the path and the
 * twist, so curved/twisted volumes are approximations that converge with
 * station count (measured bounds live in sweep.test.ts).
 */
function applySweepTwistMesh(hw: number, hh: number, p: SweepParams): THREE.BufferGeometry {
  const twistRad = (p.twistDeg / 180) * Math.PI;
  const spine = spineSamples(p, hw, hh);
  const stationCount = p.pathType === 0 ? 65 : p.pathType === 1 ? 129 : p.helixSteps + 1;
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
    return baseProfile.map(pt => ({ x: pt.x * c - pt.y * sn, y: pt.x * sn + pt.y * c }));
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

  // Twisted sweep goes through the station-based builder (ExtrudeGeometry
  // cannot rotate its shape along the path).
  if (p.twistDeg !== 0) return applySweepTwistMesh(hw, hh, p);

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
 *  (mesh fallback). A twisted sweep is NOT representable by these B-rep pipe
 *  builders — return null so the mesh path handles it (with a downgrade note). */
function applySweepOcct(geometry: THREE.BufferGeometry, params: Record<string, number>): THREE.BufferGeometry | null {
  try {
    const twistDeg = Number.isFinite(params.twist) ? params.twist : 0;
    if (twistDeg !== 0) return null;
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
