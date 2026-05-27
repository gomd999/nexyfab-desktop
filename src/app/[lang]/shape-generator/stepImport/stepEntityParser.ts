/**
 * stepEntityParser.ts — STEP file entity discovery + classification.
 *
 * ISO 10303 (STEP) files are line-oriented EXPRESS instances; each
 * entity occupies one or more `#N=ENTITY_NAME(args);` records. NexyFab
 * doesn't ship a full STEP parser (that's what replicad / OCCT does)
 * — this module does the lightweight discovery pass needed to:
 *
 *   1. Detect schema version (AP203 / AP214 / AP242).
 *   2. Count + index the structural entity types we care about
 *      (PRODUCT, MANIFOLD_SOLID_BREP, ADVANCED_FACE, EDGE_CURVE,
 *      AXIS2_PLACEMENT_3D, ...).
 *   3. Extract HEADER section metadata (file name, author, units).
 *
 * Why a separate lightweight pass? When the user uploads a STEP we
 * want a fast pre-flight check ("this is an AP242 assembly with
 * 1,234 faces, 56 solids, units = mm") before paying the cost of
 * the full OCCT bridge. It's also useful for cron-side validation
 * — we can reject malformed files at the entry point without spinning
 * the OCCT WASM worker.
 *
 * Implementation choice: regex-based scan. Trade-off: not a real
 * parser (can't resolve references, evaluate expressions), but runs
 * at ~100 MB/s and is sufficient for the discovery pass.
 */

export type StepSchema = 'AP203' | 'AP214' | 'AP242' | 'unknown';

export interface StepHeader {
  /** Original file name as declared in the FILE_NAME entity. */
  fileName: string;
  /** Author list from FILE_NAME. */
  author: string[];
  /** Organisation list from FILE_NAME. */
  organisation: string[];
  /** Preprocessor / authoring tool. */
  preprocessor: string;
  /** Time stamp string as recorded — ISO format usually but not guaranteed. */
  timestamp: string;
  /** Schema identifier from FILE_SCHEMA. */
  schemaName: string;
  /** Best-effort classification of the schema. */
  schema: StepSchema;
}

export interface EntityCounts {
  /** Total entity instances. */
  total: number;
  /** Map of entity name → count. */
  byType: Record<string, number>;
  /** Specific counters surfaced for the import UI. */
  products: number;
  solids: number;
  faces: number;
  edges: number;
  axisPlacements: number;
  assemblies: number;
}

export interface StepDiscovery {
  header: StepHeader;
  entities: EntityCounts;
  /** Detected unit (millimetre / inch / metre / etc.). */
  unitsHint: 'mm' | 'inch' | 'm' | 'cm' | 'unknown';
  /** True when at least one MANIFOLD_SOLID_BREP exists — minimum
   *  requirement for a 3-D import. */
  hasSolidGeometry: boolean;
  /** True when NEXT_ASSEMBLY_USAGE_OCCURRENCE entities are present —
   *  indicates a multi-part assembly. */
  isAssembly: boolean;
}

/** Extract the HEADER block (between `HEADER;` and `ENDSEC;`).
 *  Returns the empty string when not found — caller should treat as
 *  parse failure. */
function extractHeader(source: string): string {
  const m = source.match(/HEADER;([\s\S]*?)ENDSEC;/i);
  return m ? m[1] : '';
}

/** Parse a comma-separated argument list with quoted strings respected. */
function splitArgs(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let inQuote = false;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "'" && (i === 0 || s[i - 1] !== '\\')) inQuote = !inQuote;
    else if (!inQuote) {
      if (c === '(') depth++;
      else if (c === ')') depth--;
      else if (c === ',' && depth === 0) {
        out.push(s.slice(start, i).trim());
        start = i + 1;
      }
    }
  }
  out.push(s.slice(start).trim());
  return out;
}

/** Pull the string arguments out of a header entity call like
 *  `FILE_NAME('foo.step', '2026-05-18T...', ('Alice'), ('Acme'), ...);`. */
function parseStringList(arg: string): string[] {
  // Strip leading paren / trailing paren if present.
  const inner = arg.trim().replace(/^\(/, '').replace(/\)$/, '');
  if (!inner.trim()) return [];
  const parts = splitArgs(inner);
  return parts
    .map(p => p.trim().replace(/^'/, '').replace(/'$/, ''))
    .filter(Boolean);
}

function parseSingleString(arg: string): string {
  const t = arg.trim();
  if (t.startsWith("'") && t.endsWith("'")) return t.slice(1, -1);
  return t;
}

function detectSchema(schemaArg: string): StepSchema {
  const s = schemaArg.toUpperCase();
  if (s.includes('AP242')) return 'AP242';
  if (s.includes('AP214') || s.includes('AUTOMOTIVE_DESIGN')) return 'AP214';
  if (s.includes('AP203') || s.includes('CONFIG_CONTROL_DESIGN')) return 'AP203';
  return 'unknown';
}

function parseHeader(source: string): StepHeader {
  const head = extractHeader(source);
  const empty: StepHeader = {
    fileName: '', author: [], organisation: [],
    preprocessor: '', timestamp: '',
    schemaName: '', schema: 'unknown',
  };
  if (!head) return empty;

  // FILE_NAME('name', 'timestamp', ('Author1'), ('Org1'), ...)
  const fnMatch = head.match(/FILE_NAME\s*\(([\s\S]*?)\);/i);
  if (fnMatch) {
    const args = splitArgs(fnMatch[1]);
    empty.fileName = args[0] ? parseSingleString(args[0]) : '';
    empty.timestamp = args[1] ? parseSingleString(args[1]) : '';
    if (args[2]) empty.author = parseStringList(args[2]);
    if (args[3]) empty.organisation = parseStringList(args[3]);
    if (args[4]) empty.preprocessor = parseSingleString(args[4]);
  }
  // FILE_SCHEMA(('AUTOMOTIVE_DESIGN'))
  const fsMatch = head.match(/FILE_SCHEMA\s*\(([\s\S]*?)\);/i);
  if (fsMatch) {
    const list = parseStringList(fsMatch[1]);
    empty.schemaName = list[0] ?? '';
    empty.schema = detectSchema(empty.schemaName);
  }
  return empty;
}

/** Detect the working unit by scanning for SI_UNIT / NAMED_UNIT
 *  instances. Heuristic — STEP's unit system is layered (LENGTH_UNIT
 *  / SI_UNIT / CONVERSION_BASED_UNIT) so we look for keywords. */
function detectUnits(source: string): StepDiscovery['unitsHint'] {
  // Strip everything before DATA; to skip false matches in HEADER.
  const dataIdx = source.toUpperCase().indexOf('DATA;');
  const body = dataIdx >= 0 ? source.slice(dataIdx) : source;
  if (/SI_UNIT\s*\(\s*\.MILLI\./i.test(body)) return 'mm';
  if (/CONVERSION_BASED_UNIT\s*\(\s*['"]INCH['"]/i.test(body)) return 'inch';
  if (/SI_UNIT\s*\(\s*\.CENTI\./i.test(body)) return 'cm';
  // SI_UNIT($, .METRE.) → metre
  if (/SI_UNIT\s*\([^)]*\.METRE\./i.test(body) && !/MILLI|CENTI/i.test(body)) return 'm';
  return 'unknown';
}

/** Count entity instances by name. Linear scan over `DATA;`. */
function countEntities(source: string): EntityCounts {
  const dataIdx = source.toUpperCase().indexOf('DATA;');
  const body = dataIdx >= 0 ? source.slice(dataIdx) : source;
  const byType: Record<string, number> = {};
  const re = /#\d+\s*=\s*([A-Z_][A-Z0-9_]*)\s*\(/gi;
  let m: RegExpExecArray | null;
  let total = 0;
  while ((m = re.exec(body)) !== null) {
    const name = m[1].toUpperCase();
    byType[name] = (byType[name] ?? 0) + 1;
    total++;
  }
  return {
    total,
    byType,
    products: byType['PRODUCT'] ?? 0,
    solids: byType['MANIFOLD_SOLID_BREP'] ?? 0,
    faces: (byType['ADVANCED_FACE'] ?? 0) + (byType['FACE_SURFACE'] ?? 0),
    edges: (byType['EDGE_CURVE'] ?? 0) + (byType['ORIENTED_EDGE'] ?? 0),
    axisPlacements: byType['AXIS2_PLACEMENT_3D'] ?? 0,
    assemblies: byType['NEXT_ASSEMBLY_USAGE_OCCURRENCE'] ?? 0,
  };
}

/** Top-level discovery scan. Returns a structured report the import
 *  panel can show to the user before committing to the full OCCT
 *  load. */
export function discoverStep(source: string): StepDiscovery {
  const header = parseHeader(source);
  const entities = countEntities(source);
  return {
    header,
    entities,
    unitsHint: detectUnits(source),
    hasSolidGeometry: entities.solids > 0,
    isAssembly: entities.assemblies > 0,
  };
}
