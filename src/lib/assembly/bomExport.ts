/**
 * bomExport — Phase 4.5 of NexyFab Pro own-CAD (ADR-013).
 *
 * Convert an AssemblyState IR (parts + mates) into a Bill of Materials
 * (BomExport) suitable for CSV / JSON download. Phase 1 keeps the
 * algorithm intentionally simple:
 *
 *   - One PartInstance → one BomEntry (quantity always 1). Future phases
 *     will collapse identical part templates with quantity > 1.
 *   - Per-part volume / surfaceArea / bbox are derived from
 *     `featureTreeStats.computeStats(tree)` (Agent-JJJJJ / EEEEE) so all 8
 *     Phase 1 feature kinds — extrude, revolve, sweep, loft, linear/circular
 *     pattern, hole, fillet, chamfer — contribute uniformly. Earlier
 *     iterations of this module hand-rolled an inline extrude+revolve
 *     switch; that has been retired in favour of the shared stats walk so
 *     hole subtractions and pattern multipliers now reach the BOM. The
 *     inline path remains as a fallback for callers whose computeStats
 *     throws on unexpected payload shapes (Phase 1 stats handles all 8
 *     kinds; the fallback only fires if a future bad-IR edge sneaks in).
 *   - Mass = volume × density (g/mm³). When no material / density is
 *     supplied, mass stays undefined.
 *   - CSV uses RFC 4180 quoting (double quotes around any field that
 *     contains comma / quote / newline; quotes within escaped fields are
 *     doubled). Columns include surfaceArea_mm2 (since 4.5.1) so the
 *     downstream cost / coating cost UI can read off the wetted area
 *     without re-running stats.
 *   - JSON is JSON.stringify(bom, null, 2).
 *
 * Out of scope:
 *   - Part templates with identical geometry → quantity > 1
 *   - Precise OCCT volume (Phase 2; computeStats values are Phase-1 coarse
 *     estimates as documented in featureTreeStats.ts)
 *   - Cost / supplier columns (Phase 5)
 *   - Sub-assembly hierarchy
 */

import type { AssemblyState } from './assemblyState';
import type {
  FeatureTree,
  FeatureNode,
  FeaturePayload,
} from '@/lib/cad/featureTree';
import {
  computeStats,
  type Bbox,
  isEmptyBbox,
} from '@/lib/cad/featureTreeStats';

// ─── BOM data shape ──────────────────────────────────────────────────────

export interface BomEntry {
  partId: string;
  name: string;
  /** Count of identical parts in the assembly. Phase 1: always 1. */
  quantity: number;
  material?: string;
  /** Mass in grams. Present iff volume + density both resolve. */
  mass?: number;
  /** Volume in mm³. Present iff a FeatureTree was supplied for this part. */
  volume?: number;
  /**
   * Outer surface area in mm². Present iff a FeatureTree was supplied AND
   * `featureTreeStats.computeStats` produced a finite surface-area total
   * for the part. Coarse Phase 1 estimate — see featureTreeStats.ts for
   * the per-kind accuracy caveats.
   */
  surfaceArea?: number;
  /**
   * Axis-aligned bounding box in world-space millimeters. Present iff a
   * FeatureTree was supplied AND the resulting union bbox is non-empty.
   * Surfaced for the 3D viewer (Agent-FFFFF) to drive viewport framing
   * without re-walking the tree on the consumer side.
   */
  bbox?: Bbox;
  notes?: string;
}

export interface BomExport {
  assemblyName: string;
  entries: ReadonlyArray<BomEntry>;
  totalParts: number;
  /** Sum of every entry's `mass`. Present iff at least one entry has a mass. */
  totalMass?: number;
  /** ISO-8601 timestamp captured at buildBom() time. */
  generatedAt: string;
}

// ─── density catalogue ───────────────────────────────────────────────────

/**
 * Common engineering material densities in g/mm³. Sourced from standard
 * tables (MatWeb, etc.) — close enough for Phase 1 estimation. Users can
 * override or add to this set via `buildBom({ densities })`.
 */
export const DEFAULT_DENSITIES: Readonly<Record<string, number>> = {
  steel: 0.00785,
  stainless_steel: 0.00800,
  aluminum: 0.00270,
  brass: 0.00850,
  copper: 0.00896,
  titanium: 0.00451,
  plastic_abs: 0.00104,
  plastic_pla: 0.00125,
  plastic_petg: 0.00127,
  nylon: 0.00114,
  wood: 0.00070,
  rubber: 0.00115,
};

/** When no material is supplied for a part, this label appears in the BOM. */
export const DEFAULT_MATERIAL = 'unspecified';

// ─── per-part stats (delegates to featureTreeStats) ──────────────────────

/**
 * Aggregate stats for one part, derived from its FeatureTree via the
 * shared `computeStats` walk. All fields are optional — undefined here
 * means "could not compute" rather than "zero". Callers that only care
 * about volume can still use `estimatePartVolume` (it is a thin wrapper
 * around this function).
 */
export interface PartStats {
  volume?: number;
  surfaceArea?: number;
  bbox?: Bbox;
}

/**
 * Compute volume / surfaceArea / bbox for a single FeatureTree.
 *
 * Implementation strategy (Phase 1):
 *   - Delegate to `featureTreeStats.computeStats(tree)` — this covers all
 *     8 Phase 1 feature kinds (extrude, revolve, sweep, loft, linear /
 *     circular pattern, hole, fillet, chamfer) with one unified walk.
 *     Earlier iterations of this module hand-rolled a switch covering
 *     only extrude + revolve; that has been retired so hole subtractions
 *     and pattern multipliers reach the BOM.
 *   - Floor the volume at 0 to preserve the historical contract that an
 *     all-cut tree never surfaces a negative BOM volume.
 *   - When the tree has zero non-suppressed nodes (empty / all-suppressed),
 *     return undefined for every field so the BOM row legitimately shows
 *     "no measurement" rather than "0 mm³".
 *   - If `computeStats` throws for any reason (defensive guard against
 *     future malformed IR), fall back to the legacy inline extrude+revolve
 *     switch via {@link legacyPartVolume}. That keeps the BOM exporter
 *     resilient — a single bad payload should not blank out the entire
 *     export.
 */
export function estimatePartStats(tree: FeatureTree | undefined): PartStats {
  if (!tree || tree.nodes.length === 0) return {};
  // Quick check: are there any non-suppressed nodes? If not, every stat
  // is "no measurement" and we exit early.
  const hasActive = tree.nodes.some((n) => !n.suppressed);
  if (!hasActive) return {};

  try {
    const stats = computeStats(tree);
    if (stats.nodeCount === 0) return {};
    // Did any per-node entry actually contribute a finite volume? Mirrors
    // the legacy "no contribution → undefined" contract: a tree composed
    // solely of fillet / chamfer wrappers (which intentionally skip
    // volume) should keep `volume` undefined rather than show "0 mm³"
    // which the user could read as "we measured zero". A negative
    // aggregate (all-cut) IS a contribution and clamps to 0 below.
    let anyVolumeContribution = false;
    let anySurfaceContribution = false;
    for (const fs of stats.perFeature.values()) {
      if (fs.volume !== undefined && Number.isFinite(fs.volume)) {
        anyVolumeContribution = true;
      }
      if (fs.surfaceArea !== undefined && Number.isFinite(fs.surfaceArea) && fs.surfaceArea > 0) {
        anySurfaceContribution = true;
      }
    }
    const out: PartStats = {};
    if (anyVolumeContribution && Number.isFinite(stats.volume)) {
      // Match the historical bomExport contract: never expose a negative
      // BOM volume — clamp the floor at 0 for the BOM row even when the
      // unified stats kept the sign.
      out.volume = Math.max(0, stats.volume);
    }
    if (anySurfaceContribution && Number.isFinite(stats.surfaceArea) && stats.surfaceArea > 0) {
      out.surfaceArea = stats.surfaceArea;
    }
    if (stats.bbox && !isEmptyBbox(stats.bbox) && isFiniteBbox(stats.bbox)) {
      out.bbox = stats.bbox;
    }
    return out;
  } catch {
    // Defensive fallback — keep the BOM resilient if a malformed IR slips
    // past validation. Only volume is recovered (surfaceArea / bbox were
    // never in the legacy switch).
    const v = legacyPartVolume(tree);
    return v === undefined ? {} : { volume: v };
  }
}

/**
 * Compute an approximate bounding-box volume (mm³) for one FeatureTree.
 *
 * Phase 1 contract (preserved across the JJJJJ integration):
 *   - Returns `undefined` for an empty tree / all-suppressed tree so the
 *     BOM row shows "no measurement".
 *   - Returns the non-negative `computeStats`-derived volume otherwise
 *     (clamped at 0 for net-cut trees).
 *
 * Thin wrapper around {@link estimatePartStats} so existing call sites
 * keep working without changes.
 */
export function estimatePartVolume(tree: FeatureTree | undefined): number | undefined {
  return estimatePartStats(tree).volume;
}

/**
 * True iff every coordinate of the bbox is a finite number. Guards against
 * NaN/Infinity leaking out of malformed IR (which {@link computeStats}
 * may emit without throwing — its inner per-kind helpers do not validate
 * input fields).
 */
function isFiniteBbox(b: Bbox): boolean {
  return (
    Number.isFinite(b.min.x) &&
    Number.isFinite(b.min.y) &&
    Number.isFinite(b.min.z) &&
    Number.isFinite(b.max.x) &&
    Number.isFinite(b.max.y) &&
    Number.isFinite(b.max.z)
  );
}

/**
 * Legacy inline-switch volume estimator — retained as a defensive fallback
 * for {@link estimatePartStats}. Covers only the extrude + revolve cases
 * the original DDDDD implementation modelled; every other kind returns
 * `undefined` (i.e., "nothing measurable here"). Floors the sum at 0 to
 * match the historical no-negative-BOM contract.
 *
 * Exported for tests + diagnostics. Production code should prefer
 * `estimatePartStats` / `estimatePartVolume` which route through the
 * unified computeStats walk first.
 */
export function legacyPartVolume(tree: FeatureTree | undefined): number | undefined {
  if (!tree || tree.nodes.length === 0) return undefined;
  let total = 0;
  let contributed = false;
  for (const node of tree.nodes) {
    if (node.suppressed) continue;
    const v = legacyNodeVolume(node);
    if (v === undefined) continue;
    contributed = true;
    total += v;
  }
  if (!contributed) return undefined;
  return Math.max(0, total);
}

function legacyNodeVolume(node: FeatureNode): number | undefined {
  const p: FeaturePayload = node.payload;
  switch (p.kind) {
    case 'extrude': {
      const area = Math.abs(signedArea(p.loop));
      // two-sided extrudes go +depth and -depth; total span = 2 × depth.
      const depth =
        p.direction === 'two_sided' ? p.depth * 2 : p.depth;
      const v = area * depth;
      return p.mode === 'cut' ? -v : v;
    }
    case 'revolve': {
      // Pappus's theorem: V = A × 2π × r_centroid × (angle / 360).
      // `loop` in revolve IR is already in canonical axis-frame where
      // X = radial distance from axis ( ≥ 0 ) and Y = axial coordinate,
      // so centroidX is the Pappus radius directly.
      const area = Math.abs(signedArea(p.loop));
      const rC = centroidX(p.loop);
      const sweepFrac = p.angleDegrees / 360;
      const v = area * 2 * Math.PI * rC * sweepFrac;
      return p.mode === 'cut' ? -v : v;
    }
    case 'sweep':
    case 'loft':
    case 'linear_pattern':
    case 'circular_pattern':
    case 'hole':
    case 'fillet':
    case 'chamfer':
      // Not modelled by the legacy fallback (computeStats handles them).
      return undefined;
  }
}

/**
 * Shoelace formula. Returns the signed area of a closed polygon (CCW
 * positive). Open polygons are tolerated — the closing edge is implied
 * between the last and first point. The CALLER takes the absolute value
 * — we deliberately keep the sign here so future callers (e.g., hole
 * detection) can still discriminate.
 */
export function signedArea(loop: ReadonlyArray<{ x: number; y: number }>): number {
  if (loop.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i]!;
    const b = loop[(i + 1) % loop.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

/**
 * Centroid X coordinate of a closed polygon. Used by Pappus's theorem in
 * the revolve volume estimate. Falls back to the bounding-box midpoint
 * when the area is degenerate (collinear / zero-area polygon).
 */
export function centroidX(loop: ReadonlyArray<{ x: number; y: number }>): number {
  if (loop.length === 0) return 0;
  if (loop.length < 3) {
    let sum = 0;
    for (const p of loop) sum += p.x;
    return sum / loop.length;
  }
  let cx = 0;
  let a = 0;
  for (let i = 0; i < loop.length; i++) {
    const p0 = loop[i]!;
    const p1 = loop[(i + 1) % loop.length]!;
    const cross = p0.x * p1.y - p1.x * p0.y;
    cx += (p0.x + p1.x) * cross;
    a += cross;
  }
  if (Math.abs(a) < 1e-12) {
    // Degenerate — fall back to bbox midpoint so we still produce a
    // non-NaN Pappus radius.
    let minX = Infinity;
    let maxX = -Infinity;
    for (const p of loop) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
    }
    return (minX + maxX) / 2;
  }
  return cx / (3 * a);
}

// ─── buildBom ────────────────────────────────────────────────────────────

export interface BuildBomOptions {
  /** Optional human-readable name surfaced in the BOM header / filename. */
  assemblyName?: string;
  /** Per-part FeatureTree map; keys are PartInstance.id. */
  featureTrees?: Record<string, FeatureTree>;
  /** Per-part material override; keys are PartInstance.id. */
  materials?: Record<string, string>;
  /**
   * Density catalogue (g/mm³) keyed by material name. Merged on top of
   * {@link DEFAULT_DENSITIES} so callers can add custom materials without
   * losing the defaults.
   */
  densities?: Record<string, number>;
  /** Optional per-part notes column. */
  notes?: Record<string, string>;
  /**
   * Inject the timestamp instead of calling `new Date().toISOString()`.
   * Tests use this to get a deterministic generatedAt without mocking
   * the global clock.
   */
  generatedAt?: string;
}

/**
 * Walk every part in the AssemblyState and produce a single BomEntry per
 * part. See module docstring for the algorithm. Mates are intentionally
 * ignored — they don't contribute parts to the BOM, only constraints.
 */
export function buildBom(state: AssemblyState, opts: BuildBomOptions = {}): BomExport {
  const featureTrees = opts.featureTrees ?? {};
  const materials = opts.materials ?? {};
  const notesMap = opts.notes ?? {};
  const densities: Record<string, number> = {
    ...DEFAULT_DENSITIES,
    ...(opts.densities ?? {}),
  };

  const entries: BomEntry[] = [];
  let totalMass: number | undefined;

  for (const part of state.parts) {
    const tree = featureTrees[part.id];
    const partStats = estimatePartStats(tree);
    const { volume, surfaceArea, bbox } = partStats;
    const material = materials[part.id] ?? DEFAULT_MATERIAL;
    const density = densities[material];
    let mass: number | undefined;
    if (volume !== undefined && density !== undefined && density > 0) {
      mass = volume * density;
      totalMass = (totalMass ?? 0) + mass;
    }
    const entry: BomEntry = {
      partId: part.id,
      name: part.name,
      quantity: 1,
    };
    if (material !== DEFAULT_MATERIAL || materials[part.id] !== undefined) {
      entry.material = material;
    } else {
      entry.material = DEFAULT_MATERIAL;
    }
    if (volume !== undefined) entry.volume = volume;
    if (surfaceArea !== undefined) entry.surfaceArea = surfaceArea;
    if (bbox !== undefined) entry.bbox = bbox;
    if (mass !== undefined) entry.mass = mass;
    const note = notesMap[part.id];
    if (note !== undefined) entry.notes = note;
    entries.push(entry);
  }

  const bom: BomExport = {
    assemblyName: opts.assemblyName ?? 'assembly',
    entries,
    totalParts: state.parts.length,
    generatedAt: opts.generatedAt ?? new Date().toISOString(),
  };
  if (totalMass !== undefined) bom.totalMass = totalMass;
  return bom;
}

// ─── CSV ─────────────────────────────────────────────────────────────────

/**
 * Columns emitted by `bomToCsv`, in the order they appear. Exported so
 * callers / tests can assert column shape without re-declaring it.
 *
 * Schema history:
 *   - 4.5.0 → `partId,name,quantity,material,volume_mm3,mass_g,notes`
 *   - 4.5.1 → adds `surfaceArea_mm2` between `volume_mm3` and `mass_g`
 *     once bomExport routed through featureTreeStats.computeStats and
 *     started carrying a surface-area total per entry.
 *
 * The bbox is NOT projected to CSV (3 vectors × 3 floats would balloon
 * the columns); JSON consumers see `entry.bbox` directly.
 */
export const BOM_CSV_COLUMNS = [
  'partId',
  'name',
  'quantity',
  'material',
  'volume_mm3',
  'surfaceArea_mm2',
  'mass_g',
  'notes',
] as const;

/**
 * Escape one CSV field per RFC 4180:
 *   - If the field contains a comma, double-quote, CR, or LF, wrap it in
 *     double quotes and double any internal double-quote.
 *   - Otherwise emit the field verbatim.
 * `undefined` / `null` are rendered as empty strings (a common BOM
 * convention — explicit "N/A" placeholders would just add noise).
 */
export function escapeCsvField(value: unknown): string {
  if (value === undefined || value === null) return '';
  const str = String(value);
  if (
    str.includes(',') ||
    str.includes('"') ||
    str.includes('\n') ||
    str.includes('\r')
  ) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Serialize the BOM to RFC 4180 CSV.
 *
 *   - Header row first.
 *   - One data row per entry.
 *   - Lines terminated with CRLF (RFC 4180 §2.1).
 *   - Numeric fields rendered without locale grouping (use Number's
 *     default `toString` so `1500` stays `1500`, not `1,500`).
 *
 * Volume / mass are emitted in their canonical units (mm³ / g) to keep
 * the columns self-describing in the header.
 */
export function bomToCsv(bom: BomExport): string {
  const lines: string[] = [];
  lines.push(BOM_CSV_COLUMNS.map(escapeCsvField).join(','));
  for (const e of bom.entries) {
    const row = [
      e.partId,
      e.name,
      e.quantity,
      e.material ?? '',
      e.volume ?? '',
      e.surfaceArea ?? '',
      e.mass ?? '',
      e.notes ?? '',
    ];
    lines.push(row.map(escapeCsvField).join(','));
  }
  return lines.join('\r\n');
}

// ─── JSON ────────────────────────────────────────────────────────────────

/**
 * Serialize the BOM as pretty-printed JSON (2-space indent). Stable shape
 * — every BomEntry property appears even when undefined would have been
 * omitted by the build path, so downstream tooling can rely on column
 * presence.
 */
export function bomToJson(bom: BomExport): string {
  return JSON.stringify(bom, null, 2);
}
