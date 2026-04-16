import * as THREE from 'three';

/**
 * Exports geometry as STEP AP242 with tessellated representation.
 * Uses TRIANGULATED_FACE — one entity for the whole mesh.
 * Compatible with: FreeCAD 0.21+, CATIA V5, SolidWorks 2020+, Rhino 7+
 *
 * Much smaller than per-triangle ADVANCED_FACE approach:
 * - Old: ~17 STEP entities per triangle → 1.7M lines for 100k triangles
 * - New: N CARTESIAN_POINTs + 1 TRIANGULATED_FACE + wrapper entities
 */
export function exportToStep(
  geometry: THREE.BufferGeometry,
  partName = 'NexyFab_Part',
): string {
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

  // ── Coordinate system ──────────────────────────────────────────────────
  const originId = id++;
  lines.push(`#${originId}=CARTESIAN_POINT('Origin',(0.0,0.0,0.0));`);
  const zDirId = id++;
  lines.push(`#${zDirId}=DIRECTION('Z',(0.0,0.0,1.0));`);
  const xDirId = id++;
  lines.push(`#${xDirId}=DIRECTION('X',(1.0,0.0,0.0));`);
  const axisId = id++;
  lines.push(`#${axisId}=AXIS2_PLACEMENT_3D('',#${originId},#${zDirId},#${xDirId});`);

  // ── Tessellated geometry ───────────────────────────────────────────────
  // Write all vertices as individual CARTESIAN_POINT entities
  const vertexIds: number[] = [];
  for (let i = 0; i < vertCount; i++) {
    const vId = id++;
    lines.push(`#${vId}=CARTESIAN_POINT('',(${fmt(positions.getX(i))},${fmt(positions.getY(i))},${fmt(positions.getZ(i))}));`);
    vertexIds.push(vId);
  }

  // COORDINATES_LIST — all vertices as one entity
  const coordListId = id++;
  lines.push(`#${coordListId}=COORDINATES_LIST('Vertices',(${vertexIds.map(v => `#${v}`).join(',')}));`);

  // Build triangle index list (1-based for STEP)
  const triStrings: string[] = [];
  for (let t = 0; t < triCount; t++) {
    const i0 = t * 3 + 1;
    const i1 = t * 3 + 2;
    const i2 = t * 3 + 3;
    triStrings.push(`(${i0},${i1},${i2})`);
  }

  // TRIANGULATED_FACE — single entity covering all triangles
  const triFaceId = id++;
  lines.push(`#${triFaceId}=TRIANGULATED_FACE('${partName}',$,#${coordListId},$,(${triStrings.join(',')}));`);

  // TESSELLATED_SHELL
  const tessShellId = id++;
  lines.push(`#${tessShellId}=TESSELLATED_SHELL('',(.OPEN.),(#${triFaceId}));`);

  // TESSELLATED_SHAPE_REPRESENTATION
  const tessRepId = id++;
  lines.push(`#${tessRepId}=TESSELLATED_SHAPE_REPRESENTATION('',(#${axisId},#${tessShellId}),#${geoCtxId});`);

  // ── Shape definition ───────────────────────────────────────────────────
  const shapeAspId = id++;
  lines.push(`#${shapeAspId}=PRODUCT_DEFINITION_SHAPE('','',#${prodDefId});`);
  const shapeRepRelId = id++;
  lines.push(`#${shapeRepRelId}=SHAPE_DEFINITION_REPRESENTATION(#${shapeAspId},#${tessRepId});`);

  lines.push('ENDSEC;');
  lines.push('END-ISO-10303-21;');

  return lines.join('\n');
}

export function downloadStep(geometry: THREE.BufferGeometry, filename = 'part') {
  const content = exportToStep(geometry, filename);
  const blob = new Blob([content], { type: 'model/step' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.step`;
  a.click();
  URL.revokeObjectURL(url);
}
