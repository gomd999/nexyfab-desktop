import { describe, expect, it } from 'vitest';
import type { FeatureTree } from '@/lib/cad/featureTree';
import type { AiAssemblyProgram } from '../aiAssemblyProgram';
import { validateAiAssemblyProgram } from '../aiAssemblyProgram';

const tree: FeatureTree = { nodes: [] };
const valid: AiAssemblyProgram = {
  version: 1,
  units: 'mm',
  classification: 'concept_only',
  name: 'Two part product',
  unresolved: ['shaft diameter'],
  assembly: {
    parts: [
      { id: 'housing-1', name: 'Housing', partTemplateId: 'housing', position: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 }, fixed: true },
      { id: 'shaft-1', name: 'Shaft', partTemplateId: 'shaft', position: { x: 0, y: 0, z: 20 }, orientation: { x: 0, y: 0, z: 0, w: 1 } },
    ],
    mates: [],
  },
  parts: [
    { instanceId: 'housing-1', featureTree: tree, metadata: { partNumber: 'NX-001', revision: 'A', quantity: 1, source: 'confirmed' } },
    { instanceId: 'shaft-1', featureTree: tree, metadata: { partNumber: 'NX-002', revision: 'A', quantity: 1, source: 'assumed' } },
  ],
};

describe('validateAiAssemblyProgram', () => {
  it('accepts the production assembly and feature-tree types without conversion', () => {
    expect(validateAiAssemblyProgram(valid)).toEqual([]);
  });

  it('requires every assembly instance to remain an independent editable part', () => {
    const invalid = { ...valid, parts: valid.parts.slice(0, 1) };
    expect(validateAiAssemblyProgram(invalid)).toContainEqual({
      path: 'parts', message: 'missing feature tree for assembly instance shaft-1',
    });
  });

  it('does not promote unresolved AI assumptions to review-ready CAD', () => {
    const invalid: AiAssemblyProgram = { ...valid, classification: 'review_required' };
    expect(validateAiAssemblyProgram(invalid)).toContainEqual({
      path: 'classification', message: 'unresolved inputs require concept_only',
    });
  });

  it('rejects duplicate membership and cyclic subassemblies', () => {
    const invalid: AiAssemblyProgram = { ...valid, structure: [
      { id: 'a', name: 'A', instanceIds: ['housing-1'], rigid: true, parentId: 'b' },
      { id: 'b', name: 'B', instanceIds: ['housing-1'], rigid: true, parentId: 'a' },
    ] };
    const messages = validateAiAssemblyProgram(invalid).map(issue => issue.message);
    expect(messages).toContain('assembly instance housing-1 belongs to multiple subassemblies');
    expect(messages.some(message => message.includes('hierarchy contains a cycle'))).toBe(true);
  });

  it('rejects divergent repeated definitions and review-ready assumed metadata', () => {
    const repeated: AiAssemblyProgram = {
      ...valid,
      classification: 'review_required', unresolved: [],
      parts: valid.parts.map((part, index) => ({
        ...part,
        definitionId: 'shared',
        metadata: { ...part.metadata, partNumber: 'SHARED', source: index === 0 ? 'confirmed' : 'assumed' },
        featureTree: index === 0 ? part.featureTree : { nodes: [{ id: 'different', name: 'different', dependencies: [], payload: { kind: 'extrude', loop: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], depth: 1, direction: 'one_sided', mode: 'add' } }] },
      })),
      assembly: { ...valid.assembly, parts: valid.assembly.parts.map(part => ({ ...part, partTemplateId: 'shared' })) },
    };
    const messages = validateAiAssemblyProgram(repeated).map(issue => issue.message);
    expect(messages).toContain('assumed component metadata requires concept_only classification');
    expect(messages.some(message => message.includes('divergent geometry'))).toBe(true);
  });
});
