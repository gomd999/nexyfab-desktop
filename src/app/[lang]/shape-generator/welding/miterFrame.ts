/**
 * miterFrame.ts — Structural-frame engine for the weldment feature (W5-E).
 *
 * Replaces the plain "sweep each segment independently" frame builder with a
 * real weldment engine:
 *
 *   1. Section profiles — the five weldment sectionTypes (0 rect-tube,
 *      1 I-beam, 2 L-angle, 3 round-tube, 4 solid rod — same enum as
 *      features/weldment.ts) are produced as analytic 2-D polygons, plus a
 *      bridge that builds polygons from the PROFILE_CATALOG standard sections
 *      (W-beam / C-channel / L-angle / HSS / round bar) in structuralMembers.ts.
 *
 *   2. Mitered members — each member is meshed directly as a prism whose end
 *      faces are arbitrary planes. At a corner shared by exactly two members
 *      the cut plane is the angle bisector (orthogonal corner → 45° miter),
 *      so the two members meet flush with ~zero overlap volume instead of
 *      ploughing through each other.
 *
 *   3. Cut list — per-member cut lengths are measured on the mitered solid
 *      (longest fibre, i.e. stock length the saw must consume) and fed into
 *      the existing cutListReport aggregation.
 *
 * Approximations (explicit):
 *   - Round sections are tessellated as regular N-gons (default 48 segments):
 *     area/volume ≈ 0.3 % below the true circle.
 *   - Corners with 3+ incident members fall back to square butt cuts.
 *   - Members whose axis is parallel to a requested cut plane keep a square
 *     cut (the projection is undefined); this cannot happen for a 2-member
 *     corner because the bisector normal always has a component along both
 *     axes unless the members are anti-parallel overlaps, which are skipped.
 *   - Steel density 7850 kg/m³ is used for cut-list linear density when no
 *     catalog profile is given.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { StructuralProfile } from './structuralMembers';
import {
  generateCutList,
  type CutListResult,
  type StructuralMember as CutListMember,
} from './cutListReport';

export type Vec3 = [number, number, number];
export type Vec2 = [number, number];

// ── Section polygons ─────────────────────────────────────────────

export interface SectionPolygons {
  /** Outer boundary, CCW. */
  outer: Vec2[];
  /** Holes, CW. */
  holes: Vec2[][];
  /** Net cross-section area (mm²) of the polygonal representation. */
  areaMm2: number;
  /** Human label, e.g. "RECT-TUBE 40x40x4". */
  label: string;
}

/** Shoelace signed area (CCW positive). */
export function polygonSignedArea(poly: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

function ensureWinding(poly: Vec2[], ccw: boolean): Vec2[] {
  const area = polygonSignedArea(poly);
  if ((ccw && area < 0) || (!ccw && area > 0)) return [...poly].reverse();
  return poly;
}

function circlePoly(r: number, segments: number): Vec2[] {
  const pts: Vec2[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  return pts;
}

function finishSection(outer: Vec2[], holes: Vec2[][], label: string): SectionPolygons {
  const o = ensureWinding(outer, true);
  const hs = holes.map(h => ensureWinding(h, false));
  const area = polygonSignedArea(o) + hs.reduce((s, h) => s + polygonSignedArea(h), 0);
  return { outer: o, holes: hs, areaMm2: area, label };
}

/** Weldment sectionType enum — mirrors features/weldment.ts params. */
export const SECTION_TYPE = {
  RECT_TUBE: 0,
  I_BEAM: 1,
  L_ANGLE: 2,
  ROUND_TUBE: 3,
  SOLID_ROD: 4,
} as const;

/**
 * Analytic polygon for a weldment sectionType — geometry identical to the
 * THREE.Shape built by features/weldment.ts makeSectionShape.
 */
export function sectionPolygons(
  sectionType: number,
  size: number,
  thickness: number,
  circleSegments = 48,
): SectionPolygons {
  const s = size / 2;
  const t = Math.min(thickness, size * 0.4);

  if (sectionType === SECTION_TYPE.RECT_TUBE) {
    const outer: Vec2[] = [[-s, -s], [s, -s], [s, s], [-s, s]];
    const hole: Vec2[] = [[-s + t, -s + t], [s - t, -s + t], [s - t, s - t], [-s + t, s - t]];
    return finishSection(outer, [hole], `RECT-TUBE ${size}x${size}x${t}`);
  }
  if (sectionType === SECTION_TYPE.I_BEAM) {
    const outer: Vec2[] = [
      [-s, -s], [s, -s], [s, -s + t], [t / 2, -s + t], [t / 2, s - t], [s, s - t],
      [s, s], [-s, s], [-s, s - t], [-t / 2, s - t], [-t / 2, -s + t], [-s, -s + t],
    ];
    return finishSection(outer, [], `I-BEAM ${size}x${size}x${t}`);
  }
  if (sectionType === SECTION_TYPE.L_ANGLE) {
    const outer: Vec2[] = [[-s, -s], [s, -s], [s, -s + t], [-s + t, -s + t], [-s + t, s], [-s, s]];
    return finishSection(outer, [], `L-ANGLE ${size}x${size}x${t}`);
  }
  if (sectionType === SECTION_TYPE.ROUND_TUBE) {
    return finishSection(
      circlePoly(s, circleSegments),
      [circlePoly(s - t, circleSegments)],
      `ROUND-TUBE OD${size}x${t}`,
    );
  }
  // Solid rod (sectionType 4 and any out-of-range fallback, same as weldment.ts).
  return finishSection(circlePoly(s, circleSegments), [], `ROUND-BAR D${size}`);
}

/**
 * Polygon from a PROFILE_CATALOG standard section (structuralMembers.ts).
 * Dimensions come straight from the catalog entry; fillet/corner radii are
 * not modeled, so the polygon area is within a few percent of the catalog
 * areaMm2 (which includes radii).
 */
export function sectionPolygonsFromProfile(
  profile: StructuralProfile,
  circleSegments = 48,
): SectionPolygons {
  const d = profile.depthMm;
  const w = profile.widthMm;
  const tw = profile.webThicknessMm ?? Math.max(2, d * 0.05);
  const tf = profile.flangeThicknessMm ?? tw;
  const hd = d / 2;
  const hw = w / 2;

  switch (profile.family) {
    case 'w-beam':
    case 's-beam': {
      const outer: Vec2[] = [
        [-hw, -hd], [hw, -hd], [hw, -hd + tf], [tw / 2, -hd + tf], [tw / 2, hd - tf], [hw, hd - tf],
        [hw, hd], [-hw, hd], [-hw, hd - tf], [-tw / 2, hd - tf], [-tw / 2, -hd + tf], [-hw, -hd + tf],
      ];
      return finishSection(outer, [], profile.name);
    }
    case 'c-channel': {
      const outer: Vec2[] = [
        [-hw, -hd], [hw, -hd], [hw, -hd + tf], [-hw + tw, -hd + tf],
        [-hw + tw, hd - tf], [hw, hd - tf], [hw, hd], [-hw, hd],
      ];
      return finishSection(outer, [], profile.name);
    }
    case 'l-angle-equal':
    case 'l-angle-unequal': {
      const outer: Vec2[] = [
        [-hw, -hd], [hw, -hd], [hw, -hd + tw], [-hw + tw, -hd + tw], [-hw + tw, hd], [-hw, hd],
      ];
      return finishSection(outer, [], profile.name);
    }
    case 'hss-square':
    case 'hss-rect': {
      const outer: Vec2[] = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
      const hole: Vec2[] = [[-hw + tw, -hd + tw], [hw - tw, -hd + tw], [hw - tw, hd - tw], [-hw + tw, hd - tw]];
      return finishSection(outer, [hole], profile.name);
    }
    case 'hss-round':
      return finishSection(
        circlePoly(hd, circleSegments),
        [circlePoly(hd - tw, circleSegments)],
        profile.name,
      );
    case 'solid-square': {
      const outer: Vec2[] = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
      return finishSection(outer, [], profile.name);
    }
    case 'solid-round':
    default:
      return finishSection(circlePoly(hd, circleSegments), [], profile.name);
  }
}

// ── Member solid (prism with planar end cuts) ────────────────────

export interface PlaneCut {
  /** A point on the cut plane. */
  point: Vec3;
  /** Plane normal (need not be unit; must not be perpendicular to the member axis). */
  normal: Vec3;
}

export interface MemberSpec {
  start: Vec3;
  end: Vec3;
  section: SectionPolygons;
  /** Optional oblique cut at the start (defaults to square cut at `start`). */
  startCut?: PlaneCut;
  /** Optional oblique cut at the end (defaults to square cut at `end`). */
  endCut?: PlaneCut;
}

interface MemberBasis {
  origin: THREE.Vector3;
  dir: THREE.Vector3; // unit axis
  u: THREE.Vector3;   // section x
  v: THREE.Vector3;   // section y
  axisLength: number;
}

export function memberBasis(spec: MemberSpec): MemberBasis {
  const origin = new THREE.Vector3(...spec.start);
  const endV = new THREE.Vector3(...spec.end);
  const dir = endV.clone().sub(origin);
  const axisLength = dir.length();
  dir.normalize();
  const up = Math.abs(dir.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
  const u = new THREE.Vector3().crossVectors(up, dir).normalize();
  const v = new THREE.Vector3().crossVectors(dir, u);
  return { origin, dir, u, v, axisLength };
}

/**
 * Axial parameter t of the intersection between the line
 * `base + dir * t` and the plane `cut`. Returns null when the line is
 * (near-)parallel to the plane.
 */
function axialIntersect(base: THREE.Vector3, dir: THREE.Vector3, cut: PlaneCut): number | null {
  const n = new THREE.Vector3(...cut.normal);
  const denom = dir.dot(n);
  if (Math.abs(denom) < 1e-9) return null;
  const p = new THREE.Vector3(...cut.point);
  return p.clone().sub(base).dot(n) / denom;
}

/** Per-vertex axial extents [tStart, tEnd] for one section offset (u,v). */
function vertexAxialRange(spec: MemberSpec, basis: MemberBasis, uv: Vec2): [number, number] {
  const base = basis.origin.clone()
    .addScaledVector(basis.u, uv[0])
    .addScaledVector(basis.v, uv[1]);
  let t0 = 0;
  let t1 = basis.axisLength;
  if (spec.startCut) {
    const t = axialIntersect(base, basis.dir, spec.startCut);
    if (t !== null) t0 = t;
  }
  if (spec.endCut) {
    const t = axialIntersect(base, basis.dir, spec.endCut);
    if (t !== null) t1 = t;
  }
  if (t1 < t0) t1 = t0; // over-cut degenerates to zero-length fibre (explicit clamp)
  return [t0, t1];
}

export interface MemberMeasure {
  /** Distance start→end between axis endpoints (mm). */
  axisLengthMm: number;
  /** Stock length the saw must cut — longest fibre after miters (mm). */
  cutLengthMm: number;
  /** Shortest fibre after miters (mm). */
  shortLengthMm: number;
  /** Miter angle at each end: 0 = square cut, 45 = orthogonal-corner miter (deg). */
  startMiterDeg: number;
  endMiterDeg: number;
}

export function measureMember(spec: MemberSpec): MemberMeasure {
  const basis = memberBasis(spec);
  const verts: Vec2[] = [...spec.section.outer, ...spec.section.holes.flat()];
  let minT0 = Infinity, maxT1 = -Infinity, minLen = Infinity;
  for (const uv of verts) {
    const [t0, t1] = vertexAxialRange(spec, basis, uv);
    minT0 = Math.min(minT0, t0);
    maxT1 = Math.max(maxT1, t1);
    minLen = Math.min(minLen, t1 - t0);
  }
  const miterOf = (cut?: PlaneCut): number => {
    if (!cut) return 0;
    const n = new THREE.Vector3(...cut.normal).normalize();
    const c = Math.min(1, Math.abs(n.dot(basis.dir)));
    return (Math.acos(c) * 180) / Math.PI;
  };
  return {
    axisLengthMm: basis.axisLength,
    cutLengthMm: maxT1 - minT0,
    shortLengthMm: minLen,
    startMiterDeg: miterOf(spec.startCut),
    endMiterDeg: miterOf(spec.endCut),
  };
}

/** Point-in-polygon (even-odd), boundary treated as inside within eps. */
function pointInPoly(poly: Vec2[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Analytic membership test for the mitered member solid (used in overlap checks). */
export function memberContainsPoint(spec: MemberSpec, q: Vec3): boolean {
  const basis = memberBasis(spec);
  const p = new THREE.Vector3(...q).sub(basis.origin);
  const uCoord = p.dot(basis.u);
  const vCoord = p.dot(basis.v);
  if (!pointInPoly(spec.section.outer, uCoord, vCoord)) return false;
  for (const h of spec.section.holes) {
    if (pointInPoly(h, uCoord, vCoord)) return false;
  }
  const [t0, t1] = vertexAxialRange(spec, basis, [uCoord, vCoord]);
  const s = p.dot(basis.dir);
  return s >= t0 && s <= t1;
}

/**
 * Build the closed triangle mesh of a mitered member: side walls for outer
 * boundary and holes plus triangulated (possibly oblique) end caps.
 */
export function generateMemberGeometry(spec: MemberSpec): THREE.BufferGeometry {
  const basis = memberBasis(spec);
  const rings: Vec2[][] = [spec.section.outer, ...spec.section.holes];

  const startPos: THREE.Vector3[][] = [];
  const endPos: THREE.Vector3[][] = [];
  for (const ring of rings) {
    const sRing: THREE.Vector3[] = [];
    const eRing: THREE.Vector3[] = [];
    for (const uv of ring) {
      const base = basis.origin.clone()
        .addScaledVector(basis.u, uv[0])
        .addScaledVector(basis.v, uv[1]);
      const [t0, t1] = vertexAxialRange(spec, basis, uv);
      sRing.push(base.clone().addScaledVector(basis.dir, t0));
      eRing.push(base.clone().addScaledVector(basis.dir, t1));
    }
    startPos.push(sRing);
    endPos.push(eRing);
  }

  const tri: number[] = [];
  const pushTri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => {
    tri.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  };

  // Side walls.
  for (let r = 0; r < rings.length; r++) {
    const ring = rings[r];
    for (let i = 0; i < ring.length; i++) {
      const j = (i + 1) % ring.length;
      pushTri(startPos[r][i], startPos[r][j], endPos[r][j]);
      pushTri(startPos[r][i], endPos[r][j], endPos[r][i]);
    }
  }

  // End caps (triangulated with holes). Vertex order: outer then holes,
  // matching THREE.ShapeUtils.triangulateShape's flattened indexing.
  const contour = spec.section.outer.map(([x, y]) => new THREE.Vector2(x, y));
  const holeV2 = spec.section.holes.map(h => h.map(([x, y]) => new THREE.Vector2(x, y)));
  const faces = THREE.ShapeUtils.triangulateShape(contour, holeV2);
  const flatStart: THREE.Vector3[] = startPos.flat();
  const flatEnd: THREE.Vector3[] = endPos.flat();
  for (const [a, b, c] of faces) {
    pushTri(flatEnd[a], flatEnd[b], flatEnd[c]);   // end cap
    pushTri(flatStart[c], flatStart[b], flatStart[a]); // start cap (reversed)
  }

  let geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(tri, 3));
  // Guarantee outward orientation: flip everything if signed volume is negative.
  if (meshSignedVolume(geo) < 0) {
    const flipped: number[] = [];
    for (let i = 0; i < tri.length; i += 9) {
      flipped.push(
        tri[i + 6], tri[i + 7], tri[i + 8],
        tri[i + 3], tri[i + 4], tri[i + 5],
        tri[i], tri[i + 1], tri[i + 2],
      );
    }
    geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(flipped, 3));
  }
  geo.computeVertexNormals();
  return geo;
}

/** Signed volume of a closed triangle mesh (divergence theorem). */
export function meshSignedVolume(geo: THREE.BufferGeometry): number {
  const pos = geo.getAttribute('position');
  const idx = geo.getIndex();
  let vol = 0;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const triCount = idx ? idx.count / 3 : pos.count / 3;
  for (let i = 0; i < triCount; i++) {
    const i0 = idx ? idx.getX(i * 3) : i * 3;
    const i1 = idx ? idx.getX(i * 3 + 1) : i * 3 + 1;
    const i2 = idx ? idx.getX(i * 3 + 2) : i * 3 + 2;
    a.fromBufferAttribute(pos as THREE.BufferAttribute, i0);
    b.fromBufferAttribute(pos as THREE.BufferAttribute, i1);
    c.fromBufferAttribute(pos as THREE.BufferAttribute, i2);
    vol += a.dot(new THREE.Vector3().crossVectors(b, c));
  }
  return vol / 6;
}

// ── Frame joints: miter-cut computation ──────────────────────────

export interface FrameSegment {
  start: Vec3;
  end: Vec3;
}

export interface SegmentCuts {
  startCut?: PlaneCut;
  endCut?: PlaneCut;
}

const NODE_KEY_SCALE = 1e3; // group endpoints within 0.001 mm

function nodeKey(p: Vec3): string {
  return p.map(c => Math.round(c * NODE_KEY_SCALE)).join(',');
}

/**
 * For every node shared by exactly two members, compute the angle-bisector
 * miter plane and assign it to both member ends. Orthogonal corner → 45°.
 * Nodes with 1 member end keep a square cut; nodes with 3+ ends are left
 * square (butt) — noted limitation.
 */
export function computeFrameCuts(segments: FrameSegment[]): SegmentCuts[] {
  const cuts: SegmentCuts[] = segments.map(() => ({}));
  interface Incident { seg: number; end: 'start' | 'end'; dirIntoNode: THREE.Vector3 }
  const nodes = new Map<string, { point: Vec3; incident: Incident[] }>();

  segments.forEach((seg, i) => {
    const a = new THREE.Vector3(...seg.start);
    const b = new THREE.Vector3(...seg.end);
    if (a.distanceTo(b) < 1e-3) return;
    const dirAB = b.clone().sub(a).normalize();
    for (const [end, point, dirIntoNode] of [
      ['start', seg.start, dirAB.clone().negate()],
      ['end', seg.end, dirAB],
    ] as Array<['start' | 'end', Vec3, THREE.Vector3]>) {
      const key = nodeKey(point);
      const rec = nodes.get(key) ?? { point, incident: [] };
      rec.incident.push({ seg: i, end, dirIntoNode });
      nodes.set(key, rec);
    }
  });

  for (const { point, incident } of nodes.values()) {
    if (incident.length !== 2) continue;
    const [a, b] = incident;
    // Bisector plane normal: difference of the unit directions into the node.
    // Orthogonal corner (+X into node, −Y into node) → n ∝ (1,1,0) → 45°.
    const n = a.dirIntoNode.clone().sub(b.dirIntoNode);
    if (n.length() < 1e-6) continue; // anti-parallel overlap — skip
    n.normalize();
    // Skip pass-through joints (collinear members): the bisector equals the
    // axis and the "miter" would be the square cut both already have.
    const cut: PlaneCut = { point, normal: [n.x, n.y, n.z] };
    for (const inc of [a, b]) {
      if (inc.end === 'start') cuts[inc.seg].startCut = cut;
      else cuts[inc.seg].endCut = cut;
    }
  }
  return cuts;
}

// ── Frame generation + cut list ──────────────────────────────────

export interface MiteredFrameOptions {
  /** Weldment sectionType (0..4) — see SECTION_TYPE. */
  sectionType: number;
  /** Section envelope (mm). */
  size: number;
  /** Wall / web thickness (mm). */
  thickness: number;
  /** Apply bisector miters at 2-member corners (default true). */
  miter?: boolean;
  /** Tessellation for round sections (default 48). */
  circleSegments?: number;
  /** Optional catalog profile — overrides sectionType/size/thickness dims. */
  profile?: StructuralProfile;
}

export interface FrameMemberReport extends MemberMeasure {
  index: number;
  sectionLabel: string;
  areaMm2: number;
}

export interface MiteredFrameResult {
  geometry: THREE.BufferGeometry;
  members: FrameMemberReport[];
  specs: MemberSpec[];
}

export function generateMiteredFrame(
  segments: FrameSegment[],
  options: MiteredFrameOptions,
): MiteredFrameResult {
  const miter = options.miter !== false;
  const section = options.profile
    ? sectionPolygonsFromProfile(options.profile, options.circleSegments ?? 48)
    : sectionPolygons(options.sectionType, options.size, options.thickness, options.circleSegments ?? 48);
  const cuts = miter ? computeFrameCuts(segments) : segments.map(() => ({} as SegmentCuts));

  const specs: MemberSpec[] = [];
  const members: FrameMemberReport[] = [];
  const geos: THREE.BufferGeometry[] = [];

  segments.forEach((seg, i) => {
    const a = new THREE.Vector3(...seg.start);
    const b = new THREE.Vector3(...seg.end);
    if (a.distanceTo(b) < 1e-3) return; // skip degenerate
    const spec: MemberSpec = {
      start: seg.start,
      end: seg.end,
      section,
      startCut: cuts[i]?.startCut,
      endCut: cuts[i]?.endCut,
    };
    specs.push(spec);
    members.push({
      index: i,
      sectionLabel: section.label,
      areaMm2: section.areaMm2,
      ...measureMember(spec),
    });
    geos.push(generateMemberGeometry(spec));
  });

  let geometry: THREE.BufferGeometry;
  if (geos.length === 0) geometry = new THREE.BufferGeometry();
  else if (geos.length === 1) geometry = geos[0];
  else {
    const merged = mergeGeometries(geos);
    if (merged) {
      for (const g of geos) g.dispose();
      geometry = merged;
    } else {
      geometry = geos[0];
    }
  }
  return { geometry, members, specs };
}

const STEEL_DENSITY_KG_M3 = 7850;

export interface FrameCutListOptions {
  /** Material designation for the cut list (default "SS400"). */
  material?: string;
  /** Catalog profile for label + linear density (else computed from section area × 7850 kg/m³). */
  profile?: StructuralProfile;
}

/**
 * Cut list for a mitered frame: member lengths are the miter-corrected stock
 * lengths (longest fibre), grouped/massed via cutListReport.generateCutList.
 */
export function frameCutList(
  frame: MiteredFrameResult,
  options: FrameCutListOptions = {},
): CutListResult {
  const material = options.material ?? 'SS400';
  const members: CutListMember[] = frame.members.map((m, i) => {
    const linearDensity = options.profile
      ? options.profile.massPerMeterKgM
      : (m.areaMm2 * 1e-6) * STEEL_DENSITY_KG_M3; // kg/m — polygon area × steel density
    return {
      id: `M${i + 1}`,
      profile: options.profile ? options.profile.name : m.sectionLabel,
      material,
      lengthMm: m.cutLengthMm,
      linearDensityKgPerM: linearDensity,
      endMiterDeg: { start: m.startMiterDeg, end: m.endMiterDeg },
    };
  });
  return generateCutList(members);
}
