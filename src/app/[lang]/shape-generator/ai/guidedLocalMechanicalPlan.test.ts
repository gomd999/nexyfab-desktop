import { describe, expect, it } from 'vitest';
import { buildGuidedDesignBrief, buildGuidedRequirementGate, seedGuidedBriefInputs } from '@/lib/ai/guidedDesignBrief';
import { buildGuidedLocalMechanicalPlan } from './guidedLocalMechanicalPlan';

function gate(prompt: string) {
  return buildGuidedRequirementGate(buildGuidedDesignBrief({
    prompt,
    requestedStage: 'exact',
    selectedDomains: ['mechanical'],
    inputs: seedGuidedBriefInputs(prompt, 'mechanical'),
  }));
}

describe('buildGuidedLocalMechanicalPlan', () => {
  it('binds authoritative mixed-unit L-bracket dimensions to one deterministic feature edit', () => {
    const prompt = 'Design an exact L-bracket with 10 cm × 2 in legs, length 40 mm, thickness 5 mm, ±0.1 mm tolerance, 6061-T6 aluminum, CNC milling';
    const result = buildGuidedLocalMechanicalPlan(gate(prompt), prompt);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.aiModelExecution).toBe('NOT_RUN');
    expect(result.payload.intents).toEqual([{
      kind: 'set_base_shape',
      shapeId: 'lBracket',
      params: { width: 100, height: 50.8, depth: 40, thickness: 5 },
    }]);
    expect(result.payload.authoritativeRequirements.material_process.sourceRef).toBe('chat://initial-request');
    expect(result.payload.comparisonMetrics.every(metric => metric.status === 'PREVIEW')).toBe(true);
  });

  it('fails closed with an exact next question instead of inventing missing length', () => {
    const prompt = 'Design an exact L-bracket with 100 mm × 50 mm legs, thickness 5 mm, ±0.1 mm tolerance, 6061-T6 aluminum, CNC milling';
    expect(buildGuidedLocalMechanicalPlan(gate(prompt), prompt)).toEqual({
      ok: false,
      reason: 'missing_bracket_length',
      nextQuestion: 'Provide the bracket extrusion length, for example “length 40 mm”.',
    });
  });

  it('rejects non-manufacturable thickness and missing process', () => {
    const tooThick = 'Design an exact L-bracket with 100 mm × 50 mm legs, length 40 mm, thickness 50 mm, 6061-T6 aluminum, CNC milling';
    expect(buildGuidedLocalMechanicalPlan(gate(tooThick), tooThick)).toMatchObject({ ok: false, reason: 'invalid_bracket_thickness' });
    const noProcess = 'Design an exact L-bracket with 100 mm × 50 mm legs, length 40 mm, thickness 5 mm, 6061-T6 aluminum material';
    expect(buildGuidedLocalMechanicalPlan(gate(noProcess), noProcess)).toMatchObject({ ok: false, reason: 'missing_manufacturing_process' });
  });
});
