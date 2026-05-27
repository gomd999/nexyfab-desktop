import { describe, it, expect } from 'vitest';
import {
  selectContact,
  selectMultiple,
  emitAbaqusDefinition,
  recommendTangentialStiffness,
  summarize,
  type ContactPairInput,
} from './contactBondingSelector';

function pair(joint: ContactPairInput['joint'], opts: Partial<ContactPairInput> = {}): ContactPairInput {
  return { id: 'p1', joint, largeDeformation: false, frictionCoefficient: 0.2, thermal: false, ...opts };
}

describe('selectContact', () => {
  it('weld → bonded', () => {
    expect(selectContact(pair('weld')).type).toBe('bonded');
  });

  it('press-fit → no-separation', () => {
    expect(selectContact(pair('press-fit')).type).toBe('no-separation');
  });

  it('shrink-fit → no-separation', () => {
    expect(selectContact(pair('shrink-fit')).type).toBe('no-separation');
  });

  it('bolted → friction', () => {
    expect(selectContact(pair('bolted')).type).toBe('friction');
  });

  it('sliding → friction', () => {
    expect(selectContact(pair('sliding')).type).toBe('friction');
  });

  it('hinge → friction', () => {
    expect(selectContact(pair('hinge')).type).toBe('friction');
  });

  it('frictionless → frictionless', () => {
    expect(selectContact(pair('frictionless')).type).toBe('frictionless');
  });

  it('glue → bonded', () => {
    expect(selectContact(pair('glue')).type).toBe('bonded');
  });

  it('thermal load promotes bonded → tied', () => {
    expect(selectContact(pair('weld', { thermal: true })).type).toBe('tied');
  });

  it('large deformation promotes bonded → tied', () => {
    expect(selectContact(pair('glue', { largeDeformation: true })).type).toBe('tied');
  });

  it('friction coefficient passed through', () => {
    const r = selectContact(pair('bolted', { frictionCoefficient: 0.35 }));
    expect(r.frictionCoefficient).toBe(0.35);
  });

  it('rationale text present', () => {
    expect(selectContact(pair('weld')).rationale.length).toBeGreaterThan(0);
  });

  it('needsTangentialK true for friction / no-separation', () => {
    expect(selectContact(pair('bolted')).needsTangentialK).toBe(true);
    expect(selectContact(pair('press-fit')).needsTangentialK).toBe(true);
  });
});

describe('selectMultiple', () => {
  it('returns one per input', () => {
    const r = selectMultiple([pair('weld'), pair('bolted'), pair('frictionless')]);
    expect(r).toHaveLength(3);
  });
});

describe('emitAbaqusDefinition', () => {
  it('bonded emits *Tie', () => {
    const lines = emitAbaqusDefinition(selectContact(pair('weld')));
    expect(lines.some(l => l.startsWith('*Tie'))).toBe(true);
  });

  it('friction emits *Friction', () => {
    const lines = emitAbaqusDefinition(selectContact(pair('bolted')));
    expect(lines.some(l => l.startsWith('*Friction'))).toBe(true);
  });

  it('frictionless does not emit friction', () => {
    const lines = emitAbaqusDefinition(selectContact(pair('frictionless')));
    expect(lines.some(l => l.startsWith('*Friction'))).toBe(false);
  });
});

describe('recommendTangentialStiffness', () => {
  it('needs Kt → 0.4·Kn', () => {
    const r = selectContact(pair('bolted'));
    expect(recommendTangentialStiffness(r, 1000)).toBeCloseTo(400, 3);
  });

  it('no need Kt → 0', () => {
    const r = selectContact(pair('weld'));
    expect(recommendTangentialStiffness(r, 1000)).toBe(0);
  });
});

describe('summarize', () => {
  it('byType counts', () => {
    const results = selectMultiple([pair('weld'), pair('bolted')]);
    const s = summarize(results);
    expect(s.byType['bonded']).toBe(1);
    expect(s.byType['friction']).toBe(1);
  });

  it('needsTangentialKCount tracked', () => {
    const results = selectMultiple([pair('weld'), pair('bolted')]);
    const s = summarize(results);
    expect(s.needsTangentialKCount).toBe(1);
  });
});
