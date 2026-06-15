/**
 * Smoke / correctness tests for sketchExpressions (verification pass).
 * Covers the tricky points: precedence, units, builtins, topo eval, cycles.
 */
import { describe, it, expect } from 'vitest';
import {
  tokenize,
  parseExpression,
  evaluateExpression,
  evaluateAllVariables,
  detectCircularDependency,
  extractDependencies,
  parseUnit,
  convertUnit,
  type ExpressionContext,
} from './sketchExpressions';

const ctx = (vars: Record<string, { value: number; expression?: string }>): ExpressionContext => ({
  variables: Object.fromEntries(
    Object.entries(vars).map(([id, v]) => [id, { id, ...v }]),
  ),
});

const evalStr = (src: string, c: ExpressionContext = { variables: {} }) =>
  evaluateExpression(parseExpression(src), c);

describe('arithmetic + precedence', () => {
  it('respects * over +', () => expect(evalStr('2 + 3 * 4')).toBe(14));
  it('parenthesizes', () => expect(evalStr('(2 + 3) * 4')).toBe(20));
  it('** is right-associative', () => expect(evalStr('2 ** 3 ** 2')).toBe(512));
  it('modulo', () => expect(evalStr('10 % 3')).toBe(1));
  it('unary binds tighter than ** (documented grammar: (-2)**2 = 4)', () =>
    expect(evalStr('-2 ** 2')).toBe(4)); // NB: deviates from Python (-4)
  it('throws on division by zero', () => expect(() => evalStr('1/0')).toThrow(/division by zero/));
});

describe('builtins + constants', () => {
  it('pi constant', () => expect(evalStr('pi')).toBeCloseTo(Math.PI));
  it('sin(pi/2)', () => expect(evalStr('sin(pi/2)')).toBeCloseTo(1));
  it('max varargs', () => expect(evalStr('max(1, 9, 4)')).toBe(9));
  it('rejects unknown function', () => expect(() => evalStr('frobnicate(1)')).toThrow(/unknown function/));
  it('arity check', () => expect(() => evalStr('sin(1, 2)')).toThrow(/expects 1 arg/));
});

describe('units', () => {
  it('mm is canonical', () => expect(evalStr('10mm')).toBe(10));
  it('in → mm', () => expect(evalStr('1in')).toBeCloseTo(25.4));
  it('deg → rad', () => expect(evalStr('90deg')).toBeCloseTo(Math.PI / 2));
  it('parseUnit', () => expect(parseUnit('0.5in')).toEqual({ value: 0.5, unit: 'in' }));
  it('convertUnit length', () => expect(convertUnit(1, 'in', 'mm')).toBeCloseTo(25.4));
  it('convertUnit incompatible throws', () => expect(() => convertUnit(1, 'mm', 'deg')).toThrow());
  it('tokenizer keeps unit attached', () =>
    expect(tokenize('10mm')[0]).toMatchObject({ kind: 'NUMBER_UNIT', value: 10, unit: 'mm' }));
});

describe('variable references + dependencies', () => {
  it('resolves a free var', () => expect(evalStr('width * 2', ctx({ width: { value: 50 } }))).toBe(100));
  it('extractDependencies skips builtins', () =>
    expect(extractDependencies(parseExpression('w * pi + sin(h)')).sort()).toEqual(['h', 'w']));
});

describe('evaluateAllVariables (topological)', () => {
  it('resolves a dependency chain', () => {
    const c = ctx({
      width: { value: 50 },
      col_count: { value: 4 },
      spacing: { value: 5 },
      total: { value: 0, expression: 'width * col_count + spacing * (col_count - 1)' },
    });
    const results = evaluateAllVariables(c);
    const total = results.find((r) => r.variableId === 'total')!;
    expect(total.ok).toBe(true);
    expect(total.resolvedValue).toBe(50 * 4 + 5 * 3); // 215
    expect(total.dependsOn.sort()).toEqual(['col_count', 'spacing', 'width']);
  });

  it('does not mutate the input context', () => {
    const c = ctx({ a: { value: 1 }, b: { value: 0, expression: 'a + 10' } });
    evaluateAllVariables(c);
    expect(c.variables.b.value).toBe(0); // unchanged
  });

  it('flags non-finite (div by zero) as not ok', () => {
    const c = ctx({ a: { value: 0 }, b: { value: 0, expression: '1 / a' } });
    const b = evaluateAllVariables(c).find((r) => r.variableId === 'b')!;
    expect(b.ok).toBe(false);
  });

  it('flags a cycle as not ok', () => {
    const c = ctx({ a: { value: 0, expression: 'b + 1' }, b: { value: 0, expression: 'a + 1' } });
    const results = evaluateAllVariables(c);
    expect(results.every((r) => r.ok)).toBe(false);
    expect(results.find((r) => r.variableId === 'a')!.error).toMatch(/circular/);
  });
});

describe('detectCircularDependency', () => {
  it('finds a 2-cycle', () => {
    const c = ctx({ a: { value: 0, expression: 'b' }, b: { value: 0, expression: 'a' } });
    expect(detectCircularDependency(c)).toEqual([['a', 'b']]);
  });
  it('finds a self-loop', () => {
    const c = ctx({ a: { value: 0, expression: 'a + 1' } });
    expect(detectCircularDependency(c)).toEqual([['a']]);
  });
  it('no cycle on a DAG', () => {
    const c = ctx({ a: { value: 1 }, b: { value: 0, expression: 'a + 1' } });
    expect(detectCircularDependency(c)).toEqual([]);
  });
});
