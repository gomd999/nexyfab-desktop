/**
 * multiSectionSweep.ts — Multi-section / lofted sweep.
 *
 * SolidWorks "Lofted Boss / Base" + "Swept Boss with guide curves"
 * combined. Given N profile cross-sections + (optionally) M guide
 * curves + a spine, generate the swept surface as a quad mesh that
 * interpolates between sections.
 *
 * Math:
 *   - Sections are 2D profiles in their own plane; each is sampled at
 *     a common parameter count (resample if needed).
 *   - Sweep direction at parameter t is the spine tangent, or the
 *     interpolated guide-curve direction.
 *   - For each cross-section i at spine parameter t_i, build a frame
 *     (origin, tangent, normal, binormal) — typically Frenet or
 *     rotation-minimizing (RMF, Bishop frame).
 *   - Interpolate cross-section shape between adjacent sections using
 *     linear/Hermite/cubic blending.
 */

export interface Point3D {
  x: number;
  y: number;
  z: number;
}

export interface SectionProfile {
  /** Section id. */
  id: string;
  /** Parameter along the spine (0..1) where this section is placed. */
  spineParam: number;
  /** 2D points in the section's local plane (XY). */
  points2D: Array<{ x: number; y: number }>;
  /** Optional twist angle (rad) applied to this section. */
  twistRad?: number;
  /** Optional uniform scale (1.0 = original size). */
  scale?: number;
}

export interface SweepSpine {
  /** Spine path in 3D, sampled at increasing t values. */
  samples: Array<{ t: number; position: Point3D; tangent: Point3D }>;
}

export interface GuideCurve {
  /** Guide curve id. */
  id: string;
  /** Sampled positions in 3D along the same parameter axis as spine. */
  samples: Array<{ t: number; position: Point3D }>;
}

export interface SweepOptions {
  /** Number of stations along spine to evaluate. Default 32. */
  stationCount: number;
  /** Frame computation: 'frenet' | 'rmf' (rotation-minimizing). */
  frame: 'frenet' | 'rmf';
  /** Cross-section interpolation: 'linear' | 'cubic'. */
  interpolation: 'linear' | 'cubic';
  /** Whether to close end caps. */
  capEnds: boolean;
}

export const DEFAULT_SWEEP_OPTIONS: SweepOptions = {
  stationCount: 32,
  frame: 'rmf',
  interpolation: 'linear',
  capEnds: true,
};

export interface SweepResult {
  /** Triangle mesh. */
  positions: Float32Array;
  indices: Uint32Array;
  /** Stations actually evaluated (interpolation samples). */
  stationCount: number;
  /** Profile sample count per ring. */
  profilePointCount: number;
  /** Warnings during sweep. */
  warnings: string[];
}

// ── Top-level entry ─────────────────────────────────────────────

export function lofted(
  sections: SectionProfile[],
  spine: SweepSpine | null,
  guides: GuideCurve[] = [],
  options: Partial<SweepOptions> = {},
): SweepResult {
  const opts = { ...DEFAULT_SWEEP_OPTIONS, ...options };
  // Guard a non-finite/≤1 stationCount: t = i/(stationCount-1) would divide by 0
  // (Infinity) or go NaN, writing invalid frames into every station. Clamp 2..512.
  opts.stationCount = Math.max(2, Math.min(512, Math.round(Number.isFinite(opts.stationCount) ? opts.stationCount : 32)));
  const warnings: string[] = [];

  if (sections.length < 2) {
    warnings.push('Need at least 2 sections to loft');
    return emptyResult(warnings);
  }
  // Sort sections by spineParam.
  const sorted = [...sections].sort((a, b) => a.spineParam - b.spineParam);

  // Resample all sections to same point count.
  const targetCount = Math.max(...sorted.map(s => s.points2D.length));
  const resampled = sorted.map(s => resampleSection(s, targetCount));
  if (resampled.some(r => r.points2D.length !== targetCount)) {
    warnings.push('Section resample failed');
    return emptyResult(warnings);
  }

  // Guide curves (multi-guide reflection). When any guide is supplied the
  // primary guide (guides[0]) PULLS each station: the station origin is
  // translated by the in-plane component of (guide − spineOrigin), so the
  // section centroid tracks the rail — the classic SolidWorks guide-curve
  // effect. A SECOND guide additionally drives a uniform section scale =
  // spacing(t) / spacing(0) (a width rail). Malformed guides throw
  // deterministically (never silently ignored). No guides → the legacy path
  // runs bit-for-bit unchanged.
  const guideCtx = prepareGuides(guides);

  // For each station, compute the frame + interpolated section.
  const stations: Array<{ origin: Point3D; tangent: Point3D; normal: Point3D; binormal: Point3D; profile: Array<{ x: number; y: number }> }> = [];

  for (let i = 0; i < opts.stationCount; i++) {
    const t = i / (opts.stationCount - 1);
    const frame = spine ? sampleSpineFrame(spine, t, opts.frame) : axisAlignedFrame(t);
    let profile = interpolateSection(resampled, t, opts.interpolation);
    let origin = frame.origin;
    if (guideCtx) {
      const adj = guideAdjust(guideCtx, frame, t);
      origin = adj.origin;
      if (adj.scale !== 1) {
        profile = profile.map(p => ({ x: p.x * adj.scale, y: p.y * adj.scale }));
      }
    }
    stations.push({ origin, tangent: frame.tangent, normal: frame.normal, binormal: frame.binormal, profile });
  }

  // Build the swept mesh: each station's profile placed into world
  // space via its frame, then connected to the next station with
  // quads (split into 2 triangles).
  const positions: number[] = [];
  const indices: number[] = [];
  const profileCount = targetCount;

  for (const st of stations) {
    for (let p = 0; p < profileCount; p++) {
      const pt = st.profile[p]!;
      const world = sectionPointToWorld(st.origin, st.normal, st.binormal, pt);
      positions.push(world.x, world.y, world.z);
    }
  }

  for (let i = 0; i < stations.length - 1; i++) {
    for (let p = 0; p < profileCount; p++) {
      const pNext = (p + 1) % profileCount;
      const i00 = i * profileCount + p;
      const i01 = i * profileCount + pNext;
      const i10 = (i + 1) * profileCount + p;
      const i11 = (i + 1) * profileCount + pNext;
      indices.push(i00, i01, i11);
      indices.push(i00, i11, i10);
    }
  }

  if (opts.capEnds && stations.length > 0) {
    const firstBase = 0;
    const lastBase = (stations.length - 1) * profileCount;
    for (let p = 1; p < profileCount - 1; p++) {
      indices.push(firstBase, firstBase + p + 1, firstBase + p);
      indices.push(lastBase, lastBase + p, lastBase + p + 1);
    }
  }

  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
    stationCount: stations.length,
    profilePointCount: profileCount,
    warnings,
  };
}

function emptyResult(warnings: string[]): SweepResult {
  return {
    positions: new Float32Array(0),
    indices: new Uint32Array(0),
    stationCount: 0,
    profilePointCount: 0,
    warnings,
  };
}

// ── Guide-curve reflection (multi-guide) ────────────────────────
//
// The primary guide translates each station in-plane so the section tracks it.
// A second guide provides a uniform scale (in-plane spacing ratio). This is the
// minimal, deterministic form of a guide-curve sweep — no per-station shear /
// independent rotation (matching the documented limits in sweep.ts). Explicit
// rejections (throw): a guide with < 2 samples, a non-finite guide sample, or a
// first-two-guides pair that coincides at t = 0 (no scale reference).

const GUIDE_SCALE_EPS = 1e-9;

interface GuideContext {
  guides: GuideCurve[];
  /** In-plane-free 3D spacing of guides[0]→guides[1] at t = 0 (≥2 guides). */
  refSpacing: number;
}

interface StationFrame {
  origin: Point3D;
  tangent: Point3D;
  normal: Point3D;
  binormal: Point3D;
}

/** Piecewise-linear evaluation of a guide polyline at parameter t ∈ [0,1]. */
function interpGuideCurve(guide: GuideCurve, t: number): Point3D {
  const s = guide.samples;
  if (t <= s[0]!.t) return s[0]!.position;
  const last = s[s.length - 1]!;
  if (t >= last.t) return last.position;
  for (let i = 0; i < s.length - 1; i++) {
    const a = s[i]!;
    const b = s[i + 1]!;
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

/** Validate guides once and precompute the scale reference. Returns null when
 *  there are no guides (legacy path). Throws on malformed guides. */
function prepareGuides(guides: GuideCurve[]): GuideContext | null {
  if (guides.length === 0) return null;
  for (const g of guides) {
    if (g.samples.length < 2) {
      throw new Error(`guide '${g.id}' needs at least 2 samples (got ${g.samples.length})`);
    }
    for (const s of g.samples) {
      if (
        !Number.isFinite(s.t) ||
        !Number.isFinite(s.position.x) ||
        !Number.isFinite(s.position.y) ||
        !Number.isFinite(s.position.z)
      ) {
        throw new Error(`guide '${g.id}' has a non-finite sample`);
      }
    }
  }
  let refSpacing = 0;
  if (guides.length >= 2) {
    const a = interpGuideCurve(guides[0]!, 0);
    const b = interpGuideCurve(guides[1]!, 0);
    refSpacing = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    if (!(refSpacing > GUIDE_SCALE_EPS)) {
      throw new Error('the first two guide curves coincide at t=0 — cannot derive a section scale');
    }
  }
  return { guides, refSpacing };
}

/** Per-station guide adjustment: in-plane translation toward guides[0] plus an
 *  optional uniform scale from the guides[0]→guides[1] spacing ratio. */
function guideAdjust(ctx: GuideContext, frame: StationFrame, t: number): { origin: Point3D; scale: number } {
  const g0 = interpGuideCurve(ctx.guides[0]!, t);
  const off: Point3D = {
    x: g0.x - frame.origin.x,
    y: g0.y - frame.origin.y,
    z: g0.z - frame.origin.z,
  };
  const along = off.x * frame.tangent.x + off.y * frame.tangent.y + off.z * frame.tangent.z;
  const inPlane: Point3D = {
    x: off.x - along * frame.tangent.x,
    y: off.y - along * frame.tangent.y,
    z: off.z - along * frame.tangent.z,
  };
  const origin: Point3D = {
    x: frame.origin.x + inPlane.x,
    y: frame.origin.y + inPlane.y,
    z: frame.origin.z + inPlane.z,
  };
  let scale = 1;
  if (ctx.guides.length >= 2) {
    const g1 = interpGuideCurve(ctx.guides[1]!, t);
    const spacing = Math.hypot(g1.x - g0.x, g1.y - g0.y, g1.z - g0.z);
    scale = spacing / ctx.refSpacing;
  }
  return { origin, scale };
}

// ── Section resampling ──────────────────────────────────────────

export function resampleSection(section: SectionProfile, targetCount: number): SectionProfile {
  const src = section.points2D;
  if (src.length === targetCount) {
    return applyScaleAndTwist(section);
  }
  // Total perimeter for arc-length sampling.
  const perimEdges: number[] = [];
  let total = 0;
  for (let i = 0; i < src.length; i++) {
    const j = (i + 1) % src.length;
    const len = Math.hypot(src[j]!.x - src[i]!.x, src[j]!.y - src[i]!.y);
    perimEdges.push(len);
    total += len;
  }
  if (total === 0) return applyScaleAndTwist(section);

  const out: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < targetCount; i++) {
    const target = (i / targetCount) * total;
    let acc = 0;
    let k = 0;
    while (k < perimEdges.length && acc + perimEdges[k]! < target) {
      acc += perimEdges[k]!;
      k++;
    }
    if (k >= perimEdges.length) k = perimEdges.length - 1;
    const segLen = perimEdges[k]!;
    const u = segLen > 0 ? (target - acc) / segLen : 0;
    const a = src[k]!;
    const b = src[(k + 1) % src.length]!;
    out.push({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u });
  }
  return applyScaleAndTwist({ ...section, points2D: out });
}

function applyScaleAndTwist(s: SectionProfile): SectionProfile {
  const scale = s.scale ?? 1;
  const twist = s.twistRad ?? 0;
  if (scale === 1 && twist === 0) return s;
  const c = Math.cos(twist);
  const sn = Math.sin(twist);
  return {
    ...s,
    points2D: s.points2D.map(p => ({
      x: (p.x * c - p.y * sn) * scale,
      y: (p.x * sn + p.y * c) * scale,
    })),
  };
}

// ── Section interpolation ───────────────────────────────────────

export function interpolateSection(
  sections: SectionProfile[],
  t: number,
  mode: 'linear' | 'cubic',
): Array<{ x: number; y: number }> {
  if (sections.length === 0) return [];
  if (sections.length === 1) return sections[0]!.points2D.slice();

  // Find bracketing sections.
  let i0 = 0;
  for (let i = 0; i < sections.length - 1; i++) {
    if (sections[i + 1]!.spineParam >= t) { i0 = i; break; }
    i0 = i;
  }
  const i1 = Math.min(i0 + 1, sections.length - 1);
  const s0 = sections[i0]!;
  const s1 = sections[i1]!;
  const tRange = s1.spineParam - s0.spineParam;
  const localT = tRange > 1e-9 ? (t - s0.spineParam) / tRange : 0;
  const lt = Math.max(0, Math.min(1, localT));

  if (mode === 'linear' || sections.length < 3) {
    return s0.points2D.map((p0, idx) => {
      const p1 = s1.points2D[idx]!;
      return { x: p0.x + (p1.x - p0.x) * lt, y: p0.y + (p1.y - p0.y) * lt };
    });
  }

  // Cubic (Catmull-Rom-style across 4 sections).
  const iPrev = Math.max(0, i0 - 1);
  const iNext = Math.min(sections.length - 1, i1 + 1);
  const sPrev = sections[iPrev]!;
  const sNext = sections[iNext]!;
  return s0.points2D.map((p0, idx) => {
    const pPrev = sPrev.points2D[idx]!;
    const p1 = s1.points2D[idx]!;
    const pNext = sNext.points2D[idx]!;
    return {
      x: catmullRom(pPrev.x, p0.x, p1.x, pNext.x, lt),
      y: catmullRom(pPrev.y, p0.y, p1.y, pNext.y, lt),
    };
  });
}

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (
    (2 * p1) +
    (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t3
  );
}

// ── Frame computation ───────────────────────────────────────────

function sampleSpineFrame(spine: SweepSpine, t: number, mode: 'frenet' | 'rmf'): {
  origin: Point3D; tangent: Point3D; normal: Point3D; binormal: Point3D;
} {
  void mode;
  // Find bracketing samples.
  const samples = spine.samples;
  if (samples.length === 0) return axisAlignedFrame(t);
  let i0 = 0;
  for (let i = 0; i < samples.length - 1; i++) {
    if (samples[i + 1]!.t >= t) { i0 = i; break; }
    i0 = i;
  }
  const i1 = Math.min(i0 + 1, samples.length - 1);
  const s0 = samples[i0]!;
  const s1 = samples[i1]!;
  const range = s1.t - s0.t;
  const lt = range > 1e-9 ? (t - s0.t) / range : 0;
  const origin: Point3D = {
    x: s0.position.x + (s1.position.x - s0.position.x) * lt,
    y: s0.position.y + (s1.position.y - s0.position.y) * lt,
    z: s0.position.z + (s1.position.z - s0.position.z) * lt,
  };
  const tangent: Point3D = {
    x: s0.tangent.x + (s1.tangent.x - s0.tangent.x) * lt,
    y: s0.tangent.y + (s1.tangent.y - s0.tangent.y) * lt,
    z: s0.tangent.z + (s1.tangent.z - s0.tangent.z) * lt,
  };
  return buildFrame(origin, tangent);
}

function axisAlignedFrame(t: number): {
  origin: Point3D; tangent: Point3D; normal: Point3D; binormal: Point3D;
} {
  return {
    origin: { x: 0, y: 0, z: t * 100 },
    tangent: { x: 0, y: 0, z: 1 },
    normal: { x: 1, y: 0, z: 0 },
    binormal: { x: 0, y: 1, z: 0 },
  };
}

function buildFrame(origin: Point3D, tangent: Point3D): {
  origin: Point3D; tangent: Point3D; normal: Point3D; binormal: Point3D;
} {
  const tLen = Math.hypot(tangent.x, tangent.y, tangent.z) || 1;
  const t: Point3D = { x: tangent.x / tLen, y: tangent.y / tLen, z: tangent.z / tLen };
  const seed: Point3D = Math.abs(t.z) < 0.95 ? { x: 0, y: 0, z: 1 } : { x: 1, y: 0, z: 0 };
  // normal = seed - (seed · t) * t.
  const dot = seed.x * t.x + seed.y * t.y + seed.z * t.z;
  const n: Point3D = { x: seed.x - dot * t.x, y: seed.y - dot * t.y, z: seed.z - dot * t.z };
  const nLen = Math.hypot(n.x, n.y, n.z) || 1;
  n.x /= nLen; n.y /= nLen; n.z /= nLen;
  const b: Point3D = {
    x: t.y * n.z - t.z * n.y,
    y: t.z * n.x - t.x * n.z,
    z: t.x * n.y - t.y * n.x,
  };
  return { origin, tangent: t, normal: n, binormal: b };
}

function sectionPointToWorld(origin: Point3D, normal: Point3D, binormal: Point3D, p: { x: number; y: number }): Point3D {
  return {
    x: origin.x + normal.x * p.x + binormal.x * p.y,
    y: origin.y + normal.y * p.x + binormal.y * p.y,
    z: origin.z + normal.z * p.x + binormal.z * p.y,
  };
}

// ── Compatibility analysis ──────────────────────────────────────

export interface CompatibilityReport {
  /** Sections all have same vertex count after resample. */
  sameVertexCount: boolean;
  /** Suggested resample count. */
  suggestedCount: number;
  /** Section ids whose perimeter wildly differs (>10× factor). */
  wildlyDifferentSections: string[];
}

export function analyzeCompatibility(sections: SectionProfile[]): CompatibilityReport {
  if (sections.length === 0) {
    return { sameVertexCount: true, suggestedCount: 0, wildlyDifferentSections: [] };
  }
  const counts = sections.map(s => s.points2D.length);
  const suggested = Math.max(...counts);
  const sameVertexCount = counts.every(c => c === counts[0]);

  const perimeters = sections.map(s => {
    let p = 0;
    for (let i = 0; i < s.points2D.length; i++) {
      const j = (i + 1) % s.points2D.length;
      p += Math.hypot(s.points2D[j]!.x - s.points2D[i]!.x, s.points2D[j]!.y - s.points2D[i]!.y);
    }
    return p;
  });
  const meanP = perimeters.reduce((s, p) => s + p, 0) / perimeters.length;
  const wildly: string[] = [];
  for (let i = 0; i < sections.length; i++) {
    if (perimeters[i]! > meanP * 10 || perimeters[i]! < meanP / 10) {
      wildly.push(sections[i]!.id);
    }
  }

  return { sameVertexCount, suggestedCount: suggested, wildlyDifferentSections: wildly };
}
