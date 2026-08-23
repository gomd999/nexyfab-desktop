import { describe, expect, it } from 'vitest';
import { validateRefinementStageOutput } from '../refinementStageSchema';

const intent = { requirements: [{ id: 'r1', text: 'Carry coolant', category: 'interface', acceptance: 'No leak at the specified proof pressure', sourceRef: 'user:prompt' }] };
const decomposition = { components: [
  { id: 'tank', name: 'Tank', responsibility: 'Store coolant', quantity: 1, requirementIds: ['r1'] },
  { id: 'pump', name: 'Pump', responsibility: 'Move coolant', quantity: 1, requirementIds: ['r1'] },
] };

describe('commercial refinement stage schema', () => {
  it('rejects string-only requirements even when a model calls them complete', () => {
    expect(validateRefinementStageOutput('intent', { requirements: ['move'] }, {})).toMatchObject({ passed: false });
  });

  it('requires every requirement to remain allocated during decomposition', () => {
    const result = validateRefinementStageOutput('decomposition', { components: [{ id: 'pump', name: 'Pump', responsibility: 'Move fluid', requirementIds: [] }] }, { intent });
    expect(result.passed).toBe(false);
    expect(result.errors.join(' ')).toMatch(/allocate|trace/);
  });

  it('rejects a disconnected interface graph and unknown fake component ids', () => {
    const result = validateRefinementStageOutput('interfaces', { interfaces: [{ id: 'if1', between: ['tank', 'ghost'], kind: 'fluid', requirementIds: ['r1'] }] }, { intent, decomposition });
    expect(result.passed).toBe(false);
    expect(result.errors.join(' ')).toMatch(/unknown component|disconnected/);
  });

  it('accepts a fully traced connected stage', () => {
    expect(validateRefinementStageOutput('interfaces', { interfaces: [{ id: 'if1', between: ['tank', 'pump'], kind: 'fluid', requirementIds: ['r1'] }] }, { intent, decomposition })).toEqual({ passed: true, errors: [] });
  });

  it('rejects final-stage component merging and accepted requirement mutation', () => {
    const interfaces = { interfaces: [{ id: 'if1', between: ['tank', 'pump'], kind: 'mechanical', requirementIds: ['r1'] }] };
    const merged = {
      requirements: [{ ...intent.requirements[0], text: 'Changed after acceptance' }],
      definitions: [{ id: 'tank', name: 'Tank and pump', responsibility: 'Do everything', requirementIds: ['r1'] }],
      instances: [{ id: 'tank-1', definitionId: 'tank' }], mates: [], physicalNetworks: [],
    };
    const result = validateRefinementStageOutput('part_programs', merged, { intent, decomposition, interfaces });
    expect(result.passed).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('requirement r1.text changed'),
      expect.stringContaining('component pump was merged'),
      expect.stringContaining('interface if1'),
    ]));
  });

  it('accepts only an exact final inventory with every accepted interface represented', () => {
    const interfaces = { interfaces: [{ id: 'if1', between: ['tank', 'pump'], kind: 'mechanical', requirementIds: ['r1'] }] };
    const final = {
      requirements: intent.requirements,
      definitions: [
        { ...decomposition.components[0], requirementIds: ['r1'] },
        { ...decomposition.components[1], requirementIds: ['r1'] },
      ],
      instances: [{ id: 'tank-1', definitionId: 'tank' }, { id: 'pump-1', definitionId: 'pump' }],
      mates: [{ id: 'if1', a: { partId: 'tank-1' }, b: { partId: 'pump-1' } }],
      physicalNetworks: [],
    };
    expect(validateRefinementStageOutput('part_programs', final, { intent, decomposition, interfaces })).toEqual({ passed: true, errors: [] });
  });
});
