import { describe, expect, it } from 'vitest';
import type { ProductDecompositionPlan } from '../productDecomposition';
import { compileProductDecomposition, validateProductDecomposition } from '../productDecomposition';
import { validateAiAssemblyProgram } from '../aiAssemblyProgram';

const solidTree = (id: string) => ({ nodes: [{
  id: `${id}-base`, name: 'Base Extrude', dependencies: [],
  payload: { kind: 'extrude' as const, loop: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 0, y: 10 }], depth: 10, direction: 'one_sided' as const, mode: 'add' as const },
}] });

const plan: ProductDecompositionPlan = {
  version: 1, units: 'mm', productName: 'Desktop actuator',
  requirements: [{ id: 'req-motion', text: 'shaft rotates in housing', category: 'motion', source: 'user' }],
  definitions: [
    { id: 'housing', name: 'Housing', responsibility: 'support shaft', makeOrBuy: 'make', featureTree: solidTree('housing'), requirementIds: ['req-motion'], metadata: { partNumber: 'NX-HSG-001', revision: 'A', material: 'Al 6061', source: 'confirmed' } },
    { id: 'shaft', name: 'Shaft', responsibility: 'transmit torque', makeOrBuy: 'make', featureTree: solidTree('shaft'), requirementIds: ['req-motion'], metadata: { partNumber: 'NX-SFT-001', revision: 'A', material: 'S45C', source: 'confirmed' } },
  ],
  instances: [
    { id: 'housing-1', definitionId: 'housing', positionMm: [0, 0, 0], fixed: true },
    { id: 'shaft-1', definitionId: 'shaft', positionMm: [0, 0, 20] },
    { id: 'shaft-2', definitionId: 'shaft', positionMm: [40, 0, 20] },
  ],
  mates: [],
  subassemblies: [{ id: 'drive', name: 'Drive module', instanceIds: ['housing-1', 'shaft-1'], rigid: false }],
  observations: ['two shaft instances requested'], assumptions: [], unresolved: [],
};

describe('product decomposition', () => {
  it('compiles requirements, reusable definitions, instances and hierarchy into canonical CAD assembly', () => {
    const result = compileProductDecomposition(plan);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.program.assembly.parts).toHaveLength(3);
    expect(result.program.parts.filter(part => part.definitionId === 'shaft')).toHaveLength(2);
    expect(result.program.parts.find(part => part.definitionId === 'shaft')?.metadata.quantity).toBe(2);
    expect(result.program.structure?.[0]?.name).toBe('Drive module');
    expect(validateAiAssemblyProgram(result.program)).toEqual([]);
  });

  it('rejects single-body shortcuts, dangling definitions and duplicate hierarchy membership', () => {
    const invalid: ProductDecompositionPlan = {
      ...plan,
      definitions: [...plan.definitions, { ...plan.definitions[0]!, id: 'unused', metadata: { ...plan.definitions[0]!.metadata, partNumber: 'NX-X' } }],
      subassemblies: [...plan.subassemblies, { id: 'other', name: 'Other', instanceIds: ['shaft-1'], rigid: true }],
    };
    const issues = validateProductDecomposition(invalid);
    expect(issues.some(issue => issue.message.includes('unused component definition'))).toBe(true);
    expect(issues.some(issue => issue.message.includes('already belongs'))).toBe(true);
  });

  it('keeps unresolved product inputs concept-only', () => {
    const result = compileProductDecomposition({ ...plan, unresolved: ['bearing fit tolerance'] });
    expect(result.ok && result.program.classification).toBe('concept_only');
  });

  it('rejects a manufactured placeholder that has no editable geometry', () => {
    const invalid = { ...plan, definitions: plan.definitions.map((definition, index) => index === 0 ? { ...definition, featureTree: { nodes: [] } } : definition) };
    expect(validateProductDecomposition(invalid).some(issue => issue.message.includes('non-empty feature tree'))).toBe(true);
  });
});
