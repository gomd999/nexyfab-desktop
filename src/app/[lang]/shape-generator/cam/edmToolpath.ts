/**
 * edmToolpath.ts — Wire EDM + Sinker EDM toolpath math.
 *
 * EDM (Electrical Discharge Machining) erodes material via electric
 * sparks across a small gap between a tool electrode and the workpiece,
 * both submerged in dielectric fluid. Two flavors:
 *
 *   - **Wire EDM**: a brass wire is the electrode, threading through
 *     a starter hole + following a 2D path (with optional taper for
 *     5-axis wire). Used for hardened steel dies, intricate profiles,
 *     stamping punches.
 *   - **Sinker EDM**: a shaped graphite/copper electrode plunges into
 *     the workpiece to leave its mirror-image cavity. Used for mold
 *     cavities, internal corners < 0.5 mm radius.
 *
 * Stage 1 covers basic toolpath; Stage 2 (here) adds:
 *
 *   - **Skim pass strategy** — rough cut + multiple finishing skim
 *     passes (each at lower energy + smaller offset) for surface
 *     finish < Ra 0.4.
 *   - **Wire taper (4-axis)** — different upper/lower contours so
 *     the wire angles through the workpiece for relief / draft.
 *   - **Material-removal rate** estimation — depends on amp setting,
 *     wire diameter, workpiece thickness.
 *   - **Electrode wear compensation** for sinker — orbit motion in
 *     X/Y to extend electrode life.
 *   - **Burn time** estimation for quoting.
 */

export type WireMaterial = 'brass' | 'zinc-coated' | 'molybdenum';
export type WorkpieceMaterial = 'tool-steel' | 'carbide' | 'aluminum' | 'titanium' | 'copper-alloy' | 'inconel';

export interface WireEdmParams {
  /** Wire diameter (mm). Typical 0.1 / 0.2 / 0.25 / 0.3. */
  wireDiameterMm: number;
  /** Wire material. */
  wireMaterial: WireMaterial;
  /** Workpiece thickness (mm). */
  workpieceThicknessMm: number;
  /** Workpiece material. */
  workpieceMaterial: WorkpieceMaterial;
  /** Power supply setting (Amps). Typical 1-12 A. */
  ampSetting: number;
  /** Pulse on-time (μs). */
  pulseOnUs: number;
  /** Pulse off-time (μs). */
  pulseOffUs: number;
}

export interface WirePath2D {
  /** 2D path the wire centerline follows (mm). */
  points: Array<[number, number]>;
  /** True for closed loops. */
  closed: boolean;
}

// ── Material removal rate ─────────────────────────────────────────

/** Empirical MRR (mm²/min for wire EDM). Real machines log this; we
 *  approximate from amp setting + workpiece thickness. */
export function wireMrr(params: WireEdmParams): number {
  const ampFactor = Math.min(12, Math.max(1, params.ampSetting)) / 6;
  // Thicker workpieces are faster per mm² (more spark surface).
  const thicknessFactor = Math.min(2, params.workpieceThicknessMm / 25);
  const materialFactor: Record<WorkpieceMaterial, number> = {
    'tool-steel': 1.0,
    'carbide': 0.4,
    'aluminum': 2.0,
    'titanium': 0.7,
    'copper-alloy': 1.4,
    'inconel': 0.5,
  };
  return 120 * ampFactor * thicknessFactor * materialFactor[params.workpieceMaterial];
}

// ── Burn time estimation ─────────────────────────────────────────

/** Estimate total burn time from a path + MRR. */
export function wireBurnTimeSec(
  path: WirePath2D,
  params: WireEdmParams,
  passCount: number = 1,
): number {
  const pathLengthMm = computePathLength(path);
  const mrr = wireMrr(params);
  // Burn area per second = MRR / 60 in mm²/s.
  // Wire cuts a kerf = wire + 2 × overcut. For preview, overcut = 0.02 mm.
  const kerfMm = params.wireDiameterMm + 0.04;
  const areaPerMm = kerfMm * params.workpieceThicknessMm;
  const cutRateMmPerSec = (mrr / 60) / areaPerMm;
  const singlePassTime = pathLengthMm / cutRateMmPerSec;
  // Subsequent passes are ~30% slower (less power but less material).
  return singlePassTime + (passCount - 1) * singlePassTime * 0.4;
}

function computePathLength(path: WirePath2D): number {
  if (path.points.length < 2) return 0;
  let len = 0;
  for (let i = 1; i < path.points.length; i++) {
    const dx = path.points[i]![0] - path.points[i - 1]![0];
    const dy = path.points[i]![1] - path.points[i - 1]![1];
    len += Math.hypot(dx, dy);
  }
  if (path.closed && path.points.length > 2) {
    const dx = path.points[0]![0] - path.points[path.points.length - 1]![0];
    const dy = path.points[0]![1] - path.points[path.points.length - 1]![1];
    len += Math.hypot(dx, dy);
  }
  return len;
}

// ── Skim pass strategy ───────────────────────────────────────────

export interface SkimPass {
  /** Wire offset from final geometry (mm) — positive = outside. */
  offsetMm: number;
  /** Reduced amp setting. */
  ampSetting: number;
  /** Approximate Ra after this pass (μm). */
  expectedRaUm: number;
}

/** Plan a skim-pass schedule from rough to mirror finish. The first
 *  pass cuts at full amp + 0.1 mm overcut; subsequent passes shave
 *  smaller amounts at lower energy. */
export function planSkimPasses(
  totalPasses: number,
  baseAmp: number = 8,
): SkimPass[] {
  if (totalPasses < 1) return [];
  const passes: SkimPass[] = [];
  // Pass 1 — rough: large overcut + full amp.
  passes.push({ offsetMm: 0.12, ampSetting: baseAmp, expectedRaUm: 3.2 });
  // Skim passes: shave 30 / 20 / 10 / 5 μm with descending amp.
  const offsets = [0.03, 0.015, 0.008, 0.005, 0.003, 0.002];
  const amps = [baseAmp * 0.6, baseAmp * 0.4, baseAmp * 0.3, baseAmp * 0.2, baseAmp * 0.15, baseAmp * 0.1];
  const raTargets = [1.6, 0.8, 0.4, 0.2, 0.1, 0.05];
  for (let i = 0; i < totalPasses - 1; i++) {
    passes.push({
      offsetMm: offsets[i] ?? 0.002,
      ampSetting: amps[i] ?? baseAmp * 0.1,
      expectedRaUm: raTargets[i] ?? 0.05,
    });
  }
  return passes;
}

// ── Taper (4-axis wire) ──────────────────────────────────────────

export interface TaperedWirePath {
  /** Upper path (top of workpiece). */
  upperPath: WirePath2D;
  /** Lower path (bottom of workpiece). */
  lowerPath: WirePath2D;
  /** Workpiece thickness between the two paths. */
  thicknessMm: number;
  /** Wire deflection (degrees off vertical) implied by the offset. */
  taperAngleDeg: number;
}

/** Build a tapered wire path from a single 2D contour + uniform taper
 *  angle (positive = wire leans outward at the top). */
export function buildTaperedPath(
  contour: WirePath2D,
  thicknessMm: number,
  taperAngleDeg: number,
): TaperedWirePath {
  const offset = thicknessMm * Math.tan(taperAngleDeg * Math.PI / 180) / 2;
  // Crude offset: expand contour outward by offset for upper, inward
  // by offset for lower (assuming convex contour + centroid offset).
  const centroid = computeCentroid(contour.points);
  const offsetContour = (factor: number): WirePath2D => ({
    points: contour.points.map(p => {
      const dx = p[0] - centroid[0];
      const dy = p[1] - centroid[1];
      const dist = Math.hypot(dx, dy);
      if (dist === 0) return p;
      const scale = (dist + factor) / dist;
      return [centroid[0] + dx * scale, centroid[1] + dy * scale] as [number, number];
    }),
    closed: contour.closed,
  });
  return {
    upperPath: offsetContour(offset),
    lowerPath: offsetContour(-offset),
    thicknessMm,
    taperAngleDeg,
  };
}

function computeCentroid(points: Array<[number, number]>): [number, number] {
  let cx = 0, cy = 0;
  for (const p of points) { cx += p[0]; cy += p[1]; }
  return [cx / points.length, cy / points.length];
}

// ── Sinker EDM ───────────────────────────────────────────────────

export interface SinkerEdmParams {
  /** Electrode material. */
  electrodeMaterial: 'graphite' | 'copper' | 'tungsten-copper';
  /** Electrode shape — bbox + cross-section area (mm²). */
  electrodeAreaMm2: number;
  /** Plunge depth (mm). */
  plungeDepthMm: number;
  ampSetting: number;
  /** Optional orbit motion radius (mm). */
  orbitRadiusMm?: number;
}

/** Estimate sinker burn time. */
export function sinkerBurnTimeSec(params: SinkerEdmParams): number {
  // Volumetric MRR (mm³/min) ≈ amp × 30 for steel + graphite.
  const mrrVolumetric = params.ampSetting * 30;
  const cutVolume = params.electrodeAreaMm2 * params.plungeDepthMm;
  return (cutVolume / mrrVolumetric) * 60;
}

/** Electrode wear ratio — copper wears less than graphite. */
const ELECTRODE_WEAR_RATIO: Record<SinkerEdmParams['electrodeMaterial'], number> = {
  graphite: 0.01,    // 1% wear
  copper: 0.03,      // 3% wear
  'tungsten-copper': 0.002, // 0.2% wear (premium)
};

export function electrodeWearVolume(params: SinkerEdmParams): number {
  const cutVolume = params.electrodeAreaMm2 * params.plungeDepthMm;
  return cutVolume * ELECTRODE_WEAR_RATIO[params.electrodeMaterial];
}
