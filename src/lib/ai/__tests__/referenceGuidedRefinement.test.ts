import { describe, expect, it } from 'vitest';
import { referenceGuidanceForRequest } from '../referenceGuidedRefinement';

describe('reference-guided refinement', () => {
  it('routes robot motion to assembly and continuous collision requirements', () => {
    const result = referenceGuidanceForRequest('6축 로봇 arm과 reducer를 설계해줘');
    expect(result.requirementIds).toEqual(expect.arrayContaining(['MAN-FT-001', 'MAN-ASM-001', 'MAN-CCD-001']));
  });
  it('adds BIM and interior verification without dropping common STEP rules', () => {
    const result = referenceGuidanceForRequest('IFC 기반 인테리어 room과 door, MEP 설계');
    expect(result.requirementIds).toEqual(expect.arrayContaining(['MAN-BIM-001', 'MAN-INT-001', 'MAN-IO-001']));
  });
  it('marks reference-derived unsupported civil and graph capabilities explicitly', () => {
    const result = referenceGuidanceForRequest('Grasshopper node graph로 civil road alignment corridor 생성');
    expect(result.requirementIds).toEqual(expect.arrayContaining(['MAN-CIV-001', 'MAN-GRAPH-001']));
    expect(result.rules.join(' ')).toContain('unsupported');
  });
});
