import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  evaluateWorkspaceRevision,
  pendingWorkspaceRevisionVerification,
} from './workspaceRevisionVerification';

function exactBox(): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(10, 20, 30);
  geometry.userData = {
    occtHandle: 'worker:shape:42',
    occtHandleInWorker: true,
    occtShapeEvidence: { kind: 'Solid', singleSolid: true, nativeShapeType: 2, solidCount: 1, volumeMm3: 6000 },
  };
  return geometry;
}

describe('workspace revision exact-kernel verification', () => {
  it('starts pending without inheriting manufacturing release', () => {
    expect(pendingWorkspaceRevisionVerification('rev-1')).toEqual({
      revisionId: 'rev-1',
      status: 'pending',
      exactKernel: false,
      manufacturingReleaseReady: false,
    });
  });

  it('passes a valid single-body geometry with a live worker B-rep handle', () => {
    expect(evaluateWorkspaceRevision('rev-1', exactBox(), {})).toMatchObject({
      status: 'passed',
      exactKernel: true,
      manufacturingReleaseReady: false,
    });
  });

  it('fails closed when the handle is absent, a downgrade exists, or a feature errored', () => {
    const missing = exactBox();
    delete missing.userData.occtHandle;
    expect(evaluateWorkspaceRevision('rev-a', missing, {}).reason).toMatch(/handle missing/);

    const downgraded = exactBox();
    downgraded.userData.meshDowngrades = [{ featureId: 'hole-1' }];
    expect(evaluateWorkspaceRevision('rev-b', downgraded, {}).reason).toMatch(/downgrade/);

    expect(evaluateWorkspaceRevision('rev-c', exactBox(), { 'hole-1': 'boolean cut failed' }).reason)
      .toMatch(/hole-1: boolean cut failed/);

    const compound = exactBox();
    compound.userData.occtShapeEvidence = { kind: 'Compound', singleSolid: false, nativeShapeType: 0, solidCount: 2, volumeMm3: 6000 };
    expect(evaluateWorkspaceRevision('rev-d', compound, {}).reason).toMatch(/one registered Solid/);
  });
});
