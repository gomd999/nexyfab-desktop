import { describe, expect, it } from 'vitest';
import type { StructuredBrief } from '../brief-expander/types';
import {
  addEvidenceDecision,
  authoritativeParams,
  confirmDesignDecision,
  gateDesignIntentIR,
  structuredBriefToDesignIntentIR,
} from '../designIntentIR';

const brief: StructuredBrief = {
  title: 'Bracket', domain: 'mech', raw: '50mm bracket, thickness to be confirmed',
  questions: ['What is the thickness?'], assumptions: [],
  components: [{ name: 'body', params: [
    { key: 'width', value: 50, unit: 'mm', source: 'given' },
    { key: 'thickness', value: null, unit: 'mm', source: 'needs_input', note: 'Not supplied' },
  ] }],
};

describe('Design Intent IR', () => {
  it('preserves given and unresolved values instead of flattening both into params', () => {
    const ir = structuredBriefToDesignIntentIR(brief);
    expect(ir.decisions.map(item => item.status)).toEqual(['confirmed', 'needs_input']);
    expect(gateDesignIntentIR(ir)).toMatchObject({ ready: false });
    expect(gateDesignIntentIR(ir).reasons).toContain('thickness needs user input.');
  });

  it('marks contradictory evidence as a conflict rather than overwriting', () => {
    const ir = structuredBriefToDesignIntentIR({
      ...brief,
      components: [{ name: 'body', params: [{ key: 'width', value: 50, unit: 'mm', source: 'given' }] }],
    });
    const next = addEvidenceDecision(ir,
      { id: 'evidence:drawing-1', kind: 'drawing_dimension', sourceRef: 'drawing:dim-14', confidence: 0.99 },
      {
        id: 'component:body-1:param:width-drawing', componentId: 'component:body-1', key: 'width',
        value: 55, unit: 'mm', evidenceIds: ['evidence:drawing-1'], rationale: 'Drawing callout',
      },
    );
    expect(next.decisions.filter(item => item.key === 'width').every(item => item.status === 'conflict')).toBe(true);
    expect(gateDesignIntentIR(next).ready).toBe(false);
  });

  it('exports compiler params only after all decisions are resolved', () => {
    const complete = structuredBriefToDesignIntentIR({
      ...brief,
      components: [{ name: 'body', params: [
        { key: 'width', value: 50, unit: 'mm', source: 'given' },
        { key: 'thickness', value: 4, unit: 'mm', source: 'given' },
      ] }],
    });
    expect(gateDesignIntentIR(complete).ready).toBe(true);
    expect(authoritativeParams(complete, 'component:body-1')).toEqual({ width: 50, thickness: 4 });
  });

  it('does not promote a labeled assumption to an authoritative compiler parameter', () => {
    const assumed = structuredBriefToDesignIntentIR({
      ...brief,
      components: [{ name: 'body', params: [
        { key: 'thickness', value: 4, unit: 'mm', source: 'assumption', note: 'Typical stock' },
      ] }],
    });
    expect(gateDesignIntentIR(assumed).ready).toBe(false);
    expect(gateDesignIntentIR(assumed).reasons).toContain('thickness is still an unconfirmed assumption.');
    expect(authoritativeParams(assumed, 'component:body-1')).toEqual({});
  });

  it('promotes an assumption only after an explicit user confirmation', () => {
    const assumed = structuredBriefToDesignIntentIR({
      ...brief,
      components: [{ name: 'body', params: [
        { key: 'thickness', value: 4, unit: 'mm', source: 'assumption', note: 'Typical stock' },
      ] }],
    });
    const decisionId = assumed.decisions[0].id;
    const confirmed = confirmDesignDecision(assumed, decisionId, 4, '4mm로 진행해 주세요');
    expect(gateDesignIntentIR(confirmed).ready).toBe(true);
    expect(authoritativeParams(confirmed, 'component:body-1')).toEqual({ thickness: 4 });
    expect(confirmed.evidence.at(-1)).toMatchObject({ sourceRef: `confirmation:${decisionId}`, confidence: 1 });
  });
});
