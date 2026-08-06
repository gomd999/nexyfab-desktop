import { describe, expect, it } from 'vitest';
import { evaluateAiGeneration, planGenerationRepair, type AiGenerationEvidence } from '../aiGenerationPipeline';

const complete: AiGenerationEvidence = {
  intent: { unresolved: [], conflicts: [] },
  decomposition: { valid: true, independentPartCount: 2, errors: [] },
  parts: [{ instanceId: 'a', manufacturingPassed: true, errors: [] }, { instanceId: 'b', manufacturingPassed: true, errors: [] }],
  assembly: { converged: true, finalMaxResidual: 0.001, tolerance: 0.01, unsupportedResiduals: 0, approximateDoF: 0, allowedDoF: 0 },
  interference: { checked: true, method: 'precise', overlaps: [], intendedContacts: [] },
  motion: { required: false, checked: false, collisionFree: true },
  stepRoundtrip: { passed: true, errors: [] },
};

describe('AI generation pipeline release gate', () => {
  it('passes only complete manufacturing and assembly evidence', () => expect(evaluateAiGeneration(complete).stage).toBe('complete'));
  it('blocks accidental overlap but permits justified intended contact', () => {
    const overlap = { ...complete, interference: { checked: true, method: 'precise' as const, overlaps: [{ partA: 'a', partB: 'b' }], intendedContacts: [] } };
    expect(evaluateAiGeneration(overlap).status).toBe('blocked');
    expect(evaluateAiGeneration({ ...overlap, interference: { ...overlap.interference, intendedContacts: [{ partA: 'b', partB: 'a', justification: 'press fit' }] } }).status).toBe('pass');
  });
  it('does not claim pass from a conservative-only collision scan', () => {
    expect(evaluateAiGeneration({ ...complete, interference: { ...complete.interference!, method: 'conservative' } }).status).toBe('review_required');
  });
  it('stops repeated repairs and preserves the verified upstream state', () => {
    expect(planGenerationRepair({ stage: 'part_geometry', fingerprint: 'same', attempt: 3 }, ['same', 'same'])).toMatchObject({ action: 'stop', rollbackTo: 'part_geometry' });
  });
});
