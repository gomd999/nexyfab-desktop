// @vitest-environment node
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { steppedShaftPlan, revolveBushingPlan } from '@/lib/ai/design-driver/fixturePlanner';
import { buildEditableWorkspaceCandidate } from '@/lib/ai/design-driver/workspaceCandidate';
import { applyFeaturePipelineDetailedAsync } from '../features';
import { assessKernelOperationGeometry } from '../features/kernelOperationQuality';
import { workspaceCandidateToModelerDraft } from './workspaceCandidateToModeler';

function cylinderBase(diameter: number, height: number): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(diameter / 2, diameter / 2, height, 64).toNonIndexed();
}

describe('editable AI workspace candidate → real browser OCCT pipeline', () => {
  it('fuses the stepped-shaft base and boss into one exact B-rep chain', async () => {
    const converted = workspaceCandidateToModelerDraft(
      buildEditableWorkspaceCandidate(steppedShaftPlan()),
    );
    expect(converted.ok).toBe(true);
    if (!converted.ok) return;

    const { baseShape, features } = converted.draft;
    const result = await applyFeaturePipelineDetailedAsync(
      cylinderBase(baseShape.params.diameter!, baseShape.params.height!),
      features,
      { occtMode: true, baseSpec: { shapeId: baseShape.id, params: baseShape.params } },
    );

    expect(result.errors).toEqual({});
    expect(result.geometry.userData?.occtHandle).toEqual(expect.any(String));
    const evidence = result.geometry.userData?.occtShapeEvidence as { solidCount?: number; volumeMm3?: number } | undefined;
    expect(evidence?.solidCount, JSON.stringify(evidence)).toBe(1);
    expect(evidence).toMatchObject({ kind: 'Solid', singleSolid: true });
    expect(result.geometry.userData?.meshDowngrades ?? []).toEqual([]);
    const quality = assessKernelOperationGeometry(result.geometry, {
      geometryClass: 'brep',
      requireSingleBody: false,
    });
    expect(quality.valid, quality.issues.join(', ')).toBe(true);
    expect(quality.grade).toBe('EXACT');

    result.geometry.computeBoundingBox();
    const box = result.geometry.boundingBox!;
    expect(box.max.x - box.min.x).toBeCloseTo(24, 3);
    expect(box.max.z - box.min.z).toBeCloseTo(24, 3);
    expect(box.max.y - box.min.y).toBeCloseTo(55, 3);
    const expectedVolume = Math.PI * 12 * 12 * 30 + Math.PI * 8 * 8 * 25;
    expect(Math.abs(evidence!.volumeMm3! - expectedVolume) / expectedVolume).toBeLessThan(1e-9);
  }, 60_000);

  it('rebuilds a full-turn cylindrical revolve as an exact B-rep even with no downstream features', async () => {
    const converted = workspaceCandidateToModelerDraft(
      buildEditableWorkspaceCandidate(revolveBushingPlan()),
    );
    expect(converted.ok).toBe(true);
    if (!converted.ok) return;
    const { baseShape, features } = converted.draft;
    expect(features).toHaveLength(0);

    const result = await applyFeaturePipelineDetailedAsync(
      cylinderBase(baseShape.params.diameter!, baseShape.params.height!),
      features,
      { occtMode: true, baseSpec: { shapeId: baseShape.id, params: baseShape.params } },
    );
    expect(result.errors).toEqual({});
    expect(result.geometry.userData?.occtHandle).toEqual(expect.any(String));
    expect(result.geometry.userData?.occtShapeEvidence).toMatchObject({ kind: 'Solid', singleSolid: true });
    const quality = assessKernelOperationGeometry(result.geometry, {
      geometryClass: 'brep',
      requireSingleBody: false,
    });
    expect(quality.valid, quality.issues.join(', ')).toBe(true);
    expect(quality.grade).toBe('EXACT');
  }, 60_000);
});
