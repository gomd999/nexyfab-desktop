/**
 * Z5 — STEP AP242 PMI (Product Manufacturing Information) export.
 *
 * The agent produces STEP via brep_export_step (geometry only). For real
 * manufacturing handoff (MBD — Model-Based Definition) the file also
 * needs PMI annotations: GD&T frames, datum targets, surface finishes,
 * basic/reference dimensions, all linked to specific faces.
 *
 * AP242 spec (ISO 10303-242:2014/2020) extends AP203/AP214 with
 * `dimensional_characteristic_representation`, `geometric_tolerance`, and
 * `annotation_*` entities. We don't write a full AP242 schema (that's a
 * 200-page integration job) — instead we generate a compact AP242-ish
 * supplement: a separate companion file that downstream MBD-aware viewers
 * (Inspector, Tetra4D, KeyShot) can ingest as PMI metadata.
 *
 * This is a real interoperability path: many shops accept "STEP + PMI
 * companion" pairs in lieu of full AP242 because most viewers either:
 *   (a) understand the AP242 entities natively, or
 *   (b) accept the companion JSON via their MBD plugin.
 */

import type { GdtFrame, DatumTarget, SurfaceFinish, AnnotatedDimension } from './types';

export interface PmiExportInput {
  partName: string;
  gdtFrames: GdtFrame[];
  datumTargets: DatumTarget[];
  surfaceFinishes: SurfaceFinish[];
  annotatedDimensions: AnnotatedDimension[];
  /** Optional: handle of the parent B-rep this PMI refers to. */
  brepHandle?: string;
}

export interface PmiExportResult {
  /** Companion JSON in a deterministic schema for MBD viewers. */
  companionJson: string;
  /** Optional AP242-flavored STEP supplement (annotation_plane + GT entities). */
  stepSupplement: string;
  byteCounts: { json: number; step: number };
}

const PMI_SCHEMA_VERSION = '1.0';

export function exportPmi(input: PmiExportInput): PmiExportResult {
  const companionJson = JSON.stringify(
    {
      schema: 'NexyFab.PMI',
      version: PMI_SCHEMA_VERSION,
      part: input.partName,
      brepHandle: input.brepHandle ?? null,
      generatedAt: new Date().toISOString(),
      counts: {
        gdtFrames: input.gdtFrames.length,
        datumTargets: input.datumTargets.length,
        surfaceFinishes: input.surfaceFinishes.length,
        annotatedDimensions: input.annotatedDimensions.length,
      },
      gdtFrames: input.gdtFrames,
      datumTargets: input.datumTargets,
      surfaceFinishes: input.surfaceFinishes,
      annotatedDimensions: input.annotatedDimensions,
    },
    null,
    2,
  );

  const stepSupplement = renderStepAp242Supplement(input);

  return {
    companionJson,
    stepSupplement,
    byteCounts: {
      json: Buffer.byteLength(companionJson, 'utf8'),
      step: Buffer.byteLength(stepSupplement, 'utf8'),
    },
  };
}

/**
 * Render an AP242-flavored STEP supplement. This is NOT a full AP242
 * file — it's an annotation-only supplement intended to be appended to
 * the geometry STEP via tools like ProSTEP's PMI Profile or Tetra4D
 * Converter. Real industrial MBD pipelines would replace this with a
 * proper schema-validated AP242 export, but for our purposes (carrying
 * PMI through downstream tooling that accepts the supplement format)
 * this is enough.
 */
function renderStepAp242Supplement(input: PmiExportInput): string {
  const lines: string[] = [];
  lines.push('ISO-10303-21;');
  lines.push('HEADER;');
  lines.push(`FILE_DESCRIPTION(('NexyFab PMI supplement for ${esc(input.partName)}'),'2;1');`);
  lines.push(`FILE_NAME('${esc(input.partName)}.pmi.stp','${new Date().toISOString()}',('NexyFab Agent'),('NexyFab'),'NexyFab AP242 PMI ${PMI_SCHEMA_VERSION}','','');`);
  lines.push("FILE_SCHEMA(('AP242_MANAGED_MODEL_BASED_3D_ENGINEERING_MIM_LF'));");
  lines.push('ENDSEC;');
  lines.push('DATA;');

  let id = 1;
  const ref = () => `#${id++}`;

  // Annotation plane is shared across PMI entries.
  const planeId = ref();
  lines.push(`${planeId} = ANNOTATION_PLANE('PMI_PLANE', AXIS2_PLACEMENT_3D('', CARTESIAN_POINT('',(0.,0.,0.)), DIRECTION('',(0.,0.,1.)), DIRECTION('',(1.,0.,0.))));`);

  for (const f of input.gdtFrames) {
    const frameId = ref();
    const symStep = stepSymbolFor(f.symbol);
    const dia = f.diameter ? '⌀' : '';
    const mod = f.modifier ? ` (${f.modifier})` : '';
    const datums = f.datums?.length ? ' | ' + f.datums.map(d => `${d.letter}${d.modifier ? `(${d.modifier})` : ''}`).join(' | ') : '';
    lines.push(`${frameId} = GEOMETRIC_TOLERANCE_WITH_DEFINED_AREA_UNIT('${f.id}', '${esc(f.featureRef)}: ${symStep} ${dia}${f.tolerance}${mod}${datums}', $);`);
  }

  for (const t of input.datumTargets) {
    const tId = ref();
    lines.push(`${tId} = DATUM_TARGET('${t.letter}${t.index}', '${t.type}', CARTESIAN_POINT('',(${t.location.join(',')})));`);
  }

  for (const sf of input.surfaceFinishes) {
    const sId = ref();
    const range = sf.roughnessRaUm.lower !== undefined
      ? `Ra ${sf.roughnessRaUm.lower}-${sf.roughnessRaUm.upper}`
      : `Ra ${sf.roughnessRaUm.upper}`;
    lines.push(`${sId} = SURFACE_TEXTURE('${sf.id}', '${esc(sf.featureRef)}: ${range} μm${sf.lay ? ', lay=' + sf.lay : ''}');`);
  }

  for (const d of input.annotatedDimensions) {
    const dId = ref();
    const tol = d.tolerance ? ` +${d.tolerance.plus}/-${d.tolerance.minus}` : '';
    lines.push(`${dId} = DIMENSIONAL_CHARACTERISTIC_REPRESENTATION('${d.id}', '${esc(d.featureRef)}: ${d.kind} ${d.valueMm}${tol}');`);
  }

  lines.push('ENDSEC;');
  lines.push('END-ISO-10303-21;');
  return lines.join('\n');
}

function esc(s: string): string {
  // STEP strings escape ' as ''; keep it simple.
  return s.replace(/'/g, "''");
}

function stepSymbolFor(sym: string): string {
  // Plain-ASCII rendering of the GD&T symbols for the supplement file
  // (Unicode glyphs like ⌖ aren't safe in all STEP parsers).
  return ({
    position: 'POSITION',
    flatness: 'FLATNESS',
    perpendicularity: 'PERPENDICULARITY',
    parallelism: 'PARALLELISM',
    circularity: 'CIRCULARITY',
    cylindricity: 'CYLINDRICITY',
    surface_profile: 'SURFACE_PROFILE',
    concentricity: 'CONCENTRICITY',
    symmetry: 'SYMMETRY',
    angularity: 'ANGULARITY',
  } as Record<string, string>)[sym] ?? sym.toUpperCase();
}
