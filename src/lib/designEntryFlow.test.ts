import { describe, expect, it } from 'vitest';
import {
  DESIGN_ENTRY_COPY,
  classifyRasterDesignMetrics,
  recommendDesignExecutionLane,
} from './designEntryFlow';

describe('unified design entry routing', () => {
  it('routes complex concepts through AI design and authoritative edits to precision paths', () => {
    expect(recommendDesignExecutionLane({ prompt: '복잡한 로봇 제품을 요구사항부터 설계해줘' })).toBe('ai-design');
    expect(recommendDesignExecutionLane({ prompt: '기존 STEP 모델의 정확한 치수를 수정해줘' })).toBe('precision-cad');
    expect(recommendDesignExecutionLane({ prompt: 'CAD 에이전트가 계획하고 승인 후 자동으로 수정해줘' })).toBe('agentic-cad');
    expect(recommendDesignExecutionLane({ prompt: '', hasAuthoritativeCad: true })).toBe('precision-cad');
  });

  it('classifies clean monochrome sheets as drawings and textured input as photos', () => {
    expect(classifyRasterDesignMetrics({ brightRatio: 0.9, lowSaturationRatio: 0.98, edgeRatio: 0.08, luminanceVariance: 0.12 }).kind).toBe('drawing');
    expect(classifyRasterDesignMetrics({ brightRatio: 0.2, lowSaturationRatio: 0.2, edgeRatio: 0.38, luminanceVariance: 0.8 }).kind).toBe('photo');
  });

  it('has complete entry copy for every supported locale', () => {
    for (const copy of Object.values(DESIGN_ENTRY_COPY)) {
      expect(Object.values(copy).every(value => value.length > 0)).toBe(true);
    }
  });
});
