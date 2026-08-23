import { describe, expect, it } from 'vitest';
import { interpretCadRequest } from './cadInterpretationContract';

describe('CAD interpretation contract', () => {
  it('recognizes Korean colloquial create input, spacing, and preserves dimensions', () => {
    const result = interpretCadRequest('\uBE0C \uB77C\uCF13 \uB9CC\uB4E4\uC5B4\uC918 50mm x 20mm x 5mm');
    expect(result.intent).toBe('new_design');
    expect(result.candidates[0]).toMatchObject({ canonicalPart: 'bracket', mutationAllowed: true, requiresConfirmation: false });
    expect(result.preservedDimensions).toContain('50mm x 20mm x 5mm');
    expect(result.candidates[0]?.canonicalTerms).toContain('bracket');
  });

  it('recovers a common English typo but requires an is-this-what-you-mean turn', () => {
    const result = interpretCadRequest('make a braket, 40 mm x 30 mm');
    expect(result.intent).toBe('new_design');
    expect(result.candidates[0]?.canonicalPart).toBe('bracket');
    expect(result.candidates[0]?.preservedDimensions).toContain('40 mm x 30 mm');
    expect(result).toMatchObject({ mutationAllowed: false, requiresConfirmation: true, confirmationPrompt: 'Is this what you mean: bracket?' });
  });

  it('returns competing candidates and fails closed for an alternative part request', () => {
    const result = interpretCadRequest('make a bracket or plate, 50mm');
    expect(result.candidates.map(candidate => candidate.canonicalPart)).toEqual(expect.arrayContaining(['bracket', 'plate']));
    expect(result.selectedCandidateId).toBeUndefined();
    expect(result.requiresConfirmation).toBe(true);
    expect(result.mutationAllowed).toBe(false);
    expect(result.audit.failClosed).toBe(true);
  });

  it('keeps explicit multi-part requests as a composition, never the first part only', () => {
    const result = interpretCadRequest('design a bracket and shaft assembly');
    expect(result.candidates[0]?.canonicalPart).toBeUndefined();
    expect(result.candidates[0]?.canonicalTerms).toEqual(expect.arrayContaining(['bracket', 'shaft']));
    expect(result.candidates[0]?.tools).toContain('assembly');
  });

  it('blocks a request-only edit until its target scope is explicit', () => {
    const blocked = interpretCadRequest('change the width to 20mm');
    expect(blocked.intent).toBe('request_only_edit');
    expect(blocked.mutationAllowed).toBe(false);
    expect(blocked.candidates[0]?.ambiguities).toContain('missing_explicit_edit_scope');

    const scoped = interpretCadRequest({ message: 'change bracket width to 20mm', selectedPartInstanceId: 'bracket-17', existingDesign: true });
    expect(scoped.intent).toBe('request_only_edit');
    expect(scoped.candidates[0]?.scope).toMatchObject({ kind: 'part', target: 'bracket-17', source: 'selected-context' });
    expect(scoped.mutationAllowed).toBe(true);
  });

  it('binds selected-feature wording to the exact selected identity', () => {
    const result = interpretCadRequest({ message: 'change the selected feature radius to 4mm', selectedFeatureId: 'fillet-42', existingDesign: true });
    expect(result.candidates[0]?.scope).toEqual({ kind: 'feature', target: 'fillet-42', source: 'selected-context' });
    expect(result.mutationAllowed).toBe(true);
  });

  it('uses a generic parametric planner for an unknown product instead of failing', () => {
    const result = interpretCadRequest('design a quantum widget 12mm');
    expect(result.intent).toBe('new_design');
    expect(result.unknownVocabulary).toEqual(['no-known-canonical-vocabulary']);
    expect(result.candidates[0]).toMatchObject({ plannerPath: 'generic-parametric', requiresConfirmation: true, mutationAllowed: false });
    expect(result.candidates[0]?.tools).toEqual(expect.arrayContaining(['product-planner', 'scad']));
    expect(result.confirmationPrompt).toMatch(/^Is this what you mean/);
  });

  it('does not mutate a vague clarification', () => {
    const result = interpretCadRequest('\uC54C\uC544\uC11C \uC880 \uB354 \uC88B\uAC8C \uD574\uC918');
    expect(result.intent).toBe('clarification');
    expect(result.requiresConfirmation).toBe(true);
    expect(result.mutationAllowed).toBe(false);
    expect(result.candidates[0]?.ambiguities).toContain('vague_request');
  });
});
