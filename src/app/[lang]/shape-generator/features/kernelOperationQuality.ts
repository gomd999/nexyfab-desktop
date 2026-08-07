import * as THREE from 'three';
import { verifyGeneratedModel, type ModelVerificationResult } from '../analysis/verifyGeneratedModel';

export type KernelGeometryClass = 'brep' | 'mesh';
export type KernelQualityGrade = 'EXACT' | 'RECOVERED' | 'FACETED' | 'INCOMPLETE' | 'FAILED';

export interface KernelOperationQuality {
  grade: KernelQualityGrade;
  geometryClass: KernelGeometryClass;
  valid: boolean;
  recoveryStrategies: readonly string[];
  issues: string[];
  metrics: ModelVerificationResult['metrics'];
}

export interface KernelBrepResult {
  geometry: THREE.BufferGeometry;
  handle: string | null;
}

const EMPTY_METRICS: ModelVerificationResult['metrics'] = {
  triangleCount: 0, volumeMm3: 0, bbox: { x: 0, y: 0, z: 0 }, boundaryEdges: 0, componentCount: 0,
};

/** Fail-closed quality contract shared by OCCT tessellations and mesh fallbacks. */
export function assessKernelOperationGeometry(
  geometry: THREE.BufferGeometry | null,
  options: { geometryClass: KernelGeometryClass; recoveryStrategies?: readonly string[]; requireSingleBody?: boolean },
): KernelOperationQuality {
  const recoveryStrategies = [...(options.recoveryStrategies ?? [])];
  if (!geometry) return { grade: 'FAILED', geometryClass: options.geometryClass, valid: false, recoveryStrategies, issues: ['geometry_missing'], metrics: EMPTY_METRICS };
  const position = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
  if (!position || position.count === 0) return { grade: 'INCOMPLETE', geometryClass: options.geometryClass, valid: false, recoveryStrategies, issues: ['error:position_missing'], metrics: EMPTY_METRICS };
  for (let index = 0; index < position.count; index++) {
    if (![position.getX(index), position.getY(index), position.getZ(index)].every(Number.isFinite)) {
      return { grade: 'INCOMPLETE', geometryClass: options.geometryClass, valid: false, recoveryStrategies, issues: ['error:non_finite_position'], metrics: EMPTY_METRICS };
    }
  }
  // Watertightness gates only the mesh class, where the mesh IS the product
  // (CSG results; T-junction-aware check, see boundaryEdgeCount). A B-rep
  // result's mesh is a per-face display tessellation: OCCT triangulates
  // curved seams with mismatched chords, so genuine-looking open edges are
  // routine on valid solids (measured 260808: tangent fillet canary). B-rep
  // validity is the kernel's own contract; here we still enforce non-empty,
  // finite, positive-volume and the OCCT handle.
  const verification = verifyGeneratedModel(geometry, {
    requireWatertight: options.geometryClass === 'mesh',
    requireSingleBody: options.requireSingleBody ?? false,
  });
  const issues = verification.checks.filter(check => !check.pass).map(check => `${check.severity}:${check.id}`);
  const hasBrepHandle = typeof geometry.userData?.occtHandle === 'string' && geometry.userData.occtHandle.length > 0;
  const valid = verification.pass && verification.metrics.volumeMm3 > 1e-6 && (options.geometryClass !== 'brep' || hasBrepHandle);
  if (options.geometryClass === 'brep' && !hasBrepHandle) issues.push('error:brep_handle_missing');
  const grade: KernelQualityGrade = !valid ? 'INCOMPLETE' : options.geometryClass === 'mesh' ? 'FACETED' : recoveryStrategies.length ? 'RECOVERED' : 'EXACT';
  return { grade, geometryClass: options.geometryClass, valid, recoveryStrategies, issues, metrics: verification.metrics };
}

/** Attach the kernel identity and reject malformed OCCT tessellations. */
export function requireValidBrepResult(
  result: KernelBrepResult,
  recoveryStrategies: readonly string[] = [],
): KernelBrepResult & { quality: KernelOperationQuality } {
  if (result.handle) result.geometry.userData = { ...result.geometry.userData, occtHandle: result.handle };
  // No requireSingleBody here: component count is modeling semantics, not
  // tessellation validity — a subtract may legitimately split a body in two,
  // and welded component counting over face-wise OCCT triangulations can
  // read a fused boss+shell as 2 (measured 260808, REF-PART 1 boss union).
  // Rejecting the exact kernel's own result only demotes it to the mesh path.
  const quality = assessKernelOperationGeometry(result.geometry, {
    geometryClass: 'brep',
    recoveryStrategies,
  });
  if (!quality.valid) {
    throw new Error(`OCCT produced an invalid solid (${quality.issues.join(', ') || quality.grade})`);
  }
  return { ...result, quality };
}
