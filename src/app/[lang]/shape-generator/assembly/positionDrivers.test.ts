import { describe, it, expect } from 'vitest';
import {
  parseExpr,
  evalExpr,
  evaluateDrivers,
  ExpressionError,
  type DriverDefinition,
} from './positionDrivers';

describe('parseExpr', () => {
  it('parses numbers', () => {
    expect(parseExpr('3.14')).toEqual({ kind: 'num', value: 3.14 });
  });

  it('parses variables', () => {
    expect(parseExpr('t')).toEqual({ kind: 'var', name: 't' });
  });

  it('parses binary operators with precedence', () => {
    const e = parseExpr('2 + 3 * 4');
    expect(evalExpr(e, {})).toBe(14);
  });

  it('parses parens', () => {
    expect(evalExpr(parseExpr('(2 + 3) * 4'), {})).toBe(20);
  });

  it('parses negation', () => {
    expect(evalExpr(parseExpr('-3 + 5'), {})).toBe(2);
  });

  it('parses function calls', () => {
    expect(evalExpr(parseExpr('sin(0)'), {})).toBe(0);
    expect(evalExpr(parseExpr('pow(2, 3)'), {})).toBe(8);
  });

  it('throws on bad syntax', () => {
    expect(() => parseExpr('2 + ')).toThrow();
  });
});

describe('evalExpr', () => {
  it('uses var table', () => {
    const e = parseExpr('t * 2');
    expect(evalExpr(e, { t: 5 })).toBe(10);
  });

  it('throws on undefined variable', () => {
    const e = parseExpr('x');
    expect(() => evalExpr(e, {})).toThrow(ExpressionError);
  });

  it('throws on division by zero', () => {
    const e = parseExpr('1 / 0');
    expect(() => evalExpr(e, {})).toThrow(/division/i);
  });

  it('evaluates power', () => {
    expect(evalExpr(parseExpr('2 ^ 8'), {})).toBe(256);
  });
});

describe('evaluateDrivers', () => {
  const driver: DriverDefinition = {
    id: 'd1', mateId: 'm1', paramKey: 'angle',
    expr: parseExpr('t * 90'),
  };

  it('emits computed values', () => {
    const out = evaluateDrivers([driver], { t: 2 });
    expect(out).toEqual([{ mateId: 'm1', paramKey: 'angle', value: 180 }]);
  });

  it('clamps to minValue / maxValue', () => {
    const d: DriverDefinition = { ...driver, maxValue: 100 };
    const out = evaluateDrivers([d], { t: 5 });
    expect(out[0]!.value).toBe(100);
  });

  it('skips drivers with unresolvable vars', () => {
    const d: DriverDefinition = { id: 'd2', mateId: 'm2', paramKey: 'x', expr: parseExpr('missing') };
    const out = evaluateDrivers([d], {});
    expect(out).toEqual([]);
  });

  it('gear ratio expression', () => {
    const gear: DriverDefinition = {
      id: 'gear', mateId: 'lower', paramKey: 'angle',
      expr: parseExpr('upper * 2.5'),
    };
    const out = evaluateDrivers([gear], { upper: 40 });
    expect(out[0]!.value).toBe(100);
  });

  it('crank-piston sin expression', () => {
    const piston: DriverDefinition = {
      id: 'piston', mateId: 'piston', paramKey: 'pos',
      expr: parseExpr('sin(crank) * 50'),
    };
    const out = evaluateDrivers([piston], { crank: Math.PI / 2 });
    expect(out[0]!.value).toBeCloseTo(50, 5);
  });
});
