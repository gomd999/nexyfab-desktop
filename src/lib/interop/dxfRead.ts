/**
 * dxfRead — Phase 5.3 of NexyFab Pro own-CAD (ADR-013).
 *
 * Minimal DXF (ASCII) parser. Pairs with dxfExport.ts (the writer) so
 * NexyFab can roundtrip its own DXF output and read DXF files from other
 * CAD tools (within the limited subset we support).
 *
 * Scope (Phase 5.3 minimal):
 *   - Parses HEADER + ENTITIES sections.
 *   - Entity kinds: LINE, CIRCLE, TEXT, POINT, LWPOLYLINE.
 *   - Skips unsupported entities (POLYLINE, INSERT, ELLIPSE, SPLINE, etc.)
 *     while keeping the parser robust — those become DxfUnknownEntity.
 *   - Layer attribute extracted.
 *   - Group codes parsed into typed slots (10/20/30 = x/y/z; 11/21/31 =
 *     second point for lines).
 *
 * Out of scope (Phase 5.3.2+):
 *   - BLOCKS / INSERT (block reference resolution)
 *   - DIMENSION entities (dimension type families)
 *   - HATCH (multi-loop fill pattern)
 *   - Z dimensions on LWPOLYLINE bulge arcs
 *   - DXF R2000+ class-based entities
 */

// ─── entity types ─────────────────────────────────────────────────────────

export interface DxfLineEntity {
  kind: 'LINE';
  layer: string;
  x1: number; y1: number; z1: number;
  x2: number; y2: number; z2: number;
}

export interface DxfCircleEntity {
  kind: 'CIRCLE';
  layer: string;
  x: number; y: number; z: number;
  radius: number;
}

export interface DxfTextEntity {
  kind: 'TEXT';
  layer: string;
  x: number; y: number; z: number;
  height: number;
  text: string;
}

export interface DxfPointEntity {
  kind: 'POINT';
  layer: string;
  x: number; y: number; z: number;
}

export interface DxfLwPolylineEntity {
  kind: 'LWPOLYLINE';
  layer: string;
  vertices: ReadonlyArray<{ x: number; y: number }>;
  closed: boolean;
}

export interface DxfUnknownEntity {
  kind: 'UNKNOWN';
  type: string;
  layer: string;
}

export type DxfEntity =
  | DxfLineEntity
  | DxfCircleEntity
  | DxfTextEntity
  | DxfPointEntity
  | DxfLwPolylineEntity
  | DxfUnknownEntity;

export interface ParsedDxf {
  entities: ReadonlyArray<DxfEntity>;
  /** Variables from the HEADER section we recognize. */
  header: {
    extMin?: { x: number; y: number; z: number };
    extMax?: { x: number; y: number; z: number };
  };
  /** Layer names encountered across entities. */
  layers: ReadonlyArray<string>;
}

export class DxfReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DxfReadError';
  }
}

// ─── pair stream ─────────────────────────────────────────────────────────

interface DxfPair { code: number; value: string }

function parsePairs(input: string): DxfPair[] {
  const lines = input.split(/\r?\n/);
  const pairs: DxfPair[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const codeStr = lines[i]!.trim();
    if (codeStr === '') {
      // Skip stray blank lines — shouldn't appear in well-formed DXF but
      // some writers leave them.
      i -= 1; // re-align: blank line means we need to advance by 1 not 2
      continue;
    }
    const code = Number(codeStr);
    if (!Number.isInteger(code)) {
      throw new DxfReadError(`malformed group code at line ${i + 1}: '${codeStr}'`);
    }
    pairs.push({ code, value: lines[i + 1]! });
  }
  return pairs;
}

// ─── main parser ─────────────────────────────────────────────────────────

export function parseDxf(input: string): ParsedDxf {
  const pairs = parsePairs(input);
  const entities: DxfEntity[] = [];
  const layerSet = new Set<string>();
  const header: ParsedDxf['header'] = {};
  let i = 0;
  let inEntities = false;

  while (i < pairs.length) {
    const p = pairs[i]!;
    // Section boundaries.
    if (p.code === 0 && p.value === 'SECTION') {
      const next = pairs[i + 1];
      if (next?.code === 2) {
        inEntities = next.value === 'ENTITIES';
        if (next.value === 'HEADER') {
          i = parseHeader(pairs, i + 2, header);
          continue;
        }
      }
      i += 2;
      continue;
    }
    if (p.code === 0 && p.value === 'ENDSEC') {
      inEntities = false;
      i += 1;
      continue;
    }
    if (p.code === 0 && p.value === 'EOF') break;

    if (inEntities && p.code === 0) {
      const { entity, nextIndex } = parseEntity(pairs, i);
      if (entity) {
        entities.push(entity);
        layerSet.add(entity.layer);
      }
      i = nextIndex;
      continue;
    }

    i += 1;
  }

  return { entities, header, layers: [...layerSet] };
}

function parseHeader(pairs: DxfPair[], start: number, header: ParsedDxf['header']): number {
  let i = start;
  while (i < pairs.length) {
    const p = pairs[i]!;
    if (p.code === 0 && p.value === 'ENDSEC') return i + 1;
    if (p.code === 9) {
      // Variable name; following group codes are its value.
      const varName = p.value;
      if (varName === '$EXTMIN' || varName === '$EXTMAX') {
        let x = 0, y = 0, z = 0;
        let j = i + 1;
        while (j < pairs.length && pairs[j]!.code !== 9 && !(pairs[j]!.code === 0 && pairs[j]!.value === 'ENDSEC')) {
          const q = pairs[j]!;
          if (q.code === 10) x = Number(q.value);
          else if (q.code === 20) y = Number(q.value);
          else if (q.code === 30) z = Number(q.value);
          j += 1;
        }
        if (varName === '$EXTMIN') header.extMin = { x, y, z };
        else header.extMax = { x, y, z };
        i = j;
        continue;
      }
    }
    i += 1;
  }
  return i;
}

function parseEntity(pairs: DxfPair[], start: number): { entity: DxfEntity | null; nextIndex: number } {
  const typePair = pairs[start]!;
  const type = typePair.value;
  // Collect group codes until next code-0 (entity boundary).
  const fields = new Map<number, string[]>();
  let i = start + 1;
  while (i < pairs.length && pairs[i]!.code !== 0) {
    const p = pairs[i]!;
    if (!fields.has(p.code)) fields.set(p.code, []);
    fields.get(p.code)!.push(p.value);
    i += 1;
  }
  const layer = fields.get(8)?.[0] ?? '0';
  if (type === 'LINE') {
    return {
      entity: {
        kind: 'LINE',
        layer,
        x1: numField(fields, 10, 0), y1: numField(fields, 20, 0), z1: numField(fields, 30, 0),
        x2: numField(fields, 11, 0), y2: numField(fields, 21, 0), z2: numField(fields, 31, 0),
      },
      nextIndex: i,
    };
  }
  if (type === 'CIRCLE') {
    return {
      entity: {
        kind: 'CIRCLE',
        layer,
        x: numField(fields, 10, 0), y: numField(fields, 20, 0), z: numField(fields, 30, 0),
        radius: numField(fields, 40, 0),
      },
      nextIndex: i,
    };
  }
  if (type === 'TEXT') {
    return {
      entity: {
        kind: 'TEXT',
        layer,
        x: numField(fields, 10, 0), y: numField(fields, 20, 0), z: numField(fields, 30, 0),
        height: numField(fields, 40, 1),
        text: fields.get(1)?.[0] ?? '',
      },
      nextIndex: i,
    };
  }
  if (type === 'POINT') {
    return {
      entity: {
        kind: 'POINT',
        layer,
        x: numField(fields, 10, 0), y: numField(fields, 20, 0), z: numField(fields, 30, 0),
      },
      nextIndex: i,
    };
  }
  if (type === 'LWPOLYLINE') {
    const xs = (fields.get(10) ?? []).map(Number);
    const ys = (fields.get(20) ?? []).map(Number);
    const flag = numField(fields, 70, 0);
    const closed = (flag & 1) === 1;
    const len = Math.min(xs.length, ys.length);
    const vertices: { x: number; y: number }[] = [];
    for (let k = 0; k < len; k++) vertices.push({ x: xs[k]!, y: ys[k]! });
    return { entity: { kind: 'LWPOLYLINE', layer, vertices, closed }, nextIndex: i };
  }
  // Unknown entity — preserve for round-trip awareness.
  return { entity: { kind: 'UNKNOWN', type, layer }, nextIndex: i };
}

function numField(fields: Map<number, string[]>, code: number, dflt: number): number {
  const v = fields.get(code)?.[0];
  if (v === undefined) return dflt;
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
}
