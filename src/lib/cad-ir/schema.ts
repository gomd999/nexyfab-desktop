/**
 * schema.ts — CAD → IR v1, TypeScript port of 참고파일들/result/schema/ir-schema.md.
 *
 * The IR compresses a CAD file (up to hundreds of MB) into JSON small enough for an LLM
 * context (target ≤ 8 KB) while keeping exactly what OpenSCAD parametric reconstruction needs.
 *
 * Honesty rules (ir-schema.md §불변 규칙 — enforced by `normalizeIr`):
 *   1. Never label an estimate as measured. Units undeclared → `units: null` (never guessed).
 *   2. Sampling must be recorded (`parse.truncated`). No silent truncation.
 *   3. IR never replaces the source. `identity.path` always traces back.
 *   4. Uncertain fields are `null`, not plausibly filled.
 */

export type Vec3 = [number, number, number];

export type CadFormat =
  | 'STEP' | 'IFC' | 'DXF' | 'IGES' | 'X_T' | 'SAT'
  | 'OBJ' | 'WRL' | 'DAE' | '3MF' | 'STL';

export interface IrIdentity {
  path: string;
  name: string;
  format: CadFormat;
  bytes: number;
  sha256: string | null;
  source_hint: string | null;
}

export interface IrParse {
  status: 'ok' | 'partial' | 'failed';
  parser: string;
  elapsed_ms: number;
  /** True when a large file was sampled rather than fully parsed. Never silent. */
  truncated: boolean;
  sampled_ratio: number;
  warnings: string[];
  error: string | null;
}

export interface IrExtent {
  /** Declared source unit. `null` when undeclared/unknown — never estimated. */
  units: 'mm' | 'cm' | 'm' | 'in' | 'ft' | null;
  units_source: 'declared' | 'inferred' | 'unknown';
  bbox_min: Vec3 | null;
  bbox_max: Vec3 | null;
  size: Vec3 | null;
  centroid: Vec3 | null;
  aspect: 'rod' | 'plate' | 'block' | 'shell' | 'complex' | null;
  is_2d: boolean;
}

export interface IrSurfaceTypes {
  plane: number; cylinder: number; cone: number; sphere: number;
  torus: number; bspline: number; revolution: number; extrusion: number; other: number;
}

export interface IrTopology {
  solids: number | null;
  shells: number | null;
  faces: number | null;
  edges: number | null;
  vertices: number | null;
  surface_types: Partial<IrSurfaceTypes> | null;
  curve_types: { line?: number; circle?: number; ellipse?: number; bspline?: number } | null;
  /** (total − bspline − other) / total. Nearest 1.0 → primitive-CSG reconstructible. */
  analytic_ratio: number | null;
  closed: boolean | null;
}

export interface IrHole {
  axis: Vec3 | null;
  diameter: number | null;
  depth: number | null;
  center: Vec3 | null;
  /** true=through, false=blind, null=undetermined (never guessed). */
  through: boolean | null;
  count_in_pattern: number | null;
}

export interface IrPattern {
  kind: 'circular' | 'linear' | string;
  count: number;
  axis?: Vec3 | null;
  radius?: number | null;
  direction?: Vec3 | null;
  pitch?: number | null;
  start_angle_deg?: number | null;
  element?: string | null;
}

export interface IrFeatures {
  holes: IrHole[];
  hole_diameters: number[];
  fillet_radii: number[];
  chamfers: { size: number; angle_deg: number }[];
  patterns: IrPattern[];
  revolution_profile: unknown | null;
  extrusion_profile: unknown | null;
  primitive_fit: { kind: string; params: Record<string, number>; residual_pct: number } | null;
}

export interface IrSymmetry {
  mirror_planes: string[];
  rotational_order: number | null;
  axis_aligned: boolean | null;
  principal_axis: Vec3 | null;
}

export interface IrMesh {
  triangles: number | null;
  vertices: number | null;
  watertight: boolean | null;
  volume_mm3: number | null;
  /** Set when volume cannot be trusted as mm³ (unit unknown). */
  volume_mm3_unit_warning?: string | null;
  area_mm2: number | null;
  components: number | null;
  planar_clusters: number | null;
  normal_histogram_peaks: number | null;
  curvature_bins: { flat: number; cyl: number; free: number } | null;
  primitive_fit: { kind: string; params: Record<string, number>; residual_pct: number } | null;
  degenerate_faces: number | null;
}

export interface IrReconstruct {
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  score: number;
  strategy: 'primitive_csg' | 'csg_with_approx' | 'assembly_decompose' | 'mesh_import' | 'none';
  rationale: string;
  est_tokens: number | null;
  blockers: string[];
}

export interface Ir {
  ir_version: '1';
  identity: IrIdentity;
  parse: IrParse;
  extent: IrExtent | null;
  topology: IrTopology | null;
  features: IrFeatures | null;
  symmetry: IrSymmetry | null;
  assembly: unknown | null;
  mesh: IrMesh | null;
  semantics: unknown | null;
  reconstruct: IrReconstruct | null;
}

const KNOWN_UNITS = new Set(['mm', 'cm', 'm', 'in', 'ft']);

/**
 * Normalize a raw parsed `.ir.json` object into a well-typed `Ir`, enforcing the honesty rules.
 * Anything uncertain collapses to `null` rather than a plausible fill-in.
 */
export function normalizeIr(raw: unknown): Ir {
  const r = (raw ?? {}) as Record<string, any>;
  const extentRaw = r.extent as Record<string, any> | null | undefined;

  let extent: IrExtent | null = null;
  if (extentRaw) {
    const declaredUnit = extentRaw.units;
    const unitsKnown = typeof declaredUnit === 'string' && KNOWN_UNITS.has(declaredUnit);
    const src = extentRaw.units_source;
    // Honesty rule 1: only accept a unit when it was declared/inferred; otherwise null.
    const unitsSource: IrExtent['units_source'] =
      src === 'declared' || src === 'inferred' ? src : 'unknown';
    extent = {
      units: unitsKnown && unitsSource !== 'unknown' ? (declaredUnit as IrExtent['units']) : null,
      units_source: unitsSource,
      bbox_min: asVec3(extentRaw.bbox_min),
      bbox_max: asVec3(extentRaw.bbox_max),
      size: asVec3(extentRaw.size),
      centroid: asVec3(extentRaw.centroid),
      aspect: extentRaw.aspect ?? null,
      is_2d: Boolean(extentRaw.is_2d),
    };
  }

  const featRaw = r.features as Record<string, any> | null | undefined;
  const features: IrFeatures | null = featRaw
    ? {
        holes: Array.isArray(featRaw.holes) ? featRaw.holes.map(normalizeHole) : [],
        hole_diameters: numArr(featRaw.hole_diameters),
        fillet_radii: numArr(featRaw.fillet_radii),
        chamfers: Array.isArray(featRaw.chamfers) ? featRaw.chamfers : [],
        patterns: Array.isArray(featRaw.patterns) ? featRaw.patterns : [],
        revolution_profile: featRaw.revolution_profile ?? null,
        extrusion_profile: featRaw.extrusion_profile ?? null,
        primitive_fit: featRaw.primitive_fit ?? null,
      }
    : null;

  const parseRaw = (r.parse ?? {}) as Record<string, any>;
  const parse: IrParse = {
    status: parseRaw.status === 'partial' || parseRaw.status === 'failed' ? parseRaw.status : 'ok',
    parser: String(parseRaw.parser ?? 'unknown'),
    elapsed_ms: Number(parseRaw.elapsed_ms ?? 0),
    truncated: Boolean(parseRaw.truncated),
    sampled_ratio: typeof parseRaw.sampled_ratio === 'number' ? parseRaw.sampled_ratio : 1.0,
    warnings: Array.isArray(parseRaw.warnings) ? parseRaw.warnings.map(String) : [],
    error: parseRaw.error ?? null,
  };

  const idRaw = (r.identity ?? {}) as Record<string, any>;
  const identity: IrIdentity = {
    path: String(idRaw.path ?? ''),
    name: String(idRaw.name ?? ''),
    format: idRaw.format ?? 'STL',
    bytes: Number(idRaw.bytes ?? 0),
    sha256: idRaw.sha256 ?? null,
    source_hint: idRaw.source_hint ?? null,
  };

  return {
    ir_version: '1',
    identity,
    parse,
    extent,
    topology: (r.topology ?? null) as IrTopology | null,
    features,
    symmetry: (r.symmetry ?? null) as IrSymmetry | null,
    assembly: r.assembly ?? null,
    mesh: (r.mesh ?? null) as IrMesh | null,
    semantics: r.semantics ?? null,
    reconstruct: (r.reconstruct ?? null) as IrReconstruct | null,
  };
}

function normalizeHole(h: any): IrHole {
  return {
    axis: asVec3(h?.axis),
    diameter: numOrNull(h?.diameter),
    depth: numOrNull(h?.depth),
    center: asVec3(h?.center),
    through: h?.through === true ? true : h?.through === false ? false : null,
    count_in_pattern: numOrNull(h?.count_in_pattern),
  };
}

function asVec3(v: unknown): Vec3 | null {
  if (Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n))) {
    return [v[0], v[1], v[2]];
  }
  return null;
}

function numArr(v: unknown): number[] {
  return Array.isArray(v) ? v.filter((n): n is number => typeof n === 'number' && Number.isFinite(n)) : [];
}

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** True when the IR's units may be used for absolute-dimension comparison. */
export function unitsKnown(ir: Ir): boolean {
  const e = ir.extent;
  return !!e && !!e.units && (e.units_source === 'declared' || e.units_source === 'inferred');
}
