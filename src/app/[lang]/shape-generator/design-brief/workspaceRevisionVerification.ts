import type * as THREE from 'three';
import { assessKernelOperationGeometry } from '../features/kernelOperationQuality';

export interface WorkspaceRevisionVerification {
  revisionId: string;
  status: 'pending' | 'passed' | 'failed';
  reason?: string;
  exactKernel: boolean;
  manufacturingReleaseReady: false;
}

export function pendingWorkspaceRevisionVerification(
  revisionId: string,
): WorkspaceRevisionVerification {
  return {
    revisionId,
    status: 'pending',
    exactKernel: false,
    manufacturingReleaseReady: false,
  };
}

/**
 * A workspace rebuild is exact only when the final geometry still owns a live
 * worker B-rep handle, no feature reported an error or mesh downgrade, and the
 * shared kernel-quality contract accepts the final tessellation. This does not
 * grant manufacturing release: drawings and independent approval remain
 * separate gates.
 */
export function evaluateWorkspaceRevision(
  revisionId: string,
  geometry: THREE.BufferGeometry | null,
  pipelineErrors: Readonly<Record<string, string>>,
): WorkspaceRevisionVerification {
  const errorEntries = Object.entries(pipelineErrors);
  if (errorEntries.length > 0) {
    return {
      revisionId,
      status: 'failed',
      reason: `feature errors: ${errorEntries.map(([id, reason]) => `${id}: ${reason}`).join(' | ')}`,
      exactKernel: false,
      manufacturingReleaseReady: false,
    };
  }
  if (!geometry) {
    return {
      revisionId,
      status: 'failed',
      reason: 'pipeline produced no geometry',
      exactKernel: false,
      manufacturingReleaseReady: false,
    };
  }

  const downgrades = Array.isArray(geometry.userData?.meshDowngrades)
    ? geometry.userData.meshDowngrades as unknown[]
    : [];
  if (downgrades.length > 0) {
    return {
      revisionId,
      status: 'failed',
      reason: `exact-kernel downgrade detected (${downgrades.length})`,
      exactKernel: false,
      manufacturingReleaseReady: false,
    };
  }

  const handle = geometry.userData?.occtHandle;
  const workerOwned = geometry.userData?.occtHandleInWorker === true;
  if (typeof handle !== 'string' || handle.length === 0 || !workerOwned) {
    return {
      revisionId,
      status: 'failed',
      reason: 'live worker-owned OCCT B-rep handle missing',
      exactKernel: false,
      manufacturingReleaseReady: false,
    };
  }

  const shapeEvidence = geometry.userData?.occtShapeEvidence as
    | { kind?: unknown; singleSolid?: unknown; nativeShapeType?: unknown; volumeMm3?: unknown }
    | undefined;
  if (shapeEvidence?.singleSolid !== true || shapeEvidence.kind !== 'Solid') {
    return {
      revisionId,
      status: 'failed',
      reason: 'OCCT topology did not prove one registered Solid',
      exactKernel: false,
      manufacturingReleaseReady: false,
    };
  }
  if (typeof shapeEvidence.volumeMm3 !== 'number'
    || !Number.isFinite(shapeEvidence.volumeMm3)
    || !(shapeEvidence.volumeMm3 > 0)) {
    return {
      revisionId,
      status: 'failed',
      reason: 'OCCT topology has no positive kernel-measured volume',
      exactKernel: false,
      manufacturingReleaseReady: false,
    };
  }

  const quality = assessKernelOperationGeometry(geometry, {
    geometryClass: 'brep',
    // OCCT face/feature tessellations may be disconnected even when the
    // registry-owned topology above is one Solid. Do not substitute display
    // mesh connectivity for exact kernel topology.
    requireSingleBody: false,
  });
  if (!quality.valid || quality.grade !== 'EXACT') {
    return {
      revisionId,
      status: 'failed',
      reason: `kernel quality ${quality.grade}: ${quality.issues.join(', ') || 'invalid geometry'}`,
      exactKernel: false,
      manufacturingReleaseReady: false,
    };
  }

  return {
    revisionId,
    status: 'passed',
    exactKernel: true,
    manufacturingReleaseReady: false,
  };
}
