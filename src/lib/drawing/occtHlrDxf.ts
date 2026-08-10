/**
 * OCCT GeomTools 2D curve records -> DXF entities.
 *
 * Replicad Drawing.serialize() preserves the HLR curve records as JSON. This
 * exporter consumes those records directly. It never samples SVG paths: lines,
 * circles/arcs and B-splines remain their corresponding CAD entities. Unknown
 * GeomTools curve types throw so an incomplete drawing cannot be advertised.
 */

export type HlrLayer = 'VISIBLE' | 'HIDDEN';

interface TrimmedCurve {
  first: number | null;
  last: number | null;
  values: number[];
  source: string;
}

export interface OcctHlrDxfResult {
  dxf: string;
  curveCount: number;
  entityCounts: Record<'LINE' | 'CIRCLE' | 'ARC' | 'SPLINE', number>;
  curveTypes: number[];
}

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new Error(`OCCT HLR ${label} is non-finite`);
  return value;
}

function fmt(value: number): string {
  return Number(finite(value, 'coordinate').toFixed(12)).toString();
}

function group(code: number, value: string | number): string {
  return `${code}\n${typeof value === 'number' ? fmt(value) : value}\n`;
}

/** Extract every serialized curve string from Blueprint/Blueprints JSON. */
export function occtHlrCurveRecords(serialized: string): string[] {
  if (!serialized.trim()) return [];
  let root: unknown;
  try {
    root = JSON.parse(serialized) as unknown;
  } catch {
    throw new Error('OCCT HLR serialized drawing is not valid JSON');
  }
  const records: string[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const object = value as Record<string, unknown>;
    if (Array.isArray(object.curves)) {
      for (const curve of object.curves) {
        if (typeof curve !== 'string' || !curve.trim()) throw new Error('OCCT HLR curve record is empty or non-text');
        records.push(curve);
      }
    }
    for (const [key, child] of Object.entries(object)) {
      if (key !== 'curves') visit(child);
    }
  };
  visit(root);
  return records;
}

function parseRecord(source: string): TrimmedCurve {
  const lines = source.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines.length === 0) throw new Error('OCCT HLR curve record is empty');
  let first: number | null = null;
  let last: number | null = null;
  if (/^8(?:\s|$)/.test(lines[0]!)) {
    const trim = lines.shift()!.split(/\s+/).map(Number);
    if (trim.length !== 3 || trim[0] !== 8) throw new Error('invalid OCCT trimmed-curve header');
    first = finite(trim[1]!, 'trim start');
    last = finite(trim[2]!, 'trim end');
  }
  const values = lines.join(' ').split(/\s+/).filter(Boolean).map(Number);
  if (values.length === 0 || values.some(value => !Number.isFinite(value))) {
    throw new Error('invalid OCCT HLR curve numeric payload');
  }
  return { first, last, values, source };
}

function lineEntity(curve: TrimmedCurve, layer: HlrLayer): string {
  const [, x, y, dx, dy, ...rest] = curve.values;
  if ([x, y, dx, dy].some(value => value === undefined) || rest.length > 0 || curve.first === null || curve.last === null) {
    throw new Error('unsupported or untrimmed OCCT line record');
  }
  const x1 = x! + dx! * curve.first;
  const y1 = y! + dy! * curve.first;
  const x2 = x! + dx! * curve.last;
  const y2 = y! + dy! * curve.last;
  return group(0, 'LINE') + group(8, layer)
    + group(10, x1) + group(20, y1) + group(30, 0)
    + group(11, x2) + group(21, y2) + group(31, 0);
}

function normalizedDegrees(value: number): number {
  const degrees = value * 180 / Math.PI;
  return ((degrees % 360) + 360) % 360;
}

function circleEntity(curve: TrimmedCurve, layer: HlrLayer): { entity: string; kind: 'CIRCLE' | 'ARC' } {
  const [, cx, cy, xx, xy, yx, yy, radius, ...rest] = curve.values;
  if ([cx, cy, xx, xy, yx, yy, radius].some(value => value === undefined) || rest.length > 0 || curve.first === null || curve.last === null || !(radius! > 0)) {
    throw new Error('unsupported OCCT circle record');
  }
  const span = Math.abs(curve.last - curve.first);
  const base = group(8, layer) + group(10, cx!) + group(20, cy!) + group(30, 0) + group(40, radius!);
  if (Math.abs(span - Math.PI * 2) <= 1e-9 || span > Math.PI * 2) {
    return { kind: 'CIRCLE', entity: group(0, 'CIRCLE') + base };
  }
  const angleAt = (parameter: number) => {
    const px = xx! * Math.cos(parameter) + yx! * Math.sin(parameter);
    const py = xy! * Math.cos(parameter) + yy! * Math.sin(parameter);
    return normalizedDegrees(Math.atan2(py, px));
  };
  const determinant = xx! * yy! - xy! * yx!;
  const start = determinant >= 0 ? angleAt(curve.first) : angleAt(curve.last);
  const end = determinant >= 0 ? angleAt(curve.last) : angleAt(curve.first);
  return { kind: 'ARC', entity: group(0, 'ARC') + base + group(50, start) + group(51, end) };
}

function bsplineEntity(curve: TrimmedCurve, layer: HlrLayer): string {
  if (curve.first !== null || curve.last !== null) throw new Error('trimmed OCCT B-spline export is not supported');
  const values = curve.values;
  if (values.length < 6 || values[0] !== 7) throw new Error('invalid OCCT B-spline record');
  const rational = values[1]!;
  const periodic = values[2]!;
  const degree = values[3]!;
  const poleCount = values[4]!;
  const distinctKnotCount = values[5]!;
  if (![rational, periodic].every(value => value === 0 || value === 1)
    || !Number.isInteger(degree) || degree < 1
    || !Number.isInteger(poleCount) || poleCount < degree + 1
    || !Number.isInteger(distinctKnotCount) || distinctKnotCount < 2) {
    throw new Error('invalid OCCT B-spline header');
  }
  let offset = 6;
  const poles: Array<[number, number]> = [];
  for (let index = 0; index < poleCount; index += 1) {
    if (offset + 1 >= values.length) throw new Error('truncated OCCT B-spline poles');
    poles.push([values[offset]!, values[offset + 1]!]);
    offset += 2;
  }
  const weights: number[] = [];
  if (rational === 1) {
    for (let index = 0; index < poleCount; index += 1) {
      const weight = values[offset++];
      if (weight === undefined || !(weight > 0)) throw new Error('invalid OCCT B-spline weight');
      weights.push(weight);
    }
  }
  const knots: number[] = [];
  for (let index = 0; index < distinctKnotCount; index += 1) {
    const knot = values[offset++];
    const multiplicity = values[offset++];
    if (knot === undefined || !Number.isInteger(multiplicity) || multiplicity! < 1) {
      throw new Error('invalid OCCT B-spline knot/multiplicity');
    }
    for (let repeat = 0; repeat < multiplicity!; repeat += 1) knots.push(knot);
  }
  if (offset !== values.length) throw new Error('unsupported trailing OCCT B-spline data');
  if (knots.length !== poleCount + degree + 1) {
    throw new Error(`OCCT B-spline knot cardinality ${knots.length} != poles ${poleCount} + degree ${degree} + 1`);
  }
  const flags = 8 | (periodic === 1 ? 2 : 0) | (rational === 1 ? 4 : 0);
  let entity = group(0, 'SPLINE') + group(8, layer)
    + group(70, flags) + group(71, degree) + group(72, knots.length)
    + group(73, poleCount) + group(74, 0)
    + group(210, 0) + group(220, 0) + group(230, 1);
  for (const knot of knots) entity += group(40, knot);
  for (const weight of weights) entity += group(41, weight);
  for (const [x, y] of poles) entity += group(10, x) + group(20, y) + group(30, 0);
  return entity;
}

function layerTable(): string {
  return group(0, 'SECTION') + group(2, 'TABLES')
    + group(0, 'TABLE') + group(2, 'LTYPE') + group(70, 2)
    + group(0, 'LTYPE') + group(2, 'CONTINUOUS') + group(70, 0) + group(3, 'Solid line') + group(72, 65) + group(73, 0) + group(40, 0)
    + group(0, 'LTYPE') + group(2, 'DASHED') + group(70, 0) + group(3, 'Hidden __ __') + group(72, 65) + group(73, 2) + group(40, 3) + group(49, 2) + group(49, -1)
    + group(0, 'ENDTAB')
    + group(0, 'TABLE') + group(2, 'LAYER') + group(70, 2)
    + group(0, 'LAYER') + group(2, 'VISIBLE') + group(70, 0) + group(62, 7) + group(6, 'CONTINUOUS')
    + group(0, 'LAYER') + group(2, 'HIDDEN') + group(70, 0) + group(62, 8) + group(6, 'DASHED')
    + group(0, 'ENDTAB') + group(0, 'ENDSEC');
}

export function occtHlrSerializedToDxf(visibleSerialized: string, hiddenSerialized: string): OcctHlrDxfResult {
  const records: Array<{ source: string; layer: HlrLayer }> = [
    ...occtHlrCurveRecords(visibleSerialized).map(source => ({ source, layer: 'VISIBLE' as const })),
    ...occtHlrCurveRecords(hiddenSerialized).map(source => ({ source, layer: 'HIDDEN' as const })),
  ];
  if (records.length === 0) throw new Error('OCCT HLR drawing has no curve records');
  const entityCounts = { LINE: 0, CIRCLE: 0, ARC: 0, SPLINE: 0 };
  const curveTypes = new Set<number>();
  let entities = '';
  for (const record of records) {
    const curve = parseRecord(record.source);
    const type = curve.values[0]!;
    curveTypes.add(type);
    if (type === 1) {
      entities += lineEntity(curve, record.layer);
      entityCounts.LINE += 1;
    } else if (type === 2) {
      const circle = circleEntity(curve, record.layer);
      entities += circle.entity;
      entityCounts[circle.kind] += 1;
    } else if (type === 7) {
      entities += bsplineEntity(curve, record.layer);
      entityCounts.SPLINE += 1;
    } else {
      throw new Error(`unsupported OCCT HLR GeomTools curve type ${type}`);
    }
  }
  const header = group(0, 'SECTION') + group(2, 'HEADER')
    + group(9, '$ACADVER') + group(1, 'AC1027')
    + group(9, '$INSUNITS') + group(70, 4)
    + group(0, 'ENDSEC');
  const dxf = header + layerTable() + group(0, 'SECTION') + group(2, 'ENTITIES')
    + entities + group(0, 'ENDSEC') + group(0, 'EOF');
  return { dxf, curveCount: records.length, entityCounts, curveTypes: [...curveTypes].sort((a, b) => a - b) };
}
