import { describe, expect, it } from 'vitest';
import { buildNativeStepAssemblyPlan } from './nativeStepAssemblyPlan';
import type { ComplexProductArchitecture } from './complexProductArchitecture';

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const architecture: ComplexProductArchitecture = { schema: 'nexyfab.complex-product-architecture.v1', requirements: [], definitions: [{ id: 'root', name: 'A', kind: 'product', sourcing: 'make', independentlyReplaceable: false, bodyIntent: { policy: 'multi_body', expectedBodies: null }, requirementIds: [] }, { id: 'wheel', name: 'Wheel', kind: 'part', sourcing: 'make', independentlyReplaceable: true, bodyIntent: { policy: 'single_body', expectedBodies: 1 }, requirementIds: [] }], occurrences: [{ id: 'o-root', definitionId: 'root', parentOccurrenceId: null, quantityIndex: 1 }, { id: 'wheel-1', definitionId: 'wheel', parentOccurrenceId: 'o-root', quantityIndex: 1 }, { id: 'wheel-2', definitionId: 'wheel', parentOccurrenceId: 'o-root', quantityIndex: 2 }], interfaces: [], interfaceExpectation: 'none' };
const assignment = { definitionId: 'wheel', material: 'abs', process: 'injection_molding', source: 'user_confirmed' as const, sourceRef: 'user:1', confirmedAt: null, policyId: null };

describe('native STEP assembly plan', () => {
  it('preserves one definition and repeated occurrences with separate transforms', () => {
    const moved = [...identity]; moved[3] = 20;
    const plan = buildNativeStepAssemblyPlan({ architecture, artifacts: [{ definitionId: 'wheel', stepPath: 'wheel.step', sha256: 'a'.repeat(64) }], assignments: [assignment], transforms: [{ occurrenceId: 'o-root', matrix: identity, source: 'assembly_solver' }, { occurrenceId: 'wheel-1', matrix: identity, source: 'assembly_solver' }, { occurrenceId: 'wheel-2', matrix: moved, source: 'assembly_solver' }] });
    expect(plan).toMatchObject({ status: 'pass' });
    expect(plan.definitions).toHaveLength(1); expect(plan.occurrences).toHaveLength(3); expect(plan.occurrences[2]?.localToParent[3]).toBe(20);
  });
  it('fails closed on missing assignment and invalid transform', () => {
    const invalid = [...identity]; invalid[15] = 0;
    const plan = buildNativeStepAssemblyPlan({ architecture, artifacts: [{ definitionId: 'wheel', stepPath: 'wheel.step', sha256: 'a'.repeat(64) }], assignments: [], transforms: architecture.occurrences.map(item => ({ occurrenceId: item.id, matrix: invalid, source: 'assembly_solver' as const })) });
    expect(plan.status).toBe('fail'); expect(plan.codes).toEqual(expect.arrayContaining(['STEP_ASSEMBLY_MANUFACTURING_ASSIGNMENT_MISSING:wheel', 'STEP_ASSEMBLY_TRANSFORM_INVALID:wheel-1']));
  });
});
