import { describe, expect, it } from 'vitest';
import { evaluateAiProjectGeneration, planAiProjectRepair } from '../aiProjectGenerationPipeline';
import type { ProductSpatialIr } from '../productSpatialIr';

const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] as const;
const ir: ProductSpatialIr = { schema: 'nexyfab.product-spatial-ir.v1', units: 'mm', definitions: [{ id: 'd', name: 'Part', kind: 'part' }], nodes: [{ id: 'p', kind: 'part', name: 'Part', definitionId: 'd', localToParent: I, worldTransform: I }] };

describe('AI project generation pipeline', () => {
  it('passes a fully evidenced mechanical/interior project', () => {
    const decision = evaluateAiProjectGeneration({
      requirements: { unresolved: [], conflicts: [] }, ir,
      geometry: { requested: 1, exactGenerated: 1, failedIds: [] },
      verification: { structure: { valid: true }, placement: { required: 1, resolved: 1, invalid: 0 } },
      exports: { required: ['step', 'ifc'], passed: ['step', 'ifc'] },
    });
    expect(decision).toMatchObject({ stage: 'complete', status: 'pass' });
  });

  it('blocks incomplete placement before geometry and proposes a bounded retry', () => {
    const incomplete = structuredClone(ir); delete incomplete.nodes[0]!.worldTransform;
    const decision = evaluateAiProjectGeneration({ requirements: { unresolved: [], conflicts: [] }, ir: incomplete, geometry: { requested: 1, exactGenerated: 1, failedIds: [] }, exports: { required: [], passed: [] } });
    expect(decision).toMatchObject({ stage: 'product_spatial_ir', status: 'blocked', failureCodes: ['MISSING_TRANSFORM'] });
    expect(planAiProjectRepair(decision, 1, 0)).toMatchObject({ action: 'retry_stage', stage: 'product_spatial_ir' });
    expect(planAiProjectRepair(decision, 3, 2).action).toBe('stop');
  });

  it('never treats an absent verification run as complete', () => {
    const decision = evaluateAiProjectGeneration({ requirements: { unresolved: [], conflicts: [] }, ir, geometry: { requested: 1, exactGenerated: 1, failedIds: [] }, exports: { required: [], passed: [] } });
    expect(decision).toMatchObject({ stage: 'verification', status: 'blocked', failureCodes: ['PRECISE_INTERFERENCE_NOT_RUN'] });
  });

  it('requires governed complex-product evidence at ten parts and blocks incomplete interfaces', () => {
    const missing = evaluateAiProjectGeneration({ requirements: { unresolved: [], conflicts: [] }, ir, geometry: { requested: 10, exactGenerated: 10, failedIds: [] }, exports: { required: [], passed: [] } });
    expect(missing).toMatchObject({ stage: 'complexity', status: 'blocked', failureCodes: ['GEOMETRY_INCOMPLETE'] });
    const incomplete = evaluateAiProjectGeneration({
      requirements: { unresolved: [], conflicts: [] }, ir,
      geometry: { requested: 10, exactGenerated: 10, failedIds: [] },
      complexProduct: { definitions: 10, instances: 10, maxAssemblyDepth: 2, interfacesRequired: 9, interfacesVerified: 8, exactPartsVerified: 10, expectedStepOccurrences: 10, measuredStepOccurrences: 10, movingInstances: 0 },
      exports: { required: [], passed: [] },
    });
    expect(incomplete).toMatchObject({ stage: 'complexity', status: 'blocked' });
    expect(incomplete.reasons).toContain('Verified interfaces 8/9.');
  });
});
