/**
 * stepAp242Writer.ts — Emit ISO 10303-21 STEP with AP242 semantic PMI.
 *
 * Replicad already exports basic STEP geometry. AP242 adds:
 *   - **Semantic PMI**: dimensions / tolerances / GD&T attached to
 *     specific faces / edges (not just 2D drawing annotations).
 *   - **Product structure**: assembly hierarchy with PRODUCT,
 *     PRODUCT_DEFINITION, NEXT_ASSEMBLY_USAGE_OCCURRENCE.
 *   - **Material / surface finish** attributes.
 *
 * Output is the text body of a `.stp` file. Used by NexyFab when
 * the partner workshop needs full design intent (not just
 * geometry).
 */

export interface StepEntity {
  /** STEP entity id (e.g. "#42"). */
  id: string;
  /** Type name (e.g. "CARTESIAN_POINT"). */
  type: string;
  /** Parenthesised parameter string (already formatted). */
  params: string;
}

export interface StepFileHeader {
  fileName: string;
  author: string;
  organisation: string;
  preprocessorVersion: string;
  originatingSystem: string;
  schema: 'AP203' | 'AP214' | 'AP242';
  timestamp?: string;
}

export class StepWriter {
  private entities: StepEntity[] = [];
  private counter = 0;

  /** Add an entity, returning its #id. */
  add(type: string, params: string): string {
    const id = `#${++this.counter}`;
    this.entities.push({ id, type, params });
    return id;
  }

  /** Build the full STEP text. */
  finish(header: StepFileHeader): string {
    const lines: string[] = [];
    lines.push('ISO-10303-21;');
    lines.push('HEADER;');
    lines.push(`FILE_DESCRIPTION(('NexyFab AP242 export'),'2;1');`);
    lines.push(`FILE_NAME('${header.fileName}','${header.timestamp ?? new Date().toISOString()}',('${header.author}'),('${header.organisation}'),'${header.preprocessorVersion}','${header.originatingSystem}','');`);
    lines.push(`FILE_SCHEMA(('${this.schemaUri(header.schema)}'));`);
    lines.push('ENDSEC;');
    lines.push('DATA;');
    for (const e of this.entities) {
      lines.push(`${e.id}=${e.type}${e.params};`);
    }
    lines.push('ENDSEC;');
    lines.push('END-ISO-10303-21;');
    return lines.join('\n');
  }

  private schemaUri(s: StepFileHeader['schema']): string {
    switch (s) {
      case 'AP203': return 'CONFIG_CONTROL_DESIGN';
      case 'AP214': return 'AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }';
      case 'AP242': return 'AP242_MANAGED_MODEL_BASED_3D_ENGINEERING_MIM_LF { 1 0 10303 442 1 1 4 }';
    }
  }
}

/** Emit a single CARTESIAN_POINT entity. */
export function cartesianPoint(w: StepWriter, x: number, y: number, z: number): string {
  return w.add('CARTESIAN_POINT', `('',(${x.toFixed(6)},${y.toFixed(6)},${z.toFixed(6)}))`);
}

/** Emit a DIRECTION entity. */
export function direction(w: StepWriter, x: number, y: number, z: number): string {
  return w.add('DIRECTION', `('',(${x.toFixed(6)},${y.toFixed(6)},${z.toFixed(6)}))`);
}

/** Emit a PRODUCT + PRODUCT_DEFINITION pair for the part. */
export function emitProduct(
  w: StepWriter,
  id: string,
  name: string,
  description: string,
): { productId: string; productDefinitionId: string } {
  const ctx = w.add('PRODUCT_CONTEXT', `('mechanical',#1,'mechanical')`);
  const prod = w.add('PRODUCT', `('${id}','${name}','${description}',(${ctx}))`);
  const pdf = w.add('PRODUCT_DEFINITION_FORMATION', `('','',${prod})`);
  const pdfCtx = w.add('PRODUCT_DEFINITION_CONTEXT', `('design',#1,'design')`);
  const pd = w.add('PRODUCT_DEFINITION', `('design','',${pdf},${pdfCtx})`);
  return { productId: prod, productDefinitionId: pd };
}

/** Emit a dimensional tolerance attached to a feature. */
export function emitDimensionalTolerance(
  w: StepWriter,
  featureId: string,
  toleranceMm: number,
  description: string,
): string {
  const measure = w.add('LENGTH_MEASURE', `(${toleranceMm.toFixed(6)})`);
  return w.add('DIMENSIONAL_LOCATION', `('${description}','',${featureId},${measure})`);
}

/** Emit a GD&T feature control frame (AP242 semantic PMI). */
export type GdtControl =
  | 'flatness' | 'position' | 'perpendicularity' | 'parallelism';

export function emitFeatureControlFrame(
  w: StepWriter,
  feature: string,
  control: GdtControl,
  toleranceMm: number,
  datums: string[] = [],
): string {
  const map: Record<GdtControl, string> = {
    flatness: 'FLATNESS_TOLERANCE',
    position: 'POSITIONAL_TOLERANCE',
    perpendicularity: 'PERPENDICULARITY_TOLERANCE',
    parallelism: 'PARALLELISM_TOLERANCE',
  };
  const measure = w.add('LENGTH_MEASURE_WITH_UNIT', `(${toleranceMm.toFixed(6)},#1)`);
  const datumsStr = datums.length ? `,(${datums.join(',')})` : '';
  return w.add(map[control], `('${control}','',${feature},${measure}${datumsStr})`);
}
