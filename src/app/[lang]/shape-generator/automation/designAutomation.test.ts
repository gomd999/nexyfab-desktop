import { describe, it, expect } from 'vitest';
import {
  evalExpression,
  initState,
  validateState,
  evaluateDerived,
  resolveBom,
  computeCost,
  stateToUrlParam,
  stateFromUrlParam,
  type DesignForm,
} from './designAutomation';

describe('evalExpression', () => {
  it('numeric arithmetic', () => {
    expect(evalExpression('1 + 2 * 3', {})).toBe(7);
  });

  it('parens override precedence', () => {
    expect(evalExpression('(1 + 2) * 3', {})).toBe(9);
  });

  it('variable lookup', () => {
    expect(evalExpression('width * 2', { width: 5 })).toBe(10);
  });

  it('comparison returns boolean', () => {
    expect(evalExpression('5 > 3', {})).toBe(true);
    expect(evalExpression('5 < 3', {})).toBe(false);
  });

  it('boolean logical AND/OR', () => {
    expect(evalExpression('true && false', {})).toBe(false);
    expect(evalExpression('true || false', {})).toBe(true);
  });

  it('string literals', () => {
    expect(evalExpression('"hello"', {})).toBe('hello');
  });

  it('unary negation', () => {
    expect(evalExpression('-5', {})).toBe(-5);
  });
});

const form: DesignForm = {
  id: 'shelf',
  name: 'Adjustable shelf',
  fields: [
    { id: 'width', label: 'Width', kind: 'number', min: 100, max: 2000, defaultValue: 600, unit: 'mm' },
    { id: 'depth', label: 'Depth', kind: 'number', min: 100, max: 800, defaultValue: 300, unit: 'mm' },
    { id: 'material', label: 'Material', kind: 'enum', defaultValue: 'oak',
      options: [{ value: 'oak', label: 'Oak' }, { value: 'pine', label: 'Pine' }] },
    { id: 'includeBrackets', label: 'Include brackets', kind: 'boolean', defaultValue: true },
    { id: 'bracketColor', label: 'Bracket color', kind: 'string',
      defaultValue: 'black', showIf: 'includeBrackets' },
  ],
  derived: [
    { id: 'area', label: 'Surface area', expression: 'width * depth', unit: 'mm²' },
  ],
  bom: [
    { partNumber: 'TOP-001', description: 'Shelf board', quantityExpression: '1' },
    { partNumber: 'BR-001', description: 'L-bracket', quantityExpression: '2',
      conditionExpression: 'includeBrackets' },
  ],
  costExpression: 'area * 0.0001 + (includeBrackets * 8)',
};

describe('initState', () => {
  it('returns defaults', () => {
    const s = initState(form);
    expect(s.width).toBe(600);
    expect(s.material).toBe('oak');
    expect(s.includeBrackets).toBe(true);
  });
});

describe('validateState', () => {
  it('clean defaults pass', () => {
    const r = validateState(form, initState(form));
    expect(r.valid).toBe(true);
  });

  it('below min → error', () => {
    const state = initState(form);
    state.width = 50;
    const r = validateState(form, state);
    expect(r.errors.some(e => e.fieldId === 'width')).toBe(true);
  });

  it('invalid enum → error', () => {
    const state = initState(form);
    state.material = 'titanium';
    const r = validateState(form, state);
    expect(r.errors.some(e => e.fieldId === 'material')).toBe(true);
  });

  it('hidden field with showIf=false is skipped', () => {
    const state = initState(form);
    state.includeBrackets = false;
    state.bracketColor = ''; // would be invalid if visible
    const r = validateState(form, state);
    expect(r.errors.some(e => e.fieldId === 'bracketColor')).toBe(false);
  });
});

describe('evaluateDerived', () => {
  it('computes area = width × depth', () => {
    const state = initState(form);
    const d = evaluateDerived(form, state);
    expect(d.area).toBe(600 * 300);
  });
});

describe('resolveBom', () => {
  it('emits top board always', () => {
    const bom = resolveBom(form, initState(form));
    expect(bom.find(b => b.partNumber === 'TOP-001')).toBeDefined();
  });

  it('brackets included when boolean true', () => {
    const bom = resolveBom(form, initState(form));
    expect(bom.find(b => b.partNumber === 'BR-001')?.quantity).toBe(2);
  });

  it('brackets excluded when false', () => {
    const state = initState(form);
    state.includeBrackets = false;
    const bom = resolveBom(form, state);
    expect(bom.find(b => b.partNumber === 'BR-001')).toBeUndefined();
  });
});

describe('computeCost', () => {
  it('includes derived field in expression', () => {
    const state = initState(form);
    const cost = computeCost(form, state);
    // area = 180000, cost = 18 + 8 (brackets) = 26.
    expect(cost).toBeCloseTo(26, 4);
  });

  it('skips bracket cost when false', () => {
    const state = initState(form);
    state.includeBrackets = false;
    const cost = computeCost(form, state);
    expect(cost).toBeCloseTo(18, 4);
  });
});

describe('URL serialization', () => {
  it('round-trip preserves state', () => {
    const state = initState(form);
    state.width = 1200;
    const url = stateToUrlParam(state);
    const restored = stateFromUrlParam(url);
    expect(restored).toEqual(state);
  });
});
