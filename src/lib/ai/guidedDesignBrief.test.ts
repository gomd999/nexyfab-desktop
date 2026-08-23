import { describe, expect, it } from 'vitest';
import {
  answerGuidedBriefQuestion,
  buildGuidedDesignBrief,
  composeGuidedDesignPrompt,
  inferRequestedMaturity,
  isNewDesignPrompt,
  seedGuidedBriefInputs,
  buildGuidedRequirementGate,
  validateGuidedRequirementGate,
} from './guidedDesignBrief';

describe('guided design brief', () => {
  it('recognizes new-design requests separately from feature edits', () => {
    expect(isNewDesignPrompt('Design a new aluminum bracket')).toBe(true);
    expect(isNewDesignPrompt('Add a 2 mm fillet')).toBe(false);
    expect(inferRequestedMaturity('양산 제조 승인을 위한 설계')).toBe('release');
    expect(inferRequestedMaturity('정밀 공차 모델')).toBe('exact');
  });

  it('lets an explicit mechanical concept proceed without inventing exact inputs', () => {
    const prompt = '80×50 mm 알루미늄 브라켓을 만들어줘';
    const brief = buildGuidedDesignBrief({
      prompt,
      requestedStage: 'concept',
      selectedDomains: ['mechanical'],
      inputs: seedGuidedBriefInputs(prompt, 'mechanical'),
    });
    expect(brief.canGenerateConcept).toBe(true);
    expect(brief.plan.status).toBe('ready_for_concept');
  });

  it('asks for missing manufacturing evidence before entering exact CAD', () => {
    const prompt = '정밀한 브라켓을 설계해줘';
    const brief = buildGuidedDesignBrief({
      prompt,
      requestedStage: 'exact',
      selectedDomains: ['mechanical'],
      inputs: seedGuidedBriefInputs(prompt, 'mechanical'),
    });
    expect(brief.plan.status).toBe('authoritative_input_required');
    expect(brief.questions.map(item => item.input.key)).toEqual(expect.arrayContaining(['critical_dimensions', 'material_process']));
    expect(brief.canEnterExactCad).toBe(false);
  });

  it('does not treat an assumption as authoritative exact evidence', () => {
    const initial = buildGuidedDesignBrief({
      prompt: '정밀 기계 부품 설계',
      requestedStage: 'exact',
      selectedDomains: ['mechanical'],
      inputs: seedGuidedBriefInputs('정밀 기계 부품 설계', 'mechanical'),
    });
    const critical = initial.questions.find(item => item.input.key === 'critical_dimensions')!;
    const answered = answerGuidedBriefQuestion(initial, critical, '100×40×5 mm로 가정', 'assumed');
    expect(answered.questions.map(item => item.input.key)).toContain('critical_dimensions');
    expect(answered.canEnterExactCad).toBe(false);
  });

  it('accepts sequential user-confirmed answers and preserves provenance in the execution prompt', () => {
    const prompt = '정밀 브라켓 설계';
    let brief = buildGuidedDesignBrief({ prompt, requestedStage: 'exact', selectedDomains: ['mechanical'], inputs: seedGuidedBriefInputs(prompt, 'mechanical') });
    for (const key of ['critical_dimensions', 'material_process']) {
      const question = brief.questions.find(item => item.input.key === key)!;
      brief = answerGuidedBriefQuestion(brief, question, key === 'critical_dimensions' ? '100×50×5 mm, ±0.1 mm' : '6061-T6 CNC 밀링');
    }
    expect(brief.plan.status).toBe('ready_for_exact');
    expect(brief.canEnterExactCad).toBe(true);
    expect(composeGuidedDesignPrompt(brief)).toContain('[user_confirmed]');
  });

  it('requires field evidence for an interior concept instead of fabricating room geometry', () => {
    const prompt = '작은 카페 인테리어를 설계해줘';
    const brief = buildGuidedDesignBrief({ prompt, requestedStage: 'concept', selectedDomains: ['interior'], inputs: seedGuidedBriefInputs(prompt, 'interior') });
    expect(brief.questions.map(item => item.input.key)).toContain('field_measurement');
    expect(brief.canGenerateConcept).toBe(false);
  });

  it('keeps unresolved exact alternatives blocked and asks the same precise field again', () => {
    const prompt = 'Design an exact bracket';
    let brief = buildGuidedDesignBrief({ prompt, requestedStage: 'exact', selectedDomains: ['mechanical'], inputs: seedGuidedBriefInputs(prompt, 'mechanical') });
    const dimensions = brief.questions.find(item => item.input.key === 'critical_dimensions')!;
    brief = answerGuidedBriefQuestion(brief, dimensions, '100 mm or 120 mm');
    expect(brief.canEnterExactCad).toBe(false);
    expect(brief.questions[0]?.input.key).toBe('critical_dimensions');
    expect(buildGuidedRequirementGate(brief)).toMatchObject({
      ready: false,
      nextInput: { key: 'critical_dimensions', reason: 'CONFLICT' },
    });
  });

  it('rejects a forged ready aggregate when authoritative inputs are missing', () => {
    const brief = buildGuidedDesignBrief({ prompt: 'Design an exact bracket', requestedStage: 'exact', selectedDomains: ['mechanical'], inputs: seedGuidedBriefInputs('Design an exact bracket', 'mechanical') });
    const gate = buildGuidedRequirementGate(brief);
    expect(validateGuidedRequirementGate({ ...gate, ready: true })).toContain('forged_guided_requirement_aggregate');
  });

  it('blocks explicitly unmanufacturable and non-positive exact inputs', () => {
    for (const prompt of [
      'Design an exact 100 x 60 x 0 mm aluminum bracket; manufacturing impossible.',
      '100 x 60 x 8 mm 알루미늄 브래킷이며 제조 불가 조건으로 정밀 설계해줘.',
    ]) {
      const brief = buildGuidedDesignBrief({
        prompt,
        requestedStage: 'exact',
        selectedDomains: ['mechanical'],
        inputs: seedGuidedBriefInputs(prompt, 'mechanical'),
      });
      const gate = buildGuidedRequirementGate(brief);
      expect(gate.ready).toBe(false);
      expect(gate.items.some(item => item.state === 'CONFLICT')).toBe(true);
      expect(brief.canEnterExactCad).toBe(false);
    }
  });
});
