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
  // Path 1 — geometry already has an OCCT handle (e.g. produced by a
  // boolean/fillet/chamfer/shell op). Round-trips cleanly through OCCT.
  const handle = geometry.userData?.occtHandle as string | undefined;
  if (handle) {
    try {
      const { exportOcctStep } = await import('../features/occtEngine');
      const stepText = await exportOcctStep(handle);
      if (stepText) return stepText;
    } catch (err) {
      console.warn('Failed to export real B-Rep STEP from existing handle, trying mesh bridge:', err);
    }
  }

  // Path 2 — Route A: convert the mesh through replicad.importSTL into an
  // OCCT B-rep on the fly, then export STEP through the kernel itself.
  // This is the path that lets cylinders / spheres / sweep / CSG output
  // round-trip through occt-import-js without the legacy AP242 emitter's
  // rejection (R2 burn-in 2026-05-08).
  try {
    const { meshToOcctShapeHandle, exportOcctStep } = await import('../features/occtEngine');
    const newHandle = await meshToOcctShapeHandle(geometry);
    if (newHandle) {
      // Cache for subsequent exports of the same mesh.
      geometry.userData = { ...geometry.userData, occtHandle: newHandle };
      const stepText = await exportOcctStep(newHandle);
      if (stepText) return stepText;
    }
  } catch (err) {
    console.warn('Failed to export STEP via OCCT mesh bridge, falling back to tessellated:', err);
  }

  // Path 3 — legacy hand-written AP242 emitter. Only Box geometries
  // round-trip cleanly here; for other shapes the caller should have used
  // `canExportStepCleanly()` to grey out the button. Kept as last-resort
  // path so a misconfigured caller still gets a file. Telemetry warning
  // so we can spot UI regressions where the predicate is bypassed (a user
  // hitting this path almost always means a broken caller, not an
  // intentional fallback). Single-line console.warn keeps the export
  // succeeding for whoever's already invoking it.

  console.warn('[step-export] Reached legacy AP242 emitter — output may be rejected by importers for non-box geometries. Caller should have gated this with canExportStepCleanly().');
  return exportToStep(geometry, partName);
}

/**
 * Predicate the UI uses to decide whether STEP export will round-trip
 * **synchronously** through a fast path:
 *   - has an OCCT B-rep handle (real STEP from kernel) — best case
 *   - is a THREE.BoxGeometry (AP214 NX-cube fast path) — exact round-trip
 *
 * Returns false for general meshes. Those still export cleanly via the
 * `exportToStepAsync()` Route A path (replicad.importSTL → OCCT B-rep →
 * STEP) but it costs an OCCT round-trip (~1s on cold WASM, ~100-300ms hot).
 * UI can keep using this predicate to decide between an instant button
 * and one that shows a "Converting via OCCT…" spinner.
 *
 * Set by `canExportStepCleanly(effectiveResult.geometry)` to prevent
 * regressions if Route A breaks: a false here still falls back to the
 * AP242 emitter, but its output is rejected by occt-import-js for non-box
 * shapes per the R2 burn-in (2026-05-08).
 */
export function canExportStepCleanly(geometry: THREE.BufferGeometry): boolean {
  if (geometry.userData?.occtHandle) return true;
  if (geometry instanceof THREE.BoxGeometry) return true;
  return false;
}

/**
 * Companion predicate for the post-Route-A world: any geometry can export
 * via `exportToStepAsync()` provided the OCCT WASM is loadable. Returns
 * `true` unconditionally today because the prebuild script always ships
 * the .wasm into /public; flip this to a runtime probe if the engine is
 * ever made optional.
 *
 * UI uses this when it wants to *enable* the STEP button but show a
 * progress hint for shapes outside the fast path.
 */
export function canExportStepViaBridge(_geometry: THREE.BufferGeometry): boolean {
  return true;
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
  // Route through the OCCT bridge so non-box meshes round-trip cleanly. The
  // sync exportToStep emits legacy AP242 that occt-import-js rejects for
  // anything but a box (R2 burn-in 2026-05-08), so never use it for downloads.
  const content = await exportToStepAsync(geometry, filename);
  const blob = new Blob([content], { type: 'model/step' });
  await downloadBlob(`${filename}.step`, blob);
}
