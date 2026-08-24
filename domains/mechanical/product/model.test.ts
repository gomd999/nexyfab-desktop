import { describe, expect, it } from 'vitest';
import { validateTree } from '@/lib/cad/featureTree';
import { featureTreeToOcctPlan } from '@/lib/occt/featurePlan';
import { validateAssembly } from '@/lib/assembly/assemblyState';
import { buildMotorGearboxDriveModuleModel, hashMechanicalFeatureTree } from './model';

describe('mechanical drive-module editable model', () => {
  it('builds an original, non-preview contract-backed model', () => {
    const model = buildMotorGearboxDriveModuleModel();
    expect(model.metadata.preview).toBe(false);
    expect(model.metadata.rightsStatus).toBe('RIGHTS_CLEARED_ORIGINAL');
    expect(model.metadata.sourceRevision).toBe('1.0.0');
    expect(model.metadata.manufacturingApproval).toBe(false);
    expect(Object.keys(model.featureTrees)).toHaveLength(model.contract.parts.length);
  });

  it('has a replayable exact plan for every contracted part', () => {
    const model = buildMotorGearboxDriveModuleModel();
    for (const part of model.contract.parts) {
      const tree = model.featureTrees[part.id];
      expect(tree).toBeDefined();
      expect(part.geometryHash).toBe(hashMechanicalFeatureTree(tree));
      validateTree(tree);
      const plan = featureTreeToOcctPlan(tree);
      expect(plan.finalResultId).toBeTruthy();
      expect(plan.unsupported).toEqual([]);
      expect(plan.embeddedChildNodes).toEqual([]);
    }
  });

  it('exposes stable assembly references and valid mates', () => {
    const model = buildMotorGearboxDriveModuleModel();
    validateAssembly(model.assemblyState);
    expect(model.assemblyState.parts.some((part) => part.fixed)).toBe(true);
    expect(model.assemblyState.mates).toHaveLength(3);
    for (const part of model.assemblyState.parts) {
      expect(part.refs?.center_axis).toBeDefined();
      expect(Number.isFinite(part.position.x)).toBe(true);
      expect(Number.isFinite(part.position.y)).toBe(true);
      expect(Number.isFinite(part.position.z)).toBe(true);
    }
  });
});
