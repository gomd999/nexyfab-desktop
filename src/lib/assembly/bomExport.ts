/**
 * bomExport — Phase 4.5 of NexyFab Pro own-CAD (ADR-013).
 *
 * Convert an AssemblyState IR (parts + mates) into a Bill of Materials
 * (BomExport) suitable for CSV / JSON download. Phase 1 keeps the
 * algorithm intentionally simple:
 *
 *   - One PartInstance → one BomEntry (quantity always 1). Future phases
 *     will collapse identical part templates with quantity > 1.
 *   - Per-part volume is computed from the optional FeatureTree by walking
 *     extrude / revolve / hole nodes and accumulating an approximate
 *     bounding-box-style volume in mm³. Precise OCCT-derived volume is
 *     Phase 2 work.
 *   - Mass = volume × density (g/mm³). When no material / density is
 *     supplied, mass stays undefined.
 *   - CSV uses RFC 4180 quoting (double quotes around any field that
 *     contains comma / quote / newline; quotes within escaped fields are
 *     doubled).
 *   - JSON is JSON.stringify(bom, null, 2).
 *
 * Out of scope:
 *   - Part templates with identical geometry → quantity > 1
 *   - Precise OCCT volume (Phase 2)
 *   - Cost / supplier columns (Phase 5)
 *   - Sub-assembly hierarchy
 */

import type { AssemblyState } from './assemblyState';
import type {
  FeatureTree,
  FeatureNode,
  FeaturePayload,
} from '@/lib/cad/featureTree';

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

// ─── volume estimation ───────────────────────────────────────────────────

/**
 * Compute an approximate bounding-box volume (mm³) for one FeatureTree.
 *
 * Algorithm (Phase 1 — deliberately coarse, deterministic, kernel-free):
 *   1. Skip every suppressed node so the user's UI choice is respected.
 *   2. For each non-suppressed node, derive an "additive" volume from its
 *      payload kind:
 *        - extrude: signedArea(loop) × effectiveDepth.
 *          `two_sided` doubles the depth.
 *        - revolve: signedArea(loop) × 2π × centroidX × (angle / 360).
 *          (Pappus's theorem; accurate enough for axisymmetric profiles.)
 *        - sweep / loft: 0 (Phase 1 doesn't model curved sweeps — leaves
 *          the user with the underlying base-feature volume).
 *        - linear_pattern: ignored — the pattern multiplies an existing
 *          body but we lack the source-body volume in Phase 1.
 *        - circular_pattern: ignored — same caveat.
 *        - hole / fillet / chamfer: ignored — these are subtractive /
 *          edge-modifying, and capturing them without an OCCT kernel is a
 *          rabbit hole. Phase 2 will pull volumes from OCCT directly.
 *   3. `cut` mode on extrude / revolve produces a negative contribution
 *      (subtractive volume) so a part composed of one boss + one cut
 *      lines up roughly with reality.
 *   4. Sum every contribution. Floor at 0 — a pathological "all-cut"
 *      tree shouldn't surface a negative BOM volume.
 *
 * Returns `undefined` when the tree has zero contributing nodes (so the
 * BOM row legitimately shows "no volume" rather than 0 mm³, which would
 * imply we measured and found nothing).
 */
export function estimatePartVolume(tree: FeatureTree | undefined): number | undefined {
  if (!tree || tree.nodes.length === 0) return undefined;
  let total = 0;
  let contributed = false;
  for (const node of tree.nodes) {
    if (node.suppressed) continue;
    const v = nodeVolume(node);
    if (v === undefined) continue;
    contributed = true;
    total += v;
  }
  if (!contributed) return undefined;
  return Math.max(0, total);
}

function nodeVolume(node: FeatureNode): number | undefined {
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
      // Not modelled in Phase 1.
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
    const volume = estimatePartVolume(tree);
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
 */
export const BOM_CSV_COLUMNS = [
  'partId',
  'name',
  'quantity',
  'material',
  'volume_mm3',
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
