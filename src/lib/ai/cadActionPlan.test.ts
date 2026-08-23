import { describe, expect, it } from 'vitest';
import { buildCadActionPlan } from './cadActionPlan';

describe('CAD action plan contract', () => {
  it('describes a generated assembly as normalize/generate/verify/export', () => {
    const plan = buildCadActionPlan('터보제트 연소기와 샤프트 조립체', {
      type: 'assembly', prompt: 'annular combustor and shaft', reply: '생성합니다',
    });
    expect(plan.schema).toBe('nexyfab.cad-action-plan.v1');
    expect(plan.operation).toBe('create_assembly');
    expect(plan.steps).toEqual(['normalize', 'generate', 'verify', 'export']);
    expect(plan.canonicalTerms).toEqual(expect.arrayContaining(['annular_combustor', 'shaft']));
  });

  it('keeps a reply in confirmation state', () => {
    const plan = buildCadActionPlan('브래킷 치수는?', { type: 'reply', reply: '가로를 알려주세요' });
    expect(plan.needsConfirmation).toBe(true);
    expect(plan.steps).toEqual(['normalize']);
  });

  it('surfaces typo confirmation and the generic planner instead of a terminal vocabulary error', () => {
    const typo = buildCadActionPlan('make a braket 40mm x 30mm', { type: 'scad', prompt: 'bracket', reply: 'preview' });
    expect(typo.needsConfirmation).toBe(true);
    expect(typo.ambiguities).toContain('recovered_typo_or_noncanonical_term');
    expect(typo.interpretation.confirmationPrompt).toBe('Is this what you mean: bracket?');

    const unknown = buildCadActionPlan('design a quantum widget 12mm', { type: 'scad', prompt: 'generic', reply: 'preview' });
    expect(unknown.tools).toContainEqual(expect.objectContaining({ tool: 'product-planner' }));
    expect(unknown.interpretation.candidates[0]?.plannerPath).toBe('generic-parametric');
  });
});
