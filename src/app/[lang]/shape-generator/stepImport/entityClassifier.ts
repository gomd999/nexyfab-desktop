/**
 * entityClassifier.ts — Phase D 후속 "AP242 BIM 풀 호환 — entity 화이트리스트".
 *
 * Classifies the entities present in a STEP file's DATA section into
 * categories so the UI can:
 *   - warn before import ("this STEP has 3 unsupported BIM entities —
 *     the building/wall data will be ignored")
 *   - log analytics on which entity classes are most-requested but not
 *     yet supported
 *   - skip a file gracefully (return early with a clean error rather
 *     than letting OCCT spend 30 s + fail)
 *
 * Classification (priority order — first match wins):
 *   - 'bim'         IFC + architectural — silently skipped on import
 *   - 'tessellated' AP242 mesh paths
 *   - 'pmi'         AP242 PMI (geometric tolerance / dimensional callout)
 *   - 'core'        AP214/AP242 well-supported geometry + structure
 *   - 'units'       Unit-system entities
 *   - 'style'       Color / presentation
 *   - 'unknown'     Anything else — may or may not import cleanly
 *
 * Implementation: regex-light scan of DATA section. We DO NOT parse the
 * entity bodies; only their type name (the token before the `(`). This
 * is robust to OCCT's writer variants and AP242 Edition 2 entity
 * extensions.
 */

const CORE: ReadonlySet<string> = new Set([
  // Application context + product structure
  'APPLICATION_CONTEXT',
  'APPLICATION_PROTOCOL_DEFINITION',
  'PRODUCT',
  'PRODUCT_CONTEXT',
  'PRODUCT_DEFINITION',
  'PRODUCT_DEFINITION_CONTEXT',
  'PRODUCT_DEFINITION_FORMATION',
  'PRODUCT_DEFINITION_FORMATION_WITH_SPECIFIED_SOURCE',
  'PRODUCT_DEFINITION_SHAPE',
  'PRODUCT_RELATED_PRODUCT_CATEGORY',
  'SHAPE_DEFINITION_REPRESENTATION',
  'SHAPE_REPRESENTATION',
  'ADVANCED_BREP_SHAPE_REPRESENTATION',
  'MANIFOLD_SURFACE_SHAPE_REPRESENTATION',
  'MECHANICAL_DESIGN_GEOMETRIC_PRESENTATION_REPRESENTATION',
  // Assembly
  'NEXT_ASSEMBLY_USAGE_OCCURRENCE',
  'ASSEMBLY_COMPONENT_USAGE',
  'CONTEXT_DEPENDENT_SHAPE_REPRESENTATION',
  'ITEM_DEFINED_TRANSFORMATION',
  'REPRESENTATION_RELATIONSHIP',
  'REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION',
  'SHAPE_REPRESENTATION_RELATIONSHIP',
  // Geometry — points, directions, frames
  'CARTESIAN_POINT',
  'DIRECTION',
  'VECTOR',
  'AXIS1_PLACEMENT',
  'AXIS2_PLACEMENT_2D',
  'AXIS2_PLACEMENT_3D',
  'PLACEMENT',
  // Curves
  'LINE',
  'CIRCLE',
  'ELLIPSE',
  'PARABOLA',
  'HYPERBOLA',
  'B_SPLINE_CURVE',
  'B_SPLINE_CURVE_WITH_KNOTS',
  'BEZIER_CURVE',
  'RATIONAL_B_SPLINE_CURVE',
  'POLYLINE',
  'TRIMMED_CURVE',
  // Surfaces
  'PLANE',
  'CYLINDRICAL_SURFACE',
  'CONICAL_SURFACE',
  'SPHERICAL_SURFACE',
  'TOROIDAL_SURFACE',
  'SURFACE_OF_REVOLUTION',
  'SURFACE_OF_LINEAR_EXTRUSION',
  'B_SPLINE_SURFACE',
  'B_SPLINE_SURFACE_WITH_KNOTS',
  'BEZIER_SURFACE',
  'RATIONAL_B_SPLINE_SURFACE',
  'OFFSET_SURFACE',
  'CURVE_BOUNDED_SURFACE',
  // Topology
  'VERTEX_POINT',
  'EDGE_CURVE',
  'ORIENTED_EDGE',
  'EDGE_LOOP',
  'FACE_BOUND',
  'FACE_OUTER_BOUND',
  'ADVANCED_FACE',
  'OPEN_SHELL',
  'ORIENTED_OPEN_SHELL',
  'CLOSED_SHELL',
  'ORIENTED_CLOSED_SHELL',
  'CONNECTED_FACE_SET',
  'MANIFOLD_SOLID_BREP',
  'BREP_WITH_VOIDS',
  'FACETED_BREP',
  'SHELL_BASED_SURFACE_MODEL',
]);

const TESSELLATED: ReadonlySet<string> = new Set([
  'COORDINATES_LIST',
  'TRIANGULATED_FACE',
  'COMPLEX_TRIANGULATED_FACE',
  'TESSELLATED_FACE',
  'TESSELLATED_SHELL',
  'TESSELLATED_SOLID',
  'TESSELLATED_SHAPE_REPRESENTATION',
  'TESSELLATED_GEOMETRIC_SET',
  'TRIANGULATED_SURFACE_SET',
  'COMPLEX_TRIANGULATED_SURFACE_SET',
]);

const PMI_PREFIXES: readonly string[] = [
  'GEOMETRIC_TOLERANCE',
  'DIMENSIONAL_',
  'DIMENSION_CURVE',
  'DRAUGHTING_',
  'DATUM',
  'PLACED_DATUM_',
  'TOLERANCE_ZONE',
  'CALLOUT',
  'ANNOTATION_',
];

const UNITS: ReadonlySet<string> = new Set([
  'UNIT_ASSIGNMENT',
  'SI_UNIT',
  'CONVERSION_BASED_UNIT',
  'LENGTH_UNIT',
  'PLANE_ANGLE_UNIT',
  'SOLID_ANGLE_UNIT',
  'NAMED_UNIT',
  'LENGTH_MEASURE_WITH_UNIT',
  'PLANE_ANGLE_MEASURE_WITH_UNIT',
  'DIMENSIONAL_EXPONENTS',
  'UNCERTAINTY_MEASURE_WITH_UNIT',
  'GLOBAL_UNIT_ASSIGNED_CONTEXT',
  'GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT',
]);

const STYLE: ReadonlySet<string> = new Set([
  'COLOUR_RGB',
  'DRAUGHTING_PRE_DEFINED_COLOUR',
  'CURVE_STYLE',
  'FILL_AREA_STYLE',
  'FILL_AREA_STYLE_COLOUR',
  'PRESENTATION_STYLE_ASSIGNMENT',
  'PRESENTATION_LAYER_ASSIGNMENT',
  'STYLED_ITEM',
  'OVER_RIDING_STYLED_ITEM',
  'MECHANICAL_DESIGN_GEOMETRIC_PRESENTATION_AREA',
]);

const BIM_PREFIXES: readonly string[] = [
  'IFC',
  'BUILDING',
  'WALL',
  'SLAB',
  'BEAM_ELEMENT', // distinguish from generic BEAM which could be mech engineering
  'COLUMN_ELEMENT',
  'RAILING',
  'ROOF',
  'STAIR',
  'DOOR',
  'WINDOW',
  'SITE',
  'STOREY',
  'SPACE_BOUNDARY',
  'SPATIAL_STRUCTURE_ELEMENT',
  'SPATIAL_ELEMENT',
];

export type EntityCategory = 'core' | 'tessellated' | 'pmi' | 'units' | 'style' | 'bim' | 'unknown';

export interface EntityTypeCounts {
  readonly category: EntityCategory;
  readonly entityType: string;
  readonly count: number;
}

export interface ClassifyStepEntitiesResult {
  /** Total `#NNN=TYPE(...)` lines in DATA section. */
  readonly totalEntities: number;
  /** Per-category aggregate counts. */
  readonly byCategory: Readonly<Record<EntityCategory, number>>;
  /** Per-type counts (sorted by count desc, then type asc). */
  readonly byType: ReadonlyArray<EntityTypeCounts>;
  /** Unknown entity type names (sorted), for analytics tracking. */
  readonly unknownTypes: readonly string[];
  /** BIM-specific entity type names (sorted). UI surfaces a warning. */
  readonly bimTypes: readonly string[];
  /** Detected FILE_SCHEMA token (best-effort; null if not present). */
  readonly schema: string | null;
  /** True iff the file is *importable* (no BIM-blocking entities AND
   *  has at least one core geometry entity). UI uses this for the
   *  "import" button enabled-state. */
  readonly importable: boolean;
}

/** Classify a single entity type name into a category. */
export function categorizeEntityType(typeName: string): EntityCategory {
  const upper = typeName.toUpperCase();
  if (BIM_PREFIXES.some((p) => upper.startsWith(p))) return 'bim';
  if (TESSELLATED.has(upper)) return 'tessellated';
  if (PMI_PREFIXES.some((p) => upper.startsWith(p))) return 'pmi';
  if (CORE.has(upper)) return 'core';
  if (UNITS.has(upper)) return 'units';
  if (STYLE.has(upper)) return 'style';
  return 'unknown';
}

/** Extract the FILE_SCHEMA token from the HEADER section. */
function extractSchema(stepText: string): string | null {
  const m = stepText.match(/FILE_SCHEMA\s*\(\s*\(\s*'([^']*)'/);
  return m ? m[1].trim() : null;
}

/**
 * Scan a STEP file's DATA section and classify every entity by type.
 *
 * Handles both `#42=TYPE(...)` and `#42 = TYPE (...)` whitespace variants.
 * Skips lines that don't match an entity definition (comments, blanks).
 *
 * Performance: regex scan is O(n) over the file size; ~5MB STEP files
 * classify in <50ms on a hot V8.
 */
export function classifyStepEntities(stepText: string): ClassifyStepEntitiesResult {
  const schema = extractSchema(stepText);

  // Find the DATA section bounds.
  const dataStart = stepText.indexOf('DATA;');
  const dataEnd = stepText.indexOf('ENDSEC;', dataStart);
  if (dataStart < 0 || dataEnd < 0) {
    return {
      totalEntities: 0,
      byCategory: { core: 0, tessellated: 0, pmi: 0, units: 0, style: 0, bim: 0, unknown: 0 },
      byType: [],
      unknownTypes: [],
      bimTypes: [],
      schema,
      importable: false,
    };
  }
  const dataBlock = stepText.slice(dataStart + 'DATA;'.length, dataEnd);

  const typeCount = new Map<string, number>();
  let total = 0;
  // Match `#<id>=TYPE_NAME(` or `#<id> = TYPE_NAME(` at the line start.
  const rx = /^#\d+\s*=\s*([A-Z_][A-Z0-9_]*)\s*\(/gm;
  for (const m of dataBlock.matchAll(rx)) {
    const typeName = m[1];
    typeCount.set(typeName, (typeCount.get(typeName) ?? 0) + 1);
    total++;
  }

  const byCategory: Record<EntityCategory, number> = {
    core: 0, tessellated: 0, pmi: 0, units: 0, style: 0, bim: 0, unknown: 0,
  };
  const unknownSet = new Set<string>();
  const bimSet = new Set<string>();
  const byTypeArr: EntityTypeCounts[] = [];

  // Geometry-bearing entities. Importable requires at least one of
  // these (structure-only files like a PRODUCT manifest aren't useful).
  const GEOMETRY_TYPES = new Set([
    'CARTESIAN_POINT', 'ADVANCED_FACE', 'MANIFOLD_SOLID_BREP',
    'BREP_WITH_VOIDS', 'FACETED_BREP', 'SHELL_BASED_SURFACE_MODEL',
    'OPEN_SHELL', 'CLOSED_SHELL', 'TRIANGULATED_FACE', 'COORDINATES_LIST',
    'TESSELLATED_SOLID', 'TESSELLATED_SHELL',
  ]);
  let hasGeometry = false;

  for (const [typeName, count] of typeCount.entries()) {
    const category = categorizeEntityType(typeName);
    byCategory[category] += count;
    byTypeArr.push({ category, entityType: typeName, count });
    if (category === 'unknown') unknownSet.add(typeName);
    if (category === 'bim') bimSet.add(typeName);
    if (GEOMETRY_TYPES.has(typeName.toUpperCase())) hasGeometry = true;
  }

  byTypeArr.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.entityType.localeCompare(b.entityType);
  });

  return {
    totalEntities: total,
    byCategory,
    byType: byTypeArr,
    unknownTypes: Array.from(unknownSet).sort(),
    bimTypes: Array.from(bimSet).sort(),
    schema,
    importable: hasGeometry && byCategory.bim === 0,
  };
}

/** One-line summary for UI hints / log lines.
 *  Example: "AP214 · 1234 entities · 95% core · 12 unknown · ok to import". */
export function formatClassifySummary(r: ClassifyStepEntitiesResult): string {
  const corePct = r.totalEntities > 0
    ? Math.round((r.byCategory.core / r.totalEntities) * 100)
    : 0;
  const verdict = r.importable
    ? 'ok to import'
    : r.byCategory.bim > 0
      ? `${r.byCategory.bim} BIM entities — not importable`
      : 'no core geometry';
  return [
    r.schema ?? 'unknown schema',
    `${r.totalEntities} entities`,
    `${corePct}% core`,
    `${r.byCategory.unknown} unknown`,
    verdict,
  ].join(' · ');
}
