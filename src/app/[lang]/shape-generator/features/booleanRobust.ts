import * as THREE from 'three';
import { applyBooleanSyncSafe } from './boolean';
import { assessKernelOperationGeometry, type KernelOperationQuality } from './kernelOperationQuality';

export type RobustBooleanFailure =
  | { kind: 'identical_inputs' }
  | { kind: 'disjoint_inputs' }
  | { kind: 'open_mesh'; which: 'a' | 'b' }
  | { kind: 'coincident_faces' }
  | { kind: 'zero_volume' }
  | { kind: 'invalid_result'; issues: string[] }
  | { kind: 'evaluator_error'; message: string };

export interface RobustBooleanResult {
  geometry: THREE.BufferGeometry | null;
  failure: RobustBooleanFailure | null;
  attempts: number;
  hints: { code: string; message: string }[];
  quality: KernelOperationQuality;
}

const COINCIDENT_JITTER_MM = 0.0005;

/** Deterministic, bounded mesh CSG recovery. Every candidate must pass quality validation. */
export function applyBooleanRobust(
  type: 'union' | 'subtract' | 'intersect',
  geoA: THREE.BufferGeometry,
  geoB: THREE.BufferGeometry,
  evaluate: typeof applyBooleanSyncSafe = applyBooleanSyncSafe,
): RobustBooleanResult {
  const hints: RobustBooleanResult['hints'] = [];
  const assess = (geometry: THREE.BufferGeometry | null, recoveryStrategies: readonly string[] = []) =>
    assessKernelOperationGeometry(geometry, { geometryClass: 'mesh', recoveryStrategies });
  const failed = (failure: RobustBooleanFailure, attempts: number): RobustBooleanResult => ({
    geometry: null, failure, attempts, hints, quality: assess(null),
  });

  geoA.computeBoundingBox();
  geoB.computeBoundingBox();
  if (!geoA.boundingBox || !geoB.boundingBox) return failed({ kind: 'evaluator_error', message: 'missing bbox' }, 0);

  if (isIdentical(geoA, geoB)) {
    const geometry = type === 'subtract' ? null : geoA.clone();
    return {
      geometry,
      failure: type === 'subtract' ? { kind: 'identical_inputs' } : null,
      attempts: 0,
      hints: [{ code: 'identical', message: 'Both inputs are geometrically identical' }],
      quality: assess(geometry),
    };
  }

  if (!geoA.boundingBox.intersectsBox(geoB.boundingBox)) {
    if (type === 'union') {
      const geometry = mergeGeometries(geoA, geoB);
      return { geometry, failure: null, attempts: 0, hints: [{ code: 'disjoint', message: 'Inputs are disjoint — concatenated' }], quality: assess(geometry) };
    }
    if (type === 'subtract') {
      const geometry = geoA.clone();
      return { geometry, failure: null, attempts: 0, hints: [{ code: 'disjoint', message: 'Tool does not touch base — returned base unchanged' }], quality: assess(geometry) };
    }
    return { ...failed({ kind: 'disjoint_inputs' }, 0), hints: [{ code: 'disjoint', message: 'Intersect of disjoint = empty' }] };
  }

  let attempts = 0;
  // Keep callback-updated diagnostics on an object. TypeScript deliberately
  // does not assume a nested function ran when narrowing captured locals.
  const diagnostic: { lastError: string | null; lastInvalid: KernelOperationQuality | null } = {
    lastError: null,
    lastInvalid: null,
  };
  const tryCandidate = (a: THREE.BufferGeometry, b: THREE.BufferGeometry, strategies: readonly string[]) => {
    attempts++;
    const result = evaluate(type, a, b);
    diagnostic.lastError = result.error;
    if (!result.geometry) return null;
    const quality = assess(result.geometry, strategies);
    if (!quality.valid) {
      diagnostic.lastInvalid = quality;
      hints.push({ code: `reject-invalid-${strategies.at(-1) ?? 'baseline'}`, message: `Result rejected: ${quality.issues.join(', ')}` });
      return null;
    }
    return { geometry: result.geometry, quality };
  };

  const baseline = tryCandidate(geoA, geoB, []);
  if (baseline) return { ...baseline, failure: null, attempts, hints };

  hints.push({ code: 'retry-jitter', message: `Primary boolean failed (${diagnostic.lastError ?? 'invalid topology'}); retrying with deterministic sub-tolerance jitter` });
  const jittered = deterministicJitterGeometry(geoB, COINCIDENT_JITTER_MM);
  const jitter = tryCandidate(geoA, jittered, ['deterministic-jitter']);
  if (jitter) return { ...jitter, failure: null, attempts, hints };

  hints.push({ code: 'retry-weld', message: 'Jitter retry failed; welding tool mesh seams' });
  const welded = weldClosePoints(geoB, 0.01);
  const weld = tryCandidate(geoA, welded, ['deterministic-jitter', 'weld-tool']);
  if (weld) return { ...weld, failure: null, attempts, hints };

  if (!isClosedMeshByPosition(geoA)) return failed({ kind: 'open_mesh', which: 'a' }, attempts);
  if (!isClosedMeshByPosition(geoB)) return failed({ kind: 'open_mesh', which: 'b' }, attempts);
  if (diagnostic.lastInvalid) return failed({ kind: 'invalid_result', issues: diagnostic.lastInvalid.issues }, attempts);
  if (diagnostic.lastError?.includes('coincident')) return failed({ kind: 'coincident_faces' }, attempts);
  if (diagnostic.lastError?.includes('empty') || diagnostic.lastError?.includes('no geometry')) return failed({ kind: 'zero_volume' }, attempts);
  return failed({ kind: 'evaluator_error', message: diagnostic.lastError ?? 'unknown' }, attempts);
}

function isIdentical(a: THREE.BufferGeometry, b: THREE.BufferGeometry): boolean {
  const pa = a.getAttribute('position') as THREE.BufferAttribute | undefined;
  const pb = b.getAttribute('position') as THREE.BufferAttribute | undefined;
  if (!pa || !pb || pa.count !== pb.count) return false;
  for (let i = 0; i < pa.count; i++) {
    if (Math.abs(pa.getX(i) - pb.getX(i)) > 1e-6 || Math.abs(pa.getY(i) - pb.getY(i)) > 1e-6 || Math.abs(pa.getZ(i) - pb.getZ(i)) > 1e-6) return false;
  }
  return true;
}

/** Stable pseudo-random perturbation: same vertices and amount produce identical bytes. */
export function deterministicJitterGeometry(geometry: THREE.BufferGeometry, amount: number): THREE.BufferGeometry {
  if (!Number.isFinite(amount) || amount < 0) throw new TypeError('jitter amount must be finite and non-negative');
  const next = geometry.clone();
  const pos = next.getAttribute('position') as THREE.BufferAttribute | undefined;
  if (!pos) return next;
  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(
      i,
      pos.getX(i) + deterministicNoise(i * 3) * amount,
      pos.getY(i) + deterministicNoise(i * 3 + 1) * amount,
      pos.getZ(i) + deterministicNoise(i * 3 + 2) * amount,
    );
  }
  pos.needsUpdate = true;
  next.computeBoundingBox();
  next.computeBoundingSphere();
  return next;
}

function deterministicNoise(index: number): number {
  let value = Math.imul(index + 1, 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value ^= value >>> 16;
  return ((value >>> 0) / 0xffffffff) - 0.5;
}

function weldClosePoints(geometry: THREE.BufferGeometry, tolerance: number): THREE.BufferGeometry {
  const out = geometry.clone();
  const pos = out.getAttribute('position') as THREE.BufferAttribute | undefined;
  if (!pos) return out;
  const grid = 1 / tolerance;
  for (let i = 0; i < pos.count; i++) pos.setXYZ(i, Math.round(pos.getX(i) * grid) / grid, Math.round(pos.getY(i) * grid) / grid, Math.round(pos.getZ(i) * grid) / grid);
  pos.needsUpdate = true;
  out.computeVertexNormals();
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

function isClosedMeshByPosition(geometry: THREE.BufferGeometry): boolean {
  const quality = assessKernelOperationGeometry(geometry, { geometryClass: 'mesh' });
  return quality.metrics.boundaryEdges === 0;
}

function mergeGeometries(a: THREE.BufferGeometry, b: THREE.BufferGeometry): THREE.BufferGeometry {
  const na = a.index ? a.toNonIndexed() : a;
  const nb = b.index ? b.toNonIndexed() : b;
  const pa = na.getAttribute('position') as THREE.BufferAttribute | undefined;
  const pb = nb.getAttribute('position') as THREE.BufferAttribute | undefined;
  if (!pa || !pb) throw new Error('mergeGeometries: missing position attribute');
  const merged = new Float32Array((pa.count + pb.count) * 3);
  for (let i = 0; i < pa.count; i++) { merged[i * 3] = pa.getX(i); merged[i * 3 + 1] = pa.getY(i); merged[i * 3 + 2] = pa.getZ(i); }
  for (let i = 0; i < pb.count; i++) { const offset = (pa.count + i) * 3; merged[offset] = pb.getX(i); merged[offset + 1] = pb.getY(i); merged[offset + 2] = pb.getZ(i); }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(merged, 3));
  out.computeVertexNormals(); out.computeBoundingBox(); out.computeBoundingSphere();
  return out;
}
