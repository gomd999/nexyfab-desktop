import * as THREE from 'three';
import { remapAp214NxCubeToBox } from '@/lib/cad/remapAp214NxCubeToBox';

/**
 * Exports geometry as STEP AP242 with tessellated representation.
 * Uses `COORDINATES_LIST` (npoints + inline `LIST [3:3] OF REAL`) and
 * `TRIANGULATED_FACE` per AP242 — OCCT `ReadStepFile` / occt-import-js 호환.
 *
 * Much smaller than per-triangle ADVANCED_FACE approach:
 * - Old style: ~17 STEP entities per triangle → 1.7M lines for 100k triangles
 * - Here: one `COORDINATES_LIST` + one `TRIANGULATED_FACE` + wrapper entities
 */
export async function exportToStepAsync(
  geometry: THREE.BufferGeometry,
  partName = 'NexyFab_Part',
): Promise<string> {
  const handle = geometry.userData?.occtHandle as string | undefined;
  if (handle) {
    try {
      const { exportOcctStep } = await import('../features/occtEngine');
      const stepText = await exportOcctStep(handle);
      if (stepText) return stepText;
    } catch (err) {
      console.warn('Failed to export real B-Rep STEP, falling back to tessellated:', err);
    }
  }
  return exportToStep(geometry, partName);
}

export function exportToStep(
  geometry: THREE.BufferGeometry,
  partName = 'NexyFab_Part',
): string {
  if (geometry instanceof THREE.BoxGeometry) {
    const { width, height, depth } = geometry.parameters;
    return remapAp214NxCubeToBox(width, height, depth, partName);
  }

  const geo = geometry.toNonIndexed();
  geo.computeVertexNormals();

  const positions = geo.getAttribute('position') as THREE.BufferAttribute;
  const vertCount = positions.count;
  const triCount = vertCount / 3;

  const timestamp = new Date().toISOString().slice(0, 19);
  const lines: string[] = [];
  const fmt = (n: number) => n.toFixed(6);

  // ── Header ─────────────────────────────────────────────────────────────
  lines.push('ISO-10303-21;');
  lines.push('HEADER;');
  lines.push(`FILE_DESCRIPTION(('NexyFab Tessellated STEP - ${partName}'),'2;1');`);
  lines.push(`FILE_NAME('${partName}.step','${timestamp}',('NexyFab'),('nexyfab.com'),'NexyFab Web CAD 1.0','','');`);
  lines.push("FILE_SCHEMA(('AP242_MANAGED_MODEL_BASED_3D_ENGINEERING_MIM_LF { 1 0 10303 442 1 1 4 }'));");
  lines.push('ENDSEC;');
  lines.push('DATA;');

  let id = 1;

  // ── Application context ────────────────────────────────────────────────
  const appCtxId = id++;
  lines.push(`#${appCtxId}=APPLICATION_CONTEXT('core data for automotive mechanical design processes');`);
  const appProtoId = id++;
  lines.push(`#${appProtoId}=APPLICATION_PROTOCOL_DEFINITION('international standard','ap242_managed_model_based_3d_engineering',2011,#${appCtxId});`);

  // ── Product structure ──────────────────────────────────────────────────
  const prodCtxId = id++;
  lines.push(`#${prodCtxId}=PRODUCT_CONTEXT('',#${appCtxId},'mechanical');`);
  const prodId = id++;
  lines.push(`#${prodId}=PRODUCT('${partName}','${partName}','',(#${prodCtxId}));`);
  const prodDefCtxId = id++;
  lines.push(`#${prodDefCtxId}=PRODUCT_DEFINITION_CONTEXT('part definition',#${appCtxId},'design');`);
  const prodFormId = id++;
  lines.push(`#${prodFormId}=PRODUCT_DEFINITION_FORMATION('','',#${prodId});`);
  const prodDefId = id++;
  lines.push(`#${prodDefId}=PRODUCT_DEFINITION('design','',#${prodFormId},#${prodDefCtxId});`);

  // ── Units ──────────────────────────────────────────────────────────────
  const lenUnitId = id++;
  lines.push(`#${lenUnitId}=(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.));`);
  const angUnitId = id++;
  lines.push(`#${angUnitId}=(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.));`);
  const solidAngId = id++;
  lines.push(`#${solidAngId}=(NAMED_UNIT(*)SI_UNIT($,.STERADIAN.)SOLID_ANGLE_UNIT());`);
  const uncertId = id++;
  lines.push(`#${uncertId}=UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.0E-6),#${lenUnitId},'distance_accuracy_value','Confusion accuracy');`);
  const geoCtxId = id++;
  lines.push(`#${geoCtxId}=(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#${uncertId}))GLOBAL_UNIT_ASSIGNED_CONTEXT((#${lenUnitId},#${angUnitId},#${solidAngId}))REPRESENTATION_CONTEXT('Context','3D Context'));`);

  // ── Tessellated geometry (AP242) ────────────────────────────────────────
  // COORDINATES_LIST: npoints + position_coords as LIST OF (x,y,z) triples — not CARTESIAN_POINT refs.
  const triples: string[] = [];
  for (let i = 0; i < vertCount; i++) {
    triples.push(
      `(${fmt(positions.getX(i))},${fmt(positions.getY(i))},${fmt(positions.getZ(i))})`,
    );
  }
  const coordListId = id++;
  lines.push(`#${coordListId}=COORDINATES_LIST('Vertices',${vertCount},(${triples.join(',')}));`);

  // TRIANGULATED_FACE(name, coordinates, pnmax, normals, geometric_link, pnindex, triangles)
  const triIdx: string[] = [];
  for (let t = 0; t < triCount; t++) {
    const i0 = t * 3 + 1;
    const i1 = t * 3 + 2;
    const i2 = t * 3 + 3;
    triIdx.push(`(${i0},${i1},${i2})`);
  }
  const triList = `(${triIdx.join(',')})`;
  const triFaceId = id++;
  lines.push(
    `#${triFaceId}=TRIANGULATED_FACE('${partName}',#${coordListId},${vertCount},(),$,(),${triList});`,
  );

  // TESSELLATED_SHELL(name, items, topological_link?) — items는 tessellated_structured_item 집합(면)
  const tessShellId = id++;
  lines.push(`#${tessShellId}=TESSELLATED_SHELL('',(#${triFaceId}),$);`);

  // TESSELLATED_SHAPE_REPRESENTATION — items는 tessellated_item만(OCCT는 축을 RepositionedTessellatedItem으로 기대).
  const tessRepId = id++;
  lines.push(`#${tessRepId}=TESSELLATED_SHAPE_REPRESENTATION('',(#${tessShellId}),#${geoCtxId});`);

  // ── Shape definition ───────────────────────────────────────────────────
  const shapeAspId = id++;
  lines.push(`#${shapeAspId}=PRODUCT_DEFINITION_SHAPE('','',#${prodDefId});`);
  const shapeRepRelId = id++;
  lines.push(`#${shapeRepRelId}=SHAPE_DEFINITION_REPRESENTATION(#${shapeAspId},#${tessRepId});`);

  lines.push('ENDSEC;');
  lines.push('END-ISO-10303-21;');

  return lines.join('\n');
}

export async function downloadStep(geometry: THREE.BufferGeometry, filename = 'part'): Promise<void> {
  const { downloadBlob } = await import('@/lib/platform');
  const content = exportToStep(geometry, filename);
  const blob = new Blob([content], { type: 'model/step' });
  await downloadBlob(`${filename}.step`, blob);
}
