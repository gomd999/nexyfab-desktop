import { describe, expect, it } from 'vitest';
import { referenceGuidanceForRequest } from './referenceGuidedRefinement';

describe('reference-guided complex-product refinement', () => {
  it('adds common authority gates and product-specific assembly connectivity', () => {
    expect(referenceGuidanceForRequest('custom product').requirementIds).toEqual(expect.arrayContaining(['NX-REQ-001', 'NX-AUTH-001', 'NX-CONN-001']));
    expect(referenceGuidanceForRequest('토목 도로 선형').requirementIds).not.toContain('NX-CONN-001');
  });

  it('keeps five domain guidance vocabularies distinct', () => {
    expect(referenceGuidanceForRequest('건축 BIM 공간').requirementIds).toEqual(expect.arrayContaining(['MAN-BIM-001', 'MAN-BLD-001']));
    expect(referenceGuidanceForRequest('조경 식재 관개').requirementIds).toContain('MAN-LAND-001');
    expect(referenceGuidanceForRequest('토목 도로 선형').requirementIds).toContain('MAN-CIV-002');
    expect(referenceGuidanceForRequest('인테리어 가구 마감').requirementIds).toContain('MAN-INT-001');
  });

  it.each([
    ['planetary gearbox', 'NX-GEAR-001'],
    ['ASME pressure vessel', 'NX-PV-001'],
    ['centrifugal impeller pump', 'NX-TURBO-001'],
    ['truck loading conveyor', 'NX-FACT-001'],
  ])('adds the governed family gate for %s', (request, requirementId) => {
    expect(referenceGuidanceForRequest(request).requirementIds).toContain(requirementId);
  });
});
