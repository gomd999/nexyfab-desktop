/**
 * ifcImport.ts — BIM IFC (Industry Foundation Classes) file pre-flight.
 *
 * IFC is the open BIM exchange format (ISO 16739). It looks very
 * similar to STEP (both are EXPRESS-based ISO 10303 derivatives),
 * but with a different domain schema for *buildings* — walls, floors,
 * spaces, beams, doors, MEP equipment.
 *
 * NexyFab uses IFC import to:
 *
 *   - Help fabrication of building-component products (curtain walls,
 *     railings, sun shades) where the customer hands over the BIM.
 *   - Quote site-context-aware manufacturing for architectural metal
 *     work.
 *
 * Full IFC implementation requires gigabytes of geometry support
 * (libIFCJS / IfcOpenShell). NexyFab ships the *pre-flight* and
 * *entity discovery* pieces only:
 *
 *   - Parse the header (schema version, units, project name).
 *   - Count entities by type (IFCWALL, IFCWINDOW, IFCSPACE, ...).
 *   - Walk the spatial hierarchy (Site → Building → Storey → Space).
 *   - Extract a list of all "products" — placeable elements with
 *     names, types, and parent storeys.
 *
 * Full geometry is deferred to a separate worker that reuses the
 * existing OCCT / replicad pipeline.
 */

export type IfcSchema = 'IFC2X3' | 'IFC4' | 'IFC4X3' | 'unknown';

export interface IfcHeader {
  schema: IfcSchema;
  projectName?: string;
  authoringTool?: string;
  fileDescription?: string;
  /** Length unit detected (e.g. 'METRE', 'MILLIMETRE'). */
  lengthUnit?: string;
}

export interface IfcEntityCount {
  /** Entity type name (e.g. 'IFCWALL'). */
  type: string;
  /** Number of records of this type. */
  count: number;
}

export interface IfcProduct {
  /** STEP reference id (#42, etc) without the #. */
  refId: number;
  /** Type label (IFCWALL, IFCWINDOW...). */
  type: string;
  /** Display name from the entity (if present). */
  name?: string;
  /** GlobalId (GUID). */
  globalId?: string;
  /** Containing storey id (refId). */
  containedInStorey?: number;
}

export interface IfcSpatialNode {
  /** Type (IFCSITE / IFCBUILDING / IFCBUILDINGSTOREY / IFCSPACE). */
  type: string;
  refId: number;
  name?: string;
  children: IfcSpatialNode[];
}

export interface IfcPreflightReport {
  header: IfcHeader;
  /** Total entity records. */
  totalEntities: number;
  /** Counts by type, sorted descending. */
  entityCounts: IfcEntityCount[];
  /** Products discovered (walls, doors, spaces, ...). */
  products: IfcProduct[];
  /** Spatial hierarchy root nodes. */
  spatialTree: IfcSpatialNode[];
  /** Warnings encountered. */
  warnings: string[];
}

// ── Top-level entry ─────────────────────────────────────────────

export function preflightIfc(text: string): IfcPreflightReport {
  const warnings: string[] = [];
  const header = parseHeader(text);

  const entities = scanEntities(text);
  const entityCounts = countByType(entities);
  const products = extractProducts(entities);
  const spatialTree = buildSpatialTree(entities);

  if (entities.length === 0) warnings.push('No IFC entity records discovered');
  if (header.schema === 'unknown') warnings.push('Schema version not recognized');

  return {
    header,
    totalEntities: entities.length,
    entityCounts,
    products,
    spatialTree,
    warnings,
  };
}

// ── Header parsing ──────────────────────────────────────────────

const HEADER_BLOCK_RE = /HEADER;([\s\S]*?)ENDSEC;/;
const FILE_DESCRIPTION_RE = /FILE_DESCRIPTION\s*\(\s*\(\s*'([^']+)'/i;
const FILE_NAME_RE = /FILE_NAME\s*\(\s*'([^']*)'/i;
const FILE_SCHEMA_RE = /FILE_SCHEMA\s*\(\s*\(\s*'([^']+)'/i;

function parseHeader(text: string): IfcHeader {
  const match = HEADER_BLOCK_RE.exec(text);
  if (!match) return { schema: 'unknown' };
  const block = match[1] ?? '';
  const descMatch = FILE_DESCRIPTION_RE.exec(block);
  const nameMatch = FILE_NAME_RE.exec(block);
  const schemaMatch = FILE_SCHEMA_RE.exec(block);

  const header: IfcHeader = { schema: normalizeSchema(schemaMatch?.[1] ?? '') };
  if (descMatch?.[1]) header.fileDescription = descMatch[1];
  if (nameMatch?.[1]) header.projectName = nameMatch[1];

  // Tool: FILE_NAME has authoring app as one of its args. Lazy regex.
  const toolMatch = /FILE_NAME[^;]*'([^']+)'\s*,\s*'[^']*'\s*\)/i.exec(block);
  if (toolMatch?.[1]) header.authoringTool = toolMatch[1];

  // Look for IFCUNITASSIGNMENT — defer to a quick units sniff.
  const unitMatch = /IFCSIUNIT\s*\(\s*\$\s*,\s*\.LENGTHUNIT\.\s*,\s*[^,]*,\s*\.([A-Z]+)\./i.exec(text);
  if (unitMatch?.[1]) header.lengthUnit = unitMatch[1];

  return header;
}

function normalizeSchema(raw: string): IfcSchema {
  if (/IFC2X3/i.test(raw)) return 'IFC2X3';
  if (/IFC4X3/i.test(raw)) return 'IFC4X3';
  if (/IFC4/i.test(raw)) return 'IFC4';
  return 'unknown';
}

// ── Entity scan ─────────────────────────────────────────────────

interface RawEntity {
  refId: number;
  type: string;
  argsRaw: string;
}

const ENTITY_LINE_RE = /^#(\d+)\s*=\s*(IFC[A-Z0-9_]+)\s*\(([\s\S]*?)\)\s*;/gm;

function scanEntities(text: string): RawEntity[] {
  const out: RawEntity[] = [];
  let m: RegExpExecArray | null;
  while ((m = ENTITY_LINE_RE.exec(text)) !== null) {
    out.push({ refId: Number(m[1]), type: m[2]!.toUpperCase(), argsRaw: m[3] ?? '' });
  }
  return out;
}

// ── Type counts ─────────────────────────────────────────────────

function countByType(entities: RawEntity[]): IfcEntityCount[] {
  const counts = new Map<string, number>();
  for (const e of entities) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
  return [...counts.entries()].map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);
}

// ── Products ────────────────────────────────────────────────────

const PRODUCT_TYPES = new Set([
  'IFCWALL', 'IFCWALLSTANDARDCASE', 'IFCSLAB', 'IFCBEAM', 'IFCCOLUMN',
  'IFCWINDOW', 'IFCDOOR', 'IFCROOF', 'IFCRAILING', 'IFCSTAIR',
  'IFCCURTAINWALL', 'IFCSPACE', 'IFCBUILDINGELEMENTPROXY',
]);

function extractProducts(entities: RawEntity[]): IfcProduct[] {
  const products: IfcProduct[] = [];
  for (const e of entities) {
    if (!PRODUCT_TYPES.has(e.type)) continue;
    const parts = parseArgs(e.argsRaw);
    const product: IfcProduct = { refId: e.refId, type: e.type };
    // IFC products typically have: GlobalId, OwnerHistory, Name, Description, ObjectType, ...
    if (parts[0] && parts[0].startsWith("'")) product.globalId = stripQuotes(parts[0]);
    if (parts[2] && parts[2].startsWith("'")) product.name = stripQuotes(parts[2]);
    products.push(product);
  }
  return products;
}

function parseArgs(raw: string): string[] {
  // Naive comma-split that respects parentheses and quotes.
  const out: string[] = [];
  let depth = 0;
  let inQuote = false;
  let start = 0;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]!;
    if (c === "'" && raw[i - 1] !== '\\') inQuote = !inQuote;
    else if (!inQuote) {
      if (c === '(') depth++;
      else if (c === ')') depth--;
      else if (c === ',' && depth === 0) {
        out.push(raw.slice(start, i).trim());
        start = i + 1;
      }
    }
  }
  if (start < raw.length) out.push(raw.slice(start).trim());
  return out;
}

function stripQuotes(s: string): string {
  return s.replace(/^'/, '').replace(/'$/, '');
}

// ── Spatial tree (very simplified) ──────────────────────────────

const SPATIAL_TYPES = new Set([
  'IFCSITE', 'IFCBUILDING', 'IFCBUILDINGSTOREY', 'IFCSPACE',
]);

function buildSpatialTree(entities: RawEntity[]): IfcSpatialNode[] {
  // Without full IFC relationship parsing this returns a flat list
  // of spatial nodes — UI can show them as a tree if it later
  // resolves IFCRELAGGREGATES links.
  const out: IfcSpatialNode[] = [];
  for (const e of entities) {
    if (!SPATIAL_TYPES.has(e.type)) continue;
    const parts = parseArgs(e.argsRaw);
    const node: IfcSpatialNode = { type: e.type, refId: e.refId, children: [] };
    if (parts[2] && parts[2].startsWith("'")) node.name = stripQuotes(parts[2]);
    out.push(node);
  }
  return out;
}

// ── Summary helpers ─────────────────────────────────────────────

export function productsByType(report: IfcPreflightReport): Map<string, IfcProduct[]> {
  const map = new Map<string, IfcProduct[]>();
  for (const p of report.products) {
    if (!map.has(p.type)) map.set(p.type, []);
    map.get(p.type)!.push(p);
  }
  return map;
}

export interface IfcCompatibilityReport {
  /** True iff schema is one NexyFab can ingest. */
  supported: boolean;
  /** Missing units → warning. */
  unitsOk: boolean;
  /** Product count. */
  productCount: number;
  /** Recommendations. */
  recommendations: string[];
}

export function checkCompatibility(report: IfcPreflightReport): IfcCompatibilityReport {
  const recommendations: string[] = [];
  const supported = report.header.schema === 'IFC4' || report.header.schema === 'IFC4X3' || report.header.schema === 'IFC2X3';
  if (!supported) recommendations.push(`Schema ${report.header.schema} not in NexyFab\'s supported set (IFC2X3 / IFC4 / IFC4X3)`);
  const unitsOk = report.header.lengthUnit !== undefined;
  if (!unitsOk) recommendations.push('Length unit not declared — defaulting to metres');
  if (report.products.length === 0) recommendations.push('No products discovered — check that the file contains IFCWALL / IFCSLAB / etc.');
  return {
    supported,
    unitsOk,
    productCount: report.products.length,
    recommendations,
  };
}
